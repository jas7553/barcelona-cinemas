import { useState } from "preact/hooks";
import { useNow } from "../client/clock";
import { toggleFavourite, usePrefs } from "../client/prefs";
import { CityMap } from "../components/CityMap";
import { DayStrip } from "../components/DayStrip";
import { Row, ShowingChip, Tags, WeekRow } from "../components/FilmRow";
import { IconExternal } from "../components/Icons";
import { Layout } from "../components/Layout";
import { TicketSheet } from "../components/TicketSheet";
import { cinemaDayRows, cinemaWeekRows } from "../domain/cinema";
import { distanceLabel } from "../domain/distance";
import { plural, shortName } from "../domain/format";
import { clockAt, dayAndDate, dayTitle, horizon, pageDays, ranking, type FilmRow } from "../domain/schedule";
import type { CinemaPageData, ListFilm, Showing } from "../pageData";
import { EAGER_ROWS, NotOutYet, StaleNotice } from "./listView";

export function CinemaPage({ data }: { data: CinemaPageData }) {
  const now = useNow(data.renderedAt);
  const prefs = usePrefs();
  const clock = clockAt(now);
  const theater = data.theaters.find((t) => t.id === data.theaterId)!;
  const rank = ranking(data.theaters, prefs.home, prefs.favourites);
  const [ticket, setTicket] = useState<{ film: ListFilm; showing: Showing } | null>(null);
  const distance = distanceLabel(prefs.home, theater);
  const short = shortName(theater);
  const { date } = data;
  const days = pageDays(data.films.flatMap((f) => f.showtimes), data.calendar, clock);

  let index = 0;
  let body;
  if (date === null) {
    const rows = cinemaWeekRows(data.films, horizon(clock.today), clock, rank, prefs.seen);
    body = rows.length ? (
      <section aria-labelledby="programme">
        <h2 id="programme" class="label">
          {plural(rows.length, "film")} this week
        </h2>
        <ul class="films" data-seen-last>
          {rows.map((r) => (
            <WeekRow
              key={r.film.id}
              row={r}
              days={days}
              today={clock.today}
              eager={index++ < EAGER_ROWS}
              seen={prefs.seen.has(r.film.id)}
              cellHref={(d) => `/cinema/${theater.id}/${d}/#f${r.film.id}`}
              summary={
                <>
                  Next: {dayAndDate(r.showings[0].date, clock.today)} {r.showings[0].time}
                  <Tags s={r.showings[0]} />
                </>
              }
            />
          ))}
        </ul>
      </section>
    ) : (
      <div class="empty">
        <p class="empty-t">Nothing on at {short} this week</p>
        <a class="pill" href="/">
          See the whole week
        </a>
      </div>
    );
  } else {
    const rows = cinemaDayRows(data.films, date, clock, rank, prefs.seen);
    const title = dayTitle(date, clock.today);
    const on = date === clock.today ? "today" : `on ${title}`;
    if (rows.length) {
      body = (
        <section aria-labelledby="programme">
          <h2 id="programme" class="label">
            {plural(rows.length, "film")} {on}
          </h2>
          <ul class="films" data-seen-last>
            {rows.map((r) => (
              <CinemaDayRow
                key={r.film.id}
                row={r}
                eager={index++ < EAGER_ROWS}
                seen={prefs.seen.has(r.film.id)}
                onShowing={(film, showing) => setTicket({ film, showing })}
              />
            ))}
          </ul>
        </section>
      );
    } else if (days.find((d) => d.date === date)?.status === "not-out") {
      body = <NotOutYet title={title} />;
    } else {
      body = (
        <div class="empty">
          <p class="empty-t">
            Nothing {date === clock.today ? "left" : "on"} at {short} {on}
          </p>
          <a class="pill" href={`/cinema/${theater.id}/`}>
            See its week
          </a>
        </div>
      );
    }
  }

  return (
    <Layout
      data={data}
      now={now}
      section="cinemas"
      heading={
        <div class="cin-top">
          <div class="title cin-head">
            <h1 class="display">{theater.name}</h1>
            <p class="sub">
              {[theater.address, theater.neighborhood, distance && `${distance} from home`]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div class="actions">
              <FavouriteToggle id={theater.id} on={prefs.favourites.has(theater.id)} />
              <a class="pill" href={theater.website_url}>
                Website <IconExternal />
              </a>
              <a class="pill" href={theater.maps_url}>
                Directions <IconExternal />
              </a>
            </div>
            <StaleNotice data={data} now={now} />
          </div>
          {theater.lat != null && (
            <div class="cin-map">
              <CityMap
                label={`Map of ${theater.name}${prefs.home ? " and Home" : ""}, with the cinemas nearby`}
                mobile={[358, 180]}
                desktop={[480, 240]}
                theaters={data.theaters}
                frame={[theater.id]}
                minSpan={3.2}
                home={prefs.home}
                favourites={prefs.favourites}
                link
              />
            </div>
          )}
        </div>
      }
      strip={
        <DayStrip
          days={days}
          today={clock.today}
          current={date ?? undefined}
          weekHref={`/cinema/${theater.id}/`}
          dayHref={(d) => `/cinema/${theater.id}/${d}/`}
        />
      }
    >
      {body}
      {ticket && (
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

/** Label follows aria-pressed, which ORDER_SCRIPT sets before paint. */
function FavouriteToggle({ id, on }: { id: string; on: boolean }) {
  return (
    <button type="button" class="pill pill--fav" data-fav={id} aria-pressed={on} onClick={() => toggleFavourite(id)}>
      <span class="if-on">★ My cinema</span>
      <span class="if-off">☆ Add to my cinemas</span>
    </button>
  );
}

interface CinemaDayRowProps {
  row: FilmRow;
  eager: boolean;
  seen: boolean;
  onShowing: (film: ListFilm, s: Showing) => void;
}

/** A film's showings here that day: every one, with Book where there's a booking link. */
function CinemaDayRow({ row, eager, seen, onShowing }: CinemaDayRowProps) {
  const { film, showings } = row;
  return (
    <Row film={film} href={`/film/${film.id}/${showings[0].date}/`} eager={eager} seen={seen} id={`f${film.id}`}>
      <div class="chips">
        {showings.map((s, i) => (
          <ShowingChip key={i} href={`/film/${film.id}/${s.date}/`} onOpen={() => onShowing(film, s)}>
            <span class="chip-t">
              <b>{s.time}</b>
              <Tags s={s} />
            </span>
            <span class="chip-w">{s.booking_url ? "Book" : "Details"}</span>
          </ShowingChip>
        ))}
      </div>
    </Row>
  );
}
