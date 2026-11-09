# Barcelona Movie Database

Small weekend project for tracking English-language movie showings in Barcelona.

It aggregates local showtimes from tracked listings providers, enriches them with TMDb metadata, and serves the result as a pre-rendered static MPA (one HTML page per route on S3 + CloudFront). A headless Lambda refreshes the data on a timer; there is no runtime read API.

## What It Does

- Aggregates showtimes for tracked cinemas.
- Enriches movies with TMDb metadata such as runtime, genres, rating, and synopsis.
- Serves cached data so normal page loads do not trigger live data fetching.
- Shows an age banner when the pages are more than a day old, instead of refreshing in-band.

## Architecture

```text
Scheduler (2×/day) -> ApiFunction (app.py) -> pipeline.py -> cache + data/listings.json (S3)
                                             |- providers/listings_provider.py    |
                                             |- enricher.py                       v
                                             |- validation.py            SsgFunction (Node) re-renders
                                             `- cache.py                 every HTML page + invalidates CF
```

Refresh flow (no runtime read API — pages are pre-rendered):

- An EventBridge Scheduler schedule (twice a day, Madrid time) invokes the headless `ApiFunction`, which runs `pipeline.force_refresh()`.
- The refresh writes the cache, publishes the public `data/listings.json` to the frontend bucket, and invokes `SsgFunction` to re-render every page and invalidate CloudFront.
- Each page embeds its own data as inert JSON, so normal page loads never fetch — first paint shows real content.
- A failed refresh leaves the previously rendered pages serving (stale-while-revalidate); pages more than a day old show an age banner, computed client-side from `generated_at`.

Production hardening:

- The frontend S3 bucket is private; only CloudFront (via OAC) can read it, and CloudFront stamps the security headers (CSP, HSTS, etc.).
- `SsgFunction` is invoked only by the refresh path; there is no public origin that serves listings on demand.

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
```

There is no backend server to run: `app.py` is the Lambda handler for the scheduled refresh. Locally the refresh is a script that fills the file cache:

```bash
npm run refresh-cache
```

This command loads local `.env` values automatically, fetches the providers, refreshes the file cache, and prints how many movies have poster URLs after the refresh.

Frontend:

```bash
npm install
npm run export-data   # cache/listings.json -> static/data/listings.json
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and renders each page on request from `static/data/listings.json`. The site renders empty if that file is missing or has no upcoming dates, so refresh the cache and export it first.

To render the whole static site the way production does:

```bash
npm run build         # empties static/, so export after it
npm run export-data
TZ=Europe/Madrid node scripts/render.mjs
```

## Environment Variables

Local development works without TMDb credentials, but enrichment is skipped and only raw listing data is returned.

| Variable | Default | Notes |
| --- | --- | --- |
| `TMDB_API_KEY` | none | Optional locally; enables TMDb enrichment in development. |
| `CACHE_BACKEND` | `file` | Use `file` locally and `s3` in AWS. |
| `CACHE_DIR` | `./cache` | File cache directory for local use. |
| `S3_BUCKET` | none | Required only when `CACHE_BACKEND=s3`. |
| `S3_KEY` | `listings.json` | Required only when `CACHE_BACKEND=s3`. |
| `TMDB_SSM_PARAMETER` | none | Optional parameter name for AWS-hosted deployments. |
| `LISTINGS_FEED_URL` | none | Optional local override for the listings feed URL. |
| `LISTINGS_FEED_SSM_PARAMETER` | none | Optional parameter name for the listings feed URL in AWS-hosted deployments. |
| `SECONDARY_LISTINGS_URL` | none | Optional local override for the secondary listings feed URL. |
| `SECONDARY_LISTINGS_SSM_PARAMETER` | none | Optional parameter name for the secondary listings feed URL in AWS-hosted deployments. |

Example local `.env`:

```bash
CACHE_DIR=./cache
LISTINGS_FEED_URL=https://example.com/listings-feed
TMDB_API_KEY=your_tmdb_key
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
```

## Favicons

The favicon sources are [`public/favicon.svg`](public/favicon.svg) (tabs, bookmarks) and [`scripts/apple-touch-icon.svg`](scripts/apple-touch-icon.svg) (home screens, share previews).

When the artwork changes, regenerate the PNG variants with:

```bash
npm run favicons
```

Then update [`public/safari-pinned-tab.svg`](public/safari-pinned-tab.svg) if the silhouette changed and bump the `?v=` params in `scripts/template.mjs` and `public/site.webmanifest`. Details are in [`scripts/README-favicons.md`](scripts/README-favicons.md).

## Deployment

The AWS stack lives in [`template.yaml`](template.yaml) and the deployment flow is wrapped in [`deploy.sh`](deploy.sh).

Requirements:

- AWS CLI configured for the target account.
- AWS SAM CLI installed.
- A TMDb API key stored in AWS Systems Manager Parameter Store.

Notes:

- The template configures the Lambda to read its TMDb key from SSM at runtime instead of storing the secret in the repo.
- The template also configures the listings feed URLs (primary and secondary) to come from SSM at runtime, while local development can set `LISTINGS_FEED_URL` / `SECONDARY_LISTINGS_URL` directly.
- `deploy.sh` expects a `samconfig.toml` with a configured `stack_name`; if you are starting from a fresh clone, create that first with `sam deploy --guided`.
- `NotificationEmail` is required and has no default: it is the address that receives CloudWatch alarm emails via SNS. Set it in `samconfig.toml` `parameter_overrides` (gitignored) — do not commit it. After the first deploy, AWS sends a subscription confirmation email that must be clicked before any alerts are delivered.
- Avoid committing environment files, deployment config with secrets, or copied production values into the repository.

First-time setup:

```bash
sam build
sam deploy --guided
```

During the guided deploy, set `NotificationEmail`. SAM can save it into your local `samconfig.toml` for future non-guided deploys.

Subsequent deploys:

```bash
./deploy.sh
```

## Notes

- This repo is shared as a personal project, not as an official service or supported product.
- It depends on external services that may change behavior or availability over time.
- If you reuse or redeploy it, review the relevant usage requirements for yourself.
- The MIT license in this repo applies to the code here, not to external data, trademarks, or services.
