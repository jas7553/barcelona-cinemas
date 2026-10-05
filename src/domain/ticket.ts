import type { Showing } from "../pageData";
import { formatWeekday } from "./time";

// Trailers and ads before the film, and the runtime to assume when it's unknown (requirements 5.6).
const PRE_SHOW_MIN = 15;
const UNKNOWN_RUNTIME_MIN = 110;

/** "Out ~" time: start + runtime + 15 min, wrapping past midnight. */
export function outTime(start: string, runtimeMinutes: number | null): string {
  const [h, m] = start.split(":").map(Number);
  const end = h * 60 + m + (runtimeMinutes || UNKNOWN_RUNTIME_MIN) + PRE_SHOW_MIN;
  return `${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

/** "Aftersun · Verdi · Thu 9, 21:30" */
export function shareText(title: string, cinema: string, s: Pick<Showing, "date" | "time">): string {
  return `${title} · ${cinema} · ${formatWeekday(s.date)} ${Number(s.date.slice(8))}, ${s.time}`;
}
