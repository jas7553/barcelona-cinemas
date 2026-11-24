"""Inline recording sets for the four providers."""

from __future__ import annotations

import json
from typing import Any

from tests.parity.inline_cases import Case

LISTINGS_ROOT = "https://listings.example.test"
LISTINGS_FEED = f"{LISTINGS_ROOT}/films"
SECONDARY_FEED = "https://secondary.example.test/listings"
VERDI = "https://barcelona.cines-verdi.com"
ADMIT_ONE = "https://verdibcn.admit-one.eu/seats"
SENSACINE = "https://www.sensacine.com/_/showtimes"

# ── english_cinema_bcn ───────────────────────────────────────────────────────

_LISTINGS_TESTS = "tests/test_listings_provider.py"


def _card(title: str | None, href: str | None) -> str:
    attrs = (f' data-title="{title}"' if title is not None else "") + (f' href="{href}"' if href is not None else "")
    return f'<a class="film-card"{attrs}></a>'


def _catalog(*cards: str) -> str:
    return f'<html><body><div class="film-grid">\n{chr(10).join(cards)}\n</div></body></html>\n'


def _chip(label: str, *tags: str) -> str:
    time = label.split()[-1]
    tag_html = (
        '<span class="showtime-tags">' + "".join(f'<span class="showtime-tag">{t}</span>' for t in tags) + "</span>"
        if tags
        else ""
    )
    return (
        f'<a class="showtime-chip" data-showtime-id="1" data-showtime-label="{label}" href="/r/x/1">'
        f'<span class="showtime-chip-time">{time}</span>{tag_html}</a>'
    )


def _block(cinema: str, *chips: str) -> str:
    return (
        '<div class="cinema-block"><div class="cinema-block-info">'
        f'<h3 class="cinema-block-name"><a href="/cinema/x"> {cinema} </a></h3></div>'
        f'<div class="cinema-block-times">{"".join(chips)}</div></div>'
    )


def _film_detail(*blocks: str) -> str:
    return (
        '<html><body><section id="showtimes"><div class="day-group" data-day-index="0">'
        + "".join(blocks)
        + "</div></section></body></html>\n"
    )


def _listings_case(name: str, description: str, source: list[str], now: str) -> Case:
    return Case(
        "english_cinema_bcn",
        name,
        description,
        source,
        now,
        fields={"config": {"listingsFeedUrl": LISTINGS_FEED}},
    )


def _listings() -> list[Case]:
    multi = _listings_case(
        "catalog-multi-film",
        "Catalog of film cards (relative and absolute hrefs, a card with no title, one with no href), each film's "
        "detail page grouped by cinema block: alias names (Verdi, Cinemes Verdi, Cin Diag, Mooby Gran Sarrià), an "
        "unknown cinema, a duplicated chip, IMAX among several tags, a film with only unknown cinemas (dropped).",
        [
            f"{_LISTINGS_TESTS}::test_fetch_returns_movie_with_title_from_catalog",
            "::test_fetch_returns_correct_showtime",
            "::test_fetch_maps_alias_cinema_names_and_sets_vo_language",
            "::test_premium_format",
            "::test_redesigned_site_names_resolve_to_registry_keys",
        ],
        "2026-03-28T10:00:00+01:00",
    )
    multi.page(
        LISTINGS_FEED,
        _catalog(
            _card("Project Hail Mary", "/m/project-hail-mary/in-english-in-barcelona"),
            _card("Dune: Part Three", f"{LISTINGS_ROOT}/m/dune-part-three/in-english-in-barcelona"),
            _card("", "/m/untitled"),
            _card("Missing Href", None),
            _card("Ghost Film", "/m/ghost-film"),
        ),
    )
    multi.page(
        f"{LISTINGS_ROOT}/m/project-hail-mary/in-english-in-barcelona",
        _film_detail(
            _block("Verdi", _chip("Sat 28 Mar 18:00"), _chip("Sat 28 Mar 18:00")),
            _block("Cinemes Verdi", _chip("Sun 29 Mar 20:30", "VOSE", "IMAX")),
            _block("Cin Diag", _chip("Sat 28 Mar 21:00", "IMAX")),
            _block("Mooby Gran Sarrià", _chip("Mon 30 Mar 19:15")),
            _block("Nonexistent Cinema", _chip("Sat 28 Mar 22:00")),
        ),
    )
    multi.page(
        f"{LISTINGS_ROOT}/m/dune-part-three/in-english-in-barcelona",
        _film_detail(
            _block("Cinesa Diagonal", _chip("Tue 31 Mar 17:45")), _block("Zumzeig Cinema", _chip("Tue 31 Mar 22:30"))
        ),
    )
    multi.page(f"{LISTINGS_ROOT}/m/ghost-film", _film_detail(_block("Nonexistent Cinema", _chip("Sat 28 Mar 18:00"))))

    rollover = _listings_case(
        "year-rollover-and-bad-labels",
        "Date labels near New Year: Jan dates seen in late December roll to next year, the 8-day boundary, "
        "September spelled 'Sept', and labels that are skipped (impossible Feb 29, unknown month, garbled).",
        [
            f"{_LISTINGS_TESTS}::test_parse_showtime_label_standard",
            "::test_parse_showtime_label_next_year_rollover",
            "::test_parse_showtime_label_invalid_returns_empty",
        ],
        "2026-12-28T10:00:00+01:00",
    )
    rollover.page(LISTINGS_FEED, _catalog(_card("Year End Film", "/m/year-end-film")))
    rollover.page(
        f"{LISTINGS_ROOT}/m/year-end-film",
        _film_detail(
            _block(
                "Verdi",
                _chip("Sun 28 Dec 20:00"),
                _chip("Mon 5 Jan 18:00"),
                _chip("Sat 20 Dec 18:00"),
                _chip("Fri 19 Dec 18:00"),
                _chip("Sun 13 Sept 20:45"),
                _chip("Fri 29 Feb 18:00"),
                _chip("Sat 28 Foo 18:00"),
                _chip("Sat xx Jan 18:00"),
                _chip("Sat 5 Jan"),
                _chip("soon"),
            )
        ),
    )

    no_cards = _listings_case(
        "no-film-cards",
        "A feed page with no film cards (a maintenance or bot-challenge page) raises instead of returning nothing.",
        [f"{_LISTINGS_TESTS}::test_fetch_ignores_unknown_cinemas (the empty-result neighbour)"],
        "2026-03-28T10:00:00+01:00",
    )
    no_cards.page(LISTINGS_FEED, "<html><body><p>Back soon</p></body></html>\n")

    film_error = _listings_case(
        "film-page-http-error",
        "A film detail page that answers 500 fails the whole fetch (no per-film tolerance in this provider).",
        [f"{_LISTINGS_TESTS}::test_fetch_returns_movie_with_title_from_catalog (error path)"],
        "2026-03-28T10:00:00+01:00",
    )
    film_error.page(LISTINGS_FEED, _catalog(_card("Project Hail Mary", "/m/project-hail-mary/in-english-in-barcelona")))
    film_error.page(f"{LISTINGS_ROOT}/m/project-hail-mary/in-english-in-barcelona", "<html>boom</html>\n", status=500)
    return [multi, rollover, no_cards, film_error]


# ── secondary ────────────────────────────────────────────────────────────────

_SECONDARY_TESTS = "tests/test_secondary_provider.py"


def _perf(date: str, hhmmss: str, code: str | None = None) -> dict[str, str]:
    perf = {"schedule_date": date, "time": f"{date}{hhmmss}"}
    if code is not None:
        perf["performance_code"] = code
    return perf


def _event(
    name: str, language: str, subtitles: str, performances: list[Any], imdb: str | None = None
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "name": name,
        "language": language,
        "subtitles_lang": subtitles,
        "performances": performances,
    }
    if imdb is not None:
        event["imdbid"] = imdb
    return event


def _shop(
    label: str, name: str, slug: str, code: str, events: list[Any], shop_url: str | None = None
) -> dict[str, Any]:
    shop: dict[str, Any] = {"label": label, "name": name, "slug": slug, "code": code, "events": events}
    if shop_url is not None:
        shop["shop_url"] = shop_url
    return shop


def _shops_page(shops: dict[str, Any]) -> str:
    body = json.dumps(shops, indent=2, ensure_ascii=False)
    return f"<html><head><script>\nwindow.shops = {body};\n</script></head></html>\n"


def _secondary() -> list[Case]:
    template = "https://example-aribau.tickets.test/?p=tickets&perfCode=%s&language=%s&theatre=%s"
    shops = {
        "25": _shop(
            "ARIBAU",
            "Aribau",
            "/aribau",
            "BAL-ARIBAU",
            [
                _event(
                    "Project Hail Mary",
                    "Anglès",
                    "Español",
                    [_perf("20260329", "183000", "187518"), _perf("20260329", "210000")],
                    "tt12042730",
                ),
                _event("Other Language Film", "Japonès", "English", [_perf("20260330", "210000")], "tt7654321"),
                _event("Dubbed Film", "Español", "", [_perf("20260329", "160000")], "tt9999999"),
                _event("Catalan Audio English Subs", "Català", "Anglès", [_perf("20260331", "193000", "187530")], " "),
                _event("Accented Ingles Misses", "Español", "Inglés", [_perf("20260331", "200000")], "tt1111111"),
                _event("No Performances", "Anglès", "", [], "tt2222222"),
                _event("   ", "Anglès", "", [_perf("20260331", "200000")], "tt3333333"),
                _event(
                    "Bad Performances",
                    "Anglès",
                    "",
                    [
                        {"schedule_date": "2026033", "time": "20260331200000"},
                        {"schedule_date": "20260331", "time": "2026"},
                        "junk",
                    ],
                    "tt4444444",
                ),
                "not-an-event",
            ],
            template,
        ),
        "26": _shop(
            "BOSQUE",
            "Bosque",
            "/bosque",
            "BAL-BOSQUE",
            [_event("Project Hail Mary", "Anglès", "Español", [_perf("20260330", "200000", "187600")], "tt12042730")],
        ),
        "27": _shop(
            "BALMES",
            "Balmes",
            "/balmes",
            "BAL-BALMES",
            [_event("Project Hail Mary", "English", "Spanish", [_perf("20260331", "173000", "187700")], "tt12042730")],
            "https://example-balmes.tickets.test/?p=tickets&title=Hail%20Mary&perfCode=%s&language=%s&theatre=%s",
        ),
        "28": _shop(
            "ARENAS",
            "Arenas",
            "/arenas",
            "BAL-ARENAS",
            [_event("Arenas Film", "English", "", [_perf("20260401", "180000", "187800")], "tt5555555")],
            "https://example-arenas.tickets.test/?perfCode=%s&theatre=BAL-ARENAS",
        ),
        "29": _shop(
            "NOWHERE",
            "Nowhere Cinema",
            "/nowhere",
            "BAL-NOWHERE",
            [_event("Unseen Film", "English", "", [_perf("20260401", "180000", "1")], "tt6666666")],
        ),
        "30": "not-a-shop",
    }
    main = Case(
        "secondary",
        "shops-english-and-subtitled",
        "Shop payload in window.shops: English audio or subtitles only (with the accent quirk: 'Inglés' does not "
        "count); audio/subtitle normalisation; booking URL from the shop template by replacing three %s in order "
        "(also when the template holds %20); no URL when the template has no shop_url or not exactly three %s; "
        "unknown shops and junk entries skipped; one film in three shops merged by imdb_id.",
        [
            f"{_SECONDARY_TESTS}::test_fetch_parses_english_audio_and_english_subtitles",
            "::test_fetch_builds_english_booking_url_from_shop_template",
            "::test_fetch_skips_non_english_entries",
        ],
        "2026-03-28T10:00:00+01:00",
        fields={"config": {"secondaryListingsUrl": SECONDARY_FEED}},
    ).page(SECONDARY_FEED, _shops_page(shops))

    alias = Case(
        "secondary",
        "shop-aliases-by-slug-and-code",
        "Shop with blank label and name is still found through its slug or code alias.",
        [f"{_SECONDARY_TESTS}::test_fetch_maps_slug_and_code_aliases_without_branded_names"],
        "2026-03-28T10:00:00+01:00",
        fields={"config": {"secondaryListingsUrl": SECONDARY_FEED}},
    ).page(
        SECONDARY_FEED,
        _shops_page(
            {
                "25": _shop(
                    "",
                    "",
                    "/aribau",
                    "BAL-ARIBAU",
                    [_event("Project Hail Mary", "Anglès", "", [_perf("20260329", "183000")], "tt12042730")],
                )
            }
        ),
    )

    missing = Case(
        "secondary",
        "no-shops-payload",
        "A page with no window.shops blob raises.",
        [f"{_SECONDARY_TESTS}::test_extract_shops_payload_raises_for_missing_blob"],
        "2026-03-28T10:00:00+01:00",
        fields={"config": {"secondaryListingsUrl": SECONDARY_FEED}},
    ).page(SECONDARY_FEED, "<html></html>\n")

    undecodable = Case(
        "secondary",
        "shops-payload-not-json",
        "A window.shops blob that is not valid JSON raises.",
        [f"{_SECONDARY_TESTS}::test_extract_shops_payload_raises_for_missing_blob (decode neighbour)"],
        "2026-03-28T10:00:00+01:00",
        fields={"config": {"secondaryListingsUrl": SECONDARY_FEED}},
    ).page(SECONDARY_FEED, "<script>window.shops = {not json};</script>\n")
    return [main, alias, missing, undecodable]


# ── verdi ────────────────────────────────────────────────────────────────────

_VERDI_TESTS = "tests/test_verdi_provider.py"
_NOW_JUNE = "2026-06-28T10:00:00+02:00"
_CARTELLERA = f"{VERDI}/cartellera"
_SEAT_VERDI = "<p>Cines Verdi Barcelona | Sala 3</p>\n"
_SEAT_VP = "<p>Cines Verdi Barcelona | Sala D V.Park</p>\n"
_SEAT_NONE = "<html>No sala info</html>\n"
_SEAT_EXPIRED = "<html>Sessió no seleccionada o expirada.</html>\n"


def _ld_json(name: str = "Obsession", same_as: Any = "https://www.imdb.com/title/tt12345678") -> str:
    movie: dict[str, Any] = {"@type": "Movie", "@id": f"{VERDI}/x", "name": name, "event": []}
    if same_as is not None:
        movie["sameAs"] = same_as
    graph = {
        "@context": "https://schema.org",
        "@graph": [{"@type": "MovieTheater", "@id": f"{VERDI}#cinema", "name": "Cinemes Verdi Barcelona"}, movie],
    }
    return f'\n<script type="application/ld+json" id="ldjson-movie">{json.dumps(graph, indent=2)}</script>\n'


def _session(session_id: int, stamp: str, time: str, language: str = "V.O. SUB. CASTELLÀ") -> str:
    return (
        f'\n<a href="{ADMIT_ONE}/{session_id}/" x-show="!isPast(&#039;{stamp}&#039;)" x-cloak target="_blank">'
        f"<time>{time}</time><small>{language}</small></a>"
    )


def _vo(session_id: int, day: int, time: str) -> str:
    return _session(session_id, f"202606{day:02d}{time.replace(':', '')}00", time)


def _cartellera(*slugs: str) -> str:
    return "".join(f'<a href="{slug}" class="group"><figure></figure></a>\n' for slug in slugs)


def _verdi_case(name: str, description: str, source: list[str], **fields: Any) -> Case:
    return Case("verdi", name, description, [f"{_VERDI_TESTS}::{s}" for s in source], _NOW_JUNE, fields=fields)


def _verdi() -> list[Case]:
    obsession = (
        _ld_json()
        + _session(100001, "20260628183000", "18:30")
        + _session(100002, "20260628203000", "20:30")
        + _session(100003, "20260628160000", "16:00", "CASTELLÀ")
    )
    vo = _verdi_case(
        "vo-sessions-verdi-sala",
        "Cartellera with two films; one page has JSON-LD (title + IMDb id), two V.O. sessions and one dubbed "
        "(dropped); the other has no JSON-LD (film skipped). Numeric sala resolves to Verdi; subtitle language "
        "comes from 'V.O. SUB. CASTELLÀ'; one seat lookup per time slot.",
        [
            "test_fetch_returns_vo_movie_with_booking_url",
            "test_resolve_cinema_key_returns_verdi_for_numeric_sala",
            "test_is_vo_true_for_vo_prefix",
            "test_is_vo_false_for_dubbed",
        ],
    )
    vo.page(_CARTELLERA, _cartellera("/obsession", "/toy-story-5"))
    vo.page(f"{VERDI}/obsession", obsession)
    vo.page(f"{VERDI}/toy-story-5", "<html></html>\n")
    vo.page(f"{ADMIT_ONE}/100001/", _SEAT_VERDI)
    vo.page(f"{ADMIT_ONE}/100002/", _SEAT_VERDI)

    park = _verdi_case(
        "verdi-park-sala",
        "A letter sala with the V.Park suffix resolves to Verdi Park (VP), not Verdi.",
        ["test_fetch_assigns_vp_cinema_key_for_letter_sala", "test_resolve_cinema_key_returns_vp_for_letter_sala"],
    )
    park.page(_CARTELLERA, _cartellera("/obsession"))
    park.page(f"{VERDI}/obsession", _ld_json() + _session(200001, "20260628203000", "20:30"))
    park.page(f"{ADMIT_ONE}/200001/", _SEAT_VP)

    mixed = _verdi_case(
        "verdi-and-verdi-park-same-film",
        "One film screening in both venues at different times: each slot's seat page decides Verdi or VP.",
        ["test_fetch_returns_vo_movie_with_booking_url", "test_fetch_assigns_vp_cinema_key_for_letter_sala"],
    )
    mixed.page(_CARTELLERA, _cartellera("/obsession"))
    mixed.page(
        f"{VERDI}/obsession",
        _ld_json() + _session(210001, "20260628180000", "18:00") + _session(210002, "20260628210000", "21:00"),
    )
    mixed.page(f"{ADMIT_ONE}/210001/", _SEAT_VERDI)
    mixed.page(f"{ADMIT_ONE}/210002/", _SEAT_VP)

    one_of_five = _verdi_case(
        "one-slot-without-sala-is-left-out",
        "Five time slots, one seat page names no sala: the showtime is dropped and reported (1 of 5, within the limit).",
        ["test_fetch_leaves_out_a_showtime_without_a_sala_and_reports_it"],
    )
    one_of_five.page(_CARTELLERA, _cartellera("/obsession"))
    times = ["14:00", "16:00", "18:00", "20:00", "22:00"]
    one_of_five.page(f"{VERDI}/obsession", _ld_json() + "".join(_vo(310001 + i, 28, t) for i, t in enumerate(times)))
    for i in range(4):
        one_of_five.page(f"{ADMIT_ONE}/{310001 + i}/", _SEAT_VERDI)
    one_of_five.page(f"{ADMIT_ONE}/310005/", _SEAT_NONE)

    unresolved = _verdi_case(
        "all-salas-unresolved-fails",
        "The only seat page names no sala: past the failure limit the whole fetch raises PartialFetchError.",
        ["test_fetch_skips_showtime_when_sala_lookup_fails"],
    )
    unresolved.page(_CARTELLERA, _cartellera("/obsession"))
    unresolved.page(f"{VERDI}/obsession", _ld_json() + _session(300001, "20260628183000", "18:30"))
    unresolved.page(f"{ADMIT_ONE}/300001/", _SEAT_NONE)

    dedup = _verdi_case(
        "slot-lookup-once-per-time",
        "Three sessions at 20:30 on three days cost one seat lookup, asked of the latest session.",
        ["test_fetch_deduplicates_same_time_slot_sala_lookup"],
    )
    dedup.page(_CARTELLERA, _cartellera("/obsession"))
    dedup.page(
        f"{VERDI}/obsession",
        _ld_json()
        + _session(400001, "20260628203000", "20:30")
        + _session(400002, "20260629203000", "20:30")
        + _session(400003, "20260630203000", "20:30"),
    )
    dedup.page(f"{ADMIT_ONE}/400003/", _SEAT_VERDI)

    latest = _verdi_case(
        "slot-resolved-from-latest-session",
        "A session that has already started gets an 'expired' seat page with no sala, so the slot is resolved from "
        "its latest session (only seat 450003 is requested) and every date inherits VP.",
        ["test_a_slot_is_resolved_from_its_latest_session_not_one_that_has_started"],
    )
    latest.page(_CARTELLERA, _cartellera("/obsession"))
    latest.page(
        f"{VERDI}/obsession",
        _ld_json() + _vo(450001, 28, "16:00") + _vo(450002, 29, "16:00") + _vo(450003, 30, "16:00"),
    )
    latest.page(f"{ADMIT_ONE}/450001/", _SEAT_EXPIRED)
    latest.page(f"{ADMIT_ONE}/450003/", _SEAT_VP)

    cached = _verdi_case(
        "sala-map-skips-network",
        "A session already in the cached sala map costs no seat request: its VP assignment is reused.",
        [
            "test_fetch_skips_network_when_session_is_in_cached_sala_map",
            "test_cached_sala_map_extracts_session_ids_from_booking_urls",
        ],
        salaMap={"700001": "VP"},
    )
    cached.page(_CARTELLERA, _cartellera("/obsession"))
    cached.page(f"{VERDI}/obsession", _ld_json() + _session(700001, "20260628203000", "20:30"))

    slot_mate = _verdi_case(
        "sala-map-any-session-in-slot",
        "Only a later date's session is cached; the whole 20:30 slot takes its sala and no seat page is requested.",
        ["test_fetch_uses_cached_sala_from_any_session_in_the_slot"],
        salaMap={"800002": "VP"},
    )
    slot_mate.page(_CARTELLERA, _cartellera("/obsession"))
    slot_mate.page(
        f"{VERDI}/obsession",
        _ld_json() + _session(800001, "20260628203000", "20:30") + _session(800002, "20260629203000", "20:30"),
    )

    miss = _verdi_case(
        "sala-map-miss-falls-back-to-lookup",
        "A cached map that lacks this session still triggers the lookup.",
        ["test_fetch_falls_back_to_lookup_for_sessions_absent_from_cache"],
        salaMap={"111111": "VP"},
    )
    miss.page(_CARTELLERA, _cartellera("/obsession"))
    miss.page(f"{VERDI}/obsession", _ld_json() + _session(900001, "20260628203000", "20:30"))
    miss.page(f"{ADMIT_ONE}/900001/", _SEAT_VERDI)

    variants = _verdi_case(
        "film-page-variants",
        "Film pages in the shapes seen: sameAs as a list of URLs, sameAs absent (no imdb_id), a JSON-LD array root "
        "(film skipped), no JSON-LD (skipped), only dubbed sessions (skipped), and one page answering 500 (counted "
        "as a failed film page, 1 of 6).",
        [
            "test_extract_film_meta_handles_same_as_as_list",
            "test_extract_film_meta_tolerates_json_ld_array_root",
            "test_extract_film_meta_returns_none_when_no_ldjson",
            "test_fetch_skips_a_film_whose_page_fails_and_reports_it",
        ],
    )
    variants.page(
        _CARTELLERA,
        _cartellera("/same-as-list", "/no-same-as", "/array-root", "/no-ld-json", "/dubbed-only", "/broken-page"),
    )
    variants.page(
        f"{VERDI}/same-as-list",
        _ld_json("Obsession", ["https://www.imdb.com/title/tt12345678", "https://www.wikidata.org/wiki/Q1"])
        + _session(500001, "20260628183000", "18:30"),
    )
    variants.page(f"{VERDI}/no-same-as", _ld_json("Quiet Film", None) + _session(500002, "20260628200000", "20:00"))
    variants.page(
        f"{VERDI}/array-root",
        '<script type="application/ld+json">[{"@type":"Movie"}]</script>' + _session(500003, "20260628210000", "21:00"),
    )
    variants.page(f"{VERDI}/no-ld-json", "<html>" + _session(500004, "20260628220000", "22:00") + "</html>")
    variants.page(
        f"{VERDI}/dubbed-only", _ld_json("Dubbed Film") + _session(500005, "20260628170000", "17:00", "CASTELLÀ")
    )
    variants.page(f"{VERDI}/broken-page", "<html>boom</html>\n", status=500)
    variants.page(f"{ADMIT_ONE}/500001/", _SEAT_VERDI)
    variants.page(f"{ADMIT_ONE}/500002/", _SEAT_VP)

    merged = _verdi_case(
        "same-film-on-several-pages",
        "Four film pages carry the same film (one answers 500): the copies merge into one movie, identical "
        "showtimes collapse.",
        ["test_fetch_skips_a_film_whose_page_fails_and_reports_it"],
    )
    merged.page(_CARTELLERA, _cartellera("/obsession", "/two", "/three", "/four"))
    for slug, sid in (("/obsession", 320001), ("/two", 320002), ("/three", 320003)):
        merged.page(f"{VERDI}{slug}", _ld_json() + _vo(sid, 28, "18:00"))
    merged.page(f"{VERDI}/four", "<html>boom</html>\n", status=500)
    for sid in (320001, 320002, 320003):
        merged.page(f"{ADMIT_ONE}/{sid}/", _SEAT_VERDI)

    down = _verdi_case(
        "cartellera-down",
        "The cartellera answering 503 propagates as an error (a provider failure, not an empty result).",
        ["test_fetch_raises_when_cartellera_fetch_fails"],
    )
    down.page(_CARTELLERA, "<html>unavailable</html>\n", status=503)
    return [vo, park, mixed, one_of_five, unresolved, dedup, latest, cached, slot_mate, miss, variants, merged, down]


# ── sensacine ────────────────────────────────────────────────────────────────

_SENSA_TESTS = "tests/test_sensacine_provider.py"
_MOOBY_TEMPLATE = "https://moobycinemas-balmes.admit-one.eu/?p=tickets&perfCode=188474&language=%s&theatre=%s"


def _st(starts_at: str, tags: list[str], ticketing: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    st: dict[str, Any] = {"startsAt": starts_at, "tags": tags}
    if ticketing is not None:
        st["data"] = {"ticketing": ticketing}
    return st


def _entry(title: str, languages: list[str], original: list[Any], internal_id: int = 1) -> dict[str, Any]:
    return {
        "movie": {"title": title, "internalId": internal_id, "languages": languages, "poster": None},
        "showtimes": {"dubbed": [], "original": original, "local": []},
    }


def _results(*entries: Any) -> dict[str, Any]:
    return {"error": False, "results": list(entries), "nextDate": None}


def _ticket(provider: str, url: str) -> dict[str, Any]:
    return {"provider": provider, "urls": [url]}


def _sensacine_url(theatre: str, day: str) -> str:
    return f"{SENSACINE}/theater-{theatre}/d-{day}/"


_SUPERGIRL_JUNE_29 = _entry(
    "Supergirl",
    ["ENGLISH"],
    [
        _st(
            "2026-06-29T16:00:00",
            ["Localization.Version.Original", "Localization.Subtitle.Spanish", "Format.Projection.Digital"],
            [
                _ticket("relay", "https://relay.mvtx.us/ticketing/dbz?code=Vose"),
                _ticket("default", "https://www.cinesa.es/compra/butacas/?showtimeId=012-51716"),
            ],
        ),
        _st(
            "2026-06-29T21:10:00",
            ["Localization.Version.Original", "Localization.Subtitle.Spanish", "Format.Projection.Imax"],
            [_ticket("default", "https://www.cinesa.es/compra/butacas/?showtimeId=012-51718")],
        ),
    ],
    266720,
)
_SPANISH_FILM = _entry(
    "Película en Español",
    ["SPANISH"],
    [_st("2026-06-29T19:00:00", ["Localization.Version.Original", "Localization.Subtitle.Spanish"], [])],
    999,
)
_MYSTERY_FILM = _entry(
    "Mystery Film",
    [],
    [
        _st(
            "2026-06-29T20:00:00",
            ["Localization.Version.Original", "Localization.Subtitle.Catalan"],
            [_ticket("relay", "https://relay.mvtx.us/ticketing/xyz")],
        )
    ],
    777,
)


def _sensacine_case(name: str, description: str, source: list[str], now: str, ids: dict[str, str], days: int) -> Case:
    return Case(
        "sensacine",
        name,
        description,
        [f"{_SENSA_TESTS}::{s}" for s in source],
        now,
        fields={"sensacine": {"ids": ids, "daysAhead": days}},
    )


def _sensacine() -> list[Case]:
    main = _sensacine_case(
        "english-films-booking-and-formats",
        "Two theatres over two days. English-only filter (unknown language kept); 'default' ticketing provider "
        "preferred over relay, relay as fallback; a default admit-one template that can't be filled is skipped; "
        "Mooby's template filled with ENG and the theatre code (Balmes); subtitle and premium-format tags; "
        "junk entries; the same film merged across theatres and days.",
        [
            "test_fetch_returns_english_films_only",
            "test_fetch_sets_booking_url_from_default_provider",
            "test_fetch_sets_subtitle_lang_from_tags",
            "test_fetch_sets_premium_format_from_tags",
            "test_fetch_sets_audio_lang_english_for_english_film",
            "test_fetch_uses_relay_url_when_no_default",
            "test_fetch_fills_the_mooby_template_with_that_cinemas_theatre",
            "test_fetch_dedupes_same_movie_across_dates",
            "TestHelpers::test_booking_url_skips_a_template_it_cannot_fill",
        ],
        "2026-06-29T10:00:00+02:00",
        {"CinDiag": "E0381", "Balmes": "E0808"},
        2,
    )
    main.payload(
        _sensacine_url("E0381", "2026-06-29"),
        _results(
            _SUPERGIRL_JUNE_29,
            _SPANISH_FILM,
            _MYSTERY_FILM,
            "bogus-entry",
            _entry("", ["ENGLISH"], [_st("2026-06-29T18:00:00", [])]),
            _entry("Dubbed Only", ["ENGLISH"], []),
            _entry(
                "Sloppy Times",
                ["ENGLISH"],
                [
                    _st("", []),
                    _st("2026-06-29", []),
                    _st("2026-06-29T22:30:00", ["Localization.Subtitle.English", "Format.Projection.Imax3D"]),
                    _st(
                        "2026-06-29T23:30:00", ["Localization.Subtitle.Catalan"], [_ticket("default", _MOOBY_TEMPLATE)]
                    ),
                ],
            ),
        ),
    )
    main.payload(
        _sensacine_url("E0381", "2026-06-30"),
        _results(
            _entry(
                "Supergirl",
                ["ENGLISH"],
                [
                    _st(
                        "2026-06-30T16:00:00",
                        ["Localization.Subtitle.Spanish"],
                        [_ticket("default", "https://www.cinesa.es/compra/butacas/?showtimeId=012-52000")],
                    )
                ],
                266720,
            ),
            _entry(
                "Template Film",
                ["ENGLISH"],
                [
                    _st(
                        "2026-06-30T18:00:00",
                        [],
                        [_ticket("relay", "https://relay.mvtx.us/ticketing/tpl"), _ticket("default", _MOOBY_TEMPLATE)],
                    ),
                    _st("2026-06-30T20:00:00", [], [_ticket("default", _MOOBY_TEMPLATE)]),
                ],
            ),
        ),
    )
    main.payload(
        _sensacine_url("E0808", "2026-06-29"),
        _results(
            _entry(
                "Digger",
                ["ENGLISH"],
                [
                    _st("2026-06-29T16:00:00", [], [_ticket("default", _MOOBY_TEMPLATE)]),
                    _st(
                        "2026-06-29T19:00:00",
                        ["Format.Projection.Imax"],
                        [
                            _ticket("relay", "https://relay.mvtx.us/ticketing/digger"),
                            _ticket("default", _MOOBY_TEMPLATE),
                        ],
                    ),
                ],
                1234,
            ),
            _SUPERGIRL_JUNE_29,
        ),
    )
    main.payload(_sensacine_url("E0808", "2026-06-30"), {"error": False, "results": None, "nextDate": None})

    failure = _sensacine_case(
        "page-failure-reported",
        "Four pages, one answers 503: the rest are kept and the failure reported (1 of 4, within the limit).",
        ["test_fetch_keeps_the_rest_when_a_few_pages_fail_and_reports_them"],
        "2026-06-29T10:00:00+02:00",
        {"CinDiag": "E0381", "Malda": "E0682"},
        2,
    )
    for theatre in ("E0381", "E0682"):
        for day in ("2026-06-29", "2026-06-30"):
            failing = theatre == "E0381" and day == "2026-06-29"
            failure.payload(
                _sensacine_url(theatre, day),
                {"error": True} if failing else _results(_SUPERGIRL_JUNE_29),
                503 if failing else 200,
            )

    every = _sensacine_case(
        "every-page-fails",
        "Both pages answer 503: past the failure limit the fetch raises PartialFetchError.",
        ["test_fetch_fails_when_every_page_fails"],
        "2026-06-29T10:00:00+02:00",
        {"CinDiag": "E0381", "Malda": "E0682"},
        1,
    )
    for theatre in ("E0381", "E0682"):
        every.payload(_sensacine_url(theatre, "2026-06-29"), {"error": True}, 503)

    boundary = _sensacine_case(
        "madrid-day-boundary",
        "22:30 UTC in July is already the next day in Madrid: the pages asked for start on the Madrid date.",
        ["TestFetchDates::test_picks_madrid_day_when_utc_still_on_previous_day"],
        "2026-07-14T22:30:00+00:00",
        {"CinDiag": "E0381"},
        2,
    )
    boundary.payload(_sensacine_url("E0381", "2026-07-15"), _results(_SUPERGIRL_JUNE_29))
    boundary.payload(_sensacine_url("E0381", "2026-07-16"), _results())
    return [main, failure, every, boundary]


def cases() -> list[Case]:
    return [*_listings(), *_secondary(), *_verdi(), *_sensacine()]
