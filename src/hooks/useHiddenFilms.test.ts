import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useHiddenFilms } from "./useHiddenFilms";

describe("useHiddenFilms", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts with an empty set when localStorage is empty", () => {
    const { result } = renderHook(() => useHiddenFilms());
    expect(result.current.hiddenIds.size).toBe(0);
  });

  it("hideFilm adds the id to hiddenIds", () => {
    const { result } = renderHook(() => useHiddenFilms());
    act(() => { result.current.hideFilm("movie-1"); });
    expect(result.current.hiddenIds.has("movie-1")).toBe(true);
  });

  it("hideFilm persists the id to localStorage", () => {
    const { result } = renderHook(() => useHiddenFilms());
    act(() => { result.current.hideFilm("movie-1"); });
    const stored = JSON.parse(localStorage.getItem("hidden_film_ids") ?? "[]") as string[];
    expect(stored).toContain("movie-1");
  });

  it("clearHidden empties hiddenIds", () => {
    const { result } = renderHook(() => useHiddenFilms());
    act(() => { result.current.hideFilm("movie-1"); });
    act(() => { result.current.clearHidden(); });
    expect(result.current.hiddenIds.size).toBe(0);
  });

  it("clearHidden removes the key from localStorage", () => {
    const { result } = renderHook(() => useHiddenFilms());
    act(() => { result.current.hideFilm("movie-1"); });
    act(() => { result.current.clearHidden(); });
    expect(localStorage.getItem("hidden_film_ids")).toBeNull();
  });

  it("initialises from existing localStorage data", () => {
    localStorage.setItem("hidden_film_ids", JSON.stringify(["movie-a", "movie-b"]));
    const { result } = renderHook(() => useHiddenFilms());
    expect(result.current.hiddenIds.has("movie-a")).toBe(true);
    expect(result.current.hiddenIds.has("movie-b")).toBe(true);
  });
});
