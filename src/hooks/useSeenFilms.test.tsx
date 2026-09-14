import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SeenFilmsProvider, useSeenFilms, clearSeenFilms } from "./useSeenFilms";

const STORAGE_KEY = "btw-seen";

function wrapper({ children }: { children: React.ReactNode }) {
  return <SeenFilmsProvider>{children}</SeenFilmsProvider>;
}

describe("useSeenFilms", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("starts with nothing seen (SSR-safe first render)", () => {
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    expect(result.current.isSeen("1")).toBe(false);
    expect(result.current.seenCount).toBe(0);
  });

  it("reads previously stored ids after mount", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["1", "2"]));
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    await waitFor(() => expect(result.current.isSeen("1")).toBe(true));
    expect(result.current.isSeen("2")).toBe(true);
    expect(result.current.seenCount).toBe(2);
  });

  it("toggleSeen marks a film seen and persists it", () => {
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    act(() => result.current.toggleSeen("42"));
    expect(result.current.isSeen("42")).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(["42"]);
  });

  it("toggleSeen again marks it unseen and removes it from storage", () => {
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    act(() => result.current.toggleSeen("42"));
    act(() => result.current.toggleSeen("42"));
    expect(result.current.isSeen("42")).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it("ignores garbage JSON in storage", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    await waitFor(() => expect(result.current.seenCount).toBe(0));
  });

  it("ignores a non-array value in storage", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    await waitFor(() => expect(result.current.seenCount).toBe(0));
  });

  it("drops non-string entries from a mixed array", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["1", 2, null, "3", { x: 1 }]));
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    await waitFor(() => expect(result.current.seenCount).toBe(2));
    expect(result.current.isSeen("1")).toBe(true);
    expect(result.current.isSeen("3")).toBe(true);
  });

  it("caps an oversized stored array, keeping the most recent entries", async () => {
    const ids = Array.from({ length: 2500 }, (_, i) => String(i));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    await waitFor(() => expect(result.current.seenCount).toBe(2000));
    expect(result.current.isSeen("2499")).toBe(true);
    expect(result.current.isSeen("0")).toBe(false);
  });

  it("re-reads storage on a bfcache restore (persisted pageshow)", async () => {
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    await waitFor(() => expect(result.current.seenCount).toBe(0));
    // Another document (the film page) wrote the flag while this one sat in
    // bfcache; iOS Safari swipe-back restores it without remounting.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["7"]));
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(result.current.isSeen("7")).toBe(true);
  });

  it("re-reads storage on a cross-tab storage event", async () => {
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    await waitFor(() => expect(result.current.seenCount).toBe(0));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["8"]));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });
    expect(result.current.isSeen("8")).toBe(true);
  });

  it("clearSeenFilms removes the storage key", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["1"]));
    clearSeenFilms();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearAll empties in-memory state and storage", () => {
    const { result } = renderHook(() => useSeenFilms(), { wrapper });
    act(() => result.current.toggleSeen("1"));
    act(() => result.current.toggleSeen("2"));
    expect(result.current.seenCount).toBe(2);
    act(() => result.current.clearAll());
    expect(result.current.seenCount).toBe(0);
    expect(result.current.isSeen("1")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
