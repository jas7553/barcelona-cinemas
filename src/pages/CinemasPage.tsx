import { useNow } from "../client/clock";
import { toggleFavourite, usePrefs, useSettledOrder } from "../client/prefs";
import { CityMap } from "../components/CityMap";
import { IconStar } from "../components/Icons";
import { Layout } from "../components/Layout";
import { cinemaOrder, filmsLeft } from "../domain/cinema";
import { distanceKm } from "../domain/distance";
import { formatDistance, plural, shortName } from "../domain/format";
import { clockAt, ranking } from "../domain/schedule";
import type { CinemasPageData } from "../pageData";
import type { Theater } from "../types";

// With a Home, the map frames the cinemas this close and pins the rest to its edge.
const FRAME_KM = 4;

/**
 * Every cinema with something on, My cinemas first (requirements 5.5).
 *
 * One list, headings included, so the pre-paint script can put My cinemas
 * first with CSS order alone: each heading sorts to the top of its group.
 */
export function CinemasPage({ data }: { data: CinemasPageData }) {
  const now = useNow(data.renderedAt);
  const prefs = usePrefs();
  useSettledOrder(prefs);
  const clock = clockAt(now);
  const rank = ranking(data.theaters, prefs.home, prefs.favourites);
  const showing = data.theaters
    .map((t) => ({ theater: t, films: filmsLeft(data.lastShowings[t.id], clock) }))
    .filter((c) => c.films > 0)
    .sort((a, b) => cinemaOrder(rank)(a.theater, b.theater));
  const mine = showing.filter((c) => prefs.favourites.has(c.theater.id));
  const rest = showing.filter((c) => !prefs.favourites.has(c.theater.id));

  const km = (t: Theater) => {
    const d = distanceKm(prefs.home, t);
    return d == null ? null : formatDistance(d);
  };

  const row = ({ theater: t, films }: (typeof showing)[number]) => (
    <li key={t.id} class="cinema" data-id={t.id} data-lat={t.lat ?? undefined} data-lng={t.lng ?? undefined} data-t={t.name}>
      <a href={`/cinema/${t.id}/`}>
        <b>{t.name}</b>
        <span class="sub">{[t.neighborhood, km(t), `${plural(films, "film")} this week`].filter(Boolean).join(" · ")}</span>
      </a>
      <button
        type="button"
        class="star"
        data-fav={t.id}
        aria-pressed={prefs.favourites.has(t.id)}
        aria-label={`My cinema: ${t.name}`}
        onClick={() => toggleFavourite(t.id)}
      >
        <IconStar />
      </button>
    </li>
  );

  return (
    <Layout
      data={data}
      now={now}
      section="cinemas"
      heading={
        <div class="title">
          <h1 class="display">Cinemas</h1>
          <p class="sub">
            {showing.length} showing English-language films · {prefs.home ? "nearest first" : "A–Z"}
          </p>
        </div>
      }
    >
      <div class="idx">
        <div class="idx-map">
          <CityMap
            label={`Map of the ${showing.length} cinemas${prefs.home ? " around Home" : ""}`}
            mobile={[358, 300]}
            desktop={[560, 450]}
            theaters={showing.map((c) => c.theater)}
            frame={showing
              .filter((c) => {
                const d = distanceKm(prefs.home, c.theater);
                return d == null || d < FRAME_KM;
              })
              .map((c) => c.theater.id)}
            minSpan={3}
            areas
            edges
            home={prefs.home}
            favourites={prefs.favourites}
            name={shortName}
            distance={km}
            km={(t) => distanceKm(prefs.home, t)}
            link
          />
        </div>
        <ul class="cinemas" data-sort data-has-fav={mine.length > 0 ? "" : undefined}>
          <li class="label" data-head="mine" hidden={mine.length === 0}>
            My cinemas
          </li>
          {mine.map(row)}
          <li class="label" data-head="rest">
            <span class="if-has-fav">Others</span>
            <span class="if-no-fav">All</span>
          </li>
          {rest.map(row)}
        </ul>
      </div>
    </Layout>
  );
}
