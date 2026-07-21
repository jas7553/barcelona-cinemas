"""Tests for the Reconciliation module: identity, merge, and showtime dedup."""

from __future__ import annotations

from models import Movie, Showtime
from reconcile import dedup_showtimes, normalize_title, reconcile, same_movie


def _movie(
    title: str, *, imdb_id: str | None = None, showtimes: list[Showtime] | None = None, **fields: object
) -> Movie:
    base = Movie(
        title=title,
        tmdb_id=None,
        imdb_id=imdb_id,
        year=None,
        poster_url=None,
        synopsis=None,
        rating=None,
        runtime_mins=None,
        genres=None,
        showtimes=showtimes or [],
    )
    base.update(fields)  # type: ignore[typeddict-item]
    return base


def _showtime(cinema: str, date: str, time: str, **fields: object) -> Showtime:
    st = Showtime(cinema=cinema, neighborhood="N", address="A", date=date, time=time)
    st.update(fields)  # type: ignore[typeddict-item]
    return st


# ── normalize_title ──────────────────────────────────────────────────────────


def test_normalize_title_casefolds_and_collapses_whitespace():
    assert normalize_title("  The   DUNE  ") == "the dune"


def test_normalize_title_strips_edge_punctuation_and_quotes():
    assert normalize_title("“Dune”!") == "dune"


# ── same_movie identity ──────────────────────────────────────────────────────


def test_same_movie_equal_imdb_matches_even_with_different_titles():
    assert same_movie(_movie("Dune", imdb_id="tt1"), _movie("Dune: Part One", imdb_id="tt1"))


def test_same_movie_different_imdb_never_matches_even_with_same_title():
    assert not same_movie(_movie("Dune", imdb_id="tt1"), _movie("Dune", imdb_id="tt2"))


def test_same_movie_falls_back_to_title_when_one_side_lacks_imdb():
    # The cross-provider case: one feed has the imdb, the other does not.
    assert same_movie(_movie("Dune", imdb_id="tt1"), _movie("dune"))


def test_same_movie_distinct_titles_without_imdb_do_not_match():
    assert not same_movie(_movie("Dune"), _movie("Oppenheimer"))


# ── reconcile ────────────────────────────────────────────────────────────────


def test_reconcile_merges_imdb_and_titleonly_copies_and_unions_showtimes():
    a = _movie("Dune", imdb_id="tt1", showtimes=[_showtime("Verdi", "2026-06-14", "18:00")])
    b = _movie("dune", showtimes=[_showtime("Malda", "2026-06-14", "20:00")])
    [merged] = reconcile([a, b])
    assert merged["imdb_id"] == "tt1"  # coalesced from the copy that had it
    assert len(merged["showtimes"]) == 2


def test_reconcile_keeps_distinct_films_separate():
    out = reconcile([_movie("Dune"), _movie("Oppenheimer")])
    assert {m["title"] for m in out} == {"Dune", "Oppenheimer"}


def test_merge_pair_coalesces_english_title():
    a = _movie("Encuentros en la tercera fase", imdb_id="tt0075860")
    a["english_title"] = "Close Encounters of the Third Kind"
    b = _movie("Encuentros en la tercera fase", imdb_id="tt0075860")
    [merged] = reconcile([a, b])
    assert merged.get("english_title") == "Close Encounters of the Third Kind"


def test_merge_pair_english_title_absent_when_neither_side_has_it():
    a = _movie("Dune", imdb_id="tt1")
    b = _movie("Dune", imdb_id="tt1")
    [merged] = reconcile([a, b])
    assert "english_title" not in merged


def test_reconcile_picks_longest_title():
    a = _movie("Dune", imdb_id="tt1")
    b = _movie("Dune: Part One", imdb_id="tt1")
    [merged] = reconcile([a, b])
    assert merged["title"] == "Dune: Part One"


def test_reconcile_coalesces_first_non_null_field():
    a = _movie("Dune", imdb_id="tt1", year=None)
    b = _movie("Dune", imdb_id="tt1", year=2021)
    [merged] = reconcile([a, b])
    assert merged["year"] == 2021


def test_reconcile_dedups_identical_showtimes_across_copies():
    st = _showtime("Verdi", "2026-06-14", "18:00", language="vo")
    a = _movie("Dune", imdb_id="tt1", showtimes=[st])
    b = _movie("Dune", imdb_id="tt1", showtimes=[dict(st)])  # type: ignore[list-item]
    [merged] = reconcile([a, b])
    assert len(merged["showtimes"]) == 1


# ── dedup_showtimes booking-url rule ─────────────────────────────────────────


def _key(s: Showtime) -> tuple[str, str, str]:
    return (s["cinema"], s["date"], s["time"])


def test_dedup_showtimes_linkless_duplicate_does_not_clobber_linked():
    linked = _showtime("Verdi", "2026-06-14", "18:00", booking_url="https://book")
    linkless = _showtime("Verdi", "2026-06-14", "18:00")
    [kept] = dedup_showtimes([linked, linkless], key=_key)
    assert kept.get("booking_url") == "https://book"


def test_dedup_showtimes_linked_duplicate_replaces_linkless():
    linkless = _showtime("Verdi", "2026-06-14", "18:00")
    linked = _showtime("Verdi", "2026-06-14", "18:00", booking_url="https://book")
    [kept] = dedup_showtimes([linkless, linked], key=_key)
    assert kept.get("booking_url") == "https://book"


def test_dedup_showtimes_known_subtitle_wins_regardless_of_order():
    known = _showtime("Verdi", "2026-06-14", "18:00", subtitle_lang="es")
    unknown = _showtime("Verdi", "2026-06-14", "18:00")
    [a] = dedup_showtimes([unknown, known], key=_key)
    assert a.get("subtitle_lang") == "es"
    [b] = dedup_showtimes([known, unknown], key=_key)
    assert b.get("subtitle_lang") == "es"


def test_dedup_showtimes_premium_format_wins_regardless_of_order():
    premium = _showtime("Cinesa Diagonal", "2026-06-14", "21:40", premium_format="imax")
    plain = _showtime("Cinesa Diagonal", "2026-06-14", "21:40")
    [a] = dedup_showtimes([plain, premium], key=_key)
    assert a.get("premium_format") == "imax"
    [b] = dedup_showtimes([premium, plain], key=_key)
    assert b.get("premium_format") == "imax"


def test_dedup_showtimes_premium_format_does_not_outrank_booking_link():
    """Score is lexicographic, not summed: a link-bearing copy always wins."""
    premium = _showtime("Cinesa Diagonal", "2026-06-14", "21:40", premium_format="imax")
    linked = _showtime("Cinesa Diagonal", "2026-06-14", "21:40", booking_url="https://book")
    [a] = dedup_showtimes([premium, linked], key=_key)
    assert a.get("booking_url") == "https://book"
    [b] = dedup_showtimes([linked, premium], key=_key)
    assert b.get("booking_url") == "https://book"


def test_dedup_showtimes_preserves_first_seen_order():
    a = _showtime("Verdi", "2026-06-14", "18:00")
    b = _showtime("Malda", "2026-06-14", "20:00")
    assert dedup_showtimes([a, b], key=_key) == [a, b]
