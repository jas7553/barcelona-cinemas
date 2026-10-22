import type { LatLng } from "../domain/prefs";
import { streetMap, type StreetModel } from "../domain/street";

interface Props {
  place: LatLng;
  /** Drawn as the map's pin, and named in its link. */
  name: string;
  /** Where tapping the map goes: the cinema's directions. */
  href: string;
  home: LatLng | null;
  /** [width, height] on phones and on desktop, so the tiles' street names stay their own size. */
  mobile: [number, number];
  desktop: [number, number];
}

/**
 * The streets round one place, drawn twice like CityMap, at the phone and the
 * desktop width. The whole map links to directions.
 */
export function StreetMap({ place, name, href, home, mobile, desktop }: Props) {
  return (
    <div class="street">
      <a href={href} aria-label={`Directions to ${name}`}>
        <Drawing model={streetMap(place, ...mobile)} home={home} cls="map map--m" />
        <Drawing model={streetMap(place, ...desktop)} home={home} cls="map map--d" />
      </a>
      <span class="street-credit">© OpenStreetMap © CARTO</span>
    </div>
  );
}

function Drawing({ model: m, home, cls }: { model: StreetModel; home: LatLng | null; cls: string }) {
  const h = home && m.at(home);
  const x = m.width / 2;
  const y = m.height / 2;
  return (
    <svg class={cls} viewBox={`0 0 ${m.width} ${m.height}`} width={m.width} height={m.height} aria-hidden="true">
      {m.tiles.map((t) => (
        <image key={t.href} href={t.href} x={t.x.toFixed(1)} y={t.y.toFixed(1)} width={256} height={256} />
      ))}
      {h && (
        <>
          <circle class="m-home" cx={h.x.toFixed(1)} cy={h.y.toFixed(1)} r={5.5} />
          <text class="m-label m-label--home st-label" x={(h.x + 9).toFixed(1)} y={(h.y + 4).toFixed(1)}>
            Home
          </text>
        </>
      )}
      <path class="st-pin" d={`M${x} ${y}c-2-7-9-11-9-18a9 9 0 0 1 18 0c0 7-7 11-9 18z`} />
      <circle class="st-pin-hole" cx={x} cy={y - 18} r={3.5} />
    </svg>
  );
}
