import type { Theater } from "../types";
import { formatDistance } from "./format";
import type { LatLng } from "./prefs";

const EARTH_DIAMETER_KM = 12_742;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Straight-line distance in km, or null when either end has no coordinates. */
export function distanceKm(home: LatLng | null, theater: Pick<Theater, "lat" | "lng">): number | null {
  if (!home || theater.lat == null || theater.lng == null) return null;
  const h =
    Math.sin(toRad(theater.lat - home.lat) / 2) ** 2 +
    Math.cos(toRad(home.lat)) * Math.cos(toRad(theater.lat)) * Math.sin(toRad(theater.lng - home.lng) / 2) ** 2;
  return EARTH_DIAMETER_KM * Math.asin(Math.sqrt(h));
}

/** Distance from Home, or the neighbourhood when there's no Home or no coordinates. */
export function whereLabel(home: LatLng | null, theater: Theater): string {
  const km = distanceKm(home, theater);
  return km == null ? theater.neighborhood : formatDistance(km);
}
