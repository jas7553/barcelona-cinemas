export type SortBy = "rating" | "title" | "soonest" | "screenings";

interface SortOption {
  value: string;
  label: string;
}

const DEFAULT_OPTIONS: SortOption[] = [
  { value: "rating", label: "Rating" },
  { value: "title", label: "Title A–Z" },
  { value: "soonest", label: "Soonest showtime" },
  { value: "screenings", label: "Most screenings" },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  options?: SortOption[];
}

export default function SortControl({ value, onChange, options }: Props) {
  const opts = options ?? DEFAULT_OPTIONS;
  return (
    <div className="sort-control-wrap">
      <label className="sort-control-label" htmlFor="sort-select">Sort:</label>
      <select
        id="sort-select"
        className="sort-control"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
