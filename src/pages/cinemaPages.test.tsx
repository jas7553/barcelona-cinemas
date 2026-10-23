import { act, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREF_KEYS } from "../domain/prefs";
import type { CinemaPageData, CinemasPageData, ListFilm } from "../pageData";
import type { Theater } from "../types";
import { CinemaPage } from "./CinemaPage";
import { CinemasPage } from "./CinemasPage";

// Sun 4 Oct 2026, 17:30 in Madrid.
const RENDERED_AT = "2026-10-04T15:30:00Z";
const HOME = { lat: 41.4021, lng: 2.1558 };

const theater = (id: string, name: string, lat: number, lng: number): Theater => ({
  id,
  name,
  address: `${name} street`,
  neighborhood: `${name} barri`,
  website_url: `https://${id}.example`,
  maps_url: `https://maps.example/${id}`,
  lat,
  lng,
});
const THEATERS = [
  theater("girona", "Cinemes Girona", 41.3955, 2.1655),
  theater("verdi", "Cines Verdi", 41.404, 2.1569),
  theater("aribau", "Mooby Aribau", 41.3869, 2.1603),
];

const film = (id: string, title: string, showtimes: ListFilm["showtimes"]): ListFilm => ({
  id,
  title,
  poster_url: null,
  rating: null,
  genres: [],
  runtime_minutes: 100,
  showtimes,
});
const FILMS = [
  film("small", "Small", [{ theater_id: "verdi", date: "2026-10-05", time: "18:00" }]),
  film("big", "Big", [
    { theater_id: "verdi", date: "2026-10-04", time: "16:00" },
    { theater_id: "verdi", date: "2026-10-05", time: "20:00", booking_url: "https://verdi.example/b" },
    { theater_id: "verdi", date: "2026-10-05", time: "22:00", premium_format: "imax" },
  ]),
];

const base = { renderedAt: RENDERED_AT, generatedAt: "2026-10-04T13:30:00Z" };
const calendar = [
  { date: "2026-10-04", cinemas: 3, last: "22:00" },
  { date: "2026-10-05", cinemas: 3, last: "22:00" },
];
const cinema: CinemaPageData = {
  ...base,
  page: "cinema",
  theaterId: "verdi",
  films: FILMS,
  theaters: THEATERS,
  calendar,
  date: null,
};

const LEGEND = /No booking page for this showing/;
const filmTitles = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(RENDERED_AT));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("Cinema, week", () => {
  it("lists its films by showings here, with cells leading to the day's view of that film", () => {
    render(<CinemaPage data={cinema} />);
    expect(screen.getByRole("heading", { name: "2 films this week" })).toBeInTheDocument();
    expect(filmTitles()).toEqual(["Big", "Small"]);
    expect(screen.getByRole("link", { name: "Monday: 2 showings at 20:00, 22:00" })).toHaveAttribute(
      "href",
      "/cinema/verdi/2026-10-05/#fbig",
    );
    // Today's 16:00 has started, so Big's next is tomorrow.
    expect(screen.getByText(/Next: Mon 5 20:00/)).toBeInTheDocument();
  });

  it("shows times in cells with 3 showings or fewer, and the count on busier days", () => {
    const day = (id: string, title: string, times: string[]) =>
      film(id, title, times.map((time) => ({ theater_id: "verdi", date: "2026-10-05", time })));
    const trio = day("trio", "Trio", ["11:00", "13:00", "15:00"]);
    const busy = day("busy", "Busy", ["10:00", "12:00", "14:00", "16:00"]);
    render(<CinemaPage data={{ ...cinema, films: [...FILMS, trio, busy] }} />);
    expect(screen.getByRole("link", { name: "Monday: 2 showings at 20:00, 22:00" })).toHaveTextContent("20:0022:00");
    const times = screen.getByRole("link", { name: /^Monday: 3 showings/ });
    expect(times).toHaveAccessibleName(/at 11:00, 13:00, 15:00$/);
    expect(times).toHaveClass("cell--times");
    expect(times).toHaveAttribute("href", "/cinema/verdi/2026-10-05/#ftrio");
    const count = screen.getByRole("link", { name: "Monday: 4 showings" });
    expect(count).toHaveTextContent(/^4$/);
    expect(count).not.toHaveClass("cell--times");
    expect(count).toHaveAttribute("href", "/cinema/verdi/2026-10-05/#fbusy");
  });

  it("puts seen films last, faded and marked, rather than in a group", () => {
    localStorage.setItem(PREF_KEYS.seen, JSON.stringify(["big"]));
    render(<CinemaPage data={cinema} />);
    expect(filmTitles()).toEqual(["Small", "Big"]);
    expect(screen.getByRole("heading", { name: "Big" }).closest("li")).toHaveClass("film--seen");
    expect(screen.queryByText(/Seen \(/)).toBeNull();
  });

  it("toggles My cinema", () => {
    render(<CinemaPage data={cinema} />);
    const toggle = screen.getByRole("button", { name: /Add to my cinemas/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem(PREF_KEYS.favourites)!)).toEqual(["verdi"]);
  });

  it("gives the distance from home on its own line once Home is known", () => {
    localStorage.setItem(PREF_KEYS.home, JSON.stringify(HOME));
    render(<CinemaPage data={cinema} />);
    const line = screen.getByText("250 m from home");
    expect(line).toHaveClass("home-line");
    expect(line.parentElement).toHaveTextContent(/^Cines Verdi street · Cines Verdi barri250 m from home$/);
  });
});

describe("Cinema, day", () => {
  it("links every time straight to its booking page, or the cinema site, with no captions", () => {
    render(<CinemaPage data={{ ...cinema, date: "2026-10-05" }} />);
    expect(screen.getByRole("heading", { name: "2 films on Monday" })).toBeInTheDocument();
    expect(filmTitles()).toEqual(["Small", "Big"]);
    const big = screen.getByRole("heading", { name: "Big" }).closest("li")!;
    expect(big).toHaveAttribute("id", "fbig");
    const chips = within(big).getAllByRole("link").filter((a) => a.classList.contains("chip"));
    expect(chips.map((b) => b.textContent)).toEqual(["Big, 20:00", "Big, 22:00IMAX(book on the cinema's site)"]);
    expect(chips.map((b) => b.getAttribute("href"))).toEqual(["https://verdi.example/b", "https://verdi.example"]);
    expect(chips.map((b) => b.classList.contains("chip--site"))).toEqual([false, true]);
    expect(chips.map((b) => b.querySelector(".site-mark") !== null)).toEqual([false, true]);
    expect(chips[0]).not.toHaveAttribute("aria-haspopup");
    expect(within(big).getByRole("link", { name: "Big" })).toHaveAttribute("href", "/film/big/2026-10-05/");
    expect(screen.getAllByText(LEGEND)).toHaveLength(1);
  });

  it("has no legend when every time that day has its own booking page", () => {
    const booked = film("booked", "Booked", [
      { theater_id: "verdi", date: "2026-10-05", time: "19:00", booking_url: "https://verdi.example/b2" },
    ]);
    render(<CinemaPage data={{ ...cinema, films: [booked], date: "2026-10-05" }} />);
    expect(screen.getByRole("link", { name: /19:00/ })).toHaveAttribute("href", "https://verdi.example/b2");
    expect(screen.queryByText(LEGEND)).toBeNull();
  });

  it("says when nothing is on at the cinema that day", () => {
    render(<CinemaPage data={{ ...cinema, films: [], date: "2026-10-05" }} />);
    expect(screen.getByText("Nothing on at Verdi on Monday")).toBeInTheDocument();
  });

  it("says when the day's listings aren't out yet", () => {
    render(<CinemaPage data={{ ...cinema, date: "2026-10-07" }} />);
    expect(screen.getByText("Wednesday's listings aren't out yet")).toBeInTheDocument();
  });
});

describe("Cinemas", () => {
  const data: CinemasPageData = {
    ...base,
    page: "cinemas",
    theaters: THEATERS,
    lastShowings: {
      verdi: ["2026-10-05T22:00", "2026-10-05T18:00"],
      girona: ["2026-10-04T21:00"],
      aribau: ["2026-10-04T16:00"],
    },
  };
  const names = () => screen.getAllByRole("listitem").map((li) => li.querySelector("b")?.textContent ?? li.textContent);

  it("lists cinemas with films left, A–Z with no Home, and no My cinemas heading", () => {
    render(<CinemasPage data={data} />);
    // Aribau's last showing has started. CSS hides the empty My cinemas heading.
    expect(names()).toEqual(["My cinemas", "OthersAll", "Cinemes Girona", "Cines Verdi"]);
    expect(screen.getByText("2 showing English-language films · A–Z")).toBeInTheDocument();
  });

  it("puts My cinemas first, then the nearest", () => {
    localStorage.setItem(PREF_KEYS.home, JSON.stringify(HOME));
    localStorage.setItem(PREF_KEYS.favourites, JSON.stringify(["girona"]));
    render(<CinemasPage data={data} />);
    expect(names()).toEqual(["My cinemas", "Cinemes Girona", "OthersAll", "Cines Verdi"]);
    expect(screen.getByText("Cines Verdi barri · 250 m · 2 films this week")).toBeInTheDocument();
    void act(() => {
      fireEvent.click(screen.getByRole("button", { name: "My cinema: Cinemes Girona" }));
    });
    expect(JSON.parse(localStorage.getItem(PREF_KEYS.favourites)!)).toEqual([]);
  });

  it("leaves a cinema where it is when starred or unstarred, until the next load", () => {
    localStorage.setItem(PREF_KEYS.favourites, JSON.stringify(["girona"]));
    const { container } = render(<CinemasPage data={data} />);
    const star = (name: string) => screen.getByRole("button", { name: `My cinema: ${name}` });
    expect(container.querySelector(".cinemas")).toHaveAttribute("data-mine");
    const before = names();
    void act(() => {
      fireEvent.click(star("Cines Verdi"));
      fireEvent.click(star("Cinemes Girona"));
    });
    expect(star("Cines Verdi")).toHaveAttribute("aria-pressed", "true");
    expect(star("Cinemes Girona")).toHaveAttribute("aria-pressed", "false");
    expect(names()).toEqual(before);
    expect(container.querySelector(".cinemas")).toHaveAttribute("data-mine");
  });

  it("keeps the first star out of My cinemas until the next load", () => {
    const { container } = render(<CinemasPage data={data} />);
    void act(() => {
      fireEvent.click(screen.getByRole("button", { name: "My cinema: Cines Verdi" }));
    });
    expect(names()).toEqual(["My cinemas", "OthersAll", "Cinemes Girona", "Cines Verdi"]);
    expect(container.querySelector(".cinemas")).not.toHaveAttribute("data-mine");
  });
});
