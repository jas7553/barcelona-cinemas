import { buildMap, type MapModel, type MapOptions } from "../domain/map";
import type { LatLng } from "../domain/prefs";

const LABEL_CLASS: Record<MapModel["labels"][number]["kind"], string> = {
  cinema: "m-label",
  dim: "m-label m-label--dim",
  home: "m-label m-label--home",
  ring: "m-ringl",
  area: "m-area",
};

interface Props extends Omit<MapOptions, "width" | "height"> {
  /** What the map shows, for assistive tech: everything on it is in the list beside it too. */
  label: string;
  /** [width, height] on phones and on desktop. Labels stay 11px at these widths. */
  mobile: [number, number];
  desktop: [number, number];
  /** Dots link to their cinema's page. */
  link?: boolean;
  /** Tapping the map picks a place (the Home sheet). */
  onPick?: (place: LatLng) => void;
}

/**
 * A schematic map, drawn twice, at the phone and the desktop width, with CSS
 * showing the one for the viewport: the server can't know the width, and
 * scaling one drawing would scale its labels with it.
 */
export function CityMap({ label, mobile, desktop, link, onPick, ...options }: Props) {
  return (
    <>
      <Drawing model={buildMap({ ...options, width: mobile[0], height: mobile[1] })} label={label} link={link} onPick={onPick} cls="map map--m" />
      <Drawing model={buildMap({ ...options, width: desktop[0], height: desktop[1] })} label={label} link={link} onPick={onPick} cls="map map--d" />
    </>
  );
}

interface DrawingProps {
  model: MapModel;
  label: string;
  link?: boolean;
  onPick?: (place: LatLng) => void;
  cls: string;
}

function Drawing({ model: m, label, link, onPick, cls }: DrawingProps) {
  const pick = onPick
    ? (e: MouseEvent) => {
        const svg = e.currentTarget as SVGSVGElement;
        const r = svg.getBoundingClientRect();
        onPick(m.toLatLng(((e.clientX - r.left) * m.width) / r.width, ((e.clientY - r.top) * m.height) / r.height));
      }
    : undefined;
  return (
    <svg
      class={onPick ? `${cls} map--pick` : cls}
      viewBox={`0 0 ${m.width} ${m.height}`}
      width={m.width}
      height={m.height}
      role="img"
      aria-label={label}
      onClick={pick}
    >
      {m.parks.map((d, i) => (
        <path key={`p${i}`} class="m-park" d={d} />
      ))}
      {m.roads.map((d, i) => (
        <path key={`r${i}`} class="m-road" d={d} />
      ))}
      <path class="m-sea" d={m.sea} />
      {m.rings.map((r) => (
        <circle key={r.r} class="m-ring" cx={r.x.toFixed(1)} cy={r.y.toFixed(1)} r={r.r.toFixed(1)} />
      ))}
      {m.dots.map((d) => {
        const dot = (
          <circle
            class={`m-dot${d.focus ? " m-dot--on" : ""}${d.favourite ? " m-dot--fav" : ""}${d.edge ? " m-dot--edge" : ""}`}
            cx={d.x.toFixed(1)}
            cy={d.y.toFixed(1)}
            r={d.focus ? 5 : 3.5}
          />
        );
        // The list beside every map has the same links, so these stay out of the tab order and the accessibility tree.
        return link ? (
          <a key={d.id} href={`/cinema/${d.id}/`} tabIndex={-1} aria-hidden="true">
            <circle class="m-hit" cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r={12} />
            {dot}
          </a>
        ) : (
          <g key={d.id}>{dot}</g>
        );
      })}
      {m.home && <circle class="m-home" cx={m.home.x.toFixed(1)} cy={m.home.y.toFixed(1)} r={5.5} />}
      {m.labels.map((l, i) => (
        <text key={i} class={LABEL_CLASS[l.kind]} x={l.x.toFixed(1)} y={l.y.toFixed(1)}>
          {l.text}
        </text>
      ))}
    </svg>
  );
}
