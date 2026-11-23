// Serves app/e2e/stub/ with clean URLs and a strict stand-in CSP, until the
// renderer replaces it and brings the real policy.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "stub");

const CSP = [
  "default-src 'self'",
  "img-src 'self' https://image.tmdb.org",
  "script-src 'self'",
  "style-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** `/` → index.html, `/film/x` → film/x.html, `/assets/site.css` as is. */
function fileFor(urlPath: string): string | undefined {
  const clean = path.posix.normalize(decodeURIComponent(urlPath));
  if (!clean.startsWith("/") || clean.includes("..")) return undefined;
  const relative = clean.endsWith("/")
    ? `${clean}index.html`
    : path.extname(clean)
      ? clean
      : `${clean}.html`;
  return path.join(ROOT, relative);
}

const port = Number(process.env["E2E_PORT"]);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`E2E_PORT must be a port number, got ${String(process.env["E2E_PORT"])}`);
}

createServer((req, res) => {
  const file = fileFor(new URL(req.url ?? "/", "http://stub").pathname);
  const type = file ? TYPES[path.extname(file)] : undefined;
  const headers = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  };
  if (!file || !type) {
    res
      .writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" })
      .end("Not found");
    return;
  }
  readFile(file).then(
    (body) => res.writeHead(200, { ...headers, "Content-Type": type }).end(body),
    () =>
      res
        .writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" })
        .end("Not found"),
  );
}).listen(port, "127.0.0.1", () => {
  console.log(`stub server on http://127.0.0.1:${port}`);
});
