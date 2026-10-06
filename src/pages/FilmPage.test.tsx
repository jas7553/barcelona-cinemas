import { act, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREF_KEYS } from "../domain/prefs";
import type { FilmDetail, FilmPageData } from "../pageData";
import type { Theater } from "../types";
import { FilmPage } from "./FilmPage";

// Sun 4 Oct 2026, 17:30 in Madrid.
const RENDERED_AT = "2026-10-04T15:30:00Z";

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
// From the Home below: Girona about 1 km, Verdi 250 m.
const THEATERS = [theater("girona", "Cinemes Girona", 41.3955, 2.1655), theater("verdi", "Cines Verdi", 41.404, 2.1569)];

const FILM: FilmDetail = {
  id: "aftersun",
  title: "Aftersun",
  year: 2022,
  poster_url: null,
  backdrop_url: null,
  trailer_url: "https://youtube.example/x",
  rating: 7.7,
  genres: ["Drama"],
  runtime_minutes: 102,
  tagline: null,
  synopsis: "Sophie reflects on the shared joy and private melancholy of a holiday she took with her father twenty years earlier. Memories real and imagined fill the gaps.",
  director: "Charlotte Wells",
  cast: ["Paul Mescal", "Frankie Corio"],
  imdb: "https://imdb.example/tt1",
  letterboxd: "https://letterboxd.com/imdb/tt1/",
  showtimes: [
    { theater_id: "girona", date: "2026-10-04", time: "16:00" },
    { theater_id: "verdi", date: "2026-10-04", time: "21:30", booking_url: "https://verdi.example/book/1" },
    { theater_id: "girona", date: "2026-10-05", time: "18:00" },
  ],
};

const data: FilmPageData = {
  page: "film",
  renderedAt: RENDERED_AT,
  generatedAt: "2026-10-04T13:30:00Z",
  film: FILM,
  theaters: THEATERS,
  calendar: [
    { date: "2026-10-04", cinemas: 2, last: "22:00" },
    { date: "2026-10-05", cinemas: 2, last: "22:00" },
  ],
  date: null,
};

const cinemaRows = () => screen.getAllByRole("listitem").filter((li) => li.classList.contains("crow"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(RENDERED_AT));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("Film page", () => {
  it("opens on today, one row per cinema, with started showings dimmed rather than removed", () => {
    render(<FilmPage data={data} />);
    expect(screen.getByRole("link", { current: "date" })).toHaveAttribute("href", "/film/aftersun/2026-10-04/");
    expect(cinemaRows().map((li) => li.dataset.id)).toEqual(["girona", "verdi"]);
    expect(screen.getByText("16:00").closest(".chip")).toHaveClass("chip--past");
    expect(screen.queryByRole("link", { name: /16:00/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Cines Verdi/ })).toHaveAttribute("href", "/cinema/verdi/2026-10-04/");
  });

  it("puts My cinemas first, then the nearest, once prefs load", () => {
    localStorage.setItem(PREF_KEYS.home, JSON.stringify({ lat: 41.4021, lng: 2.1558 }));
    render(<FilmPage data={data} />);
    expect(cinemaRows().map((li) => li.dataset.id)).toEqual(["verdi", "girona"]);
    expect(within(cinemaRows()[0]).getByText("Cines Verdi barri · 250 m")).toBeInTheDocument();

    localStorage.setItem(PREF_KEYS.favourites, JSON.stringify(["girona"]));
    void act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PREF_KEYS.favourites }));
    });
    expect(cinemaRows().map((li) => li.dataset.id)).toEqual(["girona", "verdi"]);
    expect(within(cinemaRows()[0]).getByText("(my cinema)")).toBeInTheDocument();
  });

  it("opens on the first day with showings left when today's have all started", () => {
    vi.setSystemTime(new Date("2026-10-04T20:00:00Z"));
    render(<FilmPage data={data} />);
    expect(screen.getByRole("link", { current: "date" })).toHaveAttribute("href", "/film/aftersun/2026-10-05/");
  });

  it("says there are no more showings, with no day strip, once the run is over", () => {
    render(<FilmPage data={{ ...data, film: { ...FILM, showtimes: [] } }} />);
    expect(screen.getByText("No more showings")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Days" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Aftersun" })).toBeInTheDocument();
  });

  it("explains a day whose listings aren't out yet", () => {
    render(<FilmPage data={{ ...data, date: "2026-10-08" }} />);
    expect(screen.getByText("Thursday's listings aren't out yet")).toBeInTheDocument();
  });

  it("opens the ticket for a showing, with Book as the primary action", () => {
    render(<FilmPage data={data} />);
    const chip = screen.getByRole("link", { name: /21:30/ });
    // Before the bundle runs, the chip goes straight to the booking link.
    expect(chip).toHaveAttribute("href", "https://verdi.example/book/1");
    fireEvent.click(chip);
    const ticket = screen.getByRole("dialog", { name: "Aftersun" });
    expect(within(ticket).getByRole("link", { name: "Book at Verdi" })).toHaveAttribute(
      "href",
      "https://verdi.example/book/1",
    );
  });

  it("toggles Seen and stores it", () => {
    render(<FilmPage data={data} />);
    const seen = screen.getByRole("button", { name: /Seen/ });
    expect(seen).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(seen);
    expect(seen).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem(PREF_KEYS.seen)!)).toEqual(["aftersun"]);
  });

  it("clamps a long synopsis behind More", () => {
    render(<FilmPage data={data} />);
    const synopsis = screen.getByText(/Sophie reflects/);
    expect(synopsis).toHaveClass("synopsis--clamp");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(synopsis).not.toHaveClass("synopsis--clamp");
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("links out to the trailer, IMDb and Letterboxd", () => {
    render(<FilmPage data={data} />);
    expect(screen.getByRole("link", { name: /Trailer/ })).toHaveAttribute("href", "https://youtube.example/x");
    expect(screen.getByRole("link", { name: /IMDb/ })).toHaveAttribute("href", "https://imdb.example/tt1");
    expect(screen.getByRole("link", { name: /Letterboxd/ })).toHaveAttribute("href", "https://letterboxd.com/imdb/tt1/");
  });
});
