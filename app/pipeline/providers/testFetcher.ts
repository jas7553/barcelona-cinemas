/** Test doubles for the provider tests: a fetcher that serves canned pages, and a logger that keeps events. */
import { FetchError } from "../errors.ts";
import type { Fetcher, FetchResponse } from "../http.ts";
import type { Logger } from "../log.ts";
import { parseRegistry } from "../registry.ts";
import type { ProviderContext } from "../types.ts";

export type Page = string | { status: number; body?: string } | typeof TIMEOUT;

/** A page that never answers. */
export const TIMEOUT = { timeout: true } as const;

/** Serves `pages` by URL, recording every request; an unlisted URL is a 404. */
export function stubFetcher(pages: Readonly<Record<string, Page>>): {
  fetcher: Fetcher;
  requests: { url: string; timeoutMs: number }[];
} {
  const requests: { url: string; timeoutMs: number }[] = [];
  return {
    requests,
    fetcher: {
      get(url, { timeoutMs }) {
        requests.push({ url, timeoutMs });
        const page = pages[url] ?? { status: 404 };
        if (typeof page === "object" && "timeout" in page) {
          return Promise.reject(new FetchError("timeout", url));
        }
        const response: FetchResponse =
          typeof page === "string"
            ? { url, status: 200, contentType: "text/html", text: page }
            : { url, status: page.status, contentType: "text/html", text: page.body ?? "" };
        return Promise.resolve(response);
      },
    },
  };
}

export function recordingLogger(): { log: Logger; events: { event: string; fields: object }[] } {
  const events: { event: string; fields: object }[] = [];
  const keep = (event: string, fields: object = {}): void => {
    events.push({ event, fields });
  };
  return { log: { info: keep, warn: keep, error: keep }, events };
}

const cinema = (id: string, name: string, aliases?: Record<string, string[]>) => ({
  id,
  name,
  address: `${name} street`,
  neighborhood: `${name} quarter`,
  website_url: "https://example.test/",
  maps_url: "https://example.test/maps",
  ...(aliases && { aliases }),
});

/** Verdi, Verdi Park, Aribau and Balmes, with the aliases the provider tests need. */
export const testRegistry = parseRegistry({
  Verdi: cinema("verdi", "Cines Verdi", { english_cinema_bcn: ["Verdi"] }),
  VP: cinema("verdi-park", "Verdi Park", { english_cinema_bcn: ["VP"] }),
  Aribau: cinema("aribau", "Cinemes Aribau", { secondary: ["ARIBAU", "/aribau", "BAL-ARIBAU"] }),
  Balmes: cinema("balmes", "Cinemes Balmes"),
});

export function context(
  fetcher: Fetcher,
  overrides: Partial<ProviderContext> = {},
): ProviderContext {
  return {
    fetcher,
    now: new Date("2026-03-28T10:00:00+01:00"),
    registry: testRegistry,
    log: recordingLogger().log,
    previousFilms: [],
    ...overrides,
  };
}
