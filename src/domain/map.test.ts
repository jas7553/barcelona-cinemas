import { describe, expect, it } from "vitest";
import type { Theater } from "../types";
import { buildMap, type MapModel, type MapOptions } from "./map";

const theater = (id: string, lat: number | null, lng: number | null): Theater => ({
  id,
  name: id,
  address: "",
  neighborhood: "",
  website_url: "",
  maps_url: "",
  lat,
  lng,
});
const THEATERS = [
  theater("verdi", 41.404, 2.1569),
  theater("girona", 41.3955, 2.1655),
  theater("maquinista", 41.4398, 2.1983),
  theater("nowhere", null, null),
];
const HOME = { lat: 41.4021, lng: 2.1558 };

const options = (o: Partial<MapOptions> = {}): MapOptions => ({
  theaters: THEATERS,
  frame: ["verdi", "girona"],
  width: 358,
  height: 230,
  minSpan: 2.5,
  home: HOME,
  favourites: new Set(),
  ...o,
});

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("buildMap", () => {
  it("frames the cinemas and home inside the drawing, and leaves out cinemas with no coordinates", () => {
    const m = buildMap(options());
    for (const d of m.dots.filter((d) => d.focus)) {
      expect(d.x).toBeGreaterThan(0);
      expect(d.x).toBeLessThan(m.width);
      expect(d.y).toBeGreaterThan(0);
      expect(d.y).toBeLessThan(m.height);
    }
    expect(m.home).not.toBeNull();
    expect(m.dots.map((d) => d.id)).not.toContain("nowhere");
  });

  it("puts the sea below the land", () => {
    const m = buildMap(options());
    // Verdi (inland) is above Girona (nearer the sea) once the map is turned.
    const y = (id: string) => m.dots.find((d) => d.id === id)!.y;
    expect(y("verdi")).toBeLessThan(y("girona"));
  });

  it("never lets a label cover a dot", () => {
    const m = buildMap(options({ frame: ["verdi", "girona", "maquinista"], areas: true }));
    for (const l of m.labels) {
      for (const d of m.dots) expect(overlaps(l.box, { x: d.x - 5, y: d.y - 5, w: 10, h: 10 })).toBe(false);
    }
  });

  it("adds a focus cinema's note to its label, and labels Home", () => {
    const m = buildMap(options({ notes: { verdi: "18:00 +2" } }));
    expect(m.labels.map((l) => l.text)).toEqual(expect.arrayContaining(["Home", "verdi · 18:00 +2"]));
  });

  it("pins cinemas outside the frame to its edge with their distance", () => {
    const m = buildMap(options({ edges: true }));
    const pin = m.dots.find((d) => d.id === "maquinista")!;
    expect(pin.edge).toBe(true);
    expect(m.labels.some((l) => /^maquinista [\d.]+ km →$/.test(l.text))).toBe(true);
  });

  it("draws rings at 1, 2 and 3 km round Home unless asked not to", () => {
    expect(buildMap(options({ minSpan: 7, height: 358 })).rings.length).toBe(3);
    expect(buildMap(options({ rings: false })).rings).toEqual([]);
  });

  it("turns a point on the map back into the place drawn there", () => {
    const m = buildMap(options());
    const verdi = m.dots.find((d) => d.id === "verdi")!;
    const place = m.toLatLng(verdi.x, verdi.y);
    expect(place.lat).toBeCloseTo(41.404, 4);
    expect(place.lng).toBeCloseTo(2.1569, 4);
  });

  describe("in a crowd", () => {
    // The Invite's Saturday: Sarrià and Diagonal 250 m apart, Arenas, Glòries
    // and Diagonal Mar out on the edges of the frame.
    // From cinemas.json.
    const real: Theater[] = (
      [
        ["Arenas", "Arenas", 41.3763, 2.1493],
        ["CinDigMar", "Diagonal Mar", 41.4102, 2.2166],
        ["Glòries", "Glòries", 41.4054, 2.1929],
        ["Sarrià", "Sarrià", 41.3945, 2.1336],
        ["CinDiag", "Diagonal", 41.3938, 2.1364],
        ["Verdi", "Verdi", 41.404, 2.1569],
        ["Girona", "Girona", 41.3996, 2.1646],
        ["Aribau", "Aribau", 41.3861, 2.1626],
      ] as const
    ).map(([id, short, lat, lng]) => ({ ...theater(id, lat, lng), short_name: short }));
    const CROWD = real.map((t) => t.id);
    const notes = Object.fromEntries(CROWD.map((id) => [id, "18:00 +2"]));
    const frames: [string, number, number][] = [["phone", 358, 230], ["desktop", 440, 260]];
    const crowd = (o: Partial<MapOptions>) =>
      buildMap(options({ theaters: real, frame: CROWD, notes, others: false, ...o }));
    const dotBox = (d: MapModel["dots"][number]) => ({ x: d.x - 5, y: d.y - 5, w: 10, h: 10 });

    for (const [frame, width, height] of frames) {
      for (const home of [null, HOME]) {
        it(`labels every cinema on the ${frame} map, ${home ? "with" : "without"} Home, with nothing overlapping`, () => {
          const m = crowd({ width, height, home });
          const cinemaLabels = m.labels.filter((l) => l.kind === "cinema");
          expect(cinemaLabels.map((l) => l.text.split(" · ")[0]).sort()).toEqual(
            CROWD.map((id) => real.find((t) => t.id === id)!.short_name ?? id).sort(),
          );
          if (home) expect(m.labels.some((l) => l.kind === "home")).toBe(true);
          m.labels.forEach((a, i) => {
            expect(a.box.x).toBeGreaterThanOrEqual(0);
            expect(a.box.y).toBeGreaterThanOrEqual(0);
            expect(a.box.x + a.box.w).toBeLessThanOrEqual(m.width);
            expect(a.box.y + a.box.h).toBeLessThanOrEqual(m.height);
            m.labels.forEach((b, j) => {
              if (i !== j) expect(overlaps(a.box, b.box), `${a.text} / ${b.text}`).toBe(false);
            });
            for (const d of m.dots) expect(overlaps(a.box, dotBox(d)), `${a.text} on ${d.id}`).toBe(false);
          });
        });
      }
    }

    it("leads a crowded label away on a line that starts by its dot and ends at the label", () => {
      const m = crowd({ width: 358, height: 230, home: null });
      const led = m.labels.filter((l) => l.leader);
      expect(led.length).toBeGreaterThan(0);
      for (const l of led) {
        const s = l.leader!;
        const name = l.text.split(" · ")[0];
        const dot = m.dots.find((d) => real.find((t) => t.id === d.id)!.short_name === name)!;
        expect(Math.hypot(s.x1 - dot.x, s.y1 - dot.y)).toBeLessThan(10);
        expect(s.x2).toBeGreaterThanOrEqual(l.box.x - 0.01);
        expect(s.x2).toBeLessThanOrEqual(l.box.x + l.box.w + 0.01);
        expect(s.y2).toBeGreaterThanOrEqual(l.box.y - 0.01);
        expect(s.y2).toBeLessThanOrEqual(l.box.y + l.box.h + 0.01);
      }
    });
  });

  it("puts a label beside its dot, without a leader, when there's room", () => {
    const m = buildMap(options({ home: null }));
    expect(m.labels.filter((l) => l.kind === "cinema").every((l) => !l.leader)).toBe(true);
  });
});
