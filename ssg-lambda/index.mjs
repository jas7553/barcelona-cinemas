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
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
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

// S3 caps a single DeleteObjects request at 1000 keys.
const DELETE_BATCH = 1000;

// Per-film output prefixes the prune sweeps, each paired with the only
// extension it may delete there. ListObjectsV2 matches on a literal prefix, so
// `film/` does NOT cover `data/film/` — each needs its own listing pass.
// Keep in sync with scripts/render.mjs.
const PRUNE_PREFIXES = [
  ["film/", ".html"],
  ["data/film/", ".json"],
];

/**
 * Delete per-film objects for movies no longer in the listings.
 *
 * Only ever touches keys under the PRUNE_PREFIXES above, and only those with
 * that prefix's expected extension — the hashed /assets/* bundles,
 * data/listings.json, and the root documents are all off limits (and the IAM
 * policy scopes DeleteObject to these two prefixes besides). Called by
 * renderAll only after every page write succeeded, so an empty keep set can
 * only mean the listings really are empty.
 *
 * @param {Set<string>} keepRelPaths  Per-film keys this render just wrote.
 * @returns {Promise<number>} objects deleted
 */
async function pruneStaleFilmPages(keepRelPaths) {
  const stale = [];
  for (const [prefix, ext] of PRUNE_PREFIXES) {
    let token;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of page.Contents ?? []) {
        const key = obj.Key ?? "";
        if (!key.endsWith(ext) || keepRelPaths.has(key)) continue;
        stale.push({ Key: key });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  let deleted = 0;
  for (let i = 0; i < stale.length; i += DELETE_BATCH) {
    const batch = stale.slice(i, i + DELETE_BATCH);
    const res = await s3.send(
      new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: batch, Quiet: true } }),
    );
    const failed = res.Errors ?? [];
    deleted += batch.length - failed.length;
    // Per-key failures don't reject the request, so surface them explicitly —
    // otherwise a permanently undeletable page looks pruned in the summary.
    for (const e of failed) {
      logEvent("ssg_prune_object_failure", { key: e.Key, code: e.Code, message: e.Message });
    }
  }
  return deleted;
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

  let prunedCount = 0;

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
    async prune(keepRelPaths) {
      // Never fail the render over a prune: the freshly written pages are
      // already correct, and a leftover stale page beats no refresh at all.
      try {
        prunedCount = await pruneStaleFilmPages(keepRelPaths);
      } catch (err) {
        emitMetric("SsgPruneFailure", 1);
        logEvent("ssg_prune_failure", {
          refresh_id: refreshId,
          exception_type: err?.name ?? "Error",
          message: err?.message,
        });
      }
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
    pruned_object_count: prunedCount,
    invalidation_id: invalidationId,
    duration_ms: Date.now() - startedMs,
  });
  return { statusCode: 200, filmCount };
}
