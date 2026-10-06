// The public listings shape (transform.py). Optional fields are newer than some published data.

export interface Theater {
  id: string;
  name: string;
  /** "Verdi" for "Cines Verdi". */
  short_name?: string;
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
  /** Original audio language; null when unknown. */
  audio_lang?: "en" | "other" | null;
  /** Subtitle language; null when unknown. */
  subtitle_lang?: "en" | "es" | "ca" | null;
  /** Direct ticket-purchase link for this exact screening, when the cinema exposes one. */
  booking_url?: string | null;
  premium_format?: "imax" | null;
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
  /** TMDb vote count. */
  vote_count?: number | null;
  /** ISO 639-1, e.g. "fr". */
  original_lang?: string | null;
  /** Joined for multi-director films. */
  director?: string | null;
  /** Top-billed first. */
  cast?: string[];
  tagline?: string | null;
  synopsis: string;
  links: MovieLinks;
  showtimes: Showtime[];
}

/** A film no longer in the listings, kept for 30 days so its page outlives the run. */
export interface EndedMovie extends Movie {
  last_showing: string; // YYYY-MM-DD
}

export interface Listings {
  generated_at: string;   // ISO 8601
  theaters: Theater[];
  movies: Movie[];
  ended_movies?: EndedMovie[];
}
