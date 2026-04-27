import { Link } from "react-router-dom";

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
}

export default function BottomNav({ active }: Props) {
  const tabs = [
    { id: "list" as const, label: "Browse", Icon: BrowseIcon, to: "/" },
    { id: "search" as const, label: "Search", Icon: SearchIcon, to: "/search" },
  ];

  return (
    <nav className="bottom-nav">
      {tabs.map(({ id, label, Icon, to }) => {
        const isActive = active === id;
        const color = isActive ? "var(--accent)" : "var(--text-mute)";
        return (
          <Link
            key={id}
            to={to}
            className={`bottom-nav__tab${isActive ? " bottom-nav__tab--active" : ""}`}
            aria-label={label}
          >
            <Icon color={color} />
            <span className="bottom-nav__tab-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
