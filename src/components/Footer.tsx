import type { ReactNode } from "react";

/** Minimal site footer shared across all pages. Contains the only in-page
 * link to /privacy so both users and search crawlers can reach it. Pages with
 * no header freshness note (the film detail) pass the data-age indicator as
 * `age` so it still reaches the reader. */
export default function SiteFooter({ age }: { age?: ReactNode }) {
  return (
    <footer className="site-footer">
      {age && <div className="site-footer__age">{age}</div>}
      <a href="/privacy" className="site-footer__link">Privacy</a>
    </footer>
  );
}
