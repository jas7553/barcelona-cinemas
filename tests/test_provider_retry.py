"""
One retry per Provider on a transient error or zero films, and the diagnostics
logged when a fetch fails or comes back empty. The clock and sleep are faked: nothing here waits.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import requests

import refresh
from providers import diagnostics

from .conftest import FindEvent
from .test_refresh import NOW, _build, _find_metrics, _provider, _raw_movie, _snapshot_cache

_VERDI_URL = "https://barcelona.cines-verdi.com/cartellera"


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.fixture
def clock() -> Iterator[_Clock]:
    fake = _Clock()
    with (
        patch.object(refresh, "_monotonic", fake.monotonic),
        patch.object(refresh, "_sleep", fake.sleep),
        patch.object(diagnostics, "egress_ip", return_value="3.250.1.2"),
        patch.object(diagnostics, "_resolve", return_value=["34.1.2.3"]),
    ):
        yield fake


def _connect_timeout() -> requests.ConnectTimeout:
    return requests.ConnectTimeout("timed out", request=requests.Request("GET", _VERDI_URL).prepare())


def _http_error(status: int) -> requests.HTTPError:
    response = requests.Response()
    response.status_code = status
    response.url = _VERDI_URL
    return requests.HTTPError(f"{status}", response=response)


def _failing_after(clock: _Clock, seconds: float, *outcomes: Exception | list[dict[str, Any]]) -> Callable[[Any], Any]:
    """A fetch that takes `seconds` per call and plays `outcomes` in order."""
    remaining = list(outcomes)

    def fetch(_cinemas: Any) -> Any:
        clock.now += seconds
        outcome = remaining.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    return fetch


def test_a_transient_failure_succeeds_on_retry(
    clock: _Clock, caplog: pytest.LogCaptureFixture, find_event: FindEvent
) -> None:
    fetch = _failing_after(clock, 15, _connect_timeout(), [_raw_movie("Valid Film")])

    listings, stats = _build([_provider("verdi", fetch=fetch)])

    assert [m["title"] for m in listings["movies"]] == ["Valid Film"]
    assert stats["provider_failure_count"] == 0
    assert clock.sleeps == [refresh._RETRY_DELAY_S]
    assert len(_find_metrics(caplog, "ProviderRetry")) == 1
    assert _find_metrics(caplog, "ProviderFailure") == []
    retry = find_event("provider_retry")
    assert retry["attempt"] == 1
    assert retry["exception_type"] == "ConnectTimeout"
    assert retry["elapsed_ms"] == 15000
    assert retry["host"] == "barcelona.cines-verdi.com"
    assert retry["host_ips"] == ["34.1.2.3"]
    assert retry["egress_ip"] == "3.250.1.2"


def test_a_provider_still_failing_after_its_retry_is_a_failure(
    clock: _Clock, caplog: pytest.LogCaptureFixture, find_event: FindEvent
) -> None:
    fetch = _failing_after(clock, 1, _http_error(403), _http_error(403))
    providers = [_provider("verdi", fetch=fetch), _provider("two", [_raw_movie("Valid Film")])]

    _, stats = _build(providers)

    assert stats["provider_failure_count"] == 1
    assert len(_find_metrics(caplog, "ProviderRetry")) == 1
    assert len(_find_metrics(caplog, "ProviderFailure")) == 1
    failure = find_event("collection_failure")
    assert failure["outcome"] == "retry_failed"
    assert failure["attempt"] == 2
    assert failure["http_status"] == 403
    assert failure["total_elapsed_ms"] == 32000
    assert failure["egress_ip"] == "3.250.1.2"


@pytest.mark.parametrize("exc", [ValueError("bad markup"), _http_error(404)])
def test_a_non_transient_failure_is_not_retried(
    exc: Exception, clock: _Clock, caplog: pytest.LogCaptureFixture, find_event: FindEvent
) -> None:
    fetch = _failing_after(clock, 1, exc)
    providers = [_provider("verdi", fetch=fetch), _provider("two", [_raw_movie("Valid Film")])]

    _build(providers)

    assert clock.sleeps == []
    assert _find_metrics(caplog, "ProviderRetry") == []
    assert len(_find_metrics(caplog, "ProviderFailure")) == 1
    assert find_event("collection_failure")["outcome"] == "not_retryable"


def test_a_retry_that_would_overrun_the_budget_is_skipped(
    clock: _Clock, caplog: pytest.LogCaptureFixture, find_event: FindEvent
) -> None:
    late = refresh._RETRY_START_DEADLINE_S - refresh._RETRY_DELAY_S + 1
    fetch = _failing_after(clock, late, requests.ReadTimeout("read timed out"), [_raw_movie("Never Fetched")])
    providers = [_provider("verdi", fetch=fetch), _provider("two", [_raw_movie("Valid Film")])]

    listings, _ = _build(providers)

    assert [m["title"] for m in listings["movies"]] == ["Valid Film"]
    assert clock.sleeps == []
    assert _find_metrics(caplog, "ProviderRetry") == []
    assert find_event("collection_failure")["outcome"] == "over_budget"


def test_a_failure_just_inside_the_budget_is_retried(clock: _Clock) -> None:
    on_time = refresh._RETRY_START_DEADLINE_S - refresh._RETRY_DELAY_S
    fetch = _failing_after(clock, on_time, _connect_timeout(), [_raw_movie("Valid Film")])

    listings, _ = _build([_provider("secondary", fetch=fetch)])

    assert [m["title"] for m in listings["movies"]] == ["Valid Film"]


def test_time_spent_gathering_diagnostics_counts_against_the_budget(clock: _Clock, find_event: FindEvent) -> None:
    def slow_egress_ip() -> str:
        clock.now += 3
        return "3.250.1.2"

    on_time = refresh._RETRY_START_DEADLINE_S - refresh._RETRY_DELAY_S - 1
    fetch = _failing_after(clock, on_time, _connect_timeout(), [_raw_movie("Never Fetched")])
    providers = [_provider("verdi", fetch=fetch), _provider("two", [_raw_movie("Valid Film")])]

    with patch.object(diagnostics, "egress_ip", slow_egress_ip):
        _build(providers)

    assert clock.sleeps == []
    assert find_event("collection_failure")["outcome"] == "over_budget"


@pytest.mark.parametrize(
    ("exc", "retryable"),
    [
        (requests.ConnectionError("refused"), True),
        (requests.ConnectTimeout("timed out"), True),
        (requests.ReadTimeout("timed out"), True),
        (_http_error(403), True),
        (_http_error(429), True),
        (_http_error(503), True),
        (_http_error(404), False),
        (ValueError("bad json"), False),
    ],
)
def test_is_retryable(exc: Exception, retryable: bool) -> None:
    assert diagnostics.is_retryable(exc) is retryable


def test_egress_ip_never_raises() -> None:
    with patch.object(requests, "get", MagicMock(side_effect=requests.ConnectTimeout("no route"))):
        assert diagnostics.egress_ip() is None


def test_diagnostics_skip_network_lookups_for_non_network_errors() -> None:
    with patch.object(requests, "get") as get, patch("socket.getaddrinfo") as resolve:
        assert diagnostics.failure_diagnostics(ValueError("bad markup")) == {"http_status": None}
    get.assert_not_called()
    resolve.assert_not_called()


def test_a_successful_retry_needs_no_fallback(clock: _Clock, caplog: pytest.LogCaptureFixture) -> None:
    fetch = _failing_after(clock, 1, _connect_timeout(), [_raw_movie("Fresh")])
    cached = _snapshot_cache({"verdi": (NOW.isoformat(), [_raw_movie("Snapshot")])})

    listings, stats = _build([_provider("verdi", fetch=fetch)], cached=cached)

    assert [m["title"] for m in listings["movies"]] == ["Fresh"]
    assert stats["provider_fallback_count"] == 0
    assert _find_metrics(caplog, "ProviderFallback") == []


def test_the_fallback_follows_an_exhausted_retry(clock: _Clock, find_event: FindEvent) -> None:
    fetch = _failing_after(clock, 1, _connect_timeout(), _connect_timeout())
    cached = _snapshot_cache({"verdi": (NOW.isoformat(), [_raw_movie("Snapshot")])})

    listings, stats = _build([_provider("verdi", fetch=fetch), _provider("two", [_raw_movie("Fresh")])], cached=cached)

    assert clock.sleeps == [refresh._RETRY_DELAY_S]
    assert sorted(m["title"] for m in listings["movies"]) == ["Fresh", "Snapshot"]
    assert stats["provider_fallback_count"] == 1
    assert find_event("collection_failure")["outcome"] == "retry_failed"
    assert find_event("provider_fallback")["trigger"] == "failure"


def _challenge_page() -> requests.Response:
    response = requests.Response()
    response.status_code = 200
    response.url = "https://www.moobycinemas.com/cartelera"
    response.headers["Content-Type"] = "text/html"
    response._content = b"<html>\n  <title>Just a moment...</title>\n" + b"x" * 1000
    return response


def _empty_page_then(clock: _Clock, *outcomes: list[dict[str, Any]]) -> Callable[[Any], Any]:
    """A fetch that lands on a challenge page each call and plays `outcomes` in order."""
    remaining = list(outcomes)

    def fetch(_cinemas: Any) -> Any:
        clock.now += 1
        diagnostics.record_entry_response(_challenge_page())
        return remaining.pop(0)

    return fetch


def test_zero_films_are_retried_and_the_entry_page_logged(
    clock: _Clock, caplog: pytest.LogCaptureFixture, find_event: FindEvent
) -> None:
    fetch = _empty_page_then(clock, [], [_raw_movie("Valid Film")])

    listings, _ = _build([_provider("secondary", fetch=fetch)])

    assert [m["title"] for m in listings["movies"]] == ["Valid Film"]
    assert clock.sleeps == [refresh._RETRY_DELAY_S]
    assert _find_metrics(caplog, "ProviderZeroResult") == []
    retry = find_event("provider_retry")
    assert (retry["reason"], retry["http_status"], retry["host"]) == ("zero_result", 200, "www.moobycinemas.com")
    assert retry["body_head"].startswith("<html> <title>Just a moment...</title> xxx")
    assert len(retry["body_head"]) == 300


def test_zero_films_after_the_retry_log_the_entry_page(clock: _Clock, find_event: FindEvent) -> None:
    fetch = _empty_page_then(clock, [], [])

    _build([_provider("secondary", fetch=fetch), _provider("two", [_raw_movie("Fresh")])])

    assert find_event("provider_zero_result")["http_status"] == 200


def test_zero_films_past_the_budget_are_not_retried(clock: _Clock, caplog: pytest.LogCaptureFixture) -> None:
    late = refresh._RETRY_START_DEADLINE_S - refresh._RETRY_DELAY_S + 1
    fetch = _failing_after(clock, late, [], [_raw_movie("Never Fetched")])

    _build([_provider("secondary", fetch=fetch), _provider("two", [_raw_movie("Valid Film")])])

    assert clock.sleeps == []
    assert len(_find_metrics(caplog, "ProviderZeroResult")) == 1
