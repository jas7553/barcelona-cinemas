import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MovieRow from "./MovieRow";
import type { TransformedMovie } from "../types";

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
      theater: {
        id: "verdi",
        name: "Cinemes Verdi",
        neighborhood: "Gracia",
        website_url: "https://cinesesverdi.com",
        maps_url: "https://maps.google.com/?q=Verdi",
      },
      date: "2026-03-29",
      time: "18:00",
      language: "vo",
      dayOffset: 0,
    },
  ],
};

describe("MovieRow", () => {
  it("renders a poster image when poster_url is present", () => {
    render(
      <MovieRow
        movie={BASE_MOVIE}
        filters={{ selectedDate: "all", selectedLang: "all", selectedTheater: "all" }}
      />
    );

    const poster = screen.getByTestId("movie-poster-image");
    expect(poster).toHaveAttribute("src", BASE_MOVIE.poster_url);
  });

  it("renders the designed fallback when poster_url is missing", () => {
    render(
      <MovieRow
        movie={{ ...BASE_MOVIE, poster_url: null }}
        filters={{ selectedDate: "all", selectedLang: "all", selectedTheater: "all" }}
      />
    );

    expect(screen.getByText("PH")).toBeInTheDocument();
    expect(screen.getByTestId("movie-poster-fallback")).toHaveTextContent("Project Hail Mary");
  });

  it("falls back when the poster image fails to load", () => {
    render(
      <MovieRow
        movie={BASE_MOVIE}
        filters={{ selectedDate: "all", selectedLang: "all", selectedTheater: "all" }}
      />
    );

    const poster = screen.getByTestId("movie-poster-image");
    fireEvent.error(poster);

    expect(screen.getByText("PH")).toBeInTheDocument();
    expect(screen.queryByTestId("movie-poster-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("movie-poster-fallback")).toBeInTheDocument();
  });

  it("renders a single IMDb details action with accessible new-tab labeling", () => {
    render(
      <MovieRow
        movie={BASE_MOVIE}
        filters={{ selectedDate: "all", selectedLang: "all", selectedTheater: "all" }}
      />
    );

    const detailsLink = screen.getByRole("link", {
      name: "View details for Project Hail Mary on IMDb (opens in a new tab)",
    });

    expect(detailsLink).toHaveAttribute("href", BASE_MOVIE.links.imdb);
    expect(detailsLink).toHaveAttribute("target", "_blank");
    expect(detailsLink).toHaveAttribute("rel", "noreferrer");
    expect(detailsLink).toHaveTextContent("View on IMDb");
    expect(screen.getByText("Project Hail Mary")).not.toHaveAttribute("href");
  });

  it("omits the details action when no IMDb link is available", () => {
    render(
      <MovieRow
        movie={{ ...BASE_MOVIE, links: { imdb: null } }}
        filters={{ selectedDate: "all", selectedLang: "all", selectedTheater: "all" }}
      />
    );

    expect(screen.queryByRole("link", { name: /IMDb/ })).not.toBeInTheDocument();
  });
});
