import type { ComponentChildren } from "preact";

/** Seen films, collapsed at the end of a list: out of the way, never hidden outright. */
export function SeenGroup({ count, children }: { count: number; children: ComponentChildren }) {
  if (count === 0) return null;
  return (
    <details class="seen">
      <summary class="label">Seen ({count})</summary>
      <ul class="films">{children}</ul>
    </details>
  );
}
