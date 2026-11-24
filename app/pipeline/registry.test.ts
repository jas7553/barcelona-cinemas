import { describe, expect, it } from "vitest";
import { buildCinemaAliasLookup, loadRegistry, normalizeAlias, parseRegistry } from "./registry.ts";

const cinema = (id: string, name: string, aliases?: Record<string, string[]>) => ({
  id,
  name,
  address: "Carrer 1",
  neighborhood: "Gràcia",
  website_url: "https://example.com",
  maps_url: "https://maps.google.com/?q=x",
  ...(aliases && { aliases }),
});

describe("loadRegistry", () => {
  it("reads cinemas.json in file order", () => {
    const registry = loadRegistry();
    expect([...registry.keys()].slice(0, 2)).toEqual(["Verdi", "VP"]);
    expect(registry.get("VP")?.id).toBe("verdi-park");
  });
});

describe("parseRegistry", () => {
  it("rejects an unknown field, so a typo can't silently drop data", () => {
    expect(() => parseRegistry({ X: { ...cinema("x", "X"), alias: {} } })).toThrow();
  });

  it("rejects a cinema missing a required field", () => {
    expect(() => parseRegistry({ X: { ...cinema("x", "X"), address: undefined } })).toThrow();
  });
});

describe("normalizeAlias", () => {
  it.each([
    ["Cinemes Verdi", "cinemesverdi"],
    ["Cinema Maldà", "cinemamalda"],
    ["Glòries", "glories"],
    ["Verdi Park (V.O.)", "verdiparkvo"],
    ["BAL-ARIBAU", "balaribau"],
    ["Ñ", "n"],
    ["Straße", "strae"],
    ["—", ""],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeAlias(raw)).toBe(expected);
  });
});

describe("buildCinemaAliasLookup", () => {
  const registry = parseRegistry({
    Verdi: cinema("verdi", "Cines Verdi", { english_cinema_bcn: ["Cinemes Verdi"] }),
    VP: cinema("verdi-park", "Verdi Park", { secondary: ["VP Torrijos"] }),
  });

  it("maps a cinema's name, id and the source's own aliases to its key", () => {
    const lookup = buildCinemaAliasLookup(registry, "english_cinema_bcn");
    expect(Object.fromEntries(lookup)).toEqual({
      cinesverdi: "Verdi",
      verdi: "Verdi",
      cinemesverdi: "Verdi",
      verdipark: "VP",
    });
  });

  it("ignores other sources' aliases", () => {
    expect(buildCinemaAliasLookup(registry, "secondary").get("vptorrijos")).toBe("VP");
    expect(buildCinemaAliasLookup(registry, "sensacine").has("vptorrijos")).toBe(false);
  });

  it("gives a shared alias to the later cinema", () => {
    const clash = parseRegistry({
      A: cinema("a", "First", { s: ["Shared"] }),
      B: cinema("b", "Second", { s: ["shared!"] }),
    });
    expect(buildCinemaAliasLookup(clash, "s").get("shared")).toBe("B");
  });

  it("skips an alias that normalizes to nothing", () => {
    const blank = parseRegistry({ A: cinema("a", "First", { s: ["—"] }) });
    expect(buildCinemaAliasLookup(blank, "s").has("")).toBe(false);
  });
});
