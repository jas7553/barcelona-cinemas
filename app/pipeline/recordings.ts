/**
 * Recorded HTTP: a directory holding `manifest.json` and one file per response body. URLs are
 * stored without credential params, and requests are matched without them, so a recording made
 * with one key replays under any other, or none. Secret URLs are stored as stand-ins.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Fetcher, FetchResponse } from "./http.ts";

const CREDENTIAL_PARAMS: ReadonlySet<string> = new Set([
  "api_key",
  "apikey",
  "token",
  "access_token",
  "key",
]);

const isCredential = (name: string): boolean => CREDENTIAL_PARAMS.has(name.toLowerCase());

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
  const present = [...new Set(parsed.searchParams.keys())].filter(isCredential);
  if (present.length === 0) return url;
  for (const name of present) parsed.searchParams.delete(name);
  return parsed.toString();
}

/** Ignores credentials, param order and how params are percent-encoded. */
function requestKey(url: string): string {
  const parsed = new URL(url);
  const params = [...parsed.searchParams]
    .filter(([name]) => !isCredential(name))
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

/** A secret URL, and the URL a recording stores in its place. */
export interface StandIn {
  secret: string;
  standIn: string;
}

/** Shorter query values and path segments are too common to be telling. */
const MIN_TOKEN_CHARS = 4;

/** Where a URL in a body ends: at a quote, angle bracket, whitespace or a backslash not before `/`. */
const URL_CHARS = String.raw`(?:\\/|[^\s"'<>\\])*`;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

interface Secret {
  /** Its hostname with and without `www.`. */
  hosts: ReadonlySet<string>;
  pathAndQuery: string;
  standIn: URL;
  /** Lower case: the host, the URL, and its query values and path segments. */
  needles: readonly string[];
  /** Its host in an absolute or protocol-relative URL, plain or JSON-escaped, and bare. */
  inUrl: RegExp;
  bare: RegExp;
  /** The stand-in as a whole URL or host, which may share words with the secret. */
  standInText: RegExp;
}

function secretOf({ secret, standIn }: StandIn): Secret {
  const url = new URL(secret);
  const bareHost = url.hostname.replace(/^www\./, "");
  const host = String.raw`(?:www\.)?${escapeRegExp(bareHost)}(?![\w-])`;
  const to = new URL(standIn);
  const standInUrl = to.href.slice(to.protocol.length);
  const tokens = [
    ...url.pathname.split("/"),
    ...url.search
      .slice(1)
      .split("&")
      .map((param) => param.slice(param.indexOf("=") + 1)),
  ].flatMap((token) => [token, decoded(token.replaceAll("+", " "))]);
  return {
    hosts: new Set([bareHost, `www.${bareHost}`]),
    pathAndQuery: `${url.pathname}${url.search}`,
    standIn: to,
    needles: [
      ...new Set(
        [bareHost, url.href, ...tokens.filter((token) => token.length >= MIN_TOKEN_CHARS)].map(
          (needle) => needle.toLowerCase(),
        ),
      ),
    ],
    inUrl: new RegExp(
      String.raw`(?:https?:)?(?:\/\/|\\\/\\\/)${host}(?::\d+)?(?:(?:\/|\\\/|\?|#)${URL_CHARS})?`,
      "gi",
    ),
    bare: new RegExp(String.raw`(?<![\w-])${host}`, "gi"),
    standInText: new RegExp(
      [standInUrl, standInUrl.replaceAll("/", "\\/")]
        .map((text) => String.raw`${escapeRegExp(text)}(?![^\s"'<>?#\\])`)
        .concat(escapeRegExp(to.hostname))
        .join("|"),
      "gi",
    ),
  };
}

/**
 * `url` as a recording stores it. On a secret's host (with or without `www.`, any scheme or
 * port), the secret itself becomes its stand-in, and any other page moves to the stand-in's
 * origin, dropping its query if that held a credential or one of the secret's query values.
 */
function storedUrl(secrets: readonly Secret[], url: string): string {
  const parsed = new URL(url);
  const secret = secrets.find(({ hosts }) => hosts.has(parsed.hostname));
  if (secret === undefined) return stripCredentials(url);
  if (`${parsed.pathname}${parsed.search}` === secret.pathAndQuery) return secret.standIn.href;
  const query = `${parsed.search}\n${decoded(parsed.search)}`.toLowerCase();
  const keepQuery =
    ![...parsed.searchParams.keys()].some(isCredential) &&
    !secret.needles.some((needle) => query.includes(needle));
  const stored = new URL(secret.standIn.origin);
  stored.pathname = parsed.pathname;
  if (keepQuery) stored.search = parsed.search;
  return stored.href;
}

/** Moves each secret host's URLs in `text` to the stand-in, keeping each URL's form. */
function storedBody(secrets: readonly Secret[], text: string): string {
  return secrets.reduce(
    (out, secret) =>
      out
        .replace(secret.inUrl, (match) => {
          const escaped = match.includes("\\/");
          const plain = escaped ? match.replaceAll("\\/", "/") : match;
          const relative = plain.startsWith("//");
          let stored: string;
          try {
            stored = storedUrl(secrets, relative ? `https:${plain}` : plain);
          } catch {
            return match;
          }
          const form = relative ? stored.slice(stored.indexOf("//")) : stored;
          return escaped ? form.replaceAll("/", "\\/") : form;
        })
        .replace(secret.bare, secret.standIn.hostname),
    text,
  );
}

/** What of a secret `text` still holds, ignoring the stand-ins, named without the secret. */
function leak(secrets: readonly Secret[], text: string): string | undefined {
  const rest = secrets.reduce(
    (out, { standInText }) => out.replace(standInText, " "),
    text.toLowerCase(),
  );
  for (const secret of secrets) {
    const index = secret.needles.findIndex((needle) => rest.includes(needle));
    if (index !== -1) return `part ${index + 1} of the secret behind ${secret.standIn.hostname}`;
  }
  return undefined;
}

/** Every string in a JSON value, keys aside. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

export interface Recorder {
  /** Passes every request to the wrapped fetcher and keeps each response. */
  fetcher: Fetcher;
  /** `url` as the recording stores it: what replaying it should ask for. */
  stored(url: string): string;
  /**
   * Writes what was kept so far to `dir`, in the order the responses arrived, beside `documents`
   * (JSON, by file name). Writes nothing, and throws, if any of it still holds a secret.
   */
  save(dir: string, documents?: Readonly<Record<string, unknown>>): void;
}

/**
 * Requests that get no response (timeouts, connection errors) aren't recorded. Each of `standIns`
 * replaces its secret URL in what is written: URLs, file names and bodies.
 */
export function recordingFetcher(inner: Fetcher, standIns: readonly StandIn[] = []): Recorder {
  const secrets = standIns.map(secretOf);
  const stored = (url: string): string => storedUrl(secrets, url);
  const kept: { url: string; response: FetchResponse }[] = [];
  return {
    stored,
    fetcher: {
      async get(url, options) {
        const response = await inner.get(url, options);
        kept.push({ url, response });
        return response;
      },
    },
    save(dir, documents = {}) {
      const files = new Map<string, string>();
      const manifest = kept.map(({ url: request, response }, i): ManifestEntry => {
        const url = stored(request);
        const finalUrl = stored(response.url);
        const file = `${String(i + 1).padStart(4, "0")}-${new URL(url).hostname}${extension(response.contentType)}`;
        files.set(file, storedBody(secrets, response.text));
        return {
          method: "GET",
          url,
          status: response.status,
          contentType: response.contentType,
          file,
          ...(finalUrl !== url && { finalUrl }),
        };
      });
      const checked: [string, string[]][] = [...files].map(([name, text]) => [name, [name, text]]);
      checked.push(["manifest.json", strings(manifest)]);
      for (const [name, value] of Object.entries(documents)) {
        checked.push([name, [name, ...strings(value)]]);
      }
      for (const [name, texts] of checked) {
        const found = leak(secrets, texts.join("\n"));
        if (found !== undefined) {
          throw new Error(`recording not written: ${name} holds ${found}`);
        }
      }
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of files) writeFileSync(join(dir, name), text);
      const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
      writeFileSync(join(dir, "manifest.json"), json(manifest));
      for (const [name, value] of Object.entries(documents)) {
        writeFileSync(join(dir, name), json(value));
      }
    },
  };
}
