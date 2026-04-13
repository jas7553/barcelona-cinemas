import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MovieRow from "./MovieRow";
import type { TransformedMovie } from "../types";

const BASE_MOVIE: TransformedMovie = {
  id: "movie-1",
  title: "Project Hail Mary",
  year: 2025,
  runtime_minutes: 157,
  runtimeLabel: "2h 37m",
  poster_url: "https://image.tmdb.org/t/p/w342/project-hail-mary.jpg",
  backdrop_url: null,
  trailer_url: null,
  genres: ["Sci-Fi"],
  rating: 8.2,
  synopsis: "A lone astronaut races to save humanity.",
  links: { imdb: "https://www.imdb.com/title/tt12042730", imdb_id: "tt12042730" },
  showtimes: [
    {
      theater_id: "verdi",
      theater: {
        id: "verdi",
        name: "Cinemes Verdi",
        neighborhood: "Gràcia",
        website_url: "https://cinesverdi.com",
        maps_url: "https://maps.google.com/?q=Verdi",
        lat: 41.4035,
        lng: 2.1580,
      },
      date: "2099-06-01",
      time: "18:00",
      language: "vo",
      dayOffset: 0,
    },
  ],
};

function renderRow(overrides?: Partial<TransformedMovie>) {
  const onHide = vi.fn();
  render(
    <MemoryRouter>
      <MovieRow
        movie={{ ...BASE_MOVIE, ...overrides }}
        onHide={onHide}
      />
    </MemoryRouter>
  );
  return { onHide };
}

describe("MovieRow", () => {
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

  it("shows Last Chance badge when showtimes.length === 1", () => {
    renderRow();
    expect(screen.getByText(/last chance/i)).toBeInTheDocument();
  });

  it("does not show Last Chance badge when showtimes include future days", () => {
    const extras = Array.from({ length: 3 }, (_, i) => ({ ...BASE_MOVIE.showtimes[0], time: `${18 + i}:00`, dayOffset: 2 + i }));
    renderRow({ showtimes: [...BASE_MOVIE.showtimes, ...extras] });
    expect(screen.queryByText(/last chance/i)).not.toBeInTheDocument();
  });

  it("renders Last Chance badge inside the poster wrap", () => {
    renderRow();
    const posterWrap = screen.getByTestId("poster-wrap");
    expect(posterWrap.querySelector(".last-chance-badge")).not.toBeNull();
  });

  it("calls onHide when the hide button is clicked", () => {
    const { onHide } = renderRow();
    const hideBtn = screen.getByRole("button", { name: /hide/i });
    fireEvent.click(hideBtn);
    expect(onHide).toHaveBeenCalledWith("movie-1");
  });

  it("does not call onHide on row click", () => {
    const { onHide } = renderRow();
    fireEvent.click(screen.getByRole("article"));
    expect(onHide).not.toHaveBeenCalled();
  });
});
