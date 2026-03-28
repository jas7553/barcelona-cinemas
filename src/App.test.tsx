import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import * as api from "./api";
import type { CinemaRegistry, Listings } from "./types";


const CINEMAS: CinemaRegistry = {
  Verdi:   { address: "", neighborhood: "Gràcia" },
  Glòries: { address: "", neighborhood: "Poble-Nou" },
};

const LISTINGS: Listings = {
  fetched_at: "2026-03-28T09:00:00Z",
  stale: false,
  movies: [
    {
      title: "Project Hail Mary",
      tmdb_id: 1,
      synopsis: "A lone astronaut.",
      rating: 8.2,
      runtime_mins: 157,
      genres: ["Sci-Fi"],
      showtimes: [
        { date: "2026-03-28", time: "18:00", cinema: "Verdi", neighborhood: "Gràcia", address: "" },
        { date: "2026-03-28", time: "20:00", cinema: "Glòries", neighborhood: "Poble-Nou", address: "" },
      ],
    },
  ],
};

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(api, "fetchCinemas").mockResolvedValue(CINEMAS);
    vi.spyOn(api, "fetchListings").mockResolvedValue(LISTINGS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeletons initially then renders movies", async () => {
    render(<App />);
    expect(document.querySelector(".skeleton")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Project Hail Mary")).toBeInTheDocument()
    );
  });

  it("renders neighborhood chips from cinemas data", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Gràcia")).toBeInTheDocument());
    expect(screen.getByText("Poble-Nou")).toBeInTheDocument();
  });

  it("filters movies by neighborhood chip", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Project Hail Mary")).toBeInTheDocument());
    // Select Poble-Nou — the movie has a showtime there so it should still appear
    await userEvent.click(screen.getByText("Poble-Nou"));
    expect(screen.getByText("Project Hail Mary")).toBeInTheDocument();
  });

  it("shows stale banner when data is stale", async () => {
    vi.spyOn(api, "fetchListings").mockResolvedValue({ ...LISTINGS, stale: true });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/Showing cached listings/)).toBeInTheDocument()
    );
  });

  it("shows 'Updated' timestamp in footer", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/Updated/)).toBeInTheDocument()
    );
  });

});
