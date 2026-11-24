import { FetchError, HttpError } from "./errors.ts";

export interface FetchOptions {
  /** Covers the whole request, body included. */
  timeoutMs: number;
  /** Merged over `DEFAULT_HEADERS`. */
  headers?: Readonly<Record<string, string>>;
}

export interface FetchResponse {
  /** After redirects: relative links resolve against it. */
  url: string;
  status: number;
  /** `""` when the response has none. */
  contentType: string;
  text: string;
}

/**
 * GET only, any status: `getOk` turns an error status into an `HttpError`. Throws `FetchError` when
 * there's no response (timeout, connection failure).
 */
export interface Fetcher {
  get(url: string, options: FetchOptions): Promise<FetchResponse>;
}

/** A desktop browser's, which some cinema sites require. */
export const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

export async function getOk(
  fetcher: Fetcher,
  url: string,
  options: FetchOptions,
): Promise<FetchResponse> {
  const response = await fetcher.get(url, options);
  if (response.status >= 400) throw new HttpError(response.status, response.url);
  return response;
}

function charset(contentType: string): string {
  return /charset="?([^";\s]+)/i.exec(contentType)?.[1] ?? "utf-8";
}

function decode(body: ArrayBuffer, contentType: string): string {
  try {
    return new TextDecoder(charset(contentType)).decode(body);
  } catch {
    return new TextDecoder().decode(body);
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

export function liveFetcher(fetchImpl: typeof fetch = globalThis.fetch): Fetcher {
  return {
    async get(url, { timeoutMs, headers = {} }) {
      // A malformed URL is a bug, not a network failure: let it throw unwrapped.
      const target = new URL(url);
      try {
        const response = await fetchImpl(target, {
          headers: { ...DEFAULT_HEADERS, ...headers },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const contentType = response.headers.get("content-type") ?? "";
        const body = await response.arrayBuffer();
        return {
          url: response.url || url,
          status: response.status,
          contentType,
          text: decode(body, contentType),
        };
      } catch (error) {
        throw new FetchError(isTimeout(error) ? "timeout" : "network", url, { cause: error });
      }
    },
  };
}
