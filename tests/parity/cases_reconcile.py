"""Inline cases for reconcile.reconcile: identity, merge, showtime dedup. No HTTP."""

from __future__ import annotations

from typing import Any

from tests.parity.inline_cases import Case

_TESTS = "tests/test_reconcile.py"
_NOW = "2026-06-14T10:00:00+02:00"


def movie(
    title: str, imdb_id: str | None = None, showtimes: list[dict[str, Any]] | None = None, **fields: Any
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "title": title,
        "tmdb_id": None,
        "imdb_id": imdb_id,
        "year": None,
        "poster_url": None,
        "synopsis": None,
        "rating": None,
        "runtime_mins": None,
        "genres": None,
        "showtimes": showtimes or [],
    }
    return {**base, **fields}


def st(cinema: str, date: str, time: str, **fields: Any) -> dict[str, Any]:
    return {"cinema": cinema, "neighborhood": "N", "address": "A", "date": date, "time": time, **fields}


def _case(
    name: str, description: str, source: list[str], movies: list[dict[str, Any]], stage: str | None = None
) -> Case:
    fields: dict[str, Any] = {"movies": movies}
    if stage is not None:
        fields["stage"] = stage
    return Case("reconcile", name, description, [f"{_TESTS}::{s}" for s in source], _NOW, fields=fields)


def cases() -> list[Case]:
    day = "2026-06-14"
    return [
        _case(
            "imdb-and-title-only-copies-merge",
            "A copy with an imdb_id and a title-only copy of the same film merge; imdb_id is coalesced, showtimes unioned.",
            [
                "test_reconcile_merges_imdb_and_titleonly_copies_and_unions_showtimes",
                "test_same_movie_falls_back_to_title_when_one_side_lacks_imdb",
            ],
            [
                movie("Dune", "tt1", [st("Verdi", day, "18:00")]),
                movie("dune", None, [st("Malda", day, "20:00")]),
            ],
        ),
        _case(
            "title-folded-in-by-earlier-imdb-merge",
            "Verdi's Spanish title joins the English copy on imdb_id; SensaCine's id-less Spanish copy must follow, "
            "in any provider order.",
            ["test_reconcile_matches_a_title_folded_in_by_an_earlier_imdb_merge"],
            [
                movie("The Social Reckoning", "tt37510326", [st("Balmes", "2026-11-10", "18:00")]),
                movie("El precio de la red", "tt37510326", [st("Verdi", "2026-11-10", "20:00")]),
                movie("El precio de la red", None, [st("RenFlo", "2026-11-10", "22:00")]),
            ],
            "collection",
        ),
        _case(
            "same-title-different-imdb-stay-apart",
            "Same title with two different imdb_ids are two films; distinct titles are separate films.",
            [
                "test_reconcile_keeps_same_title_copies_with_different_imdb_ids_apart",
                "test_reconcile_keeps_distinct_films_separate",
                "test_same_movie_different_imdb_never_matches_even_with_same_title",
            ],
            [movie("Nosferatu", "tt0013442"), movie("Nosferatu", "tt5040012"), movie("Dune"), movie("Oppenheimer")],
        ),
        _case(
            "title-normalisation",
            "Casefolding, whitespace collapsing and edge punctuation/quotes make these one film.",
            [
                "test_normalize_title_casefolds_and_collapses_whitespace",
                "test_normalize_title_strips_edge_punctuation_and_quotes",
            ],
            [movie("  The   DUNE  "), movie("“The Dune”!"), movie("the dune")],
        ),
        _case(
            "merge-coalesces-fields",
            "Merging keeps the longest title and takes the first non-null of every field, including english_title, "
            "enriched_at, tmdb_match_version and a zero vote_count; fields absent from both stay absent.",
            [
                "test_reconcile_picks_longest_title",
                "test_reconcile_coalesces_first_non_null_field",
                "test_merge_pair_coalesces_english_title",
                "test_merge_pair_english_title_absent_when_neither_side_has_it",
                "test_merge_pair_preserves_enriched_at",
                "test_merge_pair_preserves_tmdb_match_version",
                "test_merge_pair_preserves_zero_vote_count",
            ],
            [
                movie("Dune", "tt1"),
                movie("Dune: Part One", "tt1", year=2021),
                movie("Encuentros en la tercera fase", "tt0075860", english_title="Close Encounters of the Third Kind"),
                movie("Encuentros en la tercera fase", "tt0075860"),
                movie(
                    "Rated Zero",
                    "tt3",
                    rating=0.0,
                    vote_count=0,
                    enriched_at="2026-07-23T10:00:00+00:00",
                    tmdb_match_version=2,
                ),
                movie(
                    "Rated Zero Extended",
                    "tt3",
                    rating=7.0,
                    vote_count=50,
                    tmdb_id=3,
                    director="D",
                    cast=["A"],
                    backdrop_url="b",
                    trailer_url="t",
                    tagline="g",
                    original_lang="en",
                ),
                movie("Plain", "tt4"),
                movie("Plain", "tt4"),
            ],
        ),
        _case(
            "identical-showtimes-collapse-and-sort",
            "Identical showtimes across copies collapse; the language field is canonicalised (absent reads as vo, "
            "dub stays distinct) and merged showtimes sort by date, time, cinema, language.",
            [
                "test_reconcile_dedups_identical_showtimes_across_copies",
                "test_dedup_showtimes_preserves_first_seen_order",
            ],
            [
                movie(
                    "Dune",
                    "tt1",
                    [
                        st("Verdi", day, "20:00", language="vo"),
                        st("Verdi", day, "18:00", language="dub"),
                        st("Malda", day, "18:00"),
                    ],
                ),
                movie(
                    "Dune",
                    "tt1",
                    [
                        st("Verdi", day, "20:00"),
                        st("Verdi", day, "18:00", language="vo"),
                        st("Malda", day, "18:00", language="vo"),
                        st("Verdi", day, "18:00", language="dub"),
                    ],
                ),
            ],
        ),
        _case(
            "showtime-info-fields-win-in-either-order",
            "A duplicate showtime carrying booking_url, subtitle_lang, audio_lang or premium_format contributes it "
            "whichever copy came first (each film is one field, both orders).",
            ["test_dedup_showtimes_info_field_wins_regardless_of_order"],
            [
                m
                for field, value in (
                    ("booking_url", "https://book"),
                    ("subtitle_lang", "es"),
                    ("audio_lang", "en"),
                    ("premium_format", "imax"),
                )
                for order, copies in (("rich-first", (True, False)), ("plain-first", (False, True)))
                for m in (
                    movie(
                        f"{field} {order}",
                        f"tt-{field}-{order}",
                        [st("Verdi", day, "18:00", **({field: value} if rich else {}))],
                    )
                    for rich in copies
                )
            ],
        ),
        _case(
            "disjoint-info-fields-merge",
            "The Cinesa overlap: one copy carries the IMAX badge, the other the booking link and subtitle; both survive, in either order.",
            ["test_dedup_showtimes_merges_disjoint_info_fields"],
            [
                movie("Supergirl", "tt9", [st("CinDiag", day, "21:40", premium_format="imax")]),
                movie(
                    "Supergirl", "tt9", [st("CinDiag", day, "21:40", booking_url="https://book", subtitle_lang="es")]
                ),
                movie(
                    "Supergirl 2", "tt10", [st("CinDiag", day, "21:40", booking_url="https://book", subtitle_lang="es")]
                ),
                movie("Supergirl 2", "tt10", [st("CinDiag", day, "21:40", premium_format="imax")]),
            ],
        ),
        _case(
            "info-merge-never-overwrites",
            "The first-seen copy stays the base: a present booking_url is kept, only gaps are filled.",
            ["test_dedup_showtimes_merge_never_overwrites_a_present_value"],
            [
                movie("Dune", "tt1", [st("Verdi", day, "18:00", booking_url="https://first", subtitle_lang="es")]),
                movie("Dune", "tt1", [st("Verdi", day, "18:00", booking_url="https://second", premium_format="imax")]),
            ],
        ),
        _case(
            "summary-counts-merges-and-deduped-showtimes",
            "The reconcile_summary event at the collection stage: movies and showtimes in/out, none cross-title.",
            [
                "test_reconcile_summary_accounts_for_merged_movies_and_showtimes",
                "test_reconcile_summary_ignores_same_title_merges_as_routine",
            ],
            [
                movie("Dune", None, [st("Verdi", day, "18:00"), st("Verdi", day, "20:00")]),
                movie("Dune", None, [st("Verdi", day, "18:00")]),
                movie("Oppenheimer"),
                movie("  dune "),
            ],
            "collection",
        ),
        _case(
            "summary-names-cross-title-merges",
            "An imdb_id match collapsing two differently-titled copies is named in the post_enrichment summary.",
            ["test_reconcile_summary_names_films_merged_across_different_titles"],
            [movie("Dune: Part Two", "tt15239678"), movie("Dune Part 2", "tt15239678")],
            "post_enrichment",
        ),
    ]
