// Street maps: real map tiles (OpenStreetMap data, CARTO's Voyager style)
// around one place, so a cinema page shows the streets and the metro next to
// it. Pure geometry in Web Mercator pixels: components/StreetMap.tsx draws it.

import type { LatLng } from "./prefs";

const TILE = 256;
export const STREET_ZOOM = 16;

/** Pixels from the world's top-left corner at `zoom`. */
function worldPx({ lat, lng }: LatLng, zoom: number): [number, number] {
  const size = TILE * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}

export interface StreetModel {
  width: number;
  height: number;
  /** Placed in the map's own units; the centre is at width/2, height/2. */
  tiles: { x: number; y: number; href: string }[];
  /** Where a place falls on the map, or null when it's off it. */
  at: (place: LatLng) => { x: number; y: number } | null;
}

/** The tiles covering a width × height map centred on `centre`. */
export function streetMap(centre: LatLng, width: number, height: number, zoom = STREET_ZOOM): StreetModel {
  const [cx, cy] = worldPx(centre, zoom);
  // Local units: world pixels this big lose precision in an SVG.
  const ox = cx - width / 2;
  const oy = cy - height / 2;
  const tiles: StreetModel["tiles"] = [];
  for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + height) / TILE); ty++) {
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + width) / TILE); tx++) {
      tiles.push({
        x: tx * TILE - ox,
        y: ty * TILE - oy,
        href: `https://${"abcd"[(tx + ty) % 4]}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tx}/${ty}@2x.png`,
      });
    }
  }
  return {
    width,
    height,
    tiles,
    at: (place) => {
      const [x, y] = worldPx(place, zoom);
      const p = { x: x - ox, y: y - oy };
      return p.x > 8 && p.y > 8 && p.x < width - 8 && p.y < height - 8 ? p : null;
    },
  };
}
