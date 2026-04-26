function BrowseIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SearchIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

interface Props {
  active: "list" | "search";
  onNavigate: (screen: "list" | "search") => void;
}

export default function BottomNav({ active, onNavigate }: Props) {
  const tabs = [
    { id: "list" as const, label: "Browse", Icon: BrowseIcon },
    { id: "search" as const, label: "Search", Icon: SearchIcon },
  ];

  return (
    <nav className="bottom-nav">
      {tabs.map(({ id, label, Icon }) => {
        const isActive = active === id;
        const color = isActive ? "var(--accent)" : "var(--text-mute)";
        return (
          <button
            key={id}
            className={`bottom-nav__tab${isActive ? " bottom-nav__tab--active" : ""}`}
            onClick={() => onNavigate(id)}
            aria-label={label}
          >
            <Icon color={color} />
            <span className="bottom-nav__tab-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
