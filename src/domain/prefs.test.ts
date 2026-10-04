import { describe, expect, it } from "vitest";
import { PREF_KEYS, parseHome, parseIds, readPrefs } from "./prefs";

describe("parseHome", () => {
  it("reads a saved point", () => {
    expect(parseHome('{"lat":41.4021,"lng":2.1558}')).toEqual({ lat: 41.4021, lng: 2.1558 });
  });

  it.each([null, "", "not json", "null", "[41,2]", '{"lat":"41","lng":2}', '{"lat":91,"lng":2}', '{"lat":41}'])(
    "treats %j as no home",
    (raw) => {
      expect(parseHome(raw)).toBeNull();
    },
  );
});

describe("parseIds", () => {
  it("keeps only string ids", () => {
    expect([...parseIds('["1248832", 7, null, "verdi"]')]).toEqual(["1248832", "verdi"]);
  });

  it("treats anything but an array as empty", () => {
    expect(parseIds('{"a":1}').size).toBe(0);
    expect(parseIds("oops").size).toBe(0);
    expect(parseIds(null).size).toBe(0);
  });

  it("caps a runaway list, keeping the most recent ids", () => {
    const ids = parseIds(JSON.stringify(Array.from({ length: 2500 }, (_, i) => String(i))));
    expect(ids.size).toBe(2000);
    expect(ids.has("2499")).toBe(true);
    expect(ids.has("0")).toBe(false);
  });
});

describe("readPrefs", () => {
  it("carries over seen films saved by the old site", () => {
    const stored: Record<string, string> = { "btw-seen": '["1248832"]' };
    const prefs = readPrefs({ getItem: (k) => stored[k] ?? null });
    expect(PREF_KEYS.seen).toBe("btw-seen");
    expect(prefs.seen.has("1248832")).toBe(true);
    expect(prefs.home).toBeNull();
    expect(prefs.favourites.size).toBe(0);
  });
});
