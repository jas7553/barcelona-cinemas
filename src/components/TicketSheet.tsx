import { useState } from "preact/hooks";
import { formatRuntime, shortName, subtitleLabel } from "../domain/format";
import { dayShort } from "../domain/schedule";
import { outTime, shareText } from "../domain/ticket";
import type { DateKey } from "../domain/time";
import type { ListFilm, Showing } from "../pageData";
import type { Theater } from "../types";
import { IconExternal, IconStar } from "./Icons";
import { Poster } from "./Poster";
import { Sheet } from "./Sheet";

interface Props {
  film: ListFilm;
  showing: Showing;
  theater: Theater;
  today: DateKey;
  favourite: boolean;
  /** Distance from Home, when there is one. */
  distance: string | null;
  onClose: () => void;
}

/** One showing as a ticket stub, with Book as the primary action (requirements 5.6). */
export function TicketSheet({ film, showing: s, theater, today, favourite, distance, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const cinema = shortName(theater);
  const about = [
    film.runtime_minutes ? formatRuntime(film.runtime_minutes) : null,
    s.premium_format === "imax" ? "IMAX" : null,
    subtitleLabel(s),
  ].filter(Boolean);

  const share = () => {
    const text = shareText(film.title, cinema, s);
    const url = new URL(`/film/${film.id}/${s.date}/`, location.href).href;
    if (navigator.share) {
      // Rejects when the person dismisses the share sheet; nothing to do then.
      navigator.share({ title: film.title, text, url }).catch(() => {});
    } else {
      navigator.clipboard
        ?.writeText(`${text} ${url}`)
        .then(() => setCopied(true))
        .catch(() => {});
    }
  };

  return (
    <Sheet labelledBy="ticket-title" onClose={onClose}>
      {/* Initial focus lands on the stub, not on the first link inside it. */}
      <div class="stub" tabIndex={-1} autoFocus>
        <div class="stub-top">
          <Poster film={film} eager />
          <div>
            <h2 id="ticket-title" class="stub-title display">
              {film.title}
            </h2>
            {about.length > 0 && <p class="sub">{about.join(" · ")}</p>}
          </div>
        </div>
        <div class="perf" />
        <dl class="facts">
          <div>
            <dt>Date</dt>
            <dd>
              {dayShort(s.date, today)} {Number(s.date.slice(8))}
            </dd>
          </div>
          <div>
            <dt>Starts</dt>
            <dd>{s.time}</dd>
          </div>
          <div>
            <dt>Out ~</dt>
            <dd>{outTime(s.time, film.runtime_minutes)}</dd>
          </div>
        </dl>
        <div class="where">
          <a href={`/cinema/${theater.id}/${s.date}/`}>
            <b>{theater.name}</b>
            {favourite && (
              <span class="fav">
                <IconStar />
                <span class="vh">(my cinema)</span>
              </span>
            )}
          </a>
          <p class="sub">{[theater.address, theater.neighborhood, distance].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      {s.booking_url ? (
        <a class="cta" href={s.booking_url}>
          Book at {cinema} <IconExternal />
        </a>
      ) : (
        <>
          <a class="cta cta--plain" href={theater.website_url}>
            {cinema} website <IconExternal />
          </a>
          <p class="note sub">No direct booking link for this showing</p>
        </>
      )}
      <div class="cta2">
        <button type="button" onClick={share}>
          {copied ? "Copied" : "Share"}
        </button>
        <a href={theater.maps_url}>
          Directions <IconExternal />
        </a>
      </div>
    </Sheet>
  );
}
