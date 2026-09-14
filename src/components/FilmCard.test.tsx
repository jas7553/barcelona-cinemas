import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilmCard from "./FilmCard";
import { transformResponse } from "../utils";
import type { Listings } from "../types";

function futureDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function sampleListings(): Listings {
  return {
    generated_at: new Date().toISOString(),
    stale: false,
    theaters: [
      {
        id: "verdi",
        name: "Cinemes Verdi",
        address: "Carrer de Verdi, 32",
        neighborhood: "Gràcia",
        website_url: "https://example.com",
        maps_url: "https://maps.google.com/?q=Verdi",
        lat: null,
        lng: null,
      },
    ],
    movies: [
      {
        id: "1",
        title: "Project Hail Mary",
        year: 2025,
        runtime_minutes: 157,
        poster_url: null,
        backdrop_url: null,
        trailer_url: null,
        genres: ["Sci-Fi"],
        rating: 8.2,
        vote_count: 4129,
        synopsis: "A lone astronaut must save humanity.",
        links: { imdb: null, imdb_id: null },
        showtimes: [{ theater_id: "verdi", date: futureDate(2), time: "18:00", language: "vo" }],
      },
    ],
  };
}

function movie() {
  return transformResponse(sampleListings())[0];
}

describe("FilmCard", () => {
  it("links to the film's detail page", () => {
    render(<FilmCard movie={movie()} />);
    const link = screen.getByRole("link", { name: /Project Hail Mary/ });
    expect(link).toHaveAttribute("href", "/film/1");
  });

  it("renders no seen-toggle button when onToggleSeen is absent", () => {
    render(<FilmCard movie={movie()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onToggleSeen without navigating when the toggle is clicked", () => {
    const onToggleSeen = vi.fn();
    render(<FilmCard movie={movie()} onToggleSeen={onToggleSeen} />);
    const btn = screen.getByRole("button", { name: "Mark as seen" });
    fireEvent.click(btn);
    expect(onToggleSeen).toHaveBeenCalledTimes(1);
    // The button is a sibling of the link, not nested inside it.
    const link = screen.getByRole("link", { name: /Project Hail Mary/ });
    expect(link).not.toContainElement(btn);
  });

  it("reflects seen state in the toggle button's label and pressed state", () => {
    render(<FilmCard movie={movie()} seen onToggleSeen={() => {}} />);
    const btn = screen.getByRole("button", { name: "Mark as unseen" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });
});
