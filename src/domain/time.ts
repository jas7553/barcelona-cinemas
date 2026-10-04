// Showtime `date`/`time` strings are Barcelona wall-clock by data contract.
// Every conversion between them and a JS instant goes through Intl pinned to
// Europe/Madrid, never the engine's ambient zone (`setHours`, `getDate`, …):
// a device in another zone would otherwise bucket days differently from the
// Madrid-pinned render and break hydration.

/** A Madrid calendar day, "YYYY-MM-DD". */
export type DateKey = string;

const MADRID_TZ = "Europe/Madrid";
const DAY_MS = 86_400_000;

const madridPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface MadridParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function madridParts(instant: Date): MadridParts {
  const parts = madridPartsFormatter.formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

export function madridDateKey(instant: Date): DateKey {
  const { y, mo, d } = madridParts(instant);
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** Madrid wall-clock "HH:MM" of an instant. */
export function madridTime(instant: Date): string {
  const { h, mi } = madridParts(instant);
  return `${pad2(h)}:${pad2(mi)}`;
}

function madridOffsetMsAt(instantMs: number): number {
  const p = madridParts(new Date(instantMs));
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - instantMs;
}

/**
 * The instant a Barcelona wall-clock date/time names, correct across DST.
 * Guess-and-correct: read the components as UTC, measure Madrid's offset there,
 * then re-measure at the corrected instant so a guess on the wrong side of a
 * transition still converges (the offset only takes two values).
 */
export function madridWallToInstant(date: DateKey, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  let instant = asUtc - madridOffsetMsAt(asUtc);
  instant = asUtc - madridOffsetMsAt(instant);
  return new Date(instant);
}

function keyToUtcMs(key: DateKey): number {
  const [y, mo, d] = key.split("-").map(Number);
  return Date.UTC(y, mo - 1, d);
}

export function addDays(key: DateKey, n: number): DateKey {
  return new Date(keyToUtcMs(key) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((keyToUtcMs(b) - keyToUtcMs(a)) / DAY_MS);
}

// Date keys are formatted as UTC midnights in UTC, so no zone can roll them
// into the neighbouring day.
const weekdayShort = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const weekdayLong = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

/** "Thu" */
export function formatWeekday(key: DateKey): string {
  return weekdayShort.format(keyToUtcMs(key));
}

/** "Thursday" */
export function formatWeekdayLong(key: DateKey): string {
  return weekdayLong.format(keyToUtcMs(key));
}

/** "Thu 2 Oct" */
export function formatDateLong(key: DateKey): string {
  return `${formatWeekday(key)} ${Number(key.slice(8))} ${monthShort.format(keyToUtcMs(key))}`;
}

const HOUR_MS = 3_600_000;

/** "Updated 2 h ago". `now` is threaded in so the first render matches the server's. */
export function formatDataAge(generatedAt: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(generatedAt));
  if (ms < 60_000) return "Updated just now";
  if (ms < HOUR_MS) return `Updated ${Math.floor(ms / 60_000)} min ago`;
  if (ms < 24 * HOUR_MS) return `Updated ${Math.floor(ms / HOUR_MS)} h ago`;
  const days = Math.floor(ms / (24 * HOUR_MS));
  return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
}

// The refresh runs every 12 h (template.yaml ScheduleExpression), so data older
// than two windows means at least one refresh has failed.
const STALE_AFTER_MS = 24 * HOUR_MS;

export function isStale(listings: { generated_at: string; stale: boolean }, now: Date): boolean {
  return listings.stale || now.getTime() - Date.parse(listings.generated_at) > STALE_AFTER_MS;
}

const monthLong = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });

/** "6 October" */
export function formatDayMonth(key: DateKey): string {
  return `${Number(key.slice(8))} ${monthLong.format(keyToUtcMs(key))}`;
}

/** "Sun 4 – Sat 10 Oct", with the first month only when the range spans two. */
export function formatRange(first: DateKey, last: DateKey): string {
  const start = `${formatWeekday(first)} ${Number(first.slice(8))}`;
  const month = first.slice(5, 7) === last.slice(5, 7) ? "" : ` ${monthShort.format(keyToUtcMs(first))}`;
  return `${start}${month} – ${formatDateLong(last)}`;
}
