import { fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREF_KEYS } from "../domain/prefs";
import type { DayPageData, ListFilm, WeekPageData } from "../pageData";
import type { Theater } from "../types";
import { DayPage } from "./DayPage";
import { WeekPage } from "./WeekPage";

// Sun 4 Oct 2026, 17:30 in Madrid.
const RENDERED_AT = "2026-10-04T15:30:00Z";

const theater = (id: string, name: string, lat: number, lng: number): Theater => ({
  id,
  name,
  address: `${name} street`,
  neighborhood: "Gràcia",
  website_url: `https://${id}.example`,
  maps_url: `https://maps.example/${id}`,
  lat,
  lng,
});
const THEATERS = [theater("verdi", "Cines Verdi", 41.404, 2.1569), theater("girona", "Cinemes Girona", 41.3955, 2.1655)];

const FILMS: ListFilm[] = [
  {
    id: "aftersun",
    title: "Aftersun",
    poster_url: null,
    rating: 7.7,
    genres: ["Drama"],
    runtime_minutes: 102,
    showtimes: [
      { theater_id: "verdi", date: "2026-10-04", time: "16:00" },
      { theater_id: "verdi", date: "2026-10-04", time: "21:30", booking_url: "https://verdi.example/book/1" },
      { theater_id: "girona", date: "2026-10-04", time: "22:00" },
    ],
  },
  {
    id: "drive",
    title: "Drive",
    poster_url: null,
    rating: null,
    genres: [],
    runtime_minutes: null,
    showtimes: [{ theater_id: "girona", date: "2026-10-04", time: "19:00" }],
  },
];

const base = { renderedAt: RENDERED_AT, generatedAt: "2026-10-04T13:30:00Z", theaters: THEATERS };
const calendar = [
  { date: "2026-10-04", cinemas: 2, last: "22:00" },
  { date: "2026-10-05", cinemas: 2, last: "22:00" },
];
const dayData: DayPageData = { ...base, page: "day", date: "2026-10-04", films: FILMS, calendar };
const weekData: WeekPageData = { ...base, page: "week", films: FILMS, calendar };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(RENDERED_AT));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("Day", () => {
  it("lists films by first remaining start, without showings that have started", () => {
    render(<DayPage data={dayData} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Drive", "Aftersun"]);
    expect(screen.queryByText("16:00")).toBeNull();
    expect(screen.getByText("From 17:30 · 2 films")).toBeInTheDocument();
  });

  it("opens the ticket for a showing, with Book as the primary action", () => {
    render(<DayPage data={dayData} />);
    fireEvent.click(screen.getByRole("link", { name: /21:30/ }));
    const ticket = screen.getByRole("dialog", { name: "Aftersun" });
    const book = within(ticket).getByRole("link", { name: "Book at Verdi" });
    expect(book).toHaveAttribute("href", "https://verdi.example/book/1");
    expect(ticket).toHaveTextContent("Today 4");
    expect(ticket).toHaveTextContent("Out ~23:27");
    expect(within(ticket).getByRole("link", { name: "Cines Verdi" })).toHaveAttribute("href", "/cinema/verdi/2026-10-04/");
  });

  it("falls back to the cinema website when the showing has no booking link", () => {
    render(<DayPage data={dayData} />);
    fireEvent.click(screen.getByRole("link", { name: /19:00/ }));
    const ticket = screen.getByRole("dialog", { name: "Drive" });
    expect(within(ticket).getByRole("link", { name: "Girona website" })).toHaveAttribute("href", "https://girona.example");
    expect(ticket).toHaveTextContent("No direct booking link for this showing");
    // Unknown runtime: start + 110 + 15.
    expect(ticket).toHaveTextContent("Out ~21:05");
  });

  it("shows distances from Home and moves seen films to the Seen group once prefs load", () => {
    localStorage.setItem(PREF_KEYS.home, JSON.stringify({ lat: 41.4021, lng: 2.1558 }));
    localStorage.setItem(PREF_KEYS.seen, JSON.stringify(["drive"]));
    render(<DayPage data={dayData} />);
    expect(screen.getByRole("link", { name: /21:30/ })).toHaveTextContent("Verdi · 250 m");
    const seen = screen.getByText("Seen (1)").closest("details")!;
    expect(within(seen).getByRole("heading", { name: "Drive" })).toBeInTheDocument();
  });

  it("says a day's listings aren't out yet rather than that nothing is on", () => {
    render(<DayPage data={{ ...dayData, date: "2026-10-07", films: [] }} />);
    expect(screen.getByText("Wednesday's listings aren't out yet")).toBeInTheDocument();
  });

  it("says nothing is left today once every showing has started", () => {
    vi.setSystemTime(new Date("2026-10-04T21:00:00Z"));
    render(<DayPage data={dayData} />);
    expect(screen.getByText("Nothing left today")).toBeInTheDocument();
  });
});

describe("This week", () => {
  it("links each day with showings to the film on that day, and hatches days not out yet", () => {
    const { container } = render(<WeekPage data={weekData} />);
    expect(screen.getByRole("link", { name: "Today: 2 showings" })).toHaveAttribute("href", "/film/aftersun/2026-10-04/");
    // Tue 6 onwards has under half of today's cinemas: not out yet.
    expect(container.querySelectorAll(".film")[0].querySelectorAll(".cell--unpub")).toHaveLength(5);
    expect(screen.getByText(/Sun 4 – Sat 10 Oct · 2 films · Tue, Wed, Thu, Fri and Sat listings not out yet/)).toBeInTheDocument();
  });

  it("puts films with few showings first, with a where-line", () => {
    render(<WeekPage data={weekData} />);
    expect(screen.getByRole("heading", { name: "Only a few showings" })).toBeInTheDocument();
    expect(screen.getByText("Today, 19:00 · Girona")).toBeInTheDocument();
    expect(screen.getByText("2 showings · Verdi, Girona")).toBeInTheDocument();
  });

  it("warns when the listings are more than a day old", () => {
    render(<WeekPage data={{ ...weekData, generatedAt: "2026-10-03T13:00:00Z" }} />);
    expect(screen.getByText(/Listings last updated Sat 3 Oct\. Times may have changed/)).toBeInTheDocument();
  });

  it("shows no warning for listings fetched today", () => {
    render(<WeekPage data={weekData} />);
    expect(screen.queryByText(/Listings last updated/)).not.toBeInTheDocument();
  });
});
