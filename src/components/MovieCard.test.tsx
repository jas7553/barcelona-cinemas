import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MovieCard } from "./MovieCard";
import type { Movie } from "../types";

const BASE: Movie = {
  title: "Project Hail Mary",
  tmdb_id: 12345,
  synopsis: "A lone astronaut must save the Earth.",
  rating: 8.2,
  runtime_mins: 157,
  genres: ["Science Fiction", "Adventure"],
  showtimes: [
    { date: "2026-03-28", time: "18:00", cinema: "Verdi", neighborhood: "Gràcia", address: "" },
  ],
};

describe("MovieCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T00:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("renders title", () => {
    render(<MovieCard movie={BASE} />);
    expect(screen.getByRole("heading", { name: "Project Hail Mary" })).toBeInTheDocument();
  });

  it("renders rating", () => {
    render(<MovieCard movie={BASE} />);
    expect(screen.getByText(/8\.2/)).toBeInTheDocument();
  });

  it("renders genres", () => {
    render(<MovieCard movie={BASE} />);
    expect(screen.getByText("Science Fiction")).toBeInTheDocument();
    expect(screen.getByText("Adventure")).toBeInTheDocument();
  });

  it("renders runtime", () => {
    render(<MovieCard movie={BASE} />);
    expect(screen.getByText("2h 37m")).toBeInTheDocument();
  });

  it("omits rating when null", () => {
    render(<MovieCard movie={{ ...BASE, rating: null }} />);
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  });

  it("omits meta row when no genres and no runtime", () => {
    render(<MovieCard movie={{ ...BASE, genres: null, runtime_mins: null }} />);
    expect(screen.queryByText("Science Fiction")).not.toBeInTheDocument();
  });

  it("renders synopsis", () => {
    render(<MovieCard movie={BASE} />);
    expect(screen.getByText(BASE.synopsis!)).toBeInTheDocument();
  });
});
