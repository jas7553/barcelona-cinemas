import { renderToString } from "preact-render-to-string";
import { App } from "./App";
import { addDays, formatDayMonth, formatWeekdayLong, madridDateKey, type DateKey } from "./domain/time";
import type {
  CalendarDay,
  CinemaPageData,
  FilmDetail,
  FilmPageData,
  ListData,
  ListFilm,
  PageBase,
  PageData,
  Showing,
} from "./pageData";
import type { Listings, Movie, Showtime, Theater } from "./types";

const SITE_NAME = "Barcelona This Week";
const DEFAULT_DESC =
  "English-language (VO) cinema showtimes across Barcelona this week — what's on, where, and when.";
// Brand image for social/link previews. 256×256 app icon — swap for a dedicated
// 1200×630 card if one is ever produced (Twitter then upgrades to large_image).
const OG_IMAGE_PATH = "/apple-touch-icon.png";

export interface RenderedPage {
  /** Server-rendered markup for the #root container. */
  html: string;
  /** Contents for <title>. */
  title: string;
  /** Extra <head> tags (description, OpenGraph). */
  headExtra: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metaTags(opts: {
  title: string;
  description: string;
  image?: string | null;
  /** Use Twitter's large-image card (only when `image` is a real poster, not the icon). */
  largeImage?: boolean;
  url?: string;
  /** Absolute canonical URL. Omit on noindex pages — the two should not co-occur. */
  canonical?: string;
  noindex?: boolean;
}): string {
  const tags = [
    `<meta name="description" content="${escapeHtml(opts.description)}" />`,
    `<meta property="og:title" content="${escapeHtml(opts.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(opts.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
  ];
  if (opts.url) tags.push(`<meta property="og:url" content="${escapeHtml(opts.url)}" />`);
  if (opts.image) tags.push(`<meta property="og:image" content="${escapeHtml(opts.image)}" />`);
  tags.push(
    `<meta name="twitter:card" content="${opts.largeImage && opts.image ? "summary_large_image" : "summary"}" />`,
  );
  tags.push(`<meta name="twitter:title" content="${escapeHtml(opts.title)}" />`);
  tags.push(`<meta name="twitter:description" content="${escapeHtml(opts.description)}" />`);
  if (opts.image) tags.push(`<meta name="twitter:image" content="${escapeHtml(opts.image)}" />`);
  if (opts.canonical) tags.push(`<link rel="canonical" href="${escapeHtml(opts.canonical)}" />`);
  if (opts.noindex) tags.push(`<meta name="robots" content="noindex" />`);
  return tags.join("\n    ");
}

/** Serialize an object as an inert ld+json data block. Like #__APP_DATA__ it is
 * not executed, so the CSP script-src needs no hash; only escape the "<" so a
 * synopsis containing "</script>" cannot break out of the element. */
function jsonLdScript(obj: unknown): string {
  const json = JSON.stringify(obj).replace(/</g, "\\u003c");
  return `\n    <script type="application/ld+json">${json}</script>`;
}

/** Europe/Madrid UTC offset ("+02:00"/"+01:00") for a given YYYY-MM-DD, DST-aware.
 *
 * Deliberately independent of process TZ — this is the correctness anchor for
 * the ScreeningEvent startDate. The literal below must equal SITE_TIMEZONE in
 * scripts/site-constants.mjs (a .mjs the client bundle must not import, so it
 * stays a literal); scripts/site-constants.test.mjs fails if it drifts. */
function madridOffset(dateStr: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Madrid",
      timeZoneName: "longOffset",
    }).formatToParts(new Date(`${dateStr}T12:00:00Z`));
    const off = (parts.find((p) => p.type === "timeZoneName")?.value ?? "").replace("GMT", "");
    return off || "+00:00";
  } catch {
    return "+00:00";
  }
}

/** schema.org Movie + one ScreeningEvent per showtime — feeds Google's showtime rich results. */
function filmJsonLd(movie: FilmDetail, theaters: Theater[], url: string | undefined): string {
  const movieId = url ? `${url}#movie` : undefined;
  const byId = new Map(theaters.map((t) => [t.id, t]));

  const movieNode: Record<string, unknown> = { "@type": "Movie", name: movie.title };
  if (movieId) movieNode["@id"] = movieId;
  if (movie.poster_url) movieNode.image = movie.poster_url;
  if (movie.year) movieNode.datePublished = String(movie.year);
  if (movie.genres?.length) movieNode.genre = movie.genres;
  if (movie.director) movieNode.director = { "@type": "Person", name: movie.director };
  if (movie.cast?.length) movieNode.actor = movie.cast.map((name) => ({ "@type": "Person", name }));
  if (movie.runtime_minutes) movieNode.duration = `PT${movie.runtime_minutes}M`;

  const events = movie.showtimes.map((s) => {
    const theater = byId.get(s.theater_id);
    const node: Record<string, unknown> = {
      "@type": "ScreeningEvent",
      name: `${movie.title}${theater ? ` at ${theater.name}` : ""}`,
      startDate: `${s.date}T${s.time}:00${madridOffset(s.date)}`,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      workPresented: movieId ? { "@id": movieId } : { "@type": "Movie", name: movie.title },
    };
    if (theater) {
      node.location = {
        "@type": "MovieTheater",
        name: theater.name,
        ...(theater.address ? { address: theater.address } : {}),
        ...(theater.website_url ? { url: theater.website_url } : {}),
      };
    }
    if (s.booking_url) {
      node.offers = { "@type": "Offer", url: s.booking_url, availability: "https://schema.org/InStock" };
    }
    if (s.audio_lang === "en") node.inLanguage = "en";
    if (s.subtitle_lang) node.subtitleLanguage = s.subtitle_lang;
    if (s.premium_format === "imax") node.videoFormat = "IMAX";
    return node;
  });

  return jsonLdScript({ "@context": "https://schema.org", "@graph": [movieNode, ...events] });
}

// Day pages and the timetable cover today plus 7: one more than the horizon, so
// a page still open after midnight has the day that rolls into view.
const RENDERED_DAYS = 8;

/** Showings per day across every film: how much of each day is published. */
function calendar(movies: Movie[]): CalendarDay[] {
  const days = new Map<DateKey, { cinemas: Set<string>; last: string }>();
  for (const s of movies.flatMap((m) => m.showtimes)) {
    const day = days.get(s.date) ?? { cinemas: new Set(), last: s.time };
    day.cinemas.add(s.theater_id);
    if (s.time > day.last) day.last = s.time;
    days.set(s.date, day);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, cinemas: d.cinemas.size, last: d.last }));
}

/** A showtime with only the fields a list page reads, and none that are empty. */
function showing(s: Showtime, forTicket: boolean): Showing {
  const out: Showing = { theater_id: s.theater_id, date: s.date, time: s.time };
  if (s.premium_format) out.premium_format = s.premium_format;
  if (forTicket) {
    if (s.booking_url) out.booking_url = s.booking_url;
    if (s.audio_lang) out.audio_lang = s.audio_lang;
    if (s.subtitle_lang) out.subtitle_lang = s.subtitle_lang;
  }
  return out;
}

/**
 * The payload for This week (every day in range, timetable fields only) or one
 * Day (that day, plus what the ticket sheet needs). Films with nothing in range
 * are left out, and so are cinemas nothing in range is at.
 */
export function listData(listings: Listings, days: DateKey[], forTicket: boolean): ListData {
  const inRange = new Set(days);
  const films: ListFilm[] = [];
  for (const m of listings.movies) {
    const showtimes = m.showtimes.filter((s) => inRange.has(s.date)).map((s) => showing(s, forTicket));
    if (showtimes.length === 0) continue;
    const { id, title, poster_url, rating, genres, runtime_minutes } = m;
    films.push({ id, title, poster_url, rating, genres, runtime_minutes, showtimes });
  }
  const used = new Set(films.flatMap((f) => f.showtimes.map((s) => s.theater_id)));
  return {
    films,
    theaters: listings.theaters.filter((t) => used.has(t.id)),
    calendar: calendar(listings.movies),
  };
}

/** "Aftersun · 2022 · Drama". No synopsis: share previews stay spoiler-free (requirements 7.5). */
function filmDescription(film: FilmDetail): string {
  return [film.title, film.year, film.genres.slice(0, 3).join(", ")].filter(Boolean).join(" · ");
}

// The film page names the director and this many of the cast (requirements 5.3).
const CAST_SHOWN = 4;

function filmDetail(m: Movie, days: DateKey[]): FilmDetail {
  const inRange = new Set(days);
  const title = `${m.title}${m.year != null ? ` ${m.year}` : ""}`;
  return {
    id: m.id,
    title: m.title,
    year: m.year,
    poster_url: m.poster_url,
    backdrop_url: m.backdrop_url,
    trailer_url: m.trailer_url,
    rating: m.rating,
    genres: m.genres,
    runtime_minutes: m.runtime_minutes,
    tagline: m.tagline ?? null,
    synopsis: m.synopsis,
    director: m.director ?? null,
    cast: (m.cast ?? []).slice(0, CAST_SHOWN),
    imdb: m.links.imdb,
    letterboxd: m.links.imdb_id
      ? `https://letterboxd.com/imdb/${m.links.imdb_id}/`
      : `https://letterboxd.com/search/${encodeURIComponent(title)}/`,
    showtimes: m.showtimes.filter((s) => inRange.has(s.date)).map((s) => showing(s, true)),
  };
}

/**
 * A film's pages: the undated one, plus one per rendered day for a film still
 * in the listings. An ended film keeps only the undated page, in its "No more
 * showings" state (requirements 7.6).
 */
function filmPages(
  listings: Listings,
  base: Omit<FilmPageData, "page" | "film" | "theaters" | "calendar" | "date">,
  days: DateKey[],
  cal: CalendarDay[],
): { path: string; data: FilmPageData }[] {
  const ended = new Set((listings.ended_movies ?? []).map((m) => m.id));
  return [...listings.movies, ...(listings.ended_movies ?? [])].flatMap((m) => {
    const film = filmDetail(m, days);
    const used = new Set(film.showtimes.map((s) => s.theater_id));
    const page = { ...base, page: "film" as const, film, theaters: listings.theaters.filter((t) => used.has(t.id)), calendar: cal };
    return [
      { path: `film/${m.id}.html`, data: { ...page, date: null } },
      ...(ended.has(m.id) ? [] : days.map((date) => ({ path: `film/${m.id}/${date}.html`, data: { ...page, date } }))),
    ];
  });
}

/** A cinema's pages: the week view, plus a Day view for each rendered day. */
function cinemaPages(listings: Listings, base: PageBase, days: DateKey[], cal: CalendarDay[]) {
  const inRange = new Set(days);
  return listings.theaters.flatMap((theater) => {
    const films: ListFilm[] = [];
    for (const m of listings.movies) {
      const showtimes = m.showtimes
        .filter((s) => s.theater_id === theater.id && inRange.has(s.date))
        .map((s) => showing(s, true));
      if (showtimes.length === 0) continue;
      const { id, title, poster_url, rating, genres, runtime_minutes } = m;
      films.push({ id, title, poster_url, rating, genres, runtime_minutes, showtimes });
    }
    const page: Omit<CinemaPageData, "date"> = {
      ...base,
      page: "cinema",
      theaterId: theater.id,
      films,
      theaters: listings.theaters,
      calendar: cal,
    };
    return [
      { path: `cinema/${theater.id}.html`, data: { ...page, date: null } },
      ...days.map((date) => ({ path: `cinema/${theater.id}/${date}.html`, data: { ...page, date } })),
    ];
  });
}

/** Each cinema's films by the start of their last showing there. */
function lastShowings(listings: Listings, days: DateKey[]): Record<string, string[]> {
  const inRange = new Set(days);
  const out: Record<string, string[]> = {};
  for (const m of listings.movies) {
    const last = new Map<string, string>();
    for (const s of m.showtimes.filter((s) => inRange.has(s.date))) {
      const at = `${s.date}T${s.time}`;
      if (at > (last.get(s.theater_id) ?? "")) last.set(s.theater_id, at);
    }
    for (const [theaterId, at] of last) (out[theaterId] ??= []).push(at);
  }
  return out;
}

/** Every page the new front end renders, keyed by its output path. */
export function sitePages(listings: Listings, renderedAt: string): { path: string; data: PageData }[] {
  const base = { renderedAt, generatedAt: listings.generated_at, stale: listings.stale };
  const today = madridDateKey(new Date(renderedAt));
  const days = Array.from({ length: RENDERED_DAYS }, (_, i) => addDays(today, i));
  const cal = calendar(listings.movies);
  return [
    { path: "index.html", data: { ...base, page: "week", ...listData(listings, days, false) } },
    ...days.map((date) => ({
      path: `day/${date}.html`,
      data: { ...base, page: "day" as const, date, ...listData(listings, [date], true) },
    })),
    ...filmPages(listings, base, days, cal),
    ...cinemaPages(listings, base, days, cal),
    {
      path: "cinemas.html",
      data: { ...base, page: "cinemas", theaters: listings.theaters, lastShowings: lastShowings(listings, days) },
    },
    // For the Home sheet's map.
    { path: "privacy.html", data: { ...base, page: "privacy", theaters: listings.theaters } },
    { path: "404.html", data: { ...base, page: "not-found", theaters: listings.theaters } },
  ];
}

export function renderPage(data: PageData, siteUrl?: string): RenderedPage {
  const html = renderToString(<App data={data} />);
  switch (data.page) {
    case "week":
      return {
        html,
        title: SITE_NAME,
        headExtra: metaTags({
          title: SITE_NAME,
          description: DEFAULT_DESC,
          image: siteUrl ? `${siteUrl}${OG_IMAGE_PATH}` : OG_IMAGE_PATH,
          url: siteUrl || undefined,
          canonical: siteUrl ? `${siteUrl}/` : undefined,
        }),
      };
    case "day": {
      // The weekday and date, not "Today": the page outlives the day it was rendered on.
      const title = `${formatWeekdayLong(data.date)} ${formatDayMonth(data.date)} · ${SITE_NAME}`;
      const url = siteUrl ? `${siteUrl}/day/${data.date}/` : undefined;
      return {
        html,
        title,
        headExtra: metaTags({
          title,
          description: DEFAULT_DESC,
          image: siteUrl ? `${siteUrl}${OG_IMAGE_PATH}` : OG_IMAGE_PATH,
          url,
          canonical: url,
        }),
      };
    }
    case "film": {
      const { film, date } = data;
      const title = `${film.title} · ${SITE_NAME}`;
      const undated = siteUrl ? `${siteUrl}/film/${film.id}/` : undefined;
      // Dated pages point search engines at the undated one; a film whose run
      // is over stays reachable for links but out of the index.
      const showing = film.showtimes.length > 0;
      return {
        html,
        title,
        headExtra:
          metaTags({
            title,
            description: filmDescription(film),
            image: film.poster_url,
            largeImage: true,
            url: date && siteUrl ? `${siteUrl}/film/${film.id}/${date}/` : undated,
            canonical: showing ? undated : undefined,
            noindex: !showing,
          }) + (showing && !date ? filmJsonLd(film, data.theaters, undated) : ""),
      };
    }
    case "cinema": {
      const theater = data.theaters.find((t) => t.id === data.theaterId)!;
      const title = `${theater.name} · ${SITE_NAME}`;
      const url = siteUrl ? `${siteUrl}/cinema/${theater.id}/` : undefined;
      return {
        html,
        title,
        headExtra: metaTags({
          title,
          description: `English-language showtimes at ${theater.name}, ${theater.neighborhood}, this week.`,
          url: data.date && siteUrl ? `${siteUrl}/cinema/${theater.id}/${data.date}/` : url,
          canonical: url,
        }),
      };
    }
    case "cinemas": {
      const title = `Cinemas · ${SITE_NAME}`;
      const url = siteUrl ? `${siteUrl}/cinemas/` : undefined;
      return {
        html,
        title,
        headExtra: metaTags({
          title,
          description: "The Barcelona cinemas showing English-language films this week.",
          url,
          canonical: url,
        }),
      };
    }
    case "privacy": {
      const title = `Privacy · ${SITE_NAME}`;
      const url = siteUrl ? `${siteUrl}/privacy/` : undefined;
      return {
        html,
        title,
        headExtra: metaTags({
          title,
          description: "No accounts, no cookies, no analytics, no tracking. Home, seen films and My cinemas stay on your device.",
          url,
          canonical: url,
        }),
      };
    }
    case "not-found":
      return {
        html,
        title: `Not showing · ${SITE_NAME}`,
        headExtra: metaTags({ title: `Not showing · ${SITE_NAME}`, description: DEFAULT_DESC, noindex: true }),
      };
  }
}
