interface Props {
  w: number;
  h: number;
  id: string | number;
}

export default function PosterPlaceholder({ w, h, id }: Props) {
  const pid = `pp-${id}`;
  const hues = ["#d4c8b8", "#c8d0c4", "#c4c8d4", "#d4c8c0", "#ccd0c8"];
  const idx = typeof id === "number" ? id : id.charCodeAt(0);
  const c = hues[idx % hues.length];
  const c2 = hues[(idx + 2) % hues.length];
  const sh = 8;
  const sr = 3;

  const sprocketHoles = (x: number) => {
    const holes: React.ReactElement[] = [];
    for (let y = 12; y < h - 6; y += 14) {
      holes.push(<circle key={y} cx={x} cy={y} r={sr} fill="rgba(0,0,0,0.18)" />);
    }
    return holes;
  };

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="xMidYMid slice" className="poster-placeholder-svg">
      <defs>
        <pattern id={pid} patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(35)">
          <rect width="12" height="12" fill={c} />
          <rect width="6" height="12" fill={c2} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${pid})`} />
      <rect x="0" y="0" width={sh} height={h} fill="rgba(0,0,0,0.12)" />
      <rect x={w - sh} y="0" width={sh} height={h} fill="rgba(0,0,0,0.12)" />
      {sprocketHoles(sh / 2)}
      {sprocketHoles(w - sh / 2)}
    </svg>
  );
}
