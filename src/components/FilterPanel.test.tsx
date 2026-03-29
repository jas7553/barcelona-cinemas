import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FilterPanel from "./FilterPanel";
import type { AppState, Theater } from "../types";

const FILTERS: AppState = {
  selectedDate: "all",
  selectedLang: "all",
  selectedGenre: "all",
  selectedTheater: "all",
  searchQuery: "",
  filterPanelOpen: true,
};

const THEATERS: Theater[] = [
  {
    id: "verdi",
    name: "Cinemes Verdi",
    neighborhood: "Gracia",
    website_url: "https://example.com/verdi",
    maps_url: "https://maps.google.com/?q=Verdi",
  },
];

describe("FilterPanel", () => {
  it("exposes named filter groups and the mobile panel id", () => {
    render(
      <FilterPanel
        open
        onClose={vi.fn()}
        filters={FILTERS}
        onFilter={vi.fn()}
        genres={["Drama"]}
        theaters={THEATERS}
      />
    );

    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Theater" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Genre" })).toBeInTheDocument();
    expect(document.getElementById("mobile-filter-panel")).toBeInTheDocument();
  });
});
