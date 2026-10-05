import type { ComponentChildren } from "preact";

// One stroke style for the whole set (guidelines §4: stroke 1.75, round caps).
function Icon({ children }: { children: ComponentChildren }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconHome() {
  return (
    <Icon>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9v10h12V9" />
    </Icon>
  );
}

/** Ratings and favourite cinemas. Filled, so it reads at meta-line size. */
export function IconStar() {
  return (
    <Icon>
      <path
        d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
        fill="currentColor"
      />
    </Icon>
  );
}

/** Ends every link that leaves the site (guidelines §7). */
export function IconExternal() {
  return (
    <Icon>
      <path d="M8 16 16 8" />
      <path d="M9 8h7v7" />
    </Icon>
  );
}
