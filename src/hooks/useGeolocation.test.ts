import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useGeolocation } from "./useGeolocation";

describe("useGeolocation", () => {
  let mockGetCurrentPosition: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: mockGetCurrentPosition },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null before geolocation resolves", () => {
    mockGetCurrentPosition.mockImplementation(() => { /* never calls back */ });
    const { result } = renderHook(() => useGeolocation());
    expect(result.current).toBeNull();
  });

  it("returns coords after geolocation resolves", () => {
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({ coords: { latitude: 41.4035, longitude: 2.1580 } } as GeolocationPosition);
    });
    const { result } = renderHook(() => useGeolocation());
    expect(result.current).toEqual({ lat: 41.4035, lng: 2.1580 });
  });

  it("returns null if geolocation is denied", () => {
    mockGetCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({ code: 1, message: "denied" } as GeolocationPositionError);
      }
    );
    const { result } = renderHook(() => useGeolocation());
    expect(result.current).toBeNull();
  });

  it("returns null if navigator.geolocation is unavailable", () => {
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useGeolocation());
    expect(result.current).toBeNull();
  });
});
