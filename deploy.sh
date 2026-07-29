#!/usr/bin/env bash
# Full deployment: build frontend → package Lambda → deploy stack → sync S3 → invalidate CF → force-refresh Lambda
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

# Verify the build produced the client entry before touching S3
[ -f static/index.html ] || { echo "ERROR: static/index.html not found — build may have failed"; exit 1; }

# Stage the built artifacts the SSG Lambda ships (see ssg-lambda/Makefile).
# HTML pages and data/listings.json are owned by the Lambda refresh path — not synced here.
echo "    stage SSG Lambda artifacts"
cp dist-ssr/entry-server.js ssg-lambda/entry-server.js
cp scripts/render-core.mjs ssg-lambda/render-core.mjs
cp scripts/template.mjs ssg-lambda/template.mjs
cp scripts/site-constants.mjs ssg-lambda/site-constants.mjs
cp static/.vite/manifest.json ssg-lambda/manifest.json

echo "==> 2/6 SAM build (package Lambdas)"
sam build

# Smoke-test the built package before deploying: a missing module in the
# Makefile copy list breaks `import app` at runtime and takes the Lambda down.
# Importing from the build artifact catches that here instead of in prod.
echo "    verifying built package imports app..."
( cd .aws-sam/build/ApiFunction && python -c "import app" ) \
  || { echo "ERROR: built Lambda package cannot import app — check Makefile copy list"; exit 1; }

# Same failure mode on the Node side, which had no equivalent check:
# ssg-lambda/Makefile copies its modules by hand-enumerated name, so a new
# import that nobody added to that list only fails at runtime, in prod, on the
# next refresh. Assert the artifacts are all present in the built package.
echo "    verifying built SSG package has every module..."
for module in index.mjs render-core.mjs template.mjs site-constants.mjs entry-server.js manifest.json; do
  [ -f ".aws-sam/build/SsgFunction/$module" ] \
    || { echo "ERROR: SsgFunction package is missing $module — check ssg-lambda/Makefile copy list"; exit 1; }
done

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
#   2. Everything else (icons, manifests, etc.) → no-cache.
#      HTML pages and data/listings.json are excluded — owned by the Lambda refresh path.
aws s3 sync static/ "s3://$BUCKET" \
  --exclude "*" --include "assets/*" --include "fonts/*" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 sync static/ "s3://$BUCKET" \
  --exclude "assets/*" --exclude "fonts/*" --exclude ".vite/*" \
  --exclude "*.html" --exclude "data/*" \
  --cache-control "no-cache"

# 404 page: public/ static HTML, not owned by the SSG Lambda render path
aws s3 cp static/404.html "s3://$BUCKET/404.html" --cache-control "no-cache"

echo "==> 5/6 Invalidate CloudFront cache"
DIST=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)
[ -z "$DIST" ] && { echo "ERROR: DistributionId not found in stack outputs"; exit 1; }
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*"

echo "==> 6/6 Force-refresh listings (fetch providers → publish data/listings.json → trigger SSG render)"
FUNC=$(aws cloudformation describe-stack-resource --stack-name "$STACK" \
  --logical-resource-id ApiFunction \
  --query "StackResourceDetail.PhysicalResourceId" \
  --output text 2>/dev/null || true)
if [ -n "$FUNC" ] && [ "$FUNC" != "None" ]; then
  aws lambda invoke \
    --function-name "$FUNC" \
    --payload '{"source":"aws.events"}' \
    --cli-binary-format raw-in-base64-out \
    /tmp/barcelona-refresh-response.json > /dev/null
  # On first deploy S3 is empty; poll until SSG renderer writes index.html (up to 60s).
  echo "    waiting for SSG render to write index.html..."
  found=false
  for i in $(seq 1 30); do
    if aws s3 ls "s3://$BUCKET/index.html" > /dev/null 2>&1; then
      found=true; break
    fi
    [ "$i" -lt 30 ] && sleep 2
  done
  if $found; then
    echo "    SSG render complete."
    # Safe to delete stale hashed bundles now: SSG has re-rendered all HTML with
    # the new asset references, and CF cache is already invalidated.
    echo "    cleaning up stale assets..."
    aws s3 sync static/assets/ "s3://$BUCKET/assets/" --delete --size-only
    aws s3 sync static/fonts/  "s3://$BUCKET/fonts/"  --delete --size-only
  else
    echo "ERROR: index.html not found after 60s — SSG render did not complete"; exit 1
  fi
else
  echo "Could not resolve function name — skipping refresh."
fi

echo ""
APP=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" \
  --output text)
echo "Done. App URL: $APP"
