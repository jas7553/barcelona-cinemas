import { useCallback, useEffect, useRef, useState } from "react";

export interface Coords {
  lat: number;
  lng: number;
}

export interface LocationPin {
  active: boolean;
  coords: Coords | null;
  error: boolean;
  toggle: () => void;
}

const STORAGE_KEY = "location_active";

export function useLocationPin(): LocationPin {
  const [active, setActive] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [error, setError] = useState(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  // On mount: if the user previously opted in, re-acquire silently.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const shouldReAcquire = localStorage.getItem(STORAGE_KEY) === "true";
    if (!shouldReAcquire) return;
    if (!navigator.geolocation) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setActive(true);
      },
      () => {
        localStorage.removeItem(STORAGE_KEY);
      },
    );
  }, []);

  const toggle = useCallback(() => {
    if (active) {
      setActive(false);
      setCoords(null);
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    if (!navigator.geolocation) {
      setError(true);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setError(false), 3000);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        localStorage.setItem(STORAGE_KEY, "true");
        setActive(true);
      },
      () => {
        setError(true);
        if (errorTimer.current) clearTimeout(errorTimer.current);
        errorTimer.current = setTimeout(() => setError(false), 3000);
      },
    );
  }, [active]);

  useEffect(() => {
    return () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, []);

  return { active, coords, error, toggle };
}
