import { act, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PREF_KEYS } from "../domain/prefs";
import { forgetAll, removeObsoleteKeys, setHome, usePrefs } from "./prefs";

function HomeProbe() {
  const { home, seen } = usePrefs();
  return (
    <p>
      {home ? `${home.lat},${home.lng}` : "no home"} · {seen.size} seen
    </p>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});
afterEach(() => localStorage.clear());

describe("usePrefs", () => {
  it("renders with nothing set first, then the stored prefs after mount", () => {
    localStorage.setItem(PREF_KEYS.home, '{"lat":41.4,"lng":2.15}');
    localStorage.setItem(PREF_KEYS.seen, '["1","2"]');
    const { container } = render(<HomeProbe />);
    // render() flushes effects, so the post-mount read has already happened.
    expect(container.textContent).toBe("41.4,2.15 · 2 seen");
  });

  it("updates every reader when Home is saved, and marks <html> for the pre-paint CSS", () => {
    render(<HomeProbe />);
    void act(() => setHome({ lat: 41.39, lng: 2.17 }));
    expect(screen.getByText("41.39,2.17 · 0 seen")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("has-home")).toBe(true);
    expect(JSON.parse(localStorage.getItem(PREF_KEYS.home)!)).toEqual({ lat: 41.39, lng: 2.17 });

    void act(() => setHome(null));
    expect(screen.getByText("no home · 0 seen")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("has-home")).toBe(false);
    expect(localStorage.getItem(PREF_KEYS.home)).toBeNull();
  });

  it("drops a has-home class the stored value doesn't back up", () => {
    localStorage.setItem(PREF_KEYS.home, "garbage");
    document.documentElement.classList.add("has-home");
    render(<HomeProbe />);
    expect(document.documentElement.classList.contains("has-home")).toBe(false);
  });

  it("re-reads after a bfcache restore, since another page may have changed them", () => {
    render(<HomeProbe />);
    localStorage.setItem(PREF_KEYS.home, '{"lat":41.4,"lng":2.15}');
    void act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(screen.getByText("41.4,2.15 · 0 seen")).toBeInTheDocument();
  });

  it("forgets everything this site stores", () => {
    localStorage.setItem(PREF_KEYS.home, '{"lat":41.4,"lng":2.15}');
    localStorage.setItem(PREF_KEYS.seen, '["1"]');
    localStorage.setItem(PREF_KEYS.favourites, '["verdi"]');
    render(<HomeProbe />);
    void act(() => forgetAll());
    expect(screen.getByText("no home · 0 seen")).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });
});

describe("removeObsoleteKeys", () => {
  it("removes the old site's keys and keeps seen films", () => {
    localStorage.setItem("btw-dark", "true");
    localStorage.setItem("location_active", "true");
    localStorage.setItem(PREF_KEYS.seen, '["1"]');
    removeObsoleteKeys();
    expect(localStorage.getItem("btw-dark")).toBeNull();
    expect(localStorage.getItem("location_active")).toBeNull();
    expect(localStorage.getItem(PREF_KEYS.seen)).toBe('["1"]');
  });
});
