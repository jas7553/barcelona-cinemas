import type { ComponentChildren } from "preact";
import { IconHome } from "./Icons";

interface Props {
  /** Highlights the Cinemas pill on cinema pages. */
  section?: "cinemas";
  onHome: () => void;
  children?: ComponentChildren;
}

export function Header({ section, onHome, children }: Props) {
  return (
    <header class="wrap">
      <nav class="bar" aria-label="Site">
        <a class="brand" href="/">
          Barcelona This Week
        </a>
        {/* PREFS_SCRIPT sets has-home before paint; CSS picks the label. */}
        <button type="button" class="pill pill--home" aria-haspopup="dialog" onClick={onHome}>
          <IconHome />
          <span class="if-home">Home</span>
          <span class="if-no-home">Set home</span>
        </button>
        <a
          class={section === "cinemas" ? "pill pill--on" : "pill"}
          href="/cinemas/"
          aria-current={section === "cinemas" ? "page" : undefined}
        >
          Cinemas
        </a>
      </nav>
      {children}
    </header>
  );
}
