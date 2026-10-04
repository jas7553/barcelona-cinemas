import { useState } from "preact/hooks";
import { useNow } from "../client/clock";
import { toggleFavourite, usePrefs, useSettledOrder } from "../client/prefs";
import { CityMap } from "../components/CityMap";
import { DayStrip } from "../components/DayStrip";
import { Row, ShowingChip, Tags, WeekRow } from "../components/FilmRow";
import { IconExternal } from "../components/Icons";
import { Layout } from "../components/Layout";
import { TicketSheet } from "../components/TicketSheet";
import { cinemaDayRows, cinemaWeekRows } from "../domain/cinema";
import { distanceKm } from "../domain/distance";
import { formatDistance, plural, shortName } from "../domain/format";
import {
  clockAt,
  dayAndDate,
  dayStatus,
  dayTitle,
  hasStarted,
  horizon,
  notOutFrom,
  ranking,
  type FilmRow,
} from "../domain/schedule";
import type { CinemaPageData, ListFilm, Showing } from "../pageData";
import { StaleNotice } from "./listView";

const EAGER_ROWS = 4;

export function CinemaPage({ data }: { data: CinemaPageData }) {
  const now = useNow(data.renderedAt);
  const prefs = usePrefs();
  useSettledOrder(prefs);
  const clock = clockAt(now);
  const theater = data.theaters.find((t) => t.id === data.theaterId)!;
  const rank = ranking(data.theaters, prefs.home, prefs.favourites);
  const [ticket, setTicket] = useState<{ film: ListFilm; showing: Showing } | null>(null);
  const favourite = prefs.favourites.has(theater.id);
  const km = distanceKm(prefs.home, theater);
  const short = shortName(theater);
  const { date } = data;

  const notOut = notOutFrom(data.calendar, clock.today);
  const days = horizon(clock.today).map((d) => {
    const status = dayStatus(d, data.calendar, clock, notOut);
    const here = data.films.some((f) => f.showtimes.some((s) => s.date === d && !hasStarted(s, clock)));
    // Not out yet beats empty here: the cinema may well publish more.
    return { date: d, status: status === "not-out" ? status : here ? ("on" as const) : ("nothing-left" as const) };
  });

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
              <DayRow
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
      body = (
        <div class="empty">
          <p class="empty-t">{title}'s listings aren't out yet</p>
          <p class="sub">Cinemas usually publish a few days ahead. Check back later in the week.</p>
        </div>
      );
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
              {[theater.address, theater.neighborhood, km == null ? null : `${formatDistance(km)} from home`]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div class="actions">
              <FavouriteToggle id={theater.id} on={favourite} />
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
                name={shortName}
                distance={() => null}
                km={(t) => distanceKm(prefs.home, t)}
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
          favourite={favourite}
          distance={km == null ? null : formatDistance(km)}
          onClose={() => setTicket(null)}
        />
      )}
    </Layout>
  );
}

/**
 * "★ My cinema" or "☆ Add to my cinemas". Both labels are in the markup and CSS
 * shows the one for aria-pressed, which the pre-paint script sets for a
 * favourite, so the pill is right before the bundle runs.
 */
export function FavouriteToggle({ id, on }: { id: string; on: boolean }) {
  return (
    <button type="button" class="pill pill--fav" data-fav={id} aria-pressed={on} onClick={() => toggleFavourite(id)}>
      <span class="if-fav">★ My cinema</span>
      <span class="if-not-fav">☆ Add to my cinemas</span>
    </button>
  );
}

interface DayRowProps {
  row: FilmRow;
  eager: boolean;
  seen: boolean;
  onShowing: (film: ListFilm, s: Showing) => void;
}

/** A film's showings here that day: every one, with Book where there's a booking link. */
function DayRow({ row, eager, seen, onShowing }: DayRowProps) {
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
