import { formatInstant } from "../domain/time";

export function Footer({ generatedAt }: { generatedAt: string }) {
  return (
    <footer class="wrap foot">
      Updated <time datetime={new Date(generatedAt).toISOString()}>{formatInstant(generatedAt)}</time> · VO screenings only · Data from{" "}
      <a href="https://www.themoviedb.org/">TMDb</a> · <a href="/privacy/">Privacy</a>
    </footer>
  );
}
