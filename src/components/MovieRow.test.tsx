import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MovieRow from "./MovieRow";
import type { TransformedMovie } from "../types";

const THEATER = {
  id: "verdi",
  name: "Cinemes Verdi",
  neighborhood: "Gràcia",
  website_url: "https://cinesverdi.com",
  maps_url: "https://maps.google.com/?q=Verdi",
  lat: 41.4035,
  lng: 2.1580,
};

const BASE_MOVIE: TransformedMovie = {
  id: "movie-1",
  title: "Project Hail Mary",
  year: 2025,
  runtime_minutes: 157,
  runtimeLabel: "2h 37m",
  poster_url: "https://image.tmdb.org/t/p/w342/project-hail-mary.jpg",
  genres: ["Sci-Fi"],
  rating: 8.2,
  synopsis: "A lone astronaut races to save humanity.",
  links: { imdb: "https://www.imdb.com/title/tt12042730" },
  showtimes: [
    {
      theater_id: "verdi",
      theater: THEATER,
      date: "2099-06-01",
      time: "18:00",
      language: "vo",
      dayOffset: 0,
    },
  ],
};

function renderRow(overrides?: Partial<TransformedMovie>, expanded = false) {
  const onToggle = vi.fn();
  const onHide = vi.fn();
  render(
    <MovieRow
      movie={{ ...BASE_MOVIE, ...overrides }}
      isExpanded={expanded}
      onToggle={onToggle}
      onHide={onHide}
      coords={null}
    />
  );
  return { onToggle, onHide };
}

describe("MovieRow collapsed", () => {
  it("renders the movie title", () => {
    renderRow();
    expect(screen.getByText("Project Hail Mary")).toBeInTheDocument();
  });

  it("renders a poster image when poster_url is present", () => {
    renderRow();
    expect(screen.getByTestId("movie-poster-image")).toHaveAttribute("src", BASE_MOVIE.poster_url);
  });

  it("renders the fallback when poster_url is missing", () => {
    renderRow({ poster_url: null });
    expect(screen.getByTestId("movie-poster-fallback")).toBeInTheDocument();
  });

  it("renders rating", () => {
    renderRow();
    expect(screen.getByText(/8\.2/)).toBeInTheDocument();
  });

  it("does not render synopsis when collapsed", () => {
    renderRow();
    expect(screen.queryByText("A lone astronaut races to save humanity.")).not.toBeInTheDocument();
  });

  it("calls onToggle when the row is clicked", () => {
    const { onToggle } = renderRow();
    fireEvent.click(screen.getByRole("article"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("calls onHide when the hide button is clicked without triggering onToggle", () => {
    const { onToggle, onHide } = renderRow();
    const hideBtn = screen.getByRole("button", { name: /hide/i });
    fireEvent.click(hideBtn);
    expect(onHide).toHaveBeenCalledWith("movie-1");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows Last Chance badge when showtimes.length === 1", () => {
    renderRow();
    expect(screen.getByText(/last chance/i)).toBeInTheDocument();
  });

  it("does not show Last Chance badge when showtimes.length > 1", () => {
    const extras = Array.from({ length: 3 }, (_, i) => ({ ...BASE_MOVIE.showtimes[0], time: `${18 + i}:00` }));
    renderRow({ showtimes: [...BASE_MOVIE.showtimes, ...extras] });
    expect(screen.queryByText(/last chance/i)).not.toBeInTheDocument();
  });

  it("renders an expand chevron indicator", () => {
    renderRow();
    expect(screen.getByTestId("expand-chevron")).toBeInTheDocument();
  });

  it("renders Last Chance badge inside the poster wrap when showtimes.length === 1", () => {
    renderRow();
    const posterWrap = screen.getByTestId("poster-wrap");
    expect(posterWrap).toBeInTheDocument();
    expect(posterWrap.querySelector(".last-chance-badge")).not.toBeNull();
  });
});

describe("MovieRow expanded", () => {
  it("renders synopsis when expanded", () => {
    renderRow(undefined, true);
    expect(screen.getByText("A lone astronaut races to save humanity.")).toBeInTheDocument();
  });

  it("renders theater name when expanded", () => {
    renderRow(undefined, true);
    expect(screen.getByText("Cinemes Verdi")).toBeInTheDocument();
  });

  it("marks the article as expanded via aria-expanded", () => {
    renderRow(undefined, true);
    expect(screen.getByRole("article")).toHaveAttribute("aria-expanded", "true");
  });

  it("marks the article as collapsed via aria-expanded", () => {
    renderRow(undefined, false);
    expect(screen.getByRole("article")).toHaveAttribute("aria-expanded", "false");
  });

  it("renders a Google Maps link for the theater when maps_url is set", () => {
    renderRow(undefined, true);
    const mapsLink = screen.getByRole("link", { name: /cinemes verdi.*map/i });
    expect(mapsLink).toHaveAttribute("href", THEATER.maps_url);
    expect(mapsLink).toHaveAttribute("target", "_blank");
  });

  it("renders an IMDb link when imdb url is present", () => {
    renderRow({ links: { imdb: "https://www.imdb.com/title/tt12042730" } }, true);
    const imdbLink = screen.getByRole("link", { name: /imdb/i });
    expect(imdbLink).toHaveAttribute("href", "https://www.imdb.com/title/tt12042730");
    expect(imdbLink).toHaveAttribute("target", "_blank");
  });

  it("renders a Letterboxd search link", () => {
    renderRow(undefined, true);
    const lbLink = screen.getByRole("link", { name: /letterboxd/i });
    expect(lbLink).toHaveAttribute("href", expect.stringContaining("letterboxd.com/search/"));
    expect(lbLink).toHaveAttribute("target", "_blank");
  });

  it("does not render an IMDb link when imdb url is null", () => {
    renderRow({ links: { imdb: null } }, true);
    expect(screen.queryByRole("link", { name: /imdb/i })).not.toBeInTheDocument();
  });
});
