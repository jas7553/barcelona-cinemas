import { useEffect, useRef, useState } from "preact/hooks";
import { setHome } from "../client/prefs";
import type { LatLng } from "../domain/prefs";
import { Sheet } from "./Sheet";

export const HOME_STATUS = {
  locating: "Finding you…",
  found: "Found you. Save to use this as Home.",
  denied: "Location access is off for this site. Tap the map instead, or allow it in Settings › Apps › Safari › Location.",
  failed: "Couldn't find your location. Try again, or tap the map instead.",
  unsupported: "This browser can't share your location. Tap the map instead.",
} as const;

interface Props {
  home: LatLng | null;
  onClose: () => void;
}

export function HomeSheet({ home, onClose }: Props) {
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
