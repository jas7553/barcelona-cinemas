import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import * as api from "./api";
import type { Listings } from "./types";

const LISTINGS: Listings = {
  generated_at: "2026-03-29T09:00:00Z",
  stale: false,
  theaters: [
    {
      id: "verdi",
      name: "Cinemes Verdi",
      neighborhood: "Gràcia",
      website_url: "https://cinesesverdi.com",
      maps_url: "https://maps.google.com/?q=Verdi",
    },
  ],
  movies: [
    {
      id: "1",
      title: "Project Hail Mary",
      year: 2025,
      runtime_minutes: 157,
      genres: ["Sci-Fi"],
      rating: 8.2,
      synopsis: "A lone astronaut.",
      links: { imdb: null, letterboxd: null, filmaffinity: null },
      showtimes: [
        { theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" },
        { theater_id: "verdi", date: "2026-03-29", time: "20:00", language: "vo" },
      ],
    },
  ],
};

describe("App", () => {
  beforeEach(() => {
    vi.spyOn(api, "fetchListings").mockResolvedValue(LISTINGS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeletons initially then renders movies", async () => {
    render(<App />);
    expect(document.querySelector(".skeleton-row")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Project Hail Mary")).toBeInTheDocument()
    );
  });

  it("renders film count in header after loading", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("1 film")).toBeInTheDocument()
    );
  });

  it("shows stale banner when data is stale", async () => {
    vi.spyOn(api, "fetchListings").mockResolvedValue({
      ...LISTINGS,
      stale: true,
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/Listings last updated/)).toBeInTheDocument()
    );
  });
});
