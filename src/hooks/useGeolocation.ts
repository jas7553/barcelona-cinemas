import { useEffect, useState } from "react";

export interface Coords {
  lat: number;
  lng: number;
}

export function useGeolocation(): Coords | null {
  const [coords, setCoords] = useState<Coords | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* denied or unavailable — stay null */ },
    );
  }, []);

  return coords;
}
