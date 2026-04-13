interface Props {
  noListings?: boolean;
}

function ProjectorIcon() {
  return (
    <svg
      className="empty-icon"
      viewBox="0 0 52 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Projector body */}
      <rect x="8" y="16" width="28" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
      {/* Lens circle */}
      <circle cx="22" cy="25" r="6" stroke="currentColor" strokeWidth="2" />
      {/* Lens inner */}
      <circle cx="22" cy="25" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      {/* Reel on top right of body */}
      <circle cx="32" cy="19" r="3" stroke="currentColor" strokeWidth="1.5" />
      {/* Projector stand/leg */}
      <line x1="22" y1="34" x2="22" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="16" y1="40" x2="28" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Beam (triangle pointing right) */}
      <path d="M36 21 L47 14 L47 36 L36 29 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity="0.5" />
      {/* "?" in beam */}
      <text x="41" y="28" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" opacity="0.7" fontFamily="sans-serif">?</text>
    </svg>
  );
}

export default function EmptyState({ noListings = false }: Props) {
  return (
    <div className="empty-state">
      <ProjectorIcon />
      <p className="empty-text">
        {noListings ? "No listings yet — check back soon." : "No movies match your filters."}
      </p>
    </div>
  );
}
