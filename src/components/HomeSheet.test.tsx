import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREF_KEYS, type LatLng } from "../domain/prefs";
import { HOME_STATUS, HomeSheet } from "./HomeSheet";

const getCurrentPosition = vi.fn();

/** Opens the sheet from a button, as the header does. */
function Harness({ home = null }: { home?: LatLng | null }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <HomeSheet home={home} onClose={() => setOpen(false)} />}
    </>
  );
}

const dialog = () => screen.queryByRole("dialog", { name: "Home" });

beforeEach(() => {
  localStorage.clear();
  getCurrentPosition.mockReset();
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
});
afterEach(() => localStorage.clear());

describe("HomeSheet", () => {
  it("saves the current location as Home only once confirmed", () => {
    getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok({ coords: { latitude: 41.4009, longitude: 2.1601 } } as GeolocationPosition),
    );
    render(<Harness />);
    const save = screen.getByRole("button", { name: "Save home here" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(screen.getByRole("status")).toHaveTextContent(HOME_STATUS.found);
    expect(localStorage.getItem(PREF_KEYS.home)).toBeNull();

    fireEvent.click(save);
    expect(JSON.parse(localStorage.getItem(PREF_KEYS.home)!)).toEqual({ lat: 41.4009, lng: 2.1601 });
    expect(dialog()).toBeNull();
  });

  it("says so when location permission is refused, instead of failing silently", () => {
    getCurrentPosition.mockImplementation((_ok: PositionCallback, fail: PositionErrorCallback) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(screen.getByRole("status")).toHaveTextContent(HOME_STATUS.denied);
    expect(screen.getByRole("button", { name: "Save home here" })).toBeDisabled();
  });

  it("reports other location failures differently from a refusal", () => {
    getCurrentPosition.mockImplementation((_ok: PositionCallback, fail: PositionErrorCallback) =>
      fail({ code: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(screen.getByRole("status")).toHaveTextContent(HOME_STATUS.failed);
  });

  it("offers Clear home when one is set, and clears it", () => {
    localStorage.setItem(PREF_KEYS.home, '{"lat":41.4,"lng":2.15}');
    render(<Harness home={{ lat: 41.4, lng: 2.15 }} />);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear home" }));
    expect(localStorage.getItem(PREF_KEYS.home)).toBeNull();
    expect(dialog()).toBeNull();
  });

  it("closes on Esc without saving", () => {
    render(<Harness />);
    fireEvent(dialog()!, new Event("cancel", { cancelable: true }));
    expect(dialog()).toBeNull();
  });

  it("closes on a backdrop tap but not on a tap inside", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("heading", { name: "Home" }));
    expect(dialog()).not.toBeNull();
    fireEvent.click(dialog()!);
    expect(dialog()).toBeNull();
  });

  it("closes on Back rather than leaving the page", async () => {
    const before = history.length;
    render(<Harness />);
    expect(history.length).toBe(before + 1);
    void act(() => history.back());
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("pops its history entry when closed some other way", () => {
    const back = vi.spyOn(history, "back");
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(back).toHaveBeenCalledOnce();
    back.mockRestore();
  });
});
