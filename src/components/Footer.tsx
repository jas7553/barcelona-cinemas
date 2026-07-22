/** Minimal site footer shared across all pages. Contains the only in-page
 * link to /privacy so both users and search crawlers can reach it. */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <a href="/privacy" className="site-footer__link">Privacy</a>
    </footer>
  );
}
