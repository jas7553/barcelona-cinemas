interface Props {
  searchQuery: string;
  onSearch: (q: string) => void;
  filmCount: number;
  filterPanelOpen: boolean;
  onToggleFilter: () => void;
  activeFilterCount: number;
}

export default function Header({
  searchQuery,
  onSearch,
  filmCount,
  filterPanelOpen,
  onToggleFilter,
  activeFilterCount,
}: Props) {
  return (
    <header className="header">
      <a className="logo" href="/">
        <span className="logo-bcn">BCN</span>
        <span className="logo-cinemas">cinemas</span>
      </a>

      <div className="search-wrap">
        <label className="search-label" htmlFor="search-input">Search films</label>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="6.5" cy="6.5" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        <input
          id="search-input"
          type="search"
          className="search-input"
          placeholder="Search films…"
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          autoComplete="off"
        />
      </div>

      <span className="film-count">
        {filmCount} {filmCount === 1 ? "film" : "films"}
      </span>

      <nav className="header-nav">
        <button className="nav-tab" disabled aria-label="Discover (coming soon)">
          Discover
        </button>
        <button className="nav-tab nav-tab--active" aria-current="page">
          Showtimes
        </button>
      </nav>

      <button
        className={`filter-toggle${activeFilterCount > 0 ? " has-active" : ""}`}
        onClick={onToggleFilter}
        aria-controls="mobile-filter-panel"
        aria-expanded={filterPanelOpen}
        aria-label="Toggle filters"
      >
        Filters
        {activeFilterCount > 0 && (
          <span className="filter-badge">{activeFilterCount}</span>
        )}
      </button>
    </header>
  );
}
