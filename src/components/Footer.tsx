import type { ReactNode } from "react";

/** Minimal site footer shared across all pages. Contains the only in-page
 * link to /privacy so both users and search crawlers can reach it. Pages with
 * no header freshness note (the film detail) pass the data-age indicator as
 * `age` so it still reaches the reader. Also carries the TMDB attribution
 * block (logo + disclaimer) required by the TMDB API terms of use. */
export default function SiteFooter({ age }: { age?: ReactNode }) {
  return (
    <footer className="site-footer">
      {age && <div className="site-footer__age">{age}</div>}
      <div className="site-footer__attr">
        <a
          href="https://www.themoviedb.org/"
          target="_blank"
          rel="noreferrer"
          className="site-footer__attr-link"
          aria-label="The Movie Database"
        >
          {/* Name is on the link, so the logo is decorative — otherwise the
              link announces "TMDB TMDB". */}
          <img
            src="/tmdb-logo.svg"
            alt=""
            width={56}
            height={8}
            className="site-footer__attr-logo"
          />
        </a>
        <span className="site-footer__attr-text">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </span>
      </div>
      <a href="/privacy" className="site-footer__link">Privacy</a>
    </footer>
  );
}
