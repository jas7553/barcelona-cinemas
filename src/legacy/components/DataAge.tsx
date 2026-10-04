import type { ReactNode } from "react";
import { formatDataAge } from "../utils";

/**
 * The freshness label ("updated 3h ago" / "may be out of date"), or null when
 * the data is fresh (< 1h) and not flagged stale. Single source of truth for
 * both the list header note and the film footer note.
 * `now` is injectable per the time-relative split — no `new Date()` in render.
 */
export function dataAgeLabel(
  generatedAt: string | null,
  stale: boolean,
  now: Date,
): string | null {
  const age = generatedAt ? formatDataAge(generatedAt, now) : null;
  if (!age && !stale) return null;
  return age ? `updated ${age}` : "may be out of date";
}

/**
 * The freshness note as a styled span, or nothing when the data is fresh.
 * `prefix` is rendered inside the span so its own coloring (muted / stale)
 * covers any separator the caller wants ahead of the label.
 */
export default function DataAge({
  generatedAt,
  stale,
  now,
  prefix,
}: {
  generatedAt: string | null;
  stale: boolean;
  now: Date;
  prefix?: ReactNode;
}) {
  const label = dataAgeLabel(generatedAt, stale, now);
  if (label == null) return null;
  return (
    <span className={`result-count-age${stale ? " result-count-age--stale" : ""}`}>
      {prefix}
      {label}
    </span>
  );
}
