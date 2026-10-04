import { dayShort, type DayStatus } from "../domain/schedule";
import type { DateKey } from "../domain/time";

interface Props {
  days: { date: DateKey; status: DayStatus }[];
  today: DateKey;
  /** The Day page's date; absent on This week. */
  current?: DateKey;
  /** Where "Week" and each day lead: This week and the Day pages, or a cinema's. */
  weekHref?: string;
  dayHref?: (date: DateKey) => string;
}

/**
 * The sticky header of the timetable: "Week", then one column per day. Shares
 * the film rows' grid so the columns line up down the page.
 */
export function DayStrip({ days, today, current, weekHref = "/", dayHref = (date) => `/day/${date}/` }: Props) {
  return (
    <nav class="strip" aria-label="Days">
      <div class="wrap tt">
        <a class="sd sd--wk" href={weekHref} aria-current={current ? undefined : "page"}>
          Week
        </a>
        {days.map(({ date, status }) => {
          const label = (
            <>
              {dayShort(date, today)}
              <b>{Number(date.slice(8))}</b>
            </>
          );
          // A published day with nothing left isn't a destination.
          if (status === "nothing-left" && date !== current) {
            return (
              <span key={date} class="sd sd--empty">
                {label}
              </span>
            );
          }
          return (
            <a
              key={date}
              class={status === "not-out" ? "sd sd--unpub" : "sd"}
              href={dayHref(date)}
              aria-current={date === current ? "date" : undefined}
            >
              {label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
