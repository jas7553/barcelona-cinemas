export const MADRID_TZ = "Europe/Madrid";

const wallClockFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: MADRID_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Madrid wall clock of an instant: `date` is `YYYY-MM-DD`, `time` is `HH:MM`. */
export function madridWallClock(instant: Date): { date: string; time: string } {
  const parts = wallClockFormat.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/**
 * The instant at a Madrid wall-clock `date` (`YYYY-MM-DD`) and `time` (`HH:MM`), as ISO-8601 with
 * Madrid's offset, e.g. `2026-11-23T21:00+01:00`. A time repeated when the clocks go back gets the
 * first (summer) offset; a time skipped when they go forward throws.
 */
export function madridIso(date: string, time: string): string {
  for (const offset of ["+02:00", "+01:00"]) {
    const iso = `${date}T${time}${offset}`;
    const instant = new Date(iso);
    if (Number.isNaN(instant.getTime())) break;
    const wall = madridWallClock(instant);
    if (wall.date === date && wall.time === time) return iso;
  }
  throw new RangeError(`${date} ${time} is not a Madrid wall-clock time`);
}

/** `YYYY-MM-DD` plus `days` calendar days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
