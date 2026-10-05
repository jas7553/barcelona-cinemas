import { useNow } from "../client/clock";
import { toggleFavourite, usePrefs } from "../client/prefs";
import { CityMap } from "../components/CityMap";
import { IconStar } from "../components/Icons";
import { Layout } from "../components/Layout";
import { cinemaOrder, filmsLeft } from "../domain/cinema";
import { distanceKm, distanceLabel } from "../domain/distance";
import { plural } from "../domain/format";
import { clockAt, ranking } from "../domain/schedule";
import type { CinemasPageData } from "../pageData";

// With a Home, the map frames the cinemas this close and pins the rest to its edge.
const FRAME_KM = 4;

/** Every cinema with something on, My cinemas first (requirements 5.5). One list, headings included, so ORDER_SCRIPT can reorder it. */
export function CinemasPage({ data }: { data: CinemasPageData }) {
  const now = useNow(data.renderedAt);
  const prefs = usePrefs();
  const clock = clockAt(now);
  const rank = ranking(data.theaters, prefs.home, prefs.favourites);
  const order = cinemaOrder(rank);
  const showing = data.theaters
    .map((t) => ({ theater: t, films: filmsLeft(data.lastShowings[t.id], clock) }))
    .filter((c) => c.films > 0)
    .sort((a, b) => order(a.theater, b.theater));
  const mine = showing.filter((c) => prefs.favourites.has(c.theater.id));
  const rest = showing.filter((c) => !prefs.favourites.has(c.theater.id));

  const row = ({ theater: t, films }: (typeof showing)[number]) => (
    <li key={t.id} class="cinema" data-id={t.id} data-lat={t.lat ?? undefined} data-lng={t.lng ?? undefined}>
      <a href={`/cinema/${t.id}/`}>
        <b>{t.name}</b>
        <span class="sub">{[t.neighborhood, distanceLabel(prefs.home, t), `${plural(films, "film")} this week`].filter(Boolean).join(" · ")}</span>
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
            link
          />
        </div>
        <ul class="cinemas" data-sort>
          <li class="label" data-head="mine">
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
