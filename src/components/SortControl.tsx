export type SortBy = "rating" | "title" | "soonest" | "screenings";

interface Props {
  value: SortBy;
  onChange: (v: SortBy) => void;
}

export default function SortControl({ value, onChange }: Props) {
  return (
    <div className="sort-control-wrap">
      <label className="sort-control-label" htmlFor="sort-select">Sort:</label>
      <select
        id="sort-select"
        className="sort-control"
        value={value}
        onChange={(e) => onChange(e.target.value as SortBy)}
      >
        <option value="rating">Rating</option>
        <option value="title">Title A–Z</option>
        <option value="soonest">Soonest showtime</option>
        <option value="screenings">Most screenings</option>
      </select>
    </div>
  );
}
