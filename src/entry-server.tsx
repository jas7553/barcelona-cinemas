import { renderToString } from "react-dom/server";
import ListPage, { type ListPageData } from "./pages/ListPage";
import FilmPage, { type FilmPageData } from "./pages/FilmPage";
import PrivacyPage from "./pages/PrivacyPage";
import type { Listings, Movie, Theater } from "./types";
import { premiumFormatLabel } from "./utils";

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
function filmJsonLd(movie: Movie, theaters: Theater[], url: string | undefined): string {
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
  if (movie.synopsis) movieNode.description = movie.synopsis;
  if (movie.rating != null && movie.vote_count && movie.vote_count > 0) {
    movieNode.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(movie.rating * 10) / 10,
      bestRating: 10,
      ratingCount: movie.vote_count,
    };
  }

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
    const fmt = premiumFormatLabel(s.premium_format);
    if (fmt) node.videoFormat = fmt;
    return node;
  });

  return jsonLdScript({ "@context": "https://schema.org", "@graph": [movieNode, ...events] });
}

export function renderList(data: ListPageData, siteUrl?: string): RenderedPage {
  return {
    html: renderToString(<ListPage data={data} />),
    title: SITE_NAME,
    headExtra: metaTags({
      title: SITE_NAME,
      description: DEFAULT_DESC,
      image: siteUrl ? `${siteUrl}${OG_IMAGE_PATH}` : OG_IMAGE_PATH,
      url: siteUrl || undefined,
      canonical: siteUrl ? `${siteUrl}/` : undefined,
    }),
  };
}

export function renderFilm(data: FilmPageData, siteUrl?: string): RenderedPage {
  const movie = data.listings.movies[0];
  const title = movie ? `${movie.title} · ${SITE_NAME}` : SITE_NAME;
  const description = movie?.synopsis?.slice(0, 200) || DEFAULT_DESC;
  // A film with no showtimes renders the graceful "not showing" state — a soft
  // 404. Mark it noindex (and skip canonical/JSON-LD) so search engines don't
  // index a dead page; index only films actually screening this week.
  const showing = !!movie && movie.showtimes.length > 0;
  const url = siteUrl ? `${siteUrl}/film/${data.filmId}` : undefined;
  const meta = metaTags({
    title,
    description,
    image: movie?.poster_url ?? null,
    largeImage: true,
    url,
    canonical: showing ? url : undefined,
    noindex: !showing,
  });
  const jsonLd = showing ? filmJsonLd(movie, data.listings.theaters, url) : "";
  return {
    html: renderToString(<FilmPage data={data} />),
    title,
    headExtra: meta + jsonLd,
  };
}

export function renderPrivacy(siteUrl?: string): RenderedPage {
  const title = `Privacy · ${SITE_NAME}`;
  const description =
    "No cookies, no analytics, no tracking. Barcelona This Week is a static site — it sets no cookies and collects no personal data.";
  return {
    html: renderToString(<PrivacyPage />),
    title,
    headExtra: metaTags({
      title,
      description,
      url: siteUrl ? `${siteUrl}/privacy` : undefined,
      canonical: siteUrl ? `${siteUrl}/privacy` : undefined,
    }),
  };
}

/** Build a per-film payload (one movie + the theaters it uses) from full listings. */
export function filmListings(full: Listings, filmId: string): Listings | null {
  const movie = full.movies.find((m) => m.id === filmId);
  if (!movie) return null;
  const usedTheaters = new Set(movie.showtimes.map((s) => s.theater_id));
  return {
    generated_at: full.generated_at,
    stale: full.stale,
    theaters: full.theaters.filter((t) => usedTheaters.has(t.id)),
    movies: [movie],
  };
}
