// API response types

export interface Theater {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  website_url: string;
  maps_url: string;
  lat: number | null;
  lng: number | null;
}

export interface MovieLinks {
  imdb: string | null;
  imdb_id: string | null;
}

export interface Showtime {
  theater_id: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM
  language: "vo" | "dub";
  /** Original audio language: "en" | "other" | null (unknown). Optional: predates older caches. */
  audio_lang?: "en" | "other" | null;
  /** Subtitle language: "en" | "es" | "ca" | null (unknown). Optional: predates older caches. */
  subtitle_lang?: "en" | "es" | "ca" | null;
  /** Direct ticket-purchase link for this exact screening, when the cinema exposes one.
      Optional: older cached API responses predate this field. */
  booking_url?: string | null;
}

export interface Movie {
  id: string;
  title: string;
  year: number | null;
  runtime_minutes: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  trailer_url: string | null;
  genres: string[];
  rating: number | null;
  /** TMDb vote count for aggregateRating. Optional: older cached responses predate it. */
  vote_count?: number | null;
  /** Original-language ISO 639-1 code (e.g. "fr"). Optional: older cached responses predate it. */
  original_lang?: string | null;
  /** Director name(s), joined for multi-director films. Optional: older cached responses predate it. */
  director?: string | null;
  /** Top-billed cast names. Optional: older cached responses predate it. */
  cast?: string[];
  /** Optional: older cached API responses predate this field */
  tagline?: string | null;
  synopsis: string;
  links: MovieLinks;
  showtimes: Showtime[];
}

export interface Listings {
  generated_at: string;   // ISO 8601
  stale: boolean;
  theaters: Theater[];
  movies: Movie[];
}

// Client-side transformed types (post-transformResponse())

export interface TransformedShowtime extends Showtime {
  theater: Theater;
  dayOffset: number;  // 0 = today, 1 = tomorrow, …, 6
}

export interface TransformedMovie extends Omit<Movie, "showtimes"> {
  runtimeLabel: string;
  showtimes: TransformedShowtime[];
}

export interface SheetVenueData {
  name: string;
  address?: string;
  neighborhood?: string;
  distLabel?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface CinemaViewGroup {
  theaterId: string;
  theater: Theater;
  films: Array<{
    movie: TransformedMovie;
    times: string[];
  }>;
  distanceKm?: number;
}
