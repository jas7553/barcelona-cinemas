import { formatDataAge } from "../domain/time";

export function Footer({ generatedAt, now }: { generatedAt: string; now: Date }) {
  return (
    <footer class="wrap foot">
      {formatDataAge(generatedAt, now)} · VO screenings only · Data from{" "}
      <a href="https://www.themoviedb.org/">TMDb</a> · <a href="/privacy/">Privacy</a>
    </footer>
  );
}
