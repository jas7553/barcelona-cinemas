import { smallPoster } from "../domain/format";
import type { ListFilm } from "../pageData";

interface Props {
  film: Pick<ListFilm, "title" | "poster_url">;
  eager?: boolean;
}

/** A small list/ticket poster, or the title on a wash when there's no art. Decorative: the title is always beside it. */
export function Poster({ film, eager }: Props) {
  if (!film.poster_url) {
    return (
      <div class="poster poster--none" aria-hidden="true">
        <span>{film.title}</span>
      </div>
    );
  }
  return (
    <img
      class="poster"
      src={smallPoster(film.poster_url)}
      alt=""
      width={56}
      height={84}
      loading={eager ? undefined : "lazy"}
      decoding="async"
    />
  );
}
