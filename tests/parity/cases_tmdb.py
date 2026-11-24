"""
Inline recording sets for TMDb enrichment: the search/detail/videos/credits
pages the enricher is served, the movies it is given, and the ranking rules.

The clock is frozen at 2026-10-20 10:00 Madrid (08:00 UTC). The Python tests
write release dates relative to the real clock ("30 days ago"); here they are
the equivalent absolute dates.
"""

from __future__ import annotations

from typing import Any

from tests.parity.common import request_url
from tests.parity.inline_cases import Case

NOW = "2026-10-20T10:00:00+02:00"
TODAY = "2026-10-20"
FRESH = "2026-10-20T07:00:00+00:00"  # inside the re-enrichment TTL at NOW
STALE = "2020-01-01T00:00:00+00:00"
MATCH_VERSION = 4  # enricher._MATCH_VERSION: the rules the cached matches below claim to come from

_TESTS = "tests/test_enricher.py"
_API = "https://api.themoviedb.org/3"
_COMMON = {"language": "en-US", "api_key": "stripped"}


def search_url(query: str, language: str = "en-US") -> str:
    return request_url(f"{_API}/search/movie", {**_COMMON, "query": query, "language": language})


def detail_url(movie_id: int) -> str:
    return request_url(f"{_API}/movie/{movie_id}", {**_COMMON, "append_to_response": "release_dates"})


def videos_url(movie_id: int) -> str:
    return request_url(f"{_API}/movie/{movie_id}/videos", _COMMON)


def credits_url(movie_id: int) -> str:
    return request_url(f"{_API}/movie/{movie_id}/credits", _COMMON)


def showtime(date: str = "2026-10-22", cinema: str = "Verdi", **fields: Any) -> dict[str, Any]:
    info = {"Verdi": ("Gràcia", "Carrer de Verdi, 32")}.get(cinema, ("", ""))
    return {"cinema": cinema, "neighborhood": info[0], "address": info[1], "date": date, "time": "18:00", **fields}


def movie(title: str, showtimes: list[dict[str, Any]] | None = None, **fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "title": title,
        "tmdb_id": None,
        "imdb_id": None,
        "year": None,
        "poster_url": None,
        "synopsis": None,
        "rating": None,
        "runtime_mins": None,
        "genres": None,
        "showtimes": showtimes if showtimes is not None else [showtime()],
    }
    return {**base, **fields}


def spanish_release(released: str) -> dict[str, Any]:
    return {
        "results": [{"iso_3166_1": "ES", "release_dates": [{"release_date": f"{released}T00:00:00.000Z", "type": 3}]}]
    }


def film_detail(movie_id: int, **fields: Any) -> dict[str, Any]:
    return {
        "id": movie_id,
        "imdb_id": "tt15239678",
        "title": "Dune: Part Two",
        "poster_path": "/poster.jpg",
        "backdrop_path": "/backdrop.jpg",
        "overview": "A hero's journey continues.",
        "tagline": "Long live the fighters.",
        "vote_average": 8.5,
        "vote_count": 12345,
        "runtime": 166,
        "genres": [{"id": 878, "name": "Science Fiction"}, {"id": 12, "name": "Adventure"}],
        "original_language": "en",
        "release_date": "2024-02-27",
        **fields,
    }


NO_VIDEOS: dict[str, Any] = {"results": []}
CREDITS: dict[str, Any] = {
    "cast": [{"name": n, "order": i} for i, n in enumerate(["Timothée Chalamet", "Zendaya", "Rebecca Ferguson"])],
    "crew": [
        {"name": "Denis Villeneuve", "job": "Director"},
        {"name": "Hans Zimmer", "job": "Original Music Composer"},
    ],
}


def _case(name: str, description: str, source: list[str], movies: list[dict[str, Any]], **fields: Any) -> Case:
    return Case("tmdb", name, description, [f"{_TESTS}::{s}" for s in source], NOW, fields={"movies": movies, **fields})


def _with_extras(case: Case, movie_id: int, videos: Any = NO_VIDEOS, credits: Any = CREDITS) -> Case:
    case.payload(videos_url(movie_id), videos)
    return case.payload(credits_url(movie_id), credits)


def _simple_search(*results: dict[str, Any]) -> dict[str, Any]:
    return {"page": 1, "results": list(results)}


def _hit(movie_id: int, title: str, release: str | None = None, **fields: Any) -> dict[str, Any]:
    return {"id": movie_id, "title": title, **({"release_date": release} if release else {}), **fields}


def _cached(title: str, tmdb_id: int, **fields: Any) -> dict[str, Any]:
    return movie(title, [], tmdb_id=tmdb_id, enriched_at=FRESH, tmdb_match_version=MATCH_VERSION, **fields)


def _tmdb() -> list[Case]:
    full = _case(
        "new-title-full-metadata",
        "A new title: search, detail, videos (official YouTube trailer preferred over the first; a Vimeo one "
        "ignored) and credits (two directors joined, cast capped at five). English title and original language set.",
        [
            "test_fetches_tmdb_for_new_title",
            "test_fetches_director_and_cast_from_credits",
            "test_an_english_title_that_matches_is_searched_once",
        ],
        [movie("Dune: Part Two")],
    )
    full.payload(search_url("Dune: Part Two"), _simple_search(_hit(42, "Dune: Part Two", "2024-02-27")))
    full.payload(detail_url(42), film_detail(42))
    full.payload(
        videos_url(42),
        {
            "results": [
                {"site": "YouTube", "type": "Trailer", "official": False, "key": "unofficial1"},
                {"site": "Vimeo", "type": "Trailer", "official": True, "key": "vimeo1"},
                {"site": "YouTube", "type": "Teaser", "official": True, "key": "teaser1"},
                {"site": "YouTube", "type": "Trailer", "official": True, "key": "official1"},
            ]
        },
    )
    full.payload(
        credits_url(42),
        {
            "cast": [{"name": n} for n in ["A One", "B Two", "C Three", "D Four", "E Five", "F Six"]],
            "crew": [
                {"name": "Denis Villeneuve", "job": "Director"},
                {"name": "Second Director", "job": "Director"},
                {"name": "Denis Villeneuve", "job": "Director"},
                {"name": "Hans Zimmer", "job": "Original Music Composer"},
            ],
        },
    )

    credits_down = _case(
        "credits-failure-is-non-fatal",
        "The credits request answers 500: the film is still enriched, director and cast are null, no failure counted.",
        ["test_credits_fetch_failure_is_non_fatal"],
        [movie("Dune: Part Two")],
    )
    credits_down.payload(search_url("Dune: Part Two"), _simple_search(_hit(42, "Dune: Part Two", "2024-02-27")))
    credits_down.payload(detail_url(42), film_detail(42))
    credits_down.payload(videos_url(42), NO_VIDEOS)
    credits_down.payload(credits_url(42), {"status_message": "down"}, 500)

    search_down = _case(
        "search-failure-leaves-movie-bare",
        "The search answers 500: the movie is returned unmodified and counted as a lookup failure.",
        ["test_lookup_failure_returns_movie_without_metadata"],
        [movie("Unknown Film")],
    )
    search_down.payload(search_url("Unknown Film"), {"status_message": "down"}, 500)

    outage = _case(
        "stale-cache-and-tmdb-down-keeps-cached",
        "A stale cached match whose re-lookup fails keeps its cached metadata with the fresh showtimes.",
        ["test_reenrichment_failure_preserves_cached_metadata"],
        [movie("Dune: Part Two", [showtime("2026-10-23")])],
        cached=[
            movie(
                "Dune: Part Two",
                [showtime("2026-10-21")],
                tmdb_id=42,
                imdb_id="tt15239678",
                poster_url="https://image.tmdb.org/t/p/w342/poster.jpg",
                synopsis="Cached synopsis",
                rating=8.5,
                enriched_at=STALE,
            )
        ],
    )
    outage.payload(search_url("Dune: Part Two"), {"status_message": "down"}, 503)

    alien = _case(
        "exact-title-over-popularity",
        "TMDb's first result is a sequel; the exact title match further down wins.",
        ["test_exact_title_match_preferred_over_popularity"],
        [movie("Alien")],
    )
    alien.payload(
        search_url("Alien"), _simple_search(_hit(1, "Alien: Romulus", "2024-08-13"), _hit(2, "Alien", "1979-05-25"))
    )
    alien.payload(detail_url(2), film_detail(2, title="Alien", imdb_id="tt0078748", release_date="1979-05-25"))
    _with_extras(alien, 2)

    quoted = _case(
        "quoted-title-does-not-reuse-cache",
        "A cached 'Wuthering Heights' is not reused for the listing '\"Wuthering Heights\"'; the exact quoted title "
        "is looked up (edge quotes are stripped when comparing titles).",
        ["test_cache_reuse_does_not_cross_exact_title_variants"],
        [movie('"Wuthering Heights"', [showtime("2026-10-23")])],
        cached=[movie("Wuthering Heights", [], tmdb_id=25095, imdb_id="tt0104181", synopsis="Older adaptation")],
    )
    quoted.payload(
        search_url('"Wuthering Heights"'), _simple_search(_hit(1316092, '"Wuthering Heights"', "2026-02-13"))
    )
    quoted.payload(
        detail_url(1316092),
        {
            "id": 1316092,
            "imdb_id": "tt32897959",
            "poster_path": "/poster.jpg",
            "overview": "New adaptation",
            "vote_average": 6.4,
            "runtime": 136,
            "genres": [{"id": 18, "name": "Drama"}],
        },
    )
    _with_extras(quoted, 1316092)

    spanish = _case(
        "spanish-title-keeps-listed-title-sets-english-title",
        "A Spanish-titled listing: the English search finds the film under its English title, the es-ES search "
        "confirms the Spanish one. The listed title stays the cache key; the TMDb title becomes english_title.",
        ["test_scraper_title_preserved_as_cache_key_and_english_title_set"],
        [movie("Encuentros en la tercera fase")],
    )
    spanish.payload(
        search_url("Encuentros en la tercera fase"), _simple_search(_hit(42, "Close Encounters of the Third Kind"))
    )
    spanish.payload(
        search_url("Encuentros en la tercera fase", "es-ES"), _simple_search(_hit(42, "Encuentros en la tercera fase"))
    )
    spanish.payload(
        detail_url(42),
        film_detail(42, title="Close Encounters of the Third Kind", imdb_id="tt0075860", release_date="1977-11-16"),
    )
    _with_extras(spanish, 42)

    hit = _case(
        "fresh-cache-hit-makes-no-requests",
        "A fresh cached match is reused as is, with the new showtimes; nothing is requested and original_lang is not backfilled.",
        ["test_reuses_cached_metadata"],
        [movie("Dune: Part Two", [showtime("2026-10-23")])],
        cached=[
            _cached(
                "Dune: Part Two",
                42,
                imdb_id="tt15239678",
                poster_url="https://image.tmdb.org/t/p/w342/poster.jpg",
                synopsis="Old synopsis",
                rating=8.5,
            )
        ],
    )

    localized_hit = _case(
        "cache-hit-by-localized-listing-title",
        "The cache is keyed by the listed (Spanish) title, so a localized listing hits it after enrichment.",
        ["test_cache_hit_when_scraper_title_matches_cached_scraper_title"],
        [movie("Encuentros en la tercera fase", [showtime("2026-10-23")])],
        cached=[
            _cached(
                "Encuentros en la tercera fase",
                42,
                imdb_id="tt0075860",
                synopsis="A UFO story.",
                english_title="Close Encounters of the Third Kind",
            )
        ],
    )

    invalid = _case(
        "invalid-tmdb-fields-discarded",
        "A detail payload with malformed fields (bad imdb id, poster path, overview type, rating type, negative "
        "runtime, junk genres, no vote_count or original_language) degrades each to null.",
        [
            "test_invalid_tmdb_fields_are_safely_discarded",
            "test_vote_count_absent_when_tmdb_omits_it",
            "test_original_lang_absent_yields_none",
        ],
        [movie("Dune: Part Two")],
    )
    invalid.payload(search_url("Dune: Part Two"), _simple_search(_hit(42, "Dune: Part Two")))
    invalid.payload(
        detail_url(42),
        {
            "id": 42,
            "imdb_id": "not-an-imdb-id",
            "poster_path": "not-a-poster-path",
            "overview": ["not", "a", "string"],
            "vote_average": "8.5",
            "runtime": -10,
            "genres": [{"name": "Science Fiction"}, {"name": ""}, "bad-entry"],
        },
    )
    _with_extras(invalid, 42)

    sns_hits = [
        _hit(4584, "Sense and Sensibility", "1995-12-13"),
        _hit(1503762, "Sense and Sensibility", "2026-09-20"),
    ]
    current = _case(
        "current-release-over-older-namesake",
        "Two films share a title and the listing gives no year: the recent one is probed first and, being in its "
        "Spanish first run with a feature runtime, wins over the older film TMDb lists first.",
        ["test_enrich_matches_the_current_release_over_an_older_namesake"],
        [movie("Sense and Sensibility")],
    )
    current.payload(search_url("Sense and Sensibility"), _simple_search(*sns_hits))
    current.payload(
        detail_url(1503762),
        film_detail(
            1503762,
            imdb_id="tt13609648",
            title="Sense and Sensibility",
            runtime=132,
            release_date="2026-09-20",
            release_dates=spanish_release("2026-10-23"),
        ),
    )
    _with_extras(current, 1503762)

    classic = _case(
        "repertory-classic-over-namesake-never-released-in-spain",
        "A recent namesake with no Spanish release is probed first and passed over; the repertory classic is matched.",
        ["test_repertory_classic_beats_a_recent_namesake_never_released_in_spain"],
        [movie("Her")],
    )
    classic.payload(
        search_url("Her"), _simple_search(_hit(152601, "Her", "2013-12-18"), _hit(1380868, "Her", "2025-12-24"))
    )
    classic.payload(
        detail_url(1380868),
        film_detail(
            1380868,
            title="Her",
            release_date="2025-12-24",
            release_dates={"results": [{"iso_3166_1": "US", "release_dates": []}]},
        ),
    )
    classic.payload(
        detail_url(152601),
        film_detail(
            152601, title="Her", runtime=126, release_date="2013-12-18", release_dates=spanish_release("2014-03-07")
        ),
    )
    _with_extras(classic, 152601)

    dolly = _case(
        "new-film-without-spanish-release-keeps-tmdb-rank",
        "A new film with no Spanish release date on TMDb yet still matches by TMDb's rank.",
        ["test_a_new_film_missing_its_spanish_release_keeps_its_tmdb_rank"],
        [movie("Dolly")],
    )
    dolly.payload(
        search_url("Dolly"), _simple_search(_hit(1309083, "Dolly", "2026-04-03"), _hit(1069885, "Dolly", "2022-10-31"))
    )
    dolly.payload(
        detail_url(1309083),
        film_detail(1309083, title="Dolly", runtime=83, release_date="2026-04-03", release_dates={"results": []}),
    )
    _with_extras(dolly, 1309083)

    short = _case(
        "short-loses-same-title-tie-to-feature",
        "The first candidate is a 32-minute short; probing continues and the 89-minute feature wins.",
        ["test_a_short_loses_a_same_title_tie_to_the_feature"],
        [movie("Stranger Than Paradise")],
    )
    short.payload(
        search_url("Stranger Than Paradise"),
        _simple_search(
            _hit(410051, "Stranger Than Paradise", "1982-01-01"), _hit(469, "Stranger Than Paradise", "1984-09-01")
        ),
    )
    short.payload(
        detail_url(410051), film_detail(410051, title="Stranger Than Paradise", runtime=32, release_date="1982-01-01")
    )
    short.payload(
        detail_url(469), film_detail(469, title="Stranger Than Paradise", runtime=89, release_date="1984-09-01")
    )
    _with_extras(short, 469)

    lone_short = _case(
        "lone-short-still-matches",
        "A title whose only match is a 12-minute short still matches it.",
        ["test_a_lone_short_still_matches"],
        [movie("Short Film")],
    )
    lone_short.payload(search_url("Short Film"), _simple_search(_hit(5, "Short Film", "2020-01-01")))
    lone_short.payload(detail_url(5), film_detail(5, title="Short Film", runtime=12, release_date="2020-01-01"))
    _with_extras(lone_short, 5)

    older_rules = _case(
        "match-from-older-rules-is-looked-up-again",
        "A cached match with a fresh enriched_at but no tmdb_match_version (read as 1, older than the current "
        "rules) is looked up again.",
        ["test_a_match_from_older_rules_is_looked_up_again"],
        [movie("Sense and Sensibility", imdb_id="tt0114388")],
        cached=[
            movie(
                "Sense and Sensibility",
                [],
                tmdb_id=4584,
                imdb_id="tt0114388",
                enriched_at=FRESH,
                english_title="Sense and Sensibility",
            )
        ],
    )
    older_rules.payload(
        search_url("Sense and Sensibility"), _simple_search(_hit(42, "Sense and Sensibility", "1995-12-13"))
    )
    older_rules.payload(detail_url(42), film_detail(42, title="Sense and Sensibility", release_date="1995-12-13"))
    _with_extras(older_rules, 42)

    english_listing = _case(
        "english-title-listing-reuses-cached-film",
        "A provider listing the English title finds the film another provider listed under its Spanish title, "
        "through the cached english_title; no requests.",
        ["test_a_listing_under_the_english_title_reuses_the_cached_film"],
        [movie("Sense and Sensibility", imdb_id="tt0114388")],
        cached=[
            _cached("Sentido y sensibilidad", 1503762, imdb_id="tt13609648", english_title="Sense and Sensibility")
        ],
    )

    remade = _case(
        "remade-title-lands-on-one-film",
        "The Sense and Sensibility split. Four provider copies (one mis-tagged with the 1995 imdb_id, one Spanish "
        "title) collapse to three at collection, enrich to the 2026 film, and reconcile into one film with "
        "every showtime and the booking link.",
        ["test_every_provider_copy_of_a_remade_title_lands_on_one_film"],
        [
            movie(
                "Sense and Sensibility",
                [showtime("2026-10-22", "Balmes"), showtime("2026-10-23", "RenFlo", booking_url="https://pillalas")],
            ),
            movie("Sense and Sensibility", [showtime("2026-10-22", "Balmes")], imdb_id="tt0114388"),
            movie("Sense and Sensibility", [showtime("2026-10-23", "Balmes", time="16:00")], imdb_id="tt13609648"),
            movie(
                "Sentido y sensibilidad",
                [showtime("2026-10-22", "Balmes"), showtime("2026-10-23", "RenFlo", booking_url="https://pillalas")],
            ),
        ],
        reconcileFirst=True,
    )
    both = _simple_search(*sns_hits)
    remade.payload(search_url("Sense and Sensibility"), both)
    remade.payload(search_url("Sentido y sensibilidad"), _simple_search(*sns_hits[::-1]))
    remade.payload(search_url("Sentido y sensibilidad", "es-ES"), {"results": []})
    remade.payload(
        detail_url(1503762),
        film_detail(
            1503762,
            imdb_id="tt13609648",
            title="Sense and Sensibility",
            release_date="2026-09-20",
            release_dates=spanish_release("2026-10-23"),
        ),
    )
    remade.payload(
        detail_url(4584),
        film_detail(4584, imdb_id="tt0114388", title="Sense and Sensibility", release_date="1995-12-13"),
    )
    _with_extras(remade, 1503762)
    _with_extras(remade, 4584)

    reckoning = _case(
        "spanish-title-names-the-film-over-top-result",
        "SensaCine's 'El precio de la red': the English search puts 'Ida Red' first; the es-ES search names the "
        "film by its Spanish title, so the right film is probed.",
        ["test_a_spanish_title_picks_the_film_it_names_over_tmdbs_top_result"],
        [movie("El precio de la red")],
    )
    ida, social = {"id": 818192, "release_date": "2021-11-05"}, {"id": 1281331, "release_date": "2026-09-30"}
    reckoning.payload(
        search_url("El precio de la red"),
        _simple_search({**ida, "title": "Ida Red"}, {**social, "title": "The Social Reckoning"}),
    )
    reckoning.payload(
        search_url("El precio de la red", "es-ES"),
        _simple_search({**ida, "title": "Ida Red"}, {**social, "title": "El precio de la red"}),
    )
    reckoning.payload(
        detail_url(1281331),
        film_detail(1281331, title="The Social Reckoning", imdb_id="tt37510326", release_date="2026-09-30"),
    )
    _with_extras(reckoning, 1281331)

    clash = _case(
        "cached-namesake-clash-looked-up-again",
        "The 1995 film is cached; a preview of the 2026 film mis-tagged with its imdb_id hits that cache, while a "
        "Spanish-titled copy finds the 2026 film. Two films now share an English title, so the cache hit is looked up again.",
        ["test_a_cached_match_sharing_its_title_with_another_film_is_looked_up_again"],
        [
            movie("Sense and Sensibility", [showtime("2026-10-22")], imdb_id="tt0114388"),
            movie("Sentido y sensibilidad", [showtime("2026-10-23")], imdb_id="tt13609648"),
        ],
        cached=[_cached("Sense and Sensibility", 4584, imdb_id="tt0114388", english_title="Sense and Sensibility")],
    )
    clash.payload(search_url("Sense and Sensibility"), _simple_search(*sns_hits))
    clash.payload(search_url("Sentido y sensibilidad"), _simple_search(sns_hits[1]))
    clash.payload(search_url("Sentido y sensibilidad", "es-ES"), {"results": []})
    clash.payload(
        detail_url(1503762),
        film_detail(
            1503762,
            imdb_id="tt13609648",
            title="Sense and Sensibility",
            release_date="2026-09-20",
            release_dates=spanish_release("2026-10-23"),
        ),
    )
    _with_extras(clash, 1503762)

    unrelated = _case(
        "cached-matches-with-different-titles-left-alone",
        "Two cached films with different English titles are both cache hits; nothing is requested.",
        ["test_cached_matches_with_different_titles_are_left_alone"],
        [movie("Fargo"), movie("Rocky")],
        cached=[
            _cached("Fargo", 275, english_title="Fargo"),
            _cached("Rocky", 1366, english_title="Rocky"),
        ],
    )

    sospecha = _case(
        "repeat-lookup-goes-by-listed-title",
        "'Sospecha' was once guessed to be 'Sofia's Suspicion'. The repeat lookup searches the listed title (en "
        "then es-ES), finds Hitchcock's film, and never searches the earlier guess.",
        ["test_a_repeat_lookup_goes_by_the_listed_title_not_the_earlier_guess"],
        [movie("Sospecha")],
        cached=[
            movie(
                "Sospecha",
                [],
                tmdb_id=1520850,
                enriched_at=FRESH,
                tmdb_match_version=MATCH_VERSION - 1,
                english_title="Sofia's Suspicion",
            )
        ],
    )
    guess = {"id": 1520850, "release_date": "2025-03-01"}
    sospecha.payload(
        search_url("Sospecha"),
        _simple_search({**guess, "title": "Sofia's Suspicion"}, {"id": 11462, "title": "Suspicion"}),
    )
    sospecha.payload(
        search_url("Sospecha", "es-ES"),
        _simple_search({**guess, "title": "La sospecha de Sofía"}, {"id": 11462, "title": "Sospecha"}),
    )
    sospecha.payload(
        detail_url(11462), film_detail(11462, title="Suspicion", imdb_id="tt0034248", release_date="1941-11-14")
    )
    _with_extras(sospecha, 11462)

    listed = "Verity. La sombra de un engaño"
    verity = _case(
        "repeat-lookup-falls-back-to-known-english-title",
        "A listed title that names no film exactly, in English or Spanish, falls back to the English title the "
        "earlier match gave (searched third).",
        ["test_a_repeat_lookup_falls_back_to_the_known_english_title"],
        [movie(listed)],
        cached=[
            movie(
                listed,
                [],
                tmdb_id=1283515,
                enriched_at=FRESH,
                tmdb_match_version=MATCH_VERSION - 1,
                english_title="Verity",
            )
        ],
    )
    verity.payload(search_url(listed), _simple_search({"id": 7, "title": "Shadow of a Doubt"}))
    verity.payload(search_url(listed, "es-ES"), _simple_search({"id": 7, "title": "La sombra de una duda"}))
    verity.payload(
        search_url("Verity"), _simple_search({"id": 1283515, "title": "Verity", "release_date": "2026-10-01"})
    )
    verity.payload(
        detail_url(1283515), film_detail(1283515, title="Verity", imdb_id="tt1283515", release_date="2026-10-01")
    )
    _with_extras(verity, 1283515)

    with_year = _case(
        "provider-year-picks-that-film",
        "The movie carries year 1995: of two same-titled films the 1995 one is probed first and chosen, although "
        "the 2026 one is the recent release.",
        ["test_provider_year_picks_the_film_from_that_year"],
        [movie("Sense and Sensibility", year=1995)],
    )
    with_year.payload(search_url("Sense and Sensibility"), _simple_search(*sns_hits))
    with_year.payload(
        detail_url(4584),
        film_detail(4584, imdb_id="tt0114388", title="Sense and Sensibility", release_date="1995-12-13"),
    )
    _with_extras(with_year, 4584)

    tv_and_film = _case(
        "tv-movie-skipped-for-the-film",
        "A TV movie of the same title (genre 10770) is never a match; the theatrical film is.",
        ["test_tv_movies_never_match"],
        [movie("The Miracle Worker")],
    )
    tv_and_film.payload(
        search_url("The Miracle Worker"),
        _simple_search(
            _hit(1163, "The Miracle Worker", "2000-10-29", genre_ids=[18, 10770]),
            _hit(1162, "The Miracle Worker", "1962-05-23", genre_ids=[18]),
        ),
    )
    tv_and_film.payload(
        detail_url(1162), film_detail(1162, title="The Miracle Worker", imdb_id="tt0056241", release_date="1962-05-23")
    )
    _with_extras(tv_and_film, 1162)

    tv_only = _case(
        "tv-movie-only-is-no-match",
        "The only result is a TV movie: after the es-ES search finds nothing either, the movie is left unenriched.",
        ["test_tv_movies_never_match"],
        [movie("The Miracle Worker")],
    )
    tv_only.payload(
        search_url("The Miracle Worker"),
        _simple_search(_hit(1163, "The Miracle Worker", "2000-10-29", genre_ids=[18, 10770])),
    )
    tv_only.payload(
        search_url("The Miracle Worker", "es-ES"),
        _simple_search(_hit(1163, "El milagro de Anna Sullivan", "2000-10-29", genre_ids=[18, 10770])),
    )

    top_stands_in = _case(
        "no-exact-title-top-result-stands-in",
        "A Spanish listing whose title matches nothing exactly, in either language: TMDb's top result stands in.",
        ["test_without_an_exact_title_the_top_result_stands_in"],
        [movie("Sentido y sensibilidad")],
    )
    top_stands_in.payload(search_url("Sentido y sensibilidad"), _simple_search(sns_hits[1], sns_hits[0]))
    top_stands_in.payload(search_url("Sentido y sensibilidad", "es-ES"), _simple_search(sns_hits[1], sns_hits[0]))
    top_stands_in.payload(
        detail_url(1503762),
        film_detail(
            1503762,
            imdb_id="tt13609648",
            title="Sense and Sensibility",
            release_date="2026-09-20",
            release_dates=spanish_release("2026-10-23"),
        ),
    )
    _with_extras(top_stands_in, 1503762)

    preview = _case(
        "preview-inside-recency-window",
        "Of three same-titled films, the 1986 classic, an announced 2027 film and a preview 31 days out "
        "(2026-11-20, inside the 90-day window): only the preview is probed as a first-run candidate.",
        ["test_recency_window_admits_a_preview_but_not_an_announced_film"],
        [movie("Highlander")],
    )
    preview.payload(
        search_url("Highlander"),
        _simple_search(
            _hit(8009, "Highlander", "1986-03-07"),
            _hit(2, "Highlander", "2027-06-01"),
            _hit(3, "Highlander", "2026-11-20"),
        ),
    )
    preview.payload(
        detail_url(3),
        film_detail(
            3,
            title="Highlander",
            imdb_id="tt0000003",
            runtime=120,
            release_date="2026-11-20",
            release_dates=spanish_release("2026-11-20"),
        ),
    )
    _with_extras(preview, 3)
    return [
        full,
        credits_down,
        search_down,
        outage,
        alien,
        quoted,
        spanish,
        hit,
        localized_hit,
        invalid,
        current,
        classic,
        dolly,
        short,
        lone_short,
        older_rules,
        english_listing,
        remade,
        reckoning,
        clash,
        unrelated,
        sospecha,
        verity,
        with_year,
        tv_and_film,
        tv_only,
        top_stands_in,
        preview,
    ]


# ── ranking, as the enricher's pure functions see it ─────────────────────────


def _rank(name: str, source: str, description: str, **fields: Any) -> Case:
    return Case("tmdb-rank", name, description, [f"{_TESTS}::{source}"], NOW, fields={"today": TODAY, **fields})


_SNS = [
    {"id": 4584, "title": "Sense and Sensibility", "release_date": "1995-12-13", "genre_ids": [18, 10749]},
    {"id": 1503762, "title": "Sense and Sensibility", "release_date": "2026-09-18", "genre_ids": [18, 10749]},
    {"id": 1, "title": "Sense and Sensibility", "release_date": "1971-09-01", "genre_ids": [10770]},
]


def _ranking() -> list[Case]:
    return [
        _rank(
            "same-title-tie-tries-recent-release-first",
            "test_same_title_tie_tries_a_recent_release_first_without_a_year",
            "No year: the 2026 release is the first-run candidate; the TV movie is dropped.",
            title="Sense and Sensibility",
            results=_SNS,
        ),
        _rank(
            "provider-year-picks-that-year",
            "test_provider_year_picks_the_film_from_that_year",
            "Year 1995 puts the 1995 film first.",
            title="Sense and Sensibility",
            results=_SNS,
            year=1995,
        ),
        _rank(
            "provider-year-allows-one-year-either-side",
            "test_provider_year_allows_a_year_either_side_for_festival_premieres",
            "Year 2025 still puts the 2026 film first (+/-1).",
            title="Sense and Sensibility",
            results=_SNS,
            year=2025,
        ),
        _rank(
            "repertory-classic-keeps-tmdb-order",
            "test_repertory_classic_keeps_tmdb_order_without_a_recent_namesake",
            "No recent namesake: TMDb's popularity order stands.",
            title="Carrie",
            results=[
                {"id": 7340, "title": "Carrie", "release_date": "1976-11-03"},
                {"id": 133805, "title": "Carrie", "release_date": "2013-10-16"},
            ],
        ),
        _rank(
            "recency-window-admits-preview-not-announced",
            "test_recency_window_admits_a_preview_but_not_an_announced_film",
            "A release 31 days ahead is a first-run candidate; one 8 months ahead is not.",
            title="Highlander",
            results=[
                {"id": 8009, "title": "Highlander", "release_date": "1986-03-07"},
                {"id": 2, "title": "Highlander", "release_date": "2027-06-01"},
                {"id": 3, "title": "Highlander", "release_date": "2026-11-20"},
            ],
        ),
        _rank(
            "tv-movie-never-matches",
            "test_tv_movies_never_match",
            "A TV movie is dropped even when it ranks first.",
            title="The Miracle Worker",
            results=[
                {"id": 1163, "title": "The Miracle Worker", "release_date": "2000-10-29", "genre_ids": [18, 10770]},
                {"id": 1162, "title": "The Miracle Worker", "release_date": "1962-05-23", "genre_ids": [18]},
            ],
        ),
        _rank(
            "tv-movie-alone-matches-nothing",
            "test_tv_movies_never_match",
            "A lone TV movie leaves no candidate.",
            title="The Miracle Worker",
            results=[
                {"id": 1163, "title": "The Miracle Worker", "release_date": "2000-10-29", "genre_ids": [18, 10770]}
            ],
        ),
        _rank(
            "no-exact-title-top-result-stands-in",
            "test_without_an_exact_title_the_top_result_stands_in",
            "A Spanish title that matches nothing exactly: the top result is the single candidate.",
            title="Sentido y sensibilidad",
            results=[
                {"id": 1503762, "title": "Sense and Sensibility", "release_date": "2026-09-18"},
                {"id": 4584, "title": "Sense and Sensibility", "release_date": "1995-12-13"},
            ],
        ),
        _rank(
            "spanish-first-run-window",
            "test_a_recent_namesake_long_out_in_spain_is_not_a_first_run",
            "A Spanish cinema release 9 months ago is not a first run; one three days ahead is; non-ES and "
            "non-cinema (type 4) releases never are.",
            details=[
                {"release_dates": spanish_release("2025-01-29")},
                {"release_dates": spanish_release("2026-10-23")},
                {
                    "release_dates": {
                        "results": [
                            {
                                "iso_3166_1": "US",
                                "release_dates": [{"release_date": "2026-10-23T00:00:00.000Z", "type": 3}],
                            }
                        ]
                    }
                },
                {
                    "release_dates": {
                        "results": [
                            {
                                "iso_3166_1": "ES",
                                "release_dates": [{"release_date": "2026-10-23T00:00:00.000Z", "type": 4}],
                            }
                        ]
                    }
                },
                {},
            ],
        ),
    ]


def cases() -> list[Case]:
    return [*_tmdb(), *_ranking()]
