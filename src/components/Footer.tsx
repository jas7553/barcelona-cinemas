import TmdbAttribution from "./TmdbAttribution";

export default function Footer() {
  return (
    <footer className="site-footer">
      <TmdbAttribution />
      <p className="footer-disclaimer">BCNcinemas is not affiliated with any cinema chain.</p>
    </footer>
  );
}
