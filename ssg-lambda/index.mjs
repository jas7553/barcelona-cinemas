// Production SSG renderer (Option A) — a headless Node Lambda chained after the
// Python refresh. Reads the public listings JSON the refresh wrote to the
// frontend bucket, renders every page (same entry-server + render-core as local
// `npm run build`), writes the HTML + per-film JSON back to the bucket, then
// invalidates CloudFront. No public HTTP surface.
//
// Packaged files (copied in by deploy.sh after `npm run build`):
//   entry-server.js   self-contained React SSR bundle (dist-ssr/)
//   render-core.mjs   shared render loop (scripts/)
//   template.mjs      HTML document template (scripts/)
//   manifest.json     Vite client manifest (static/.vite/)
//
// AWS SDK v3 is provided by the Lambda nodejs runtime — not vendored here.

import { readFileSync } from "node:fs";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { renderAll } from "./render-core.mjs";
import * as server from "./entry-server.js";

const s3 = new S3Client({});
const cf = new CloudFrontClient({});

const BUCKET = process.env.FRONTEND_BUCKET;
const DIST = process.env.CLOUDFRONT_DISTRIBUTION_ID;
const SITE_URL = process.env.SITE_URL || "";
const DATA_KEY = "data/listings.json";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));

const ENVIRONMENT = process.env.ENVIRONMENT || (process.env.AWS_LAMBDA_FUNCTION_NAME ? "prod" : "dev");
const METRIC_NAMESPACE = "BarcelonaMovieDatabase";

// Mirrors observability.py's log_event/emit_metric so both Lambdas emit the
// same JSON shape and the same EMF metric namespace — a refresh and the render
// it triggered can then be joined on refresh_id across the two log groups.
function logEvent(event, fields) {
  console.log(JSON.stringify({ event, environment: ENVIRONMENT, ...fields }));
}

function emitMetric(name, value, unit = "Count") {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: METRIC_NAMESPACE,
            Dimensions: [["Environment"]],
            Metrics: [{ Name: name, Unit: unit }],
          },
        ],
      },
      Environment: ENVIRONMENT,
      [name]: value,
    }),
  );
}

export async function handler(event = {}) {
  const refreshId = event?.refresh_id ?? null;
  const startedMs = Date.now();
  try {
    return await render(refreshId, startedMs);
  } catch (err) {
    // The invoke is async (InvocationType: Event), so nothing upstream ever
    // sees this throw — without an explicit metric a dead renderer leaves the
    // refresh reporting success and every dashboard green.
    emitMetric("SsgRenderFailure", 1);
    logEvent("ssg_render_failure", {
      refresh_id: refreshId,
      duration_ms: Date.now() - startedMs,
      exception_type: err?.name ?? "Error",
      message: err?.message,
    });
    throw err;
  }
}

async function render(refreshId, startedMs) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: DATA_KEY }));
  const listings = JSON.parse(await obj.Body.transformToString());

  const { filmCount } = await renderAll({
    listings,
    manifest,
    server,
    siteUrl: SITE_URL,
    async write(relPath, contents, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: relPath,
          Body: contents,
          ContentType: contentType,
          // HTML + data are revalidated each load so a refresh shows immediately;
          // the hashed /assets/* bundles keep their immutable Cache-Control
          // (set by deploy.sh on the one-time sync, untouched here).
          CacheControl: "no-cache",
        }),
      );
    },
  });

  let invalidationId = null;
  if (DIST) {
    const invalidation = await cf.send(
      new CreateInvalidationCommand({
        DistributionId: DIST,
        InvalidationBatch: {
          CallerReference: String(Date.now()),
          Paths: { Quantity: 3, Items: ["/", "/index.html", "/film/*"] },
        },
      }),
    );
    // Surfacing the id turns "the site looks stale" into a single CLI lookup
    // (`aws cloudfront get-invalidation`) instead of guesswork.
    invalidationId = invalidation?.Invalidation?.Id ?? null;
  }

  logEvent("ssg_render_summary", {
    refresh_id: refreshId,
    bucket: BUCKET,
    movie_count: listings?.movies?.length ?? 0,
    film_page_count: filmCount,
    invalidation_id: invalidationId,
    duration_ms: Date.now() - startedMs,
  });
  return { statusCode: 200, filmCount };
}
