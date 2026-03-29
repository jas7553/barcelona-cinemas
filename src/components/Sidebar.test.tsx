import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import type { AppState, Theater, TransformedMovie } from "../types";

const FILTERS: AppState = {
  selectedDate: "all",
  selectedLang: "all",
  selectedGenre: "all",
  selectedTheater: "all",
  searchQuery: "",
  filterPanelOpen: false,
};

const THEATERS: Theater[] = [
  {
    id: "malla",
    name: "Cinema Maldà Extended Name",
    neighborhood: "Gothic Quarter",
    website_url: "https://example.com/malla",
    maps_url: "https://maps.google.com/?q=malla",
  },
];

const MOVIES: TransformedMovie[] = [
  {
    id: "movie-1",
    title: "Project Hail Mary",
    year: 2025,
    runtime_minutes: 157,
    runtimeLabel: "2h 37m",
    poster_url: null,
    genres: ["Sci-Fi"],
    rating: 8.2,
    synopsis: "A lone astronaut races to save humanity.",
    links: { imdb: null },
    showtimes: [
      {
        theater_id: "malla",
        theater: THEATERS[0],
        date: "2026-03-29",
        time: "18:00",
        language: "vo",
        dayOffset: 0,
      },
    ],
  },
];

describe("Sidebar", () => {
  it("renders theater rows with separate left-aligned label and neighborhood meta", () => {
    render(
      <Sidebar
        filters={FILTERS}
        onFilter={vi.fn()}
        genres={[]}
        theaters={THEATERS}
        movies={MOVIES}
      />
    );

    expect(screen.getByText("Cinema Maldà Extended Name")).toHaveClass("sidebar-btn-label");
    expect(screen.getByText("Gothic Quarter")).toHaveClass("sidebar-btn-meta");
  });

  it("exposes named filter groups for assistive technology", () => {
    render(
      <Sidebar
        filters={FILTERS}
        onFilter={vi.fn()}
        genres={["Sci-Fi"]}
        theaters={THEATERS}
        movies={MOVIES}
      />
    );

    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Theater" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Genre" })).toBeInTheDocument();
  });
});
