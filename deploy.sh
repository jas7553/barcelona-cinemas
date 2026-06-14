#!/usr/bin/env bash
# Full deployment: build frontend → package Lambda → deploy stack → sync S3 → invalidate CF → warm Lambda
#
# First deploy:   ./deploy.sh --guided
# Subsequent:     ./deploy.sh
#
# The TMDb API key is expected to be available from AWS Systems Manager
# Parameter Store, so it does not need to be passed directly at deploy time.
set -euo pipefail

STACK=$(python3 -c "import tomllib; d=tomllib.load(open('samconfig.toml','rb')); print(d['default']['deploy']['parameters']['stack_name'])" 2>/dev/null \
  || { echo "ERROR: could not read stack_name from samconfig.toml"; exit 1; })
GUIDED=${1:-""}

echo "==> 0/6 Validate SAM template"
sam validate

echo "==> 1/6 Build frontend (npm run build → static/ bundles + dist-ssr/ SSR bundle)"
npm run build

# Verify the build produced an index.html before touching S3
[ -f static/index.html ] || { echo "ERROR: static/index.html not found — build may have failed"; exit 1; }

# Render the static pages from real listings (build alone emits an empty list).
# The same render runs in production via the SSG Lambda on every 12h refresh.
echo "    export public listings + render static pages"
npm run export-data
node scripts/render.mjs

# Stage the built artifacts the SSG Lambda ships (see ssg-lambda/Makefile).
echo "    stage SSG Lambda artifacts"
cp dist-ssr/entry-server.js ssg-lambda/entry-server.js
cp scripts/render-core.mjs ssg-lambda/render-core.mjs
cp scripts/template.mjs ssg-lambda/template.mjs
cp static/.vite/manifest.json ssg-lambda/manifest.json

echo "==> 2/6 SAM build (package Lambdas)"
sam build

# Smoke-test the built package before deploying: a missing module in the
# Makefile copy list breaks `import app` at runtime and takes the Lambda down.
# Importing from the build artifact catches that here instead of in prod.
echo "    verifying built package imports app..."
( cd .aws-sam/build/ApiFunction && python -c "import app" ) \
  || { echo "ERROR: built Lambda package cannot import app — check Makefile copy list"; exit 1; }

echo "==> 3/6 SAM deploy"
# Fetch distribution ID + domain from the existing stack so they can be injected
# into the SSG Lambda for post-refresh invalidation + OpenGraph og:url. Absent on first deploy.
CF_DIST_ID=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text 2>/dev/null || true)
CF_DOMAIN=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" \
  --output text 2>/dev/null | sed 's|https://||' || true)
# A CLI --parameter-overrides flag REPLACES samconfig.toml's parameter_overrides
# rather than merging with it, and parameters new to the stack have no previous
# value to fall back on. So re-read the saved overrides and append the
# CloudFront values to them.
OVERRIDES=()
while IFS= read -r -d '' token; do
  OVERRIDES+=("$token")
done < <(python3 -c "
import shlex, sys, tomllib
s = tomllib.load(open('samconfig.toml','rb'))['default']['deploy']['parameters'].get('parameter_overrides','')
# sam joins the argv tokens and re-splits on whitespace, so values containing
# spaces (e.g. 'rate(12 hours)') must carry their own quotes.
# Each token is NUL-terminated (not NUL-joined): bash's 'read -d \"\"' returns
# nonzero at EOF, so a final token without a trailing NUL would be dropped.
for tok in shlex.split(s):
    key, _, value = tok.partition('=')
    # ApiOriginVerifyToken was retired with the public API — skip it so a stale
    # samconfig.toml entry doesn't fail the deploy with an unknown parameter.
    if key == 'ApiOriginVerifyToken':
        continue
    sys.stdout.write(f'{key}=\"{value}\"\0')
")
[ -n "$CF_DIST_ID" ] && [ "$CF_DIST_ID" != "None" ] && OVERRIDES+=("CloudFrontDistributionId=\"$CF_DIST_ID\"")
[ -n "$CF_DOMAIN" ] && [ "$CF_DOMAIN" != "None" ] && OVERRIDES+=("CloudFrontDomainName=\"$CF_DOMAIN\"")

if [ "$GUIDED" = "--guided" ]; then
  sam deploy --guided
else
  sam deploy --parameter-overrides "${OVERRIDES[@]}"
fi

echo "==> 4/6 Sync static/ → S3 FrontendBucket"
BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)
[ -z "$BUCKET" ] && { echo "ERROR: FrontendBucketName not found in stack outputs"; exit 1; }

# Upload new assets without --delete: old hashed assets stay in S3 until the CloudFront
# invalidation has fully propagated (~5 min), preventing 404s on cached pages mid-deploy.
#
# Two passes set Cache-Control at the origin (CloudFront's StaticAssetsHeadersPolicy
# also stamps it at the edge — belt and suspenders):
#   1. Content-hashed bundles (assets/) and frozen fonts (fonts/) → cache for a year,
#      immutable. Their URLs change when content changes, so this is always safe.
#      If you ever swap a font, rename the file — the name is not content-hashed.
#   2. Everything else (index.html, manifest, icons) → no-cache, so a new deploy's
#      index.html, which points at the new hashed asset names, is always revalidated
#      rather than served stale from a browser cache.
aws s3 sync static/ "s3://$BUCKET" \
  --exclude "*" --include "assets/*" --include "fonts/*" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 sync static/ "s3://$BUCKET" \
  --exclude "assets/*" --exclude "fonts/*" --exclude ".vite/*" \
  --cache-control "no-cache"

echo "==> 5/6 Invalidate CloudFront cache"
DIST=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)
[ -z "$DIST" ] && { echo "ERROR: DistributionId not found in stack outputs"; exit 1; }
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*"

echo "==> 6/6 Warm Lambda (reduce first cold start)"
FUNC=$(aws cloudformation describe-stack-resource --stack-name "$STACK" \
  --logical-resource-id ApiFunction \
  --query "StackResourceDetail.PhysicalResourceId" \
  --output text 2>/dev/null || true)
if [ -n "$FUNC" ] && [ "$FUNC" != "None" ]; then
  aws lambda invoke \
    --function-name "$FUNC" \
    --payload '{"source":"warmup"}' \
    --cli-binary-format raw-in-base64-out \
    /dev/null > /dev/null
  echo "Lambda warmed."
else
  echo "Could not resolve function name — skipping warmup."
fi

echo ""
APP=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" \
  --output text)
echo "Done. App URL: $APP"
