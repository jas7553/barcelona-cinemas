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

export async function handler() {
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

  if (DIST) {
    await cf.send(
      new CreateInvalidationCommand({
        DistributionId: DIST,
        InvalidationBatch: {
          CallerReference: String(Date.now()),
          Paths: { Quantity: 3, Items: ["/", "/index.html", "/film/*"] },
        },
      }),
    );
  }

  console.log(`[ssg] rendered index.html + ${filmCount} film page(s) → s3://${BUCKET}`);
  return { statusCode: 200, filmCount };
}
