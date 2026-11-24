/**
 * Recorded HTTP: a directory holding `manifest.json` and one file per response body. URLs are
 * stored without credential params, and requests are matched without them, so a recording made
 * with one key replays under any other, or none.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Fetcher, FetchResponse } from "./http.ts";

const CREDENTIAL_PARAMS: readonly string[] = ["api_key"];

const ManifestEntry = z.strictObject({
  method: z.literal("GET"),
  /** Without credential params. */
  url: z.url(),
  status: z.int().min(100).max(599),
  contentType: z.string().nullable(),
  /** Relative to the manifest's directory. */
  file: z.string().min(1),
  /** Where redirects ended, when not at `url`. */
  finalUrl: z.url().exactOptional(),
});
type ManifestEntry = z.infer<typeof ManifestEntry>;

const Manifest = z.array(ManifestEntry);

export function stripCredentials(url: string): string {
  const parsed = new URL(url);
  const present = CREDENTIAL_PARAMS.filter((name) => parsed.searchParams.has(name));
  if (present.length === 0) return url;
  for (const name of present) parsed.searchParams.delete(name);
  return parsed.toString();
}

/** Ignores credentials, param order and how params are percent-encoded. */
function requestKey(url: string): string {
  const parsed = new URL(url);
  const params = [...parsed.searchParams]
    .filter(([name]) => !CREDENTIAL_PARAMS.includes(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${parsed.origin}${parsed.pathname}?${new URLSearchParams(params).toString()}`;
}

export class UnrecordedRequestError extends Error {
  override readonly name = "UnrecordedRequestError";
}

/**
 * Serves a recording. A URL recorded more than once (a retry) answers with each response in turn,
 * then keeps the last. An unrecorded URL throws `UnrecordedRequestError`.
 */
export function replayFetcher(dir: string): Fetcher {
  const root = resolve(dir);
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")));
  const queues = new Map<string, FetchResponse[]>();
  for (const entry of manifest) {
    const path = resolve(root, entry.file);
    const fromRoot = relative(root, path);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      throw new Error(`manifest file ${entry.file} is outside ${dir}`);
    }
    const response: FetchResponse = {
      url: entry.finalUrl ?? entry.url,
      status: entry.status,
      contentType: entry.contentType ?? "",
      text: readFileSync(path, "utf8"),
    };
    const key = requestKey(entry.url);
    queues.set(key, [...(queues.get(key) ?? []), response]);
  }
  return {
    get(url) {
      const queue = queues.get(requestKey(url));
      const response = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      if (response === undefined) {
        return Promise.reject(
          new UnrecordedRequestError(`no recording for GET ${stripCredentials(url)}`),
        );
      }
      return Promise.resolve(response);
    },
  };
}

function extension(contentType: string): string {
  if (contentType.includes("json")) return ".json";
  if (contentType.includes("html")) return ".html";
  return ".txt";
}

export interface Recorder {
  /** Passes every request to the wrapped fetcher and keeps each response. */
  fetcher: Fetcher;
  /** Writes what was kept so far to `dir`, in the order the responses arrived. */
  save(dir: string): void;
}

/** Requests that get no response (timeouts, connection errors) aren't recorded. */
export function recordingFetcher(inner: Fetcher): Recorder {
  const kept: { url: string; response: FetchResponse }[] = [];
  return {
    fetcher: {
      async get(url, options) {
        const response = await inner.get(url, options);
        kept.push({ url, response });
        return response;
      },
    },
    save(dir) {
      mkdirSync(dir, { recursive: true });
      const manifest = kept.map(({ url, response }, i): ManifestEntry => {
        const file = `${String(i + 1).padStart(4, "0")}-${new URL(url).hostname}${extension(response.contentType)}`;
        writeFileSync(join(dir, file), response.text);
        const stored = stripCredentials(url);
        const finalUrl = stripCredentials(response.url);
        return {
          method: "GET",
          url: stored,
          status: response.status,
          contentType: response.contentType,
          file,
          ...(finalUrl !== stored && { finalUrl }),
        };
      });
      writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}
