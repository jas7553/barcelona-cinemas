import { DayStrip } from "../components/DayStrip";
import { WeekRow } from "../components/FilmRow";
import { Layout } from "../components/Layout";
import { SeenGroup } from "../components/SeenGroup";
import { plural } from "../domain/format";
import { filmRows, rowSummary, weekSections, type FilmRow } from "../domain/schedule";
import { formatRange } from "../domain/time";
import type { WeekPageData } from "../pageData";
import { StaleNotice, useListView } from "./listView";

// Rows whose posters are likely above the fold on a phone.
const EAGER_ROWS = 4;

export function WeekPage({ data }: { data: WeekPageData }) {
  const { now, clock, prefs, theaters, rank, days, notOutNote } = useListView(data);
  const dates = days.map((d) => d.date);
  const rows = filmRows(data.films, dates, clock, rank);
  const { few, all, seen } = weekSections(rows, prefs.seen);

  let index = 0;
  const row = (r: FilmRow) => (
    <WeekRow
      key={r.film.id}
      row={r}
      days={days}
      today={clock.today}
      summary={rowSummary(r, theaters, rank, clock.today)}
      eager={index++ < EAGER_ROWS}
    />
  );

  const subtitle = [formatRange(dates[0], dates[dates.length - 1]), plural(rows.length, "film"), notOutNote];
  return (
    <Layout
      data={data}
      now={now}
      heading={
        <div class="title">
          <h1 class="display">This week</h1>
          <p class="sub">{subtitle.filter(Boolean).join(" · ")}</p>
          <StaleNotice data={data} now={now} />
        </div>
      }
      strip={<DayStrip days={days} today={clock.today} />}
    >
      {rows.length === 0 ? (
        <div class="empty">
          <p class="empty-t">Nothing left this week</p>
          {notOutNote && <p class="sub">Cinemas usually publish a few days ahead. Check back later in the week.</p>}
        </div>
      ) : (
        <>
          {few.length > 0 && (
            <section aria-labelledby="few">
              <h2 id="few" class="label">
                Only a few showings
              </h2>
              <ul class="films">{few.map(row)}</ul>
            </section>
          )}
          {all.length > 0 && (
            <section aria-labelledby="all">
              <h2 id="all" class="label">
                Playing all week
              </h2>
              <ul class="films">{all.map(row)}</ul>
            </section>
          )}
          <SeenGroup count={seen.length}>{seen.map(row)}</SeenGroup>
        </>
      )}
    </Layout>
  );
}
