import type { CinemaRegistry } from "../types";

interface Props {
  cinemas: CinemaRegistry;
  active: string;
  onSelect: (neighborhood: string) => void;
}

export function ChipNav({ cinemas, active, onSelect }: Props) {
  const neighborhoods = [
    ...new Set(Object.values(cinemas).map((c) => c.neighborhood)),
  ].sort();
  const chips = ["All", ...neighborhoods];

  return (
    <nav className="chips" id="chips">
      {chips.map((name) => (
        <button
          key={name}
          className={`chip${name === active ? " active" : ""}`}
          onClick={() => onSelect(name)}
        >
          {name}
        </button>
      ))}
    </nav>
  );
}
