import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useLocationPin } from "./useLocationPin";

describe("useLocationPin", () => {
  let mockGetCurrentPosition: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: mockGetCurrentPosition },
      writable: true,
      configurable: true,
    });
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("starts inactive with no coords and no error", () => {
    mockGetCurrentPosition.mockImplementation(() => {});
    const { result } = renderHook(() => useLocationPin());
    expect(result.current.active).toBe(false);
    expect(result.current.coords).toBeNull();
    expect(result.current.error).toBe(false);
  });

  it("toggle from inactive: success sets active, coords, and localStorage flag", () => {
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({ coords: { latitude: 41.4035, longitude: 2.1580 } } as GeolocationPosition);
    });
    const { result } = renderHook(() => useLocationPin());
    act(() => { result.current.toggle(); });
    expect(result.current.active).toBe(true);
    expect(result.current.coords).toEqual({ lat: 41.4035, lng: 2.1580 });
    expect(localStorage.getItem("location_active")).toBe("true");
  });

  it("toggle from inactive: failure sets error briefly, stays inactive, no flag written", () => {
    vi.useFakeTimers();
    mockGetCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({ code: 1, message: "denied" } as GeolocationPositionError);
      },
    );
    const { result } = renderHook(() => useLocationPin());
    act(() => { result.current.toggle(); });
    expect(result.current.error).toBe(true);
    expect(result.current.active).toBe(false);
    expect(localStorage.getItem("location_active")).toBeNull();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.error).toBe(false);
  });

  it("toggle from active: clears coords and removes localStorage flag", () => {
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({ coords: { latitude: 41.4035, longitude: 2.1580 } } as GeolocationPosition);
    });
    const { result } = renderHook(() => useLocationPin());
    act(() => { result.current.toggle(); }); // activate
    act(() => { result.current.toggle(); }); // deactivate
    expect(result.current.active).toBe(false);
    expect(result.current.coords).toBeNull();
    expect(localStorage.getItem("location_active")).toBeNull();
  });

  it("on mount with localStorage flag: silently re-acquires coords without dialog", () => {
    localStorage.setItem("location_active", "true");
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({ coords: { latitude: 41.4035, longitude: 2.1580 } } as GeolocationPosition);
    });
    const { result } = renderHook(() => useLocationPin());
    expect(result.current.active).toBe(true);
    expect(result.current.coords).toEqual({ lat: 41.4035, lng: 2.1580 });
  });

  it("on mount with flag but permission revoked: clears flag, stays inactive", () => {
    localStorage.setItem("location_active", "true");
    mockGetCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({ code: 1, message: "denied" } as GeolocationPositionError);
      },
    );
    const { result } = renderHook(() => useLocationPin());
    expect(result.current.active).toBe(false);
    expect(localStorage.getItem("location_active")).toBeNull();
  });
});
