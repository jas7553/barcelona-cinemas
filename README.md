# Barcelona Movie Database

Small weekend project for tracking English-language movie showings in Barcelona.

It aggregates local showtimes, enriches them with TMDb metadata, and serves the result through a React frontend with a Flask API running on AWS Lambda.

## What It Does

- Aggregates showtimes for tracked cinemas.
- Enriches movies with TMDb metadata such as runtime, genres, rating, and synopsis.
- Serves cached data so normal page loads do not trigger live data fetching.
- Marks cached data as stale instead of refreshing in-band on user requests.

## Architecture

```text
React SPA (src/) -> Flask API (app.py) -> pipeline.py
                                          |- providers/listings_provider.py
                                          |- enricher.py
                                          |- validation.py
                                          `- cache.py
```

Request flow:

- `GET /api/cinemas` returns the tracked cinema registry used by the frontend filters.
- `GET /api/listings` returns cached listings only.
- If the cache is older than the TTL, the API responds with `"stale": true`.
- If the listings path fails and any cache exists, stale cache is returned instead of an in-band refresh.
- A scheduled EventBridge refresh updates the cache in the background.

Production hardening:

- In AWS, CloudFront sends a shared-secret header to the API origin and direct origin requests are rejected.
- Local development leaves that protection disabled unless `ORIGIN_VERIFY_TOKEN` is explicitly set.

## Local Setup

Prerequisites:

- Python 3.12
- Node.js 22.12 or newer
- npm

Backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
python app.py
```

The backend runs on `http://localhost:5000` by default.

Frontend:

```bash
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5173`.

Important:

- In the current repo config, Vite proxies `/api` to `http://localhost:5001`.
- If you run the backend with its default `PORT=5000`, either update [`vite.config.ts`](vite.config.ts) or start Flask on port `5001`.

## Environment Variables

Local development works without TMDb credentials, but enrichment is skipped and only raw listing data is returned.

| Variable | Default | Notes |
| --- | --- | --- |
| `TMDB_API_KEY` | none | Optional locally; enables TMDb enrichment in development. |
| `CACHE_BACKEND` | `file` | Use `file` locally and `s3` in AWS. |
| `CACHE_TTL_HOURS` | `12` | Age after which cached data is marked stale. |
| `CACHE_DIR` | `./cache` | File cache directory for local use. |
| `PORT` | `5000` | Flask development port. |
| `S3_BUCKET` | none | Required only when `CACHE_BACKEND=s3`. |
| `S3_KEY` | `listings.json` | Required only when `CACHE_BACKEND=s3`. |
| `TMDB_SSM_PARAMETER` | none | Optional parameter name for AWS-hosted deployments. |
| `LISTINGS_FEED_URL` | none | Optional local override for the listings feed URL. |
| `LISTINGS_FEED_SSM_PARAMETER` | none | Optional parameter name for the listings feed URL in AWS-hosted deployments. |
| `ORIGIN_VERIFY_TOKEN` | none | Optional locally; when set, API requests must include the matching `X-Origin-Verify` header. |
| `APP_DEBUG` | none | Optional local-only flag to enable Flask debug mode outside Lambda. |

Example local `.env`:

```bash
CACHE_DIR=./cache
CACHE_TTL_HOURS=12
PORT=5000
LISTINGS_FEED_URL=https://example.com/listings-feed
# Optional:
# TMDB_API_KEY=your_tmdb_key
# APP_DEBUG=true
```

## Quality Checks

Backend:

```bash
pytest tests/ -q
ruff check .
ruff format .
mypy
cfn-lint template.yaml
```

Frontend:

```bash
npm run test:run
npm run typecheck
npm run lint
npm run build
npm run favicons
```

## Favicons

The favicon source of truth is [`public/favicon.svg`](public/favicon.svg).

When the favicon artwork changes, regenerate the PNG variants with:

```bash
npm run favicons
```

This script updates:

- `public/favicon.png`
- `public/favicon-32x32.png`
- `public/favicon-16x16.png`
- `public/apple-touch-icon.png`

After regenerating them:

- Update [`public/safari-pinned-tab.svg`](public/safari-pinned-tab.svg) if the silhouette changed.
- Bump the favicon cache-busting query params in [`index.html`](index.html).
- Run `npm run build` to verify the app still emits the favicon assets correctly.

The generator uses macOS built-ins (`qlmanage` and `sips`). The more detailed workflow is documented in [`scripts/README-favicons.md`](scripts/README-favicons.md).

## Deployment

The AWS stack lives in [`template.yaml`](template.yaml) and the deployment flow is wrapped in [`deploy.sh`](deploy.sh).

Requirements:

- AWS CLI configured for the target account.
- AWS SAM CLI installed.
- A TMDb API key stored in AWS Systems Manager Parameter Store.
- A long random origin verification token for the deployed API.

Notes:

- The template configures the Lambda to read its TMDb key from SSM at runtime instead of storing the secret in the repo.
- The template also configures the listings feed URL to come from SSM at runtime, while local development can set `LISTINGS_FEED_URL` directly.
- `ApiOriginVerifyToken` is still required after removing WAF. It is what lets CloudFront identify itself to the API origin so direct origin requests can be rejected.
- `deploy.sh` expects a `samconfig.toml` with a configured `stack_name` and a saved `ApiOriginVerifyToken`; if you are starting from a fresh clone, create that first with `sam deploy --guided`.
- Avoid committing environment files, deployment config with secrets, or copied production values into the repository.

First-time setup:

```bash
sam build
sam deploy --guided
```

During the guided deploy, set `ApiOriginVerifyToken` to a long random string. SAM can save it into your local `samconfig.toml` for future non-guided deploys.

Subsequent deploys:

```bash
./deploy.sh
```

## Notes

- This repo is shared as a personal project, not as an official service or supported product.
- It depends on external services that may change behavior or availability over time.
- If you reuse or redeploy it, review the relevant usage requirements for yourself.
- The MIT license in this repo applies to the code here, not to external data, trademarks, or services.
