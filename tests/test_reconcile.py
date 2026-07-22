"""Tests for the Reconciliation module: identity, merge, and showtime dedup."""

from __future__ import annotations

import logging

import pytest

from models import Movie, Showtime
from reconcile import dedup_showtimes, normalize_title, reconcile, same_movie
from tests.conftest import FindEvent


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


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("booking_url", "https://book"),
        ("subtitle_lang", "es"),
        ("audio_lang", "en"),
        ("premium_format", "imax"),
    ],
)
def test_dedup_showtimes_info_field_wins_regardless_of_order(field: str, value: str) -> None:
    """A copy carrying optional enrichment contributes it whichever provider ran first."""
    rich = _showtime("Verdi", "2026-06-14", "18:00", **{field: value})
    plain = _showtime("Verdi", "2026-06-14", "18:00")
    for order in ([plain, rich], [rich, plain]):
        [kept] = dedup_showtimes(order, key=_key)
        assert kept.get(field) == value


def test_dedup_showtimes_merges_disjoint_info_fields():
    """
    The real Cinesa overlap: SensaCine carries the booking link, the ECB feed
    carries the IMAX badge, and neither carries the other. Both must survive —
    picking a winner would silently drop one of them.
    """
    premium = _showtime("Cinesa Diagonal", "2026-06-14", "21:40", premium_format="imax")
    linked = _showtime("Cinesa Diagonal", "2026-06-14", "21:40", booking_url="https://book", subtitle_lang="es")
    for order in ([premium, linked], [linked, premium]):
        [kept] = dedup_showtimes(order, key=_key)
        assert kept.get("booking_url") == "https://book"
        assert kept.get("subtitle_lang") == "es"
        assert kept.get("premium_format") == "imax"


def test_dedup_showtimes_merge_never_overwrites_a_present_value():
    """The first-seen copy stays the base; the other only fills the gaps."""
    first = _showtime("Verdi", "2026-06-14", "18:00", booking_url="https://first", subtitle_lang="es")
    second = _showtime("Verdi", "2026-06-14", "18:00", booking_url="https://second", premium_format="imax")
    [kept] = dedup_showtimes([first, second], key=_key)
    assert kept.get("booking_url") == "https://first"
    assert kept.get("premium_format") == "imax"


def test_dedup_showtimes_merge_leaves_the_inputs_unmutated():
    premium = _showtime("Verdi", "2026-06-14", "18:00", premium_format="imax")
    linked = _showtime("Verdi", "2026-06-14", "18:00", booking_url="https://book")
    dedup_showtimes([linked, premium], key=_key)
    assert "premium_format" not in linked
    assert "booking_url" not in premium


def test_dedup_showtimes_preserves_first_seen_order():
    a = _showtime("Verdi", "2026-06-14", "18:00")
    b = _showtime("Malda", "2026-06-14", "20:00")
    assert dedup_showtimes([a, b], key=_key) == [a, b]


# ── reconcile_summary logging ─────────────────────────────────────────────────


def test_reconcile_is_silent_without_a_stage(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="observability")
    reconcile([_movie("Dune"), _movie("Dune")])
    assert caplog.text == ""


def test_reconcile_summary_accounts_for_merged_movies_and_showtimes(find_event: FindEvent) -> None:
    shared = _showtime("Verdi", "2026-06-14", "18:00")
    left = _movie("Dune", showtimes=[shared, _showtime("Verdi", "2026-06-14", "20:00")])
    right = _movie("Dune", showtimes=[shared])
    reconcile([left, right, _movie("Oppenheimer")], stage="collection")

    summary = find_event("reconcile_summary")
    assert summary["stage"] == "collection"
    assert summary["movies_in"] == 3
    assert summary["movies_out"] == 2
    assert summary["movies_merged"] == 1
    assert summary["showtimes_in"] == 3
    assert summary["showtimes_out"] == 2
    assert summary["showtimes_deduped"] == 1


def test_reconcile_summary_names_films_merged_across_different_titles(find_event: FindEvent) -> None:
    """An imdb_id match collapsing two distinct titles is the over-merge signal."""
    reconcile(
        [_movie("Dune: Part Two", imdb_id="tt15239678"), _movie("Dune Part 2", imdb_id="tt15239678")],
        stage="post_enrichment",
    )

    summary = find_event("reconcile_summary")
    assert summary["cross_title_merge_count"] == 1
    assert summary["cross_title_merges"] == ["Dune: Part Two ← Dune Part 2"]


def test_reconcile_summary_ignores_same_title_merges_as_routine(find_event: FindEvent) -> None:
    reconcile([_movie("Dune"), _movie("  dune ")], stage="collection")

    summary = find_event("reconcile_summary")
    assert summary["movies_merged"] == 1
    assert summary["cross_title_merges"] == []
