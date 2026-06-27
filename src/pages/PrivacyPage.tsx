import { MoonIcon, SunIcon } from "../components/Icons";
import SiteFooter from "../components/Footer";
import { ThemeProvider, useTheme } from "../context/ThemeContext";

/** Absolute date this policy was last updated. A constant (not new Date()) so
 * SSG and hydration agree — matches the time-relative split rule in CLAUDE.md. */
const EFFECTIVE_DATE = "2026-06-27";

/**
 * Document root for `/privacy`. Purely static prose — no listings data, no
 * clock, no URL params. Wraps in ThemeProvider for dark-mode parity with the
 * rest of the site; all localStorage reads happen post-hydration in ThemeContext.
 */
export default function PrivacyPage() {
  return (
    <ThemeProvider>
      <div className="app-wrapper">
        <div className="app-shell">
          <main className="screen">
            <PrivacyContent />
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}

function PrivacyContent() {
  const { dark, toggle } = useTheme();

  return (
    <>
      <div className="main-header">
        <div className="header-top">
          <a href="/" className="privacy-back-link" aria-label="Back to Barcelona This Week">
            ← Barcelona This Week
          </a>
          <div className="header-actions">
            <button className="icon-btn" onClick={toggle} aria-label="Toggle dark mode">
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </div>

      <div className="privacy-content">
        <h1 className="privacy-heading">Privacy</h1>

        <p className="privacy-intro">
          Barcelona This Week is a free, non-commercial hobby project. It was built to collect
          as little information as possible — ideally none.
        </p>

        <section className="privacy-section" aria-labelledby="section-no-tracking">
          <h2 className="privacy-section-title" id="section-no-tracking">What this site does not do</h2>
          <div className="privacy-section-body">
            <ul>
              <li>No cookies — the server never sends a <code>Set-Cookie</code> header.</li>
              <li>No analytics or tracking scripts of any kind.</li>
              <li>No advertising or third-party ad networks.</li>
              <li>No user accounts or sign-in.</li>
              <li>No server that receives your activity — the site is entirely static files
                served from a CDN. There is no application server logging requests.</li>
            </ul>
          </div>
        </section>

        <section className="privacy-section" aria-labelledby="section-browser-storage">
          <h2 className="privacy-section-title" id="section-browser-storage">Stored only in your browser</h2>
          <div className="privacy-section-body">
            <p>
              Three small items are stored locally in your browser for purely functional
              purposes. None of them are ever transmitted to any server.
            </p>
            <ul>
              <li>
                <code>btw-dark</code> (localStorage) — your dark/light mode preference.
                Set when you tap the theme toggle; read on the next visit to restore your
                choice before first paint.
              </li>
              <li>
                <code>location_active</code> (localStorage) — a yes/no flag recording
                whether you enabled "sort by distance." Only the flag is stored, never
                your coordinates (see Location below).
              </li>
              <li>
                <code>btw-warmed</code> (sessionStorage) — a one-time flag that controls
                a brief opening animation. It clears automatically when you close the tab.
              </li>
            </ul>
            <p>
              You can remove all of these at any time by clearing site data in your
              browser settings (Settings → Safari → Advanced → Website Data, or
              equivalent in your browser).
            </p>
          </div>
        </section>

        <section className="privacy-section" aria-labelledby="section-location">
          <h2 className="privacy-section-title" id="section-location">Location</h2>
          <div className="privacy-section-body">
            <p>
              The "sort by distance" feature asks your browser for your location via the
              standard Geolocation API. Your browser will show a permission prompt before
              anything happens.
            </p>
            <p>
              If you grant permission, your coordinates are used entirely within your
              browser to sort the cinema list by distance. They are never sent to any
              server, never stored in any database, and never written to local storage.
              Only the yes/no flag (<code>location_active</code>) is kept locally, so
              the site can remember your preference between visits.
            </p>
            <p>
              There is no <code>fetch</code>, <code>XMLHttpRequest</code>, or
              beacon anywhere in the client code — no data leaves your device.
            </p>
          </div>
        </section>

        <section className="privacy-section" aria-labelledby="section-third-party">
          <h2 className="privacy-section-title" id="section-third-party">Other sites your browser contacts</h2>
          <div className="privacy-section-body">
            <p>
              Some content on this site is loaded from third-party servers. When your
              browser fetches that content, the third party can see your IP address and
              the referring page URL. Their own privacy policies apply.
            </p>
            <ul>
              <li>
                <strong>Poster and backdrop images</strong> are served from{" "}
                <code>image.tmdb.org</code> (The Movie Database). TMDb receives your
                IP address and referer header when images load; no cookies are involved
                from this site's side.
              </li>
              <li>
                <strong>External links</strong> — to cinema websites, ticket-booking
                pages (e.g. admit-one.eu), and YouTube trailers — take you to third-party
                sites with their own terms and privacy policies.
              </li>
            </ul>
          </div>
        </section>

        <section className="privacy-section" aria-labelledby="section-hosting">
          <h2 className="privacy-section-title" id="section-hosting">Hosting and search</h2>
          <div className="privacy-section-body">
            <p>
              The site is hosted as static files on Amazon S3, served via AWS CloudFront.
              CloudFront access logging is disabled, so no IP addresses or request logs
              are stored at the infrastructure level.
            </p>
            <p>
              The site is listed in Google Search Console so that Google can index it.
              This involves only an inert verification meta tag in the page
              source — no scripts, no tracking, and no data is sent to Google from
              your browser as a result of visiting this site.
            </p>
          </div>
        </section>

        <p className="privacy-effective">Effective: {EFFECTIVE_DATE}</p>
      </div>

      <SiteFooter />
    </>
  );
}
