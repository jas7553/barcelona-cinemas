import { useMemo } from "preact/hooks";
import { useNow } from "../client/clock";
import { usePrefs } from "../client/prefs";
import { whereLabel } from "../domain/distance";
import { joinAnd } from "../domain/format";
import { clockAt, dayShort, dayStatus, horizon, notOutFrom, ranking } from "../domain/schedule";
import { formatDateLong, isStale, madridDateKey } from "../domain/time";
import type { ListData, PageBase } from "../pageData";

/** Everything This week and Day derive from the clock, the prefs and the payload. */
export function useListView(data: PageBase & ListData) {
  const now = useNow(data.renderedAt);
  const prefs = usePrefs();
  const clock = clockAt(now);
  const theaters = useMemo(() => new Map(data.theaters.map((t) => [t.id, t])), [data.theaters]);
  const rank = ranking(data.theaters, prefs.home, prefs.favourites);
  const notOut = notOutFrom(data.calendar, clock.today);
  const days = horizon(clock.today).map((date) => ({ date, status: dayStatus(date, data.calendar, clock, notOut) }));

  const notOutDays = days.filter((d) => d.status === "not-out");
  const mostly = notOutDays.some((d) => data.calendar.some((c) => c.date === d.date));
  const notOutNote = notOutDays.length
    ? `${joinAnd(notOutDays.map((d) => dayShort(d.date, clock.today)))} listings ${mostly ? "mostly " : ""}not out yet`
    : null;

  const where = (theaterId: string) => {
    const theater = theaters.get(theaterId);
    return theater ? whereLabel(prefs.home, theater) : "";
  };

  return { now, clock, prefs, theaters, rank, days, notOutNote, where };
}

export function StaleNotice({ data, now }: { data: PageBase; now: Date }) {
  if (!isStale({ generated_at: data.generatedAt, stale: data.stale }, now)) return null;
  return (
    <p class="notice">
      Listings last updated {formatDateLong(madridDateKey(new Date(data.generatedAt)))}. Times may have changed, so check
      with the cinema before you go.
    </p>
  );
}
