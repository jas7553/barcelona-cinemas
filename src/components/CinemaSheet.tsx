import { useEffect, useRef } from "react";
import { useTheme } from "../context/ThemeContext";
import type { SheetVenueData } from "../types";

interface Props {
  venue: SheetVenueData | null;
  onClose: () => void;
}

export default function CinemaSheet({ venue, onClose }: Props) {
  const { dark } = useTheme();
  const visible = !!venue;
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (visible) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      const firstFocusable = sheetRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    } else {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
  }, [visible]);

  return (
    <>
      <div
        className={`sheet-scrim${visible ? " sheet-scrim--visible" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={`cinema-sheet${visible ? " cinema-sheet--visible" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!visible}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      >
        <div className="sheet-handle-row">
          <div className="sheet-handle" />
        </div>

        <div className="sheet-header">
          <div className="sheet-cinema-name">{venue?.name}</div>
          {venue?.neighborhood && (
            <div className="sheet-cinema-address">{venue.neighborhood}</div>
          )}
          {venue?.distLabel && (
            <div className="sheet-cinema-dist">{venue.distLabel} away</div>
          )}
        </div>

        {/* Map placeholder */}
        <div className="sheet-map">
          <svg width="100%" height="130" style={{ display: "block" }}>
            <defs>
              <pattern id="sheet-mapgrid" width="28" height="28" patternUnits="userSpaceOnUse">
                <rect width="28" height="28" fill={dark ? "#2a2820" : "#e8e4dc"} />
                <rect width="14" height="28" fill={dark ? "#242218" : "#ddd8ce"} />
                <rect x="6" y="10" width="16" height="8" rx="2" fill={dark ? "#3a3828" : "#ccc8be"} />
                <rect x="2" y="14" width="10" height="6" rx="1" fill={dark ? "#3a3828" : "#ccc8be"} />
              </pattern>
            </defs>
            <rect width="100%" height="130" fill="url(#sheet-mapgrid)" />
            <rect x="0" y="58" width="100%" height="14" fill={dark ? "#1e1c18" : "#f0ece4"} opacity="0.8" />
            <rect x="45%" y="0" width="14" height="130" fill={dark ? "#1e1c18" : "#f0ece4"} opacity="0.8" />
            <circle cx="50%" cy="65" r="10" fill="var(--accent)" />
            <circle cx="50%" cy="65" r="4" fill="#fff" />
          </svg>
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              background: dark ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.9)",
              borderRadius: 6,
              padding: "3px 8px",
              fontSize: 11,
              color: "var(--text-sub)",
              backdropFilter: "blur(6px)",
            }}
          >
            Map placeholder
          </div>
        </div>

        <div className="sheet-ctas">
          {venue?.mapsUrl ? (
            <>
              <a href={venue.mapsUrl} target="_blank" rel="noreferrer" className="sheet-cta-primary">
                Get Directions
              </a>
              <a href={venue.mapsUrl} target="_blank" rel="noreferrer" className="sheet-cta-secondary">
                Open in Google Maps ↗
              </a>
            </>
          ) : (
            <button className="sheet-cta-primary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </>
  );
}
