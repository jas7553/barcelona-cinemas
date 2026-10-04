interface Props {
  w: number;
  h: number;
  id: string | number;
}

export default function BackdropPlaceholder({ w, h, id }: Props) {
  const pid = `bp-${id}`;
  const hues = ["#b8c4d4", "#c8b8c4", "#c4d4c8", "#d4c8b0", "#c0c8d0"];
  const idx = typeof id === "number" ? id : id.charCodeAt(0);
  const c = hues[idx % hues.length];
  const c2 = hues[(idx + 3) % hues.length];

  return (
    <svg
      viewBox={`0 0 ${w || 430} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      className="backdrop-placeholder-svg"
    >
      <defs>
        <pattern id={pid} patternUnits="userSpaceOnUse" width="20" height="20" patternTransform="rotate(20)">
          <rect width="20" height="20" fill={c} />
          <rect width="10" height="20" fill={c2} />
        </pattern>
      </defs>
      <rect width={w || 430} height={h} fill={`url(#${pid})`} />
    </svg>
  );
}
