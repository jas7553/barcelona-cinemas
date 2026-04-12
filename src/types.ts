// API response types

export interface Theater {
  id: string;
  name: string;
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


