import type { ComponentChildren } from "preact";
import { formatRuntime, plural, shortName, subtitleLabel } from "../domain/format";
import { dayTitle, type DayStatus, type FilmRow } from "../domain/schedule";
import type { DateKey } from "../domain/time";
import type { ListFilm, Showing } from "../pageData";
import type { Theater } from "../types";
import { IconStar } from "./Icons";
import { Poster } from "./Poster";

/** Rating · up to 2 genres · runtime, and anything the caller adds */
export function FilmMeta({ film, extra }: { film: ListFilm; extra?: string }) {
  const rest = [...film.genres.slice(0, 2), film.runtime_minutes ? formatRuntime(film.runtime_minutes) : null].filter(
    Boolean,
  );
  return (
    <p class="meta sub">
      {film.rating != null && (
        <span class="rating">
          <IconStar />
          {film.rating.toFixed(1)}
        </span>
      )}
      {film.rating != null && rest.length > 0 && " · "}
      {rest.join(" · ")}
      {extra}
    </p>
  );
}

interface RowProps {
  film: ListFilm;
  href: string;
  eager: boolean;
  /** Seen films on a cinema page stay in the list, faded, rather than move to a group. */
  seen?: boolean;
  /** The Day view's anchor, which the cinema's week cells link to. */
  id?: string;
  children: ComponentChildren;
}

/** Poster, title and meta on the timetable grid; the caller adds cells or chips. */
export function Row({ film, href, eager, seen, id, children }: RowProps) {
  return (
    <li class={seen ? "film film--seen tt" : "film tt"} data-film={film.id} id={id}>
      {/* The title link right beside it is the one assistive tech gets. */}
      <a class="film-p" href={href} tabIndex={-1} aria-hidden="true">
        <Poster film={film} eager={eager} />
      </a>
      <h3 class="film-h">
        <a href={href}>{film.title}</a>
      </h3>
      <FilmMeta film={film} extra={seen ? " · Seen" : undefined} />
      {children}
    </li>
  );
}

interface WeekRowProps {
  row: FilmRow;
  days: { date: DateKey; status: DayStatus }[];
  today: DateKey;
  summary: ComponentChildren;
  eager: boolean;
  seen?: boolean;
  /** Where a filled cell leads: the film on that day, or the cinema's Day view. */
  cellHref?: (date: DateKey) => string;
}

export function WeekRow({ row, days, today, summary, eager, seen, cellHref }: WeekRowProps) {
  const { film } = row;
  return (
    <Row film={film} href={`/film/${film.id}/`} eager={eager} seen={seen}>
      {days.map(({ date, status }) => {
        const n = row.showings.filter((s) => s.date === date).length;
        if (n > 0) {
          return (
            <a
              key={date}
              class="cell cell--on"
              href={cellHref ? cellHref(date) : `/film/${film.id}/${date}/`}
              aria-label={`${dayTitle(date, today)}: ${plural(n, "showing")}`}
            >
              {n}
            </a>
          );
        }
        return <span key={date} class={status === "not-out" ? "cell cell--unpub" : "cell"} aria-hidden="true" />;
      })}
      <p class="film-sum sub">{summary}</p>
    </Row>
  );
}

// Chips shown before "+N more" (requirements 5.2). Both counts are rendered and
// CSS shows the one for the viewport, so the server render needn't know it.
const CHIPS_MOBILE = 4;
const CHIPS_DESKTOP = 7;

interface DayRowProps {
  row: FilmRow;
  date: DateKey;
  theaters: ReadonlyMap<string, Theater>;
  where: (theaterId: string) => string;
  eager: boolean;
  onShowing: (film: ListFilm, s: Showing) => void;
}

export function DayRow({ row, date, theaters, where, eager, onShowing }: DayRowProps) {
  const { film, showings } = row;
  const href = `/film/${film.id}/${date}/`;
  const more = (shown: number, cls: string) =>
    showings.length > shown && (
      <a class={`chip chip--more ${cls}`} href={href}>
        +{showings.length - shown} more
      </a>
    );
  return (
    <Row film={film} href={href} eager={eager}>
      <div class="chips">
        {showings.slice(0, CHIPS_DESKTOP).map((s, i) => {
          const theater = theaters.get(s.theater_id);
          return (
            <button
              key={i}
              type="button"
              class={i < CHIPS_MOBILE ? "chip" : "chip chip--wide"}
              aria-haspopup="dialog"
              onClick={() => onShowing(film, s)}
            >
              <span class="chip-t">
                <b>{s.time}</b>
                <Tags s={s} />
              </span>
              <span class="chip-w">
                {theater ? shortName(theater) : s.theater_id} · {where(s.theater_id)}
              </span>
            </button>
          );
        })}
        {more(CHIPS_MOBILE, "chip--m")}
        {more(CHIPS_DESKTOP, "chip--d")}
      </div>
    </Row>
  );
}

/** IMAX and subtitle-version tags; never more than these two. */
export function Tags({ s }: { s: Showing }) {
  const subs = subtitleLabel(s);
  return (
    <>
      {s.premium_format === "imax" && <em class="tag tag--imax">IMAX</em>}
      {subs && <em class="tag">{subs}</em>}
    </>
  );
}
