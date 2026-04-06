import TmdbAttribution from "./TmdbAttribution";

interface Props {
  hiddenCount: number;
  onClearHidden: () => void;
}

export default function Footer({ hiddenCount, onClearHidden }: Props) {
  return (
    <footer className="site-footer">
      <TmdbAttribution />
      <p className="footer-disclaimer">BCNcinemas is not affiliated with any cinema chain.</p>
      {hiddenCount > 0 && (
        <button className="show-hidden-btn" onClick={onClearHidden}>
          Show {hiddenCount} hidden {hiddenCount === 1 ? "film" : "films"}
        </button>
      )}
    </footer>
  );
}
