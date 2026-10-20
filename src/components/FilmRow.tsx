import type { ComponentChildren } from "preact";
import { distanceLabel } from "../domain/distance";
import { formatRuntime, plural, shortName, subtitleLabel } from "../domain/format";
import type { LatLng } from "../domain/prefs";
import { dayTitle, type DayStatus, type FilmRow } from "../domain/schedule";
import type { DateKey } from "../domain/time";
import type { ListFilm, Showing } from "../pageData";
import type { Theater } from "../types";
import { siteOnly } from "../domain/ticket";
import { IconExternal, IconStar } from "./Icons";
import { Poster } from "./Poster";

/** Rating · up to 2 genres · runtime, and anything the caller adds */
function FilmMeta({ film, extra }: { film: ListFilm; extra?: string }) {
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
  /** Distance from Home, on its own line, held from first paint whenever a Home is saved. */
  distance?: string;
  eager: boolean;
  seen?: boolean;
  /** Where a filled cell leads: the film on that day, or the cinema's Day view. */
  cellHref?: (date: DateKey) => string;
  /** Days with this many showings or fewer show their times in the cell instead of the count. */
  timesUpTo?: number;
}

export function WeekRow({ row, days, today, summary, distance, eager, seen, cellHref, timesUpTo = 0 }: WeekRowProps) {
  const { film } = row;
  return (
    <Row film={film} href={`/film/${film.id}/`} eager={eager} seen={seen}>
      {days.map(({ date, status }) => {
        const on = row.showings.filter((s) => s.date === date);
        const n = on.length;
        if (n > 0) {
          const times = n <= timesUpTo;
          return (
            <a
              key={date}
              class={times ? "cell cell--on cell--times" : "cell cell--on"}
              href={cellHref ? cellHref(date) : `/film/${film.id}/${date}/`}
              aria-label={`${dayTitle(date, today)}: ${plural(n, "showing")}${times ? ` at ${on.map((s) => s.time).join(", ")}` : ""}`}
            >
              {times ? on.map((s, i) => <span key={i}>{s.time}</span>) : n}
            </a>
          );
        }
        return <span key={date} class={status === "not-out" ? "cell cell--unpub" : "cell"} aria-hidden="true" />;
      })}
      <p class="film-sum sub">
        {summary}
        {distance !== undefined && <span class="home-line if-home">{distance}</span>}
      </p>
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
  home: LatLng | null;
  eager: boolean;
  onShowing: (film: ListFilm, s: Showing) => void;
}

/**
 * "Verdi · Gràcia" without Home. With one, the distance takes a slot that's
 * as wide from first paint as once it's filled, so the chips beside it stay put.
 */
function ChipWhere({ theater, home }: { theater: Theater; home: LatLng | null }) {
  if (theater.lat == null || theater.lng == null) return <>{`${shortName(theater)} · ${theater.neighborhood}`}</>;
  return (
    <>
      {shortName(theater)} · <span class="if-no-home">{theater.neighborhood}</span>
      <span class="chip-d if-home">{distanceLabel(home, theater)}</span>
    </>
  );
}

export function DayRow({ row, date, theaters, home, eager, onShowing }: DayRowProps) {
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
            <ShowingChip
              key={i}
              href={href}
              class={`${i < CHIPS_MOBILE ? "chip" : "chip chip--wide"}${siteOnly(s) ? " chip--site" : ""}`}
              onOpen={() => onShowing(film, s)}
            >
              <ChipTime s={s} />
              <span class="chip-w">
                {theater ? <ChipWhere theater={theater} home={home} /> : s.theater_id}
              </span>
            </ShowingChip>
          );
        })}
        {more(CHIPS_MOBILE, "chip--m")}
        {more(CHIPS_DESKTOP, "chip--d")}
      </div>
    </Row>
  );
}

interface ShowingChipProps {
  /** Where a tap goes before the bundle runs, and with a modifier key after. */
  href: string;
  class?: string;
  onOpen: () => void;
  children: ComponentChildren;
}

/**
 * A showtime chip. It's a real link, so a tap before the bundle runs still
 * goes somewhere useful; once it runs, a plain tap opens the ticket in place.
 */
export function ShowingChip({ href, class: cls = "chip", onOpen, children }: ShowingChipProps) {
  return (
    <a
      class={cls}
      href={href}
      aria-haspopup="dialog"
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onOpen();
      }}
    >
      {children}
    </a>
  );
}

/** A chip's time and tags, with a ↗ when the showing has no booking page of its own. */
export function ChipTime({ s }: { s: Showing }) {
  return (
    <span class="chip-t">
      <b>{s.time}</b>
      <Tags s={s} />
      {siteOnly(s) && (
        <span class="site-mark">
          <IconExternal />
          <span class="vh">(book on the cinema's site)</span>
        </span>
      )}
    </span>
  );
}

/**
 * Explains the ↗, once per page; the caller renders it only when a time it
 * draws has one. "desktop" shows it only at the width that draws that time;
 * "idle" holds its line unseen, so the last marked time starting moves nothing.
 */
export function SiteLegend({ only }: { only?: "desktop" | "idle" }) {
  return (
    <p class={only ? `legend legend--${only} sub` : "legend sub"} aria-hidden={only === "idle" || undefined}>
      <IconExternal /> No booking page for this showing. Book on the cinema's site.
    </p>
  );
}

/** The Day view's legend, for the marked times drawn before "+N more" at each width. */
export function DayLegend({ rows }: { rows: FilmRow[] }) {
  const marked = (shown: number) => rows.some((r) => r.showings.slice(0, shown).some(siteOnly));
  return marked(CHIPS_MOBILE) ? <SiteLegend /> : marked(CHIPS_DESKTOP) ? <SiteLegend only="desktop" /> : null;
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
