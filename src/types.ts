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

export interface Showtime {
  theater_id: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM
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
  /** Joined for multi-director films. */
  director?: string | null;
  /** Top-billed first. */
  cast?: string[];
  tagline?: string | null;
  synopsis: string;
  imdb_id: string | null;
  showtimes: Showtime[];
}

export interface Listings {
  generated_at: string;   // ISO 8601
  theaters: Theater[];
  movies: Movie[];
  /** Films no longer in the listings, kept for 30 days so their pages outlive the run. No showtimes. */
  ended_movies?: Movie[];
}
