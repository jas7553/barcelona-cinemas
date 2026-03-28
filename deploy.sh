#!/usr/bin/env bash
# Full deployment: build frontend → package Lambda → deploy stack → sync S3 → invalidate CF
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

if [ "$GUIDED" != "--guided" ]; then
  HAS_ORIGIN_TOKEN=$(python3 -c "import tomllib; d=tomllib.load(open('samconfig.toml','rb')); s=d['default']['deploy']['parameters'].get('parameter_overrides',''); print('yes' if 'ApiOriginVerifyToken=' in s else 'no')" 2>/dev/null || echo "no")
  if [ "$HAS_ORIGIN_TOKEN" != "yes" ]; then
    echo "ERROR: samconfig.toml does not include ApiOriginVerifyToken in deploy.parameter_overrides."
    echo "Run './deploy.sh --guided' once to set the origin verification secret, then use './deploy.sh' for later deploys."
    exit 1
  fi
fi

echo "==> 0/5 Validate SAM template"
sam validate

echo "==> 1/5 Build React frontend (npm run build → static/)"
npm run build

# Verify the build produced an index.html before touching S3
[ -f static/index.html ] || { echo "ERROR: static/index.html not found — build may have failed"; exit 1; }

echo "==> 2/5 SAM build (package Lambda + dependencies)"
sam build

echo "==> 3/5 SAM deploy"
if [ "$GUIDED" = "--guided" ]; then
  sam deploy --guided
else
  sam deploy
fi

echo "==> 4/5 Sync static/ → S3 FrontendBucket"
BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)
[ -z "$BUCKET" ] && { echo "ERROR: FrontendBucketName not found in stack outputs"; exit 1; }

# Upload new assets without --delete: old hashed assets stay in S3 until the CloudFront
# invalidation has fully propagated (~5 min), preventing 404s on cached pages mid-deploy.
aws s3 sync static/ "s3://$BUCKET"

echo "==> 5/5 Invalidate CloudFront cache"
DIST=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)
[ -z "$DIST" ] && { echo "ERROR: DistributionId not found in stack outputs"; exit 1; }
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*"

echo ""
APP=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" \
  --output text)
echo "Done. App URL: $APP"
