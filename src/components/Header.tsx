interface LocationPinProps {
  active: boolean;
  error: boolean;
  onToggle: () => void;
}

interface LastChanceProps {
  active: boolean;
  onToggle: () => void;
}

interface Props {
  searchQuery: string;
  onSearch: (q: string) => void;
  locationPin: LocationPinProps;
  lastChance: LastChanceProps;
}

export default function Header({ searchQuery, onSearch, locationPin, lastChance }: Props) {
  return (
    <header className="header">
      <div className="header-inner">
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

      <button
        type="button"
        className={`last-chance-toggle${lastChance.active ? " is-active" : ""}`}
        onClick={lastChance.onToggle}
        aria-label={lastChance.active ? "Disable last chance grouping" : "Group last chance films first"}
        title={lastChance.active ? "Last chance: on" : "Last chance: off"}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 4v4l2.5 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {locationPin.error ? (
        <span className="location-pin-error" aria-live="polite">Location unavailable</span>
      ) : (
        <button
          type="button"
          className={`location-pin${locationPin.active ? " is-active" : ""}`}
          onClick={locationPin.onToggle}
          aria-label={locationPin.active ? "Disable distance sorting" : "Enable distance sorting"}
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 1a5 5 0 0 0-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 0 0-5-5zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />
          </svg>
        </button>
      )}
      </div>
    </header>
  );
}
