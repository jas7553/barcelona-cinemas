import { Link } from "react-router-dom";
import { BrowseIcon, SearchIcon } from "./Icons";

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
