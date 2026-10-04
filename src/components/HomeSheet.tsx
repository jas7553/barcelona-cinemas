import { useEffect, useRef, useState } from "preact/hooks";
import { setHome } from "../client/prefs";
import { distanceKm } from "../domain/distance";
import { shortName } from "../domain/format";
import type { LatLng } from "../domain/prefs";
import type { Theater } from "../types";
import { CityMap } from "./CityMap";
import { Sheet } from "./Sheet";

// The pick map's frame is fixed, so it doesn't jump as the pin moves: the
// cinemas this close to the centre of town.
const CENTRE = { lat: 41.395, lng: 2.165 };
const FRAME_KM = 4.5;

export const HOME_STATUS = {
  locating: "Finding you…",
  found: "Found you. Save to use this as Home.",
  denied: "Location access is off for this site. Tap the map instead, or allow it in Settings › Apps › Safari › Location.",
  failed: "Couldn't find your location. Try again, or tap the map instead.",
  unsupported: "This browser can't share your location. Tap the map instead.",
  picked: "Pin dropped. Save to use it as Home.",
} as const;

interface Props {
  home: LatLng | null;
  /** The cinemas to show on the pick map. */
  theaters: Theater[];
  onClose: () => void;
}

export function HomeSheet({ home, theaters, onClose }: Props) {
  const [pending, setPending] = useState<LatLng | null>(null);
  const [status, setStatus] = useState("");
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setStatus(HOME_STATUS.unsupported);
      return;
    }
    setStatus(HOME_STATUS.locating);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!mounted.current) return;
        setPending({ lat: coords.latitude, lng: coords.longitude });
        setStatus(HOME_STATUS.found);
      },
      (error) => {
        if (!mounted.current) return;
        setStatus(error.code === error.PERMISSION_DENIED ? HOME_STATUS.denied : HOME_STATUS.failed);
      },
      { maximumAge: 300_000, timeout: 20_000 },
    );
  };

  const save = (value: LatLng | null) => {
    setHome(value);
    onClose();
  };

  return (
    <Sheet labelledBy="home-sheet-title" onClose={onClose}>
      <h2 id="home-sheet-title" class="sheet-title display">
        Home
      </h2>
      <p class="sheet-intro sub">Distances and map rings are measured from here. Saved on this device only.</p>
      <button type="button" class="cta" onClick={locate}>
        Use my current location
      </button>
      <p class="note sub" role="status">
        {status}
      </p>
      <p class="label">Or tap the map</p>
      <CityMap
        label="Map of central Barcelona: tap to put Home there"
        mobile={[358, 280]}
        desktop={[380, 280]}
        theaters={theaters}
        frame={theaters.filter((t) => (distanceKm(CENTRE, t) ?? Infinity) < FRAME_KM).map((t) => t.id)}
        focus={new Set()}
        minSpan={3}
        areas
        rings={false}
        fitHome={false}
        home={pending ?? home}
        favourites={new Set()}
        name={shortName}
        distance={() => null}
        km={(t) => distanceKm(CENTRE, t)}
        onPick={(place) => {
          setPending(place);
          setStatus(HOME_STATUS.picked);
        }}
      />
      <div class="cta2">
        <button type="button" disabled={!pending} onClick={() => save(pending)}>
          Save home here
        </button>
        {home ? (
          <button type="button" onClick={() => save(null)}>
            Clear home
          </button>
        ) : (
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </Sheet>
  );
}
