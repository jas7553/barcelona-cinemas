export default function TmdbAttribution() {
  return (
    <section className="tmdb-attribution" aria-label="TMDb attribution">
      <a
        className="tmdb-attribution-logo-link"
        href="https://www.themoviedb.org/"
        target="_blank"
        rel="noreferrer"
        aria-label="Visit TMDb (opens in a new tab)"
      >
        <img
          className="tmdb-attribution-logo"
          src="/tmdb-logo.svg"
          alt="TMDb"
          loading="lazy"
        />
      </a>

      <div className="tmdb-attribution-copy">
        <p className="tmdb-attribution-source">
          Poster images and movie metadata are provided by{" "}
          <a
            className="tmdb-attribution-link"
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noreferrer"
          >
            TMDb
          </a>
          .
        </p>
        <p className="tmdb-attribution-disclaimer">
          This website uses TMDB and the TMDB APIs but is not endorsed, certified, or
          otherwise approved by TMDB.
        </p>
      </div>
    </section>
  );
}
