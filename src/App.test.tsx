import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import * as api from "./api";
import type { Listings } from "./types";

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
      address: "Carrer de Verdi, 32",
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
      poster_url: null,
      backdrop_url: null,
      trailer_url: null,
      genres: ["Sci-Fi"],
      rating: 8.2,
      synopsis: "A lone astronaut.",
      links: { imdb: null, imdb_id: null },
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
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeletons initially then renders film title", async () => {
    render(<App />);
    expect(document.querySelector(".loading-card")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Project Hail Mary")).toBeInTheDocument()
    );
  });

  it("renders app title", () => {
    render(<App />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Barcelona");
    expect(heading).toHaveTextContent("This Week");
  });

  it("navigates to search and back", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Project Hail Mary")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "Search films" }));
    expect(screen.getByRole("textbox", { name: "Search films" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    // Screen stays in DOM but list screen loses is-pushed class
    expect(document.querySelector(".screen-list.is-pushed")).not.toBeInTheDocument();
  });

  it("navigates to film detail on card tap", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Project Hail Mary")).toBeInTheDocument()
    );
    const card = screen.getByText("Project Hail Mary").closest("a");
    await user.click(card!);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument()
    );
  });
});
