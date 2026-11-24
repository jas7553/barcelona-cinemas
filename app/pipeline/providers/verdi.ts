/**
 * Verdi and Verdi Park, from the cinema's own site: a cartellera page, a page per film with
 * JSON-LD and one booking button per session, and the Admit One seat page behind each button,
 * which names the sala and so which of the two cinemas shows it.
 *
 * Admit One is the slowest and least reliable dependency: a bad spell there once ate a whole
 * refresh's budget. So the seat lookups time out fast, run a few at a time after every film page
 * is in, cover one session per time slot, and skip any session already resolved in the previous
 * refresh's films. The film pages stay one at a time: their host has blocked this client before.
 */
import { z } from "zod";
import { getOk } from "../http.ts";
import { normalizeSubtitleLang, scrapedFilm } from "../normalize.ts";
import { reportPartialFailure } from "../errors.ts";
import type { Provider, ScrapedFilm, ScrapedShowing } from "../types.ts";
import { buildShowing, mapPool } from "./support.ts";

const VERDI = "verdi";

const VERDI_BASE = "https://barcelona.cines-verdi.com";
const ADMIT_ONE_BASE = "https://verdibcn.admit-one.eu";

const PAGE_TIMEOUT_MS = 15_000;
/** Seat pages answer in well under a second when healthy; the ceiling bounds a hung host. */
const SALA_TIMEOUT_MS = 3_000;
const SALA_WORKERS = 4;

const VERDI_CINEMA_KEYS: ReadonlySet<string> = new Set(["Verdi", "VP"]);

const BOOKING_SESSION = /\/seats\/(\d+)\//;
/** `href="/some-slug" class="group"`: a film card on the cartellera. */
const FILM_LINK = /href="(\/[a-z][a-z0-9-]+)"\s+class="group"/g;
/**
 * A session button on a film page:
 * `<a href=".../seats/217082/" x-show="!isPast(&#039;20260628180000&#039;)" ...>
 *  <time>18:00</time><small>CASTELLÀ</small></a>`
 */
const SESSION =
  /href="https:\/\/verdibcn\.admit-one\.eu\/seats\/(\d+)\/"[^>]*x-show="!isPast\(&#039;(\d{14})&#039;\)"[^>]*>\s*<time>(\d{2}:\d{2})<\/time>\s*<small>([^<]+)<\/small>/g;
const LD_JSON = /<script[^>]+type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs;
const IMDB = /imdb\.com\/title\/(tt\d+)/;
/** The seat page's sala line: a numeric sala is Verdi, a letter plus "V.Park" is Verdi Park. */
const VP_SALA = /Sala [A-Z] V\.Park/;
const VERDI_SALA = /Cines Verdi Barcelona \| Sala \d/;

export interface VerdiSession {
  /** Madrid `YYYY-MM-DD`. */
  date: string;
  /** Madrid `HH:MM`. */
  time: string;
  id: string;
  bookingUrl: string;
  /** The button's own label: "V.O. SUB. CASTELLÀ", "CASTELLÀ". */
  label: string;
}

export interface VerdiFilm {
  title: string;
  imdbId: string | undefined;
  sessions: VerdiSession[];
}

const LdItem = z.looseObject({
  "@type": z.literal("Movie"),
  name: z.string().optional().catch(undefined),
  sameAs: z
    .union([z.string(), z.array(z.unknown())])
    .optional()
    .catch(undefined),
});
const LdRoot = z.looseObject({ "@graph": z.array(z.unknown()).catch([]) });

/** The film's title and IMDb id from its page's JSON-LD. */
export function extractFilmMeta(
  html: string,
): { title: string; imdbId: string | undefined } | undefined {
  for (const [, body = ""] of html.matchAll(LD_JSON)) {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      continue;
    }
    const root = LdRoot.safeParse(json);
    if (!root.success) continue;
    for (const raw of root.data["@graph"]) {
      const item = LdItem.safeParse(raw);
      const title = item.success ? item.data.name?.trim() : undefined;
      if (!item.success || !title) continue;
      const { sameAs = "" } = item.data;
      const urls =
        typeof sameAs === "string" ? sameAs : sameAs.filter((s) => typeof s === "string").join(" ");
      return { title, imdbId: IMDB.exec(urls)?.[1] };
    }
  }
  return undefined;
}

/** Every session button on a film page, whatever its language. */
export function parseSessions(html: string): VerdiSession[] {
  return [...html.matchAll(SESSION)].flatMap(([, id, stamp, time, label]) =>
    id === undefined || stamp === undefined || time === undefined || label === undefined
      ? []
      : [
          {
            date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
            time,
            id,
            bookingUrl: `${ADMIT_ONE_BASE}/seats/${id}/`,
            label: label.trim(),
          },
        ],
  );
}

/** V.O. (original-version) sessions: the label starts "V.O". */
export function isVo(label: string): boolean {
  return label.trim().toUpperCase().startsWith("V.O");
}

/**
 * The legacy filter: V.O. sessions only, and no film without one. The sala lookups run on what
 * this leaves.
 */
export function legacyEnglishOnly(film: VerdiFilm): VerdiFilm | undefined {
  const sessions = film.sessions.filter((session) => isVo(session.label));
  return sessions.length > 0 ? { ...film, sessions } : undefined;
}

/** Session ids by time slot, each slot's latest date first: a slot's sessions share a sala. */
export function slots(film: VerdiFilm): string[][] {
  const byTime = new Map<string, VerdiSession[]>();
  for (const session of film.sessions) {
    byTime.set(session.time, [...(byTime.get(session.time) ?? []), session]);
  }
  return [...byTime.values()].map((slot) =>
    [...slot].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).map(({ id }) => id),
  );
}

/** Session id to cinema key, read back from the previous refresh's booking URLs. */
export function salaMapFromFilms(films: readonly ScrapedFilm[]): Map<string, string> {
  const salas = new Map<string, string>();
  for (const { showings } of films) {
    for (const { cinema, booking_url } of showings) {
      if (!VERDI_CINEMA_KEYS.has(cinema) || !booking_url?.startsWith(ADMIT_ONE_BASE)) continue;
      const id = BOOKING_SESSION.exec(booking_url)?.[1];
      if (id !== undefined) salas.set(id, cinema);
    }
  }
  return salas;
}

export interface VerdiOptions {
  /** Narrows the cartellera to these film paths ("/obsession"); recordings hold only a few. */
  slugs?: readonly string[];
}

export function verdiProvider({ slugs: onlySlugs }: VerdiOptions = {}): Provider {
  // Kept across fetches: a retried fetch repeats only the lookups that failed.
  const salas = new Map<string, string>();

  return {
    name: VERDI,
    async fetch({ fetcher, registry, log, previousFilms }) {
      for (const [id, cinema] of salaMapFromFilms(previousFilms)) salas.set(id, cinema);

      const lookup = async (id: string): Promise<string | undefined> => {
        try {
          const page = await getOk(fetcher, `${ADMIT_ONE_BASE}/seats/${id}/`, {
            timeoutMs: SALA_TIMEOUT_MS,
          });
          if (VP_SALA.test(page.text)) return "VP";
          if (VERDI_SALA.test(page.text)) return "Verdi";
          log.warn("verdi_sala_unrecognized", { provider: VERDI, session: id });
        } catch (error) {
          log.warn("verdi_sala_lookup_failed", {
            provider: VERDI,
            session: id,
            error: String(error),
          });
        }
        return undefined;
      };

      // The one failure that means "Verdi is unreachable" rather than "nothing in English": it
      // propagates. One bad film page is skipped and counted.
      const cartellera = await getOk(fetcher, `${VERDI_BASE}/cartellera`, {
        timeoutMs: PAGE_TIMEOUT_MS,
      });
      const found = [...new Set([...cartellera.text.matchAll(FILM_LINK)].map(([, slug]) => slug))];
      const slugs = found.filter(
        (slug): slug is string => slug !== undefined && (onlySlugs?.includes(slug) ?? true),
      );
      log.info("verdi_sala_map_seeded", { provider: VERDI, session_count: salas.size });

      const films: VerdiFilm[] = [];
      let failedPages = 0;
      for (const slug of slugs) {
        try {
          const page = await getOk(fetcher, `${VERDI_BASE}${slug}`, { timeoutMs: PAGE_TIMEOUT_MS });
          const meta = extractFilmMeta(page.text);
          const film = meta && legacyEnglishOnly({ ...meta, sessions: parseSessions(page.text) });
          if (film) films.push(film);
        } catch (error) {
          log.warn("verdi_film_page_failed", { provider: VERDI, slug, error: String(error) });
          failedPages += 1;
        }
      }
      reportPartialFailure(log, VERDI, "film pages", { failed: failedPages, total: slugs.length });

      // A slot's latest session is the one to ask about: film pages still list today's sessions
      // that have started, and Admit One answers those with an "expired" page naming no sala.
      const filmSlots = films.flatMap(slots);
      const unknown = filmSlots.flatMap(([latest, ...rest]) =>
        latest !== undefined && ![latest, ...rest].some((id) => salas.has(id)) ? [latest] : [],
      );
      const resolved = await mapPool(unknown, SALA_WORKERS, lookup);
      unknown.forEach((id, i) => {
        const cinema = resolved[i];
        if (cinema !== undefined) salas.set(id, cinema);
      });
      for (const ids of filmSlots) {
        const cinema = ids.map((id) => salas.get(id)).find((key) => key !== undefined);
        if (cinema !== undefined) for (const id of ids) salas.set(id, cinema);
      }

      const out: ScrapedFilm[] = [];
      let unresolved = 0;
      for (const film of films) {
        const showings: ScrapedShowing[] = [];
        for (const session of film.sessions) {
          const cinema = salas.get(session.id);
          if (cinema === undefined) unresolved += 1;
          else if (registry.has(cinema)) {
            const showing = buildShowing({
              cinema,
              date: session.date,
              time: session.time,
              subtitle_lang: normalizeSubtitleLang(session.label),
              booking_url: session.bookingUrl,
              labels: { version: session.label },
            });
            if (showing !== undefined) showings.push(showing);
          }
        }
        if (showings.length > 0) out.push(scrapedFilm(film.title, film.imdbId, showings));
      }
      reportPartialFailure(log, VERDI, "showtimes without a sala", {
        failed: unresolved,
        total: films.reduce((sum, film) => sum + film.sessions.length, 0),
      });
      return { films: out, entry: cartellera };
    },
  };
}
