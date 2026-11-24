/** The cinemas the site covers (`cinemas.json`), and how each source names them. */
import { z } from "zod";
import cinemasJson from "../../cinemas.json" with { type: "json" };

const Text = z.string().min(1);

const CinemaInfo = z.strictObject({
  id: Text,
  name: Text,
  short_name: Text.exactOptional(),
  address: Text,
  neighborhood: Text,
  website_url: z.httpUrl(),
  maps_url: z.httpUrl(),
  lat: z.number().nullable().exactOptional(),
  lng: z.number().nullable().exactOptional(),
  /** Per source (a provider's `name`): the other names it lists the cinema under. */
  aliases: z.record(z.string(), z.array(z.string())).exactOptional(),
});
type CinemaInfo = z.infer<typeof CinemaInfo>;

/** Keyed by registry key (`"VP"`), in file order. */
export type CinemaRegistry = ReadonlyMap<string, CinemaInfo>;

const Registry = z
  .record(z.string(), CinemaInfo)
  .transform((cinemas): CinemaRegistry => new Map(Object.entries(cinemas)));

export function parseRegistry(data: unknown): CinemaRegistry {
  return Registry.parse(data);
}

export function loadRegistry(): CinemaRegistry {
  return parseRegistry(cinemasJson);
}

/** Lowercase ASCII letters and digits only: "Cinemes Maldà" → "cinemesmalda". */
export function normalizeAlias(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Normalized alias → registry key for one source: each cinema's name, id and that source's aliases.
 * Where two cinemas share an alias, the later one in the registry wins.
 */
export function buildCinemaAliasLookup(
  registry: CinemaRegistry,
  source: string,
): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const [key, info] of registry) {
    for (const alias of [info.name, info.id, ...(info.aliases?.[source] ?? [])]) {
      const normalized = normalizeAlias(alias);
      if (normalized) lookup.set(normalized, key);
    }
  }
  return lookup;
}
