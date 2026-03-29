// API response types — mirror of HANDOFF.md §3 / transform.py output

export interface Theater {
  id: string;
  name: string;
  neighborhood: string;
  website_url: string;
  maps_url: string;
}

export interface MovieLinks {
  imdb: string | null;
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

export interface AppState {
  selectedDate: "all" | number;
  selectedLang: "all" | "vo" | "dub";
  selectedGenre: string;
  selectedTheater: string;
  searchQuery: string;
  filterPanelOpen: boolean;
}
