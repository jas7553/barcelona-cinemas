import type { FilmDiscovery } from "../types";

interface Props {
  film: FilmDiscovery;
}

export default function FilmBadge({ film }: Props) {
  if (film.isLastChance) {
    return <span className="film-badge film-badge--lastchance">Last chance</span>;
  }
  if (film.isLimitedRun) {
    return <span className="film-badge film-badge--limited">Limited</span>;
  }
  if (film.isNewRelease) {
    return <span className="film-badge film-badge--new">New</span>;
  }
  return null;
}
