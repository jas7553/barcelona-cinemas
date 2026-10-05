// Schematic maps (guidelines §5): an equirectangular projection rotated 42°
// clockwise so the coast runs along the bottom, hand-simplified base layers,
// and greedily placed labels. Pure geometry: components/CityMap.tsx draws it.

import type { Theater } from "../types";
import { distanceKm, distanceLabel } from "./distance";
import { shortName } from "./format";
import type { LatLng } from "./prefs";

type Point = [lat: number, lng: number];

const GEO = {
  coast: [
    [41.27, 2.05], [41.3, 2.1], [41.335, 2.15], [41.35, 2.165], [41.362, 2.178], [41.372, 2.183], [41.376, 2.189],
    [41.38, 2.192], [41.384, 2.196], [41.388, 2.202], [41.393, 2.207], [41.398, 2.212], [41.404, 2.219],
    [41.41, 2.226], [41.413, 2.232], [41.42, 2.238], [41.428, 2.245], [41.45, 2.27], [41.5, 2.33],
  ] as Point[],
  seaFar: [[41.6, 2.5], [41.1, 2.5], [41.1, 1.95]] as Point[],
  parks: [
    // Collserola, Montjuïc, Ciutadella
    [[41.395, 2.085], [41.41, 2.105], [41.418, 2.122], [41.428, 2.14], [41.438, 2.158], [41.448, 2.172], [41.46, 2.185], [41.5, 2.15], [41.45, 2.05], [41.38, 2.05]],
    [[41.372, 2.15], [41.374, 2.162], [41.37, 2.172], [41.362, 2.172], [41.357, 2.163], [41.36, 2.15], [41.366, 2.146]],
    [[41.391, 2.184], [41.389, 2.191], [41.386, 2.188], [41.388, 2.181]],
  ] as Point[][],
  roads: [
    // Diagonal, Gran Via, Passeig de Gràcia / Gran de Gràcia, La Rambla, Meridiana
    [[41.383, 2.11], [41.388, 2.125], [41.392, 2.138], [41.394, 2.146], [41.397, 2.157], [41.399, 2.166], [41.403, 2.187], [41.407, 2.203], [41.411, 2.218]],
    [[41.356, 2.125], [41.368, 2.14], [41.375, 2.149], [41.385, 2.164], [41.394, 2.175], [41.403, 2.187], [41.412, 2.199], [41.421, 2.21]],
    [[41.387, 2.17], [41.392, 2.165], [41.397, 2.159], [41.403, 2.153], [41.408, 2.15]],
    [[41.387, 2.17], [41.376, 2.177]],
    [[41.403, 2.187], [41.415, 2.184], [41.428, 2.184], [41.442, 2.19]],
  ] as Point[][],
  areas: [
    ["Gràcia", 41.41, 2.158], ["Eixample", 41.391, 2.157], ["Ciutat Vella", 41.381, 2.181], ["Sants", 41.373, 2.136],
    ["Les Corts", 41.384, 2.124], ["Sarrià", 41.401, 2.121], ["Poblenou", 41.401, 2.203], ["Sant Andreu", 41.433, 2.19],
    ["Montjuïc", 41.366, 2.16], ["Horta", 41.428, 2.158], ["Sant Martí", 41.417, 2.198],
  ] as [string, number, number][],
};

const D2R = Math.PI / 180;
const TILT = 42 * D2R;
const LAT0 = 41.395;
const LNG0 = 2.165;
const R_EARTH = 6371;
const PAD = 34;

/** km east/north of the centre, rotated so the coast is level. */
function project([lat, lng]: Point): [number, number] {
  const x = (lng - LNG0) * Math.cos(LAT0 * D2R) * D2R * R_EARTH;
  const y = (lat - LAT0) * D2R * R_EARTH;
  return [x * Math.cos(TILT) + y * Math.sin(TILT), -x * Math.sin(TILT) + y * Math.cos(TILT)];
}

function unproject([xr, yr]: [number, number]): LatLng {
  const x = xr * Math.cos(TILT) - yr * Math.sin(TILT);
  const y = xr * Math.sin(TILT) + yr * Math.cos(TILT);
  return { lat: y / (D2R * R_EARTH) + LAT0, lng: x / (Math.cos(LAT0 * D2R) * D2R * R_EARTH) + LNG0 };
}

interface MapLabel {
  x: number;
  y: number;
  text: string;
  kind: "cinema" | "dim" | "home" | "ring" | "area";
}

interface MapDot {
  id: string;
  name: string;
  x: number;
  y: number;
  focus: boolean;
  favourite: boolean;
  /** Outside the frame, pinned to its edge. */
  edge: boolean;
}

export interface MapModel {
  width: number;
  height: number;
  parks: string[];
  roads: string[];
  sea: string;
  rings: { x: number; y: number; r: number }[];
  home: { x: number; y: number } | null;
  dots: MapDot[];
  labels: MapLabel[];
  /** Turns a point on the map, in its own units, back into a place. */
  toLatLng: (x: number, y: number) => LatLng;
}

export interface MapOptions {
  theaters: Theater[];
  /** The cinemas the frame must hold. */
  frame: string[];
  /** Cinemas drawn large and labelled first; the frame by default. */
  focus?: ReadonlySet<string>;
  /** Extra text after a focus cinema's name: "18:00 +2". */
  notes?: Readonly<Record<string, string>>;
  width: number;
  height: number;
  /** The smallest span the frame shows, in km, so one cinema isn't the whole map. */
  minSpan: number;
  home: LatLng | null;
  /** Frame the home as well as the cinemas. */
  fitHome?: boolean;
  rings?: boolean;
  areas?: boolean;
  /** Draw the cinemas outside `focus` too, dimmed. */
  others?: boolean;
  /** Pin cinemas outside the frame to its edge, with their distance. */
  edges?: boolean;
  favourites: ReadonlySet<string>;
  /** Label priority, nearest first; by default the distance from `home`. */
  km?: (t: Theater) => number | null;
}

// Average advance of an 11px semibold DM Sans character; labels are placed on estimates.
const CHAR_W = 6.1;
const LABEL_H = 13;
type Box = { x: number; y: number; w: number; h: number };
type Spot = "r" | "l" | "t" | "b" | "tr" | "br" | "tl" | "bl" | "c";
const SPOTS: Spot[] = ["r", "l", "t", "b", "tr", "br", "tl", "bl"];

export function buildMap(o: MapOptions): MapModel {
  const { width: W, height: H } = o;
  const located = o.theaters.filter((t): t is Theater & { lat: number; lng: number } => t.lat != null && t.lng != null);
  const byId = new Map(located.map((t) => [t.id, t]));
  const focus = o.focus ?? new Set(o.frame);

  const pts = o.frame.flatMap((id) => {
    const t = byId.get(id);
    return t ? [project([t.lat, t.lng])] : [];
  });
  if (o.home && o.fitHome !== false) pts.push(project([o.home.lat, o.home.lng]));
  if (pts.length === 0) pts.push([0, 0]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = Math.min(
    (W - 2 * PAD) / Math.max(Math.max(...xs) - Math.min(...xs), o.minSpan),
    (H - 2 * PAD) / Math.max(Math.max(...ys) - Math.min(...ys), o.minSpan * (H / W)),
  );

  const toXY = (p: Point): [number, number] => {
    const [x, y] = project(p);
    return [W / 2 + (x - cx) * scale, H / 2 - (y - cy) * scale];
  };
  const path = (points: Point[], close = false) =>
    "M" + points.map((p) => toXY(p).map((v) => v.toFixed(1)).join(" ")).join("L") + (close ? "Z" : "");
  const inside = ([x, y]: [number, number]) => x > 8 && y > 8 && x < W - 8 && y < H - 8;
  const clamp = ([x, y]: [number, number]): [number, number] => [
    Math.min(W - 10, Math.max(10, x)),
    Math.min(H - 10, Math.max(10, y)),
  ];

  // Greedy placement: a label goes in the first candidate spot that's on the
  // map and clear of every box placed so far, dots included; otherwise it's dropped.
  const boxes: Box[] = [];
  const blocked = (b: Box) =>
    b.x < 2 ||
    b.y < 2 ||
    b.x + b.w > W - 2 ||
    b.y + b.h > H - 2 ||
    boxes.some((o2) => b.x < o2.x + o2.w && o2.x < b.x + b.w && b.y < o2.y + o2.h && o2.y < b.y + b.h);
  const labels: MapLabel[] = [];
  const place = (x: number, y: number, text: string, kind: MapLabel["kind"], spots: Spot[] = SPOTS, cw = CHAR_W) => {
    const w = text.length * cw + 4;
    const at: Record<Spot, [number, number]> = {
      r: [x + 7, y - 7],
      l: [x - 7 - w, y - 7],
      t: [x - w / 2, y - 21],
      b: [x - w / 2, y + 7],
      c: [x - w / 2, y - 6],
      tr: [x + 4, y - 18],
      br: [x + 4, y + 4],
      tl: [x - 4 - w, y - 18],
      bl: [x - 4 - w, y + 4],
    };
    for (const spot of spots) {
      const b = { x: at[spot][0], y: at[spot][1], w, h: LABEL_H };
      if (!blocked(b)) {
        boxes.push(b);
        labels.push({ x: b.x + 2, y: b.y + 10, text, kind });
        return;
      }
    }
  };

  const km = (t: Theater) => (o.km ? o.km(t) : distanceKm(o.home, t)) ?? Infinity;
  const shown = located
    .filter((t) => focus.has(t.id) || o.others !== false)
    .map((t) => ({ t, raw: toXY([t.lat, t.lng]) }))
    .filter(({ t, raw }) => o.edges || focus.has(t.id) || inside(raw))
    .sort(
      (a, b) =>
        Number(focus.has(b.t.id)) - Number(focus.has(a.t.id)) ||
        Number(o.favourites.has(b.t.id)) - Number(o.favourites.has(a.t.id)) ||
        km(a.t) - km(b.t) ||
        (a.t.id < b.t.id ? -1 : 1),
    );
  const dots: MapDot[] = shown.map(({ t, raw }) => {
    const [x, y] = clamp(raw);
    return { id: t.id, name: t.name, x, y, focus: focus.has(t.id), favourite: o.favourites.has(t.id), edge: !inside(raw) };
  });
  // Dots first, so no label ever covers one.
  for (const d of dots) boxes.push({ x: d.x - 5, y: d.y - 5, w: 10, h: 10 });

  let home: MapModel["home"] = null;
  const rings: MapModel["rings"] = [];
  if (o.home) {
    const [x, y] = toXY([o.home.lat, o.home.lng]);
    home = { x, y };
    boxes.push({ x: x - 6, y: y - 6, w: 12, h: 12 });
    place(x, y, "Home", "home");
    if (o.rings !== false) {
      for (const k of [1, 2, 3]) {
        const r = k * scale;
        if (r >= Math.max(W, H)) continue;
        rings.push({ x, y, r });
        place(x + r * Math.SQRT1_2, y - r * Math.SQRT1_2, `${k} km`, "ring", ["c"], 5);
      }
    }
  }
  for (const d of dots) {
    const t = byId.get(d.id)!;
    const note = d.focus && o.notes?.[d.id] ? ` · ${o.notes[d.id]}` : "";
    const edge = d.edge ? ` ${distanceLabel(o.home, t) ?? ""} →`.replace("  ", " ") : "";
    place(d.x, d.y, `${shortName(t)}${note}${edge}`, d.focus ? "cinema" : "dim");
  }
  if (o.areas) {
    for (const [name, lat, lng] of GEO.areas) {
      const [x, y] = toXY([lat, lng]);
      place(x, y, name.toUpperCase(), "area", ["c"], 6.8);
    }
  }

  return {
    width: W,
    height: H,
    parks: GEO.parks.map((p) => path(p, true)),
    roads: GEO.roads.map((r) => path(r)),
    sea: path([...GEO.coast, ...GEO.seaFar], true),
    rings,
    home,
    dots,
    labels,
    toLatLng: (x, y) => unproject([(x - W / 2) / scale + cx, -(y - H / 2) / scale + cy]),
  };
}
