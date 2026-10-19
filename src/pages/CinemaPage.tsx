import { useNow } from "../client/clock";
import { toggleFavourite, usePrefs } from "../client/prefs";
import { CityMap } from "../components/CityMap";
import { DayStrip } from "../components/DayStrip";
import { ChipTime, Row, SiteLegend, Tags, WeekRow } from "../components/FilmRow";
import { IconExternal } from "../components/Icons";
import { Layout } from "../components/Layout";
import { cinemaDayRows, cinemaWeekRows } from "../domain/cinema";
import { distanceLabel } from "../domain/distance";
import { plural, shortName } from "../domain/format";
import { bookingHref, siteOnly } from "../domain/ticket";
import { clockAt, dayAndDate, dayTitle, horizon, pageDays, ranking, type FilmRow } from "../domain/schedule";
import type { CinemaPageData } from "../pageData";
import type { Theater } from "../types";
import { EAGER_ROWS, NotOutYet, StaleNotice } from "./listView";

const TIMES_UP_TO = 3;

export function CinemaPage({ data }: { data: CinemaPageData }) {
  const now = useNow(data.renderedAt);
  const prefs = usePrefs();
  const clock = clockAt(now);
  const theater = data.theaters.find((t) => t.id === data.theaterId)!;
  const rank = ranking(data.theaters, prefs.home, prefs.favourites);
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
              timesUpTo={TIMES_UP_TO}
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
                theater={theater}
              />
            ))}
          </ul>
          <SiteLegend showings={rows.flatMap((r) => r.showings)} />
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
  theater: Theater;
  eager: boolean;
  seen: boolean;
}

/** A film's showings here that day: every time links to that showing's booking page, as on the film page. */
function CinemaDayRow({ row, theater, eager, seen }: CinemaDayRowProps) {
  const { film, showings } = row;
  return (
    <Row film={film} href={`/film/${film.id}/${showings[0].date}/`} eager={eager} seen={seen} id={`f${film.id}`}>
      <div class="chips">
        {showings.map((s, i) => (
          <a key={i} class={siteOnly(s) ? "chip chip--site" : "chip"} href={bookingHref(s, theater)}>
            <ChipTime s={s} mark />
          </a>
        ))}
      </div>
    </Row>
  );
}
