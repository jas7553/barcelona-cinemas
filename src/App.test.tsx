import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import * as api from "./api";
import type { Listings } from "./types";

/** A date string 2 days from now, which will always be within the 7-day window. */
function futureDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

const LISTINGS: Listings = {
  generated_at: new Date().toISOString(),
  stale: false,
  theaters: [
    {
      id: "verdi",
      name: "Cinemes Verdi",
      neighborhood: "Gràcia",
      website_url: "https://cinesesverdi.com",
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
      poster_url: "https://image.tmdb.org/t/p/w342/example.jpg",
      genres: ["Sci-Fi"],
      rating: 8.2,
      synopsis: "A lone astronaut.",
      links: { imdb: null },
      showtimes: [
        { theater_id: "verdi", date: futureDateStr(), time: "18:00", language: "vo" },
        { theater_id: "verdi", date: futureDateStr(), time: "20:00", language: "vo" },
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
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    expect(document.querySelector(".skeleton-row")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Project Hail Mary")).toBeInTheDocument()
    );
  });

  it("renders a skip link and a named main region", () => {
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    expect(screen.getByRole("link", { name: "Skip to listings" })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main", { name: "Barcelona English-language cinema listings" })).toHaveAttribute(
      "id",
      "main-content"
    );
  });

  it("announces loading and exposes the main region as busy while fetching", () => {
    let resolveListings: ((value: Listings) => void) | undefined;
    vi.spyOn(api, "fetchListings").mockImplementation(
      () =>
        new Promise<Listings>((resolve) => {
          resolveListings = resolve;
        })
    );

    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    expect(screen.getByRole("status")).toHaveTextContent("Loading movie listings.");
    expect(screen.getByRole("main", { name: "Barcelona English-language cinema listings" })).toHaveAttribute(
      "aria-busy",
      "true"
    );

    resolveListings?.(LISTINGS);
  });

  it("announces the result count after loading", async () => {
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 film shown.")
    );
  });

  it("shows quiet freshness metadata when data is fresh", async () => {
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByText(/Listings last updated/)).toBeInTheDocument()
    );

    expect(screen.getByText(/Listings last updated .*just now|Listings last updated .*minute|Listings last updated .*hour|Listings last updated .*day/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 film shown.");
  });

  it("renders TMDb attribution once after listings load", async () => {
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    const attribution = await screen.findByRole("region", { name: "TMDb attribution" });
    expect(attribution).toBeInTheDocument();
    expect(screen.getByText(/Poster images and movie metadata are provided by/i)).toBeInTheDocument();
    expect(screen.getByText(/This website uses TMDB and the TMDB APIs/i)).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "TMDb" })).toHaveLength(1);

    const links = screen.getAllByRole("link", { name: /TMDb|Visit TMDb/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://www.themoviedb.org/");
  });

  it("shows emphasized stale metadata when data is stale", async () => {
    vi.spyOn(api, "fetchListings").mockResolvedValue({
      ...LISTINGS,
      stale: true,
    });
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByText(/Listings last updated/)).toBeInTheDocument()
    );
  });

  it("keeps TMDb attribution visible when no movies are returned", async () => {
    vi.spyOn(api, "fetchListings").mockResolvedValue({
      ...LISTINGS,
      movies: [],
    });

    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    await waitFor(() =>
      expect(screen.getByText("No listings yet — check back soon.")).toBeInTheDocument()
    );
    expect(screen.getByRole("region", { name: "TMDb attribution" })).toBeInTheDocument();
  });

  it("keeps TMDb attribution visible when data is stale", async () => {
    vi.spyOn(api, "fetchListings").mockResolvedValue({
      ...LISTINGS,
      stale: true,
    });

    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 film shown.")
    );
    expect(screen.getByRole("region", { name: "TMDb attribution" })).toBeInTheDocument();
  });

  it("renders the showtimes view at /", () => {
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Skip to listings" })).toHaveAttribute(
      "href",
      "#main-content"
    );
  });
});
