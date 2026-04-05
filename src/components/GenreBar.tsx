interface Props {
  genres: string[];
  selectedGenre: string;
  onSelect: (g: string) => void;
}

export default function GenreBar({ genres, selectedGenre, onSelect }: Props) {
  return (
    <div className="genre-bar" role="group" aria-label="Filter by genre">
      <button
        className={`genre-pill${selectedGenre === "all" ? " genre-pill--active" : ""}`}
        onClick={() => onSelect("all")}
        aria-pressed={selectedGenre === "all"}
      >
        All
      </button>
      {genres.map((g) => (
        <button
          key={g}
          className={`genre-pill${selectedGenre === g ? " genre-pill--active" : ""}`}
          onClick={() => onSelect(g)}
          aria-pressed={selectedGenre === g}
        >
          {g}
        </button>
      ))}
    </div>
  );
}
