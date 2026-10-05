import { useEffect, useMemo, useState } from "preact/hooks";
import { useNow } from "../client/clock";
import { toggleSeen, usePrefs } from "../client/prefs";
import { CityMap } from "../components/CityMap";
import { ShowingChip, Tags } from "../components/FilmRow";
import { Footer } from "../components/Footer";
import { IconExternal, IconStar } from "../components/Icons";
import { TicketSheet } from "../components/TicketSheet";
import { DayLink } from "../components/DayStrip";
import { distanceLabel } from "../domain/distance";
import { byCinema } from "../domain/film";
import { formatRuntime, largePoster, plural, shortName } from "../domain/format";
import type { LatLng } from "../domain/prefs";
import { clockAt, dayTitle, hasStarted, pageDays, ranking } from "../domain/schedule";
import type { DateKey } from "../domain/time";
import type { FilmDetail, FilmPageData, Showing } from "../pageData";
import type { Theater } from "../types";
import { NotOutYet, StaleNotice } from "./listView";

// Past this many characters the synopsis is likely over its 3 clamped lines on
// a phone, so it gets a "More" button. Decided on the server, so nothing moves
// once the page hydrates.
const CLAMP_CHARS = 140;

export function FilmPage({ data }: { data: FilmPageData }) {
  const now = useNow(data.renderedAt);
  const prefs = usePrefs();
  const clock = clockAt(now);
  const { film } = data;
  const theaters = useMemo(() => new Map(data.theaters.map((t) => [t.id, t])), [data.theaters]);
  const rank = ranking(data.theaters, prefs.home, prefs.favourites);
  const days = pageDays(film.showtimes, data.calendar, clock);
  const first = days.find((d) => d.status === "on")?.date ?? null;
  const date = data.date && data.date >= clock.today ? data.date : first;
  const [ticket, setTicket] = useState<Showing | null>(null);
  const groups = date ? byCinema(film.showtimes, date, rank) : [];
  // Each cinema on the map with its first showing left and how many more: "18:00 +2".
  const notes: Record<string, string> = {};
  for (const g of groups) {
    const left = g.showings.filter((s) => !hasStarted(s, clock));
    if (left.length) notes[g.theaterId] = `${left[0].time}${left.length > 1 ? ` +${left.length - 1}` : ""}`;
  }

  const ticketTheater = ticket && theaters.get(ticket.theater_id);

  return (
    <>
      <Hero film={film} theaters={theaters} />
      <main class="wrap film-layout">
        <About film={film} seen={prefs.seen.has(film.id)} />
        <section class="panel" aria-labelledby="showtimes">
          <h2 id="showtimes" class="panel-h display">
            Showtimes
          </h2>
          <StaleNotice data={data} now={now} />
          {first === null || date === null ? (
            <div class="empty">
              <p class="empty-t">No more showings</p>
              <p class="sub">
                {film.title} has no showings left in the listings. Its run may be over, or new dates may not be out yet.
              </p>
              <a class="pill" href="/">
                See what's on this week
              </a>
            </div>
          ) : (
            <>
              <nav class="days" aria-label="Days">
                {days.map((d) => (
                  <DayLink key={d.date} {...d} today={clock.today} current={date} href={`/film/${film.id}/${d.date}/`} />
                ))}
              </nav>
              <DayShowings
                film={film}
                date={date}
                today={clock.today}
                unpub={days.find((d) => d.date === date)?.status === "not-out"}
                groups={groups}
                theaters={theaters}
                home={prefs.home}
                favourite={(id) => prefs.favourites.has(id)}
                started={(s) => hasStarted(s, clock)}
                onShowing={setTicket}
              />
              {Object.keys(notes).length > 0 && (
                <div class="map-wrap">
                  <h3>Where, {date === clock.today ? "today" : dayTitle(date, clock.today)}</h3>
                  <CityMap
                    label={`Map of the ${plural(Object.keys(notes).length, "cinema")} showing ${film.title} ${date === clock.today ? "today" : `on ${dayTitle(date, clock.today)}`}`}
                    mobile={[358, 230]}
                    desktop={[398, 240]}
                    theaters={data.theaters}
                    frame={Object.keys(notes)}
                    notes={notes}
                    minSpan={2.5}
                    others={false}
                    home={prefs.home}
                    favourites={prefs.favourites}
                    link
                  />
                </div>
              )}
            </>
          )}
        </section>
      </main>
      <Footer generatedAt={data.generatedAt} now={now} />
      {ticket && ticketTheater && (
        <TicketSheet
          film={film}
          showing={ticket}
          theater={ticketTheater}
          today={clock.today}
          prefs={prefs}
          onClose={() => setTicket(null)}
        />
      )}
    </>
  );
}

/**
 * The backdrop, with a way back: to This week, or to the cinema page the
 * visitor came from (requirements 5.3). The referrer is only known in the
 * browser, so the cinema label arrives after mount.
 */
function Hero({ film, theaters }: { film: FilmDetail; theaters: ReadonlyMap<string, Theater> }) {
  const [back, setBack] = useState({ href: "/", label: "This week" });
  useEffect(() => {
    try {
      const ref = new URL(document.referrer);
      const m = ref.origin === location.origin && ref.pathname.match(/^\/cinema\/([^/]+)\//);
      const theater = m && theaters.get(decodeURIComponent(m[1]));
      if (theater) setBack({ href: ref.pathname, label: shortName(theater) });
    } catch {
      /* no referrer */
    }
  }, [theaters]);

  const src = film.backdrop_url;
  return (
    <div class={src ? "hero" : "hero hero--none"}>
      {src && (
        <img
          src={src}
          srcset={`${src.replace(/\/w\d+\//, "/w780/")} 780w, ${src} 1280w`}
          sizes="100vw"
          alt=""
          width={1280}
          height={720}
          fetchpriority="high"
        />
      )}
      <a class="pill back" href={back.href}>
        ‹ {back.label}
      </a>
    </div>
  );
}

function About({ film, seen }: { film: FilmDetail; seen: boolean }) {
  const [open, setOpen] = useState(false);
  const clamp = film.synopsis.length > CLAMP_CHARS;
  const facts = [film.year, film.runtime_minutes ? formatRuntime(film.runtime_minutes) : null].filter(Boolean);
  return (
    <section class="about" aria-labelledby="film-title">
      <div class="head">
        {film.poster_url ? (
          <img class="poster" src={largePoster(film.poster_url)} alt="" width={180} height={270} />
        ) : (
          <div class="poster poster--none" aria-hidden="true">
            <span>{film.title}</span>
          </div>
        )}
        <div>
          <h1 id="film-title" class="display">
            {film.title}
          </h1>
          <p class="meta sub">
            {film.rating != null && (
              <span class="rating">
                <IconStar />
                {film.rating.toFixed(1)}
              </span>
            )}
            {film.rating != null && facts.length > 0 && " · "}
            {facts.join(" · ")}
            {film.genres.length > 0 && (
              <>
                <br />
                {film.genres.join(", ")}
              </>
            )}
          </p>
        </div>
      </div>
      {film.tagline && <p class="tagline">{film.tagline}</p>}
      {film.synopsis && (
        <p id="synopsis" class={clamp && !open ? "synopsis synopsis--clamp" : "synopsis"}>
          {film.synopsis}
        </p>
      )}
      {clamp && !open && (
        <button type="button" class="more" aria-controls="synopsis" aria-expanded="false" onClick={() => setOpen(true)}>
          More
        </button>
      )}
      {(film.director || film.cast.length > 0) && (
        <p class="credits sub">
          {film.director && `Dir. ${film.director}`}
          {film.director && film.cast.length > 0 && <br />}
          {film.cast.length > 0 && `With ${film.cast.join(", ")}`}
        </p>
      )}
      <div class="actions">
        {film.trailer_url && (
          <a class="pill" href={film.trailer_url}>
            ▶ Trailer
          </a>
        )}
        {/* SEEN_SCRIPT presses this before paint; CSS picks the label. */}
        <button
          type="button"
          class="pill pill--seen"
          data-seen-toggle={film.id}
          aria-pressed={seen}
          onClick={() => toggleSeen(film.id)}
        >
          ✓ <span class="if-on">Seen</span>
          <span class="if-off">Seen it?</span>
        </button>
        {film.imdb && (
          <a class="pill" href={film.imdb}>
            IMDb <IconExternal />
          </a>
        )}
        <a class="pill" href={film.letterboxd}>
          Letterboxd <IconExternal />
        </a>
      </div>
    </section>
  );
}

interface DayShowingsProps {
  film: FilmDetail;
  date: DateKey;
  today: DateKey;
  unpub: boolean;
  groups: ReturnType<typeof byCinema>;
  theaters: ReadonlyMap<string, Theater>;
  home: LatLng | null;
  favourite: (theaterId: string) => boolean;
  started: (s: Showing) => boolean;
  onShowing: (s: Showing) => void;
}

/** The day's showings, one row per cinema: day → cinema → showing. */
function DayShowings({ film, date, today, unpub, groups, theaters, home, favourite, started, onShowing }: DayShowingsProps) {
  if (groups.length === 0) {
    const title = dayTitle(date, today);
    return unpub ? (
      <NotOutYet title={title} />
    ) : (
      <div class="empty">
        <p class="empty-t">
          {film.title} isn't on {date === today ? "today" : title}
        </p>
      </div>
    );
  }
  return (
    <ul class="crows" data-sort>
      {groups.map(({ theaterId, showings }) => {
        const theater = theaters.get(theaterId);
        if (!theater) return null;
        return (
          <li
            key={theaterId}
            class="crow"
            data-id={theaterId}
            data-lat={theater.lat ?? undefined}
            data-lng={theater.lng ?? undefined}
          >
            <a class="crow-h" href={`/cinema/${theaterId}/${date}/`}>
              <span class="cin">
                {theater.name}
                {favourite(theaterId) && (
                  <span class="fav">
                    <IconStar />
                    <span class="vh">(my cinema)</span>
                  </span>
                )}
              </span>
              <span class="nb">
                {[theater.neighborhood, distanceLabel(home, theater)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </a>
            <div class="tchips">
              {showings.map((s, i) =>
                started(s) ? (
                  <span key={i} class="chip chip--t chip--past">
                    <span class="chip-t">
                      <b>{s.time}</b>
                      <Tags s={s} />
                    </span>
                    <span class="vh">(started)</span>
                  </span>
                ) : (
                  // Before the bundle runs, straight to what the ticket would offer first.
                  <ShowingChip
                    key={i}
                    href={s.booking_url ?? theater.website_url}
                    class="chip chip--t"
                    onOpen={() => onShowing(s)}
                  >
                    <span class="chip-t">
                      <b>{s.time}</b>
                      <Tags s={s} />
                    </span>
                  </ShowingChip>
                ),
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
