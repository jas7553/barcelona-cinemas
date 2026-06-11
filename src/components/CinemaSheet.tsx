import { useEffect, useRef } from "react";
import type { SheetVenueData } from "../types";

interface Props {
  venue: SheetVenueData | null;
  onClose: () => void;
}

export default function CinemaSheet({ venue, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (venue) {
      el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [venue]);

  const directionsUrl =
    venue?.lat != null && venue.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`
      : venue?.mapsUrl;

  return (
    <dialog
      ref={dialogRef}
      className="cinema-dialog"
      aria-labelledby="cinema-dialog-name"
      onClose={onClose}
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="cinema-dialog__inner" onClick={(e) => e.stopPropagation()}>
        <div className="cinema-dialog__header">
          <div>
            <div className="sheet-cinema-name" id="cinema-dialog-name">{venue?.name}</div>
            {venue?.address && (
              <div className="sheet-cinema-address">{venue.address}</div>
            )}
            <div className="sheet-cinema-meta">
              {[venue?.neighborhood, venue?.distLabel ? `${venue.distLabel} away` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <button className="cinema-dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sheet-ctas">
          {directionsUrl ? (
            <a href={directionsUrl} target="_blank" rel="noreferrer" className="sheet-cta-primary">
              Get Directions
            </a>
          ) : (
            <button className="sheet-cta-primary" onClick={onClose}>
              Close
            </button>
          )}
          {venue?.websiteUrl && (
            <a href={venue.websiteUrl} target="_blank" rel="noreferrer" className="sheet-cta-secondary">
              Cinema Website ↗
            </a>
          )}
        </div>
      </div>
    </dialog>
  );
}
