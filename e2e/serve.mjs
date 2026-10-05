// Serves the built static/ directory the way production does, for e2e:
// - request paths resolve to bucket keys through the CloudFront Function's
//   mapping (objectKeyFor), and a missing key gets 404.html with a 404;
// - every response carries the production CSP from template.yaml, so a
//   blocked inline script or style attribute fails here, not first in prod;
// - nothing is no-store, so pages stay bfcache-eligible.
//
//   node e2e/serve.mjs [port]

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { objectKeyFor } from "../scripts/site-constants.mjs";

const ROOT = path.resolve("static");
const PORT = Number(process.argv[2] ?? 5180);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
};

/** The page CSP, folded out of SecurityHeadersPolicy's block scalar. */
function productionCsp() {
  const yaml = fs.readFileSync("template.yaml", "utf8");
  const block = yaml.match(/SecurityHeadersPolicy:[\s\S]*?ContentSecurityPolicy: >-\n([\s\S]*?)\n\s*Override:/);
  if (!block) throw new Error("e2e/serve.mjs: no ContentSecurityPolicy in template.yaml");
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .join(" ")
    // upgrade-insecure-requests would push http://localhost asset loads to https.
    .replace(/\s*upgrade-insecure-requests;?/, "");
}

const CSP = productionCsp();

http
  .createServer((req, res) => {
    const key = objectKeyFor(decodeURIComponent((req.url ?? "/").split("?")[0]));
    let file = path.join(ROOT, key);
    let status = 200;
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      file = path.join(ROOT, "404.html");
      status = 404;
    }
    res.writeHead(status, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy": CSP,
      "Cache-Control": key.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`[e2e] serving static/ on http://localhost:${PORT}`));
