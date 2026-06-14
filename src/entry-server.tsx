import { renderToString } from "react-dom/server";
import ListPage, { type ListPageData } from "./pages/ListPage";
import FilmPage, { type FilmPageData } from "./pages/FilmPage";
import type { Listings } from "./types";

const SITE_NAME = "Barcelona This Week";
const DEFAULT_DESC =
  "English-language (VO) cinema showtimes across Barcelona this week — what's on, where, and when.";

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

function metaTags(opts: { title: string; description: string; image?: string | null; url?: string }): string {
  const tags = [
    `<meta name="description" content="${escapeHtml(opts.description)}" />`,
    `<meta property="og:title" content="${escapeHtml(opts.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(opts.description)}" />`,
    `<meta property="og:type" content="website" />`,
  ];
  if (opts.url) tags.push(`<meta property="og:url" content="${escapeHtml(opts.url)}" />`);
  if (opts.image) tags.push(`<meta property="og:image" content="${escapeHtml(opts.image)}" />`);
  return tags.join("\n    ");
}

export function renderList(data: ListPageData): RenderedPage {
  return {
    html: renderToString(<ListPage data={data} />),
    title: SITE_NAME,
    headExtra: metaTags({ title: SITE_NAME, description: DEFAULT_DESC }),
  };
}

export function renderFilm(data: FilmPageData, siteUrl?: string): RenderedPage {
  const movie = data.listings.movies[0];
  const title = movie ? `${movie.title} · ${SITE_NAME}` : SITE_NAME;
  const description = movie?.synopsis?.slice(0, 200) || DEFAULT_DESC;
  return {
    html: renderToString(<FilmPage data={data} />),
    title,
    headExtra: metaTags({
      title,
      description,
      image: movie?.poster_url ?? null,
      url: siteUrl ? `${siteUrl}/film/${data.filmId}` : undefined,
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
