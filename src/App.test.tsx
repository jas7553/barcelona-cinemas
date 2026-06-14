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
    window.history.pushState({}, "", "/");
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

  it("shows not-found state when deep-linking to an unknown film", async () => {
    window.history.pushState({}, "", "/film/does-not-exist");
    render(<App />);
    expect(document.querySelector(".loading-card")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("This film isn't showing")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "See what's on" })).toBeInTheDocument();
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

  // Regression: MainList's scroll-restore rAF loop must be cancelled when the
  // list unmounts. Without the cancel, tapping into a detail before the loop
  // finishes left it running and yanked the *detail* page to the list's saved
  // offset. Assert no scrollTo fires from the leaked loop after detail mounts.
  it("stops restoring list scroll after navigating to a detail", async () => {
    sessionStorage.setItem("btw-list-scroll", "500");
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    try {
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
      // Detail has mounted (and reset its own scroll once). Let several animation
      // frames pass: a leaked restore loop would keep calling scrollTo here.
      const after = scrollSpy.mock.calls.length;
      await new Promise((r) => setTimeout(r, 200));
      expect(scrollSpy.mock.calls.length).toBe(after);
    } finally {
      scrollSpy.mockRestore();
      sessionStorage.clear();
    }
  });
});
