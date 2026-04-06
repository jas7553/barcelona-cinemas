interface Props {
  searchQuery: string;
  onSearch: (q: string) => void;
}

export default function Header({ searchQuery, onSearch }: Props) {
  return (
    <header className="header">
      <a className="logo" href="/">
        <span className="logo-bcn">BCN</span>
        <span className="logo-cinemas">cinemas</span>
      </a>

      <div className="search-wrap">
        <label className="search-label" htmlFor="search-input">Search films</label>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
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
    </header>
  );
}
