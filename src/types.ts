export interface Showtime {
  cinema: string;
  neighborhood: string;
  address: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}

export interface Movie {
  title: string;
  tmdb_id: number | null;
  synopsis: string | null;
  rating: number | null;
  runtime_mins: number | null;
  genres: string[] | null;
  showtimes: Showtime[];
}

export interface Listings {
  fetched_at: string;
  stale: boolean;
  movies: Movie[];
}

export type CinemaRegistry = Record<string, { address: string; neighborhood: string }>;

export interface BannerState {
  type: "stale" | "error";
  message: string;
}
