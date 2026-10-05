import { useState } from "preact/hooks";
import { DayStrip } from "../components/DayStrip";
import { DayRow } from "../components/FilmRow";
import { Layout } from "../components/Layout";
import { SeenGroup } from "../components/SeenGroup";
import { TicketSheet } from "../components/TicketSheet";
import { plural } from "../domain/format";
import { daySections, dayStatus, dayTitle, filmRows, notOutFrom, type FilmRow } from "../domain/schedule";
import { formatDayMonth } from "../domain/time";
import type { DayPageData, ListFilm, Showing } from "../pageData";
import { EAGER_ROWS, NotOutYet, StaleNotice, useListView } from "./listView";

export function DayPage({ data }: { data: DayPageData }) {
  const { now, clock, prefs, theaters, rank, days, where } = useListView(data);
  const [ticket, setTicket] = useState<{ film: ListFilm; showing: Showing } | null>(null);
  const { date } = data;
  const rows = filmRows(data.films, [date], clock, rank);
  const { films, seen } = daySections(rows, prefs.seen);
  const status = dayStatus(date, data.calendar, clock, notOutFrom(data.calendar, clock.today));
  const title = dayTitle(date, clock.today);

  let index = 0;
  const row = (r: FilmRow) => (
    <DayRow
      key={r.film.id}
      row={r}
      date={date}
      theaters={theaters}
      where={where}
      eager={index++ < EAGER_ROWS}
      onShowing={(film, showing) => setTicket({ film, showing })}
    />
  );

  const subtitle = [
    date === clock.today ? `From ${clock.time}` : formatDayMonth(date),
    rows.length > 0 && plural(rows.length, "film"),
    rows.length > 0 && status === "not-out" && "Listings mostly not out yet",
  ];

  let body;
  if (rows.length > 0) {
    body = (
      <>
        <section aria-labelledby="by-start">
          <h2 id="by-start" class="label">
            By start time
          </h2>
          <ul class="films">{films.map(row)}</ul>
        </section>
        <SeenGroup count={seen.length}>{seen.map(row)}</SeenGroup>
      </>
    );
  } else if (status === "not-out") {
    body = <NotOutYet title={title} />;
  } else {
    body = (
      <div class="empty">
        <p class="empty-t">
          {date > clock.today ? `Nothing on ${title}` : date === clock.today ? "Nothing left today" : `Nothing left on ${title}`}
        </p>
        <a class="pill" href="/">
          See the whole week
        </a>
      </div>
    );
  }

  const theater = ticket && theaters.get(ticket.showing.theater_id);
  return (
    <Layout
      data={data}
      now={now}
      heading={
        <div class="title">
          <h1 class="display">{title}</h1>
          <p class="sub">{subtitle.filter(Boolean).join(" · ")}</p>
          <StaleNotice data={data} now={now} />
        </div>
      }
      strip={<DayStrip days={days} today={clock.today} current={date} />}
    >
      {body}
      {ticket && theater && (
        <TicketSheet
          film={ticket.film}
          showing={ticket.showing}
          theater={theater}
          today={clock.today}
          prefs={prefs}
          onClose={() => setTicket(null)}
        />
      )}
    </Layout>
  );
}
