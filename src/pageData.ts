import type { DateKey } from "./domain/time";
import type { Movie, Showtime, Theater } from "./types";

/** Fields every page's embedded payload carries. */
export interface PageBase {
  /** The instant the page was rendered; seeds the clock for hydration. */
  renderedAt: string;
  /** When the listings were fetched (public `generated_at`). */
  generatedAt: string;
  /** The refresh fell back to cached listings. */
  stale: boolean;
}

/** A showtime as list pages carry it; the week timetable drops what only the ticket needs. */
export type Showing = Pick<Showtime, "theater_id" | "date" | "time"> &
  Partial<Pick<Showtime, "booking_url" | "premium_format" | "audio_lang" | "subtitle_lang">>;

export type ListFilm = Pick<Movie, "id" | "title" | "poster_url" | "rating" | "genres" | "runtime_minutes"> & {
  showtimes: Showing[];
};

/** How much of a day the cinemas have published, across all films. */
export interface CalendarDay {
  date: DateKey;
  /** Cinemas with at least one showing that day. */
  cinemas: number;
  /** Start time of the day's last showing. */
  last: string;
}

/** What the This week and Day pages share: they render the same strip and rows. */
export interface ListData {
  films: ListFilm[];
  theaters: Theater[];
  calendar: CalendarDay[];
}

/** Everything the film page shows. Cast is cut to the 4 it names. */
export type FilmDetail = ListFilm &
  Pick<Movie, "year" | "backdrop_url" | "trailer_url" | "synopsis"> & {
    tagline: string | null;
    director: string | null;
    cast: string[];
    imdb: string | null;
    letterboxd: string;
  };

/**
 * A film page: the film, its showings over the rendered days with what the
 * ticket needs, and the cinemas they're at. `date` is null on the undated page,
 * which opens on the first day with showings left.
 */
export type FilmPageData = PageBase & {
  page: "film";
  film: FilmDetail;
  theaters: Theater[];
  calendar: CalendarDay[];
  date: DateKey | null;
};

export type WeekPageData = PageBase & ListData & { page: "week" };
export type DayPageData = PageBase & ListData & { page: "day"; date: DateKey };

export type PageData =
  | WeekPageData
  | DayPageData
  | FilmPageData
  | (PageBase & { page: "privacy" })
  | (PageBase & { page: "not-found" });

export type PageName = PageData["page"];
