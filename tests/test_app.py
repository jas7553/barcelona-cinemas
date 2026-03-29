"""Tests for app.py request hardening and safe API behavior."""

import logging
from typing import Any

import pytest

import app
import cache
import pipeline
from models import Listings, Movie


@pytest.fixture()
def client() -> Any:
    app.app.config["TESTING"] = True
    return app.app.test_client()


def _listings() -> Listings:
    return Listings(fetched_at="2026-03-28T12:00:00+00:00", stale=False, movies=[])


def _movie(imdb_id: str | None) -> Movie:
    return Movie(
        title="Dune: Part Two",
        tmdb_id=42,
        imdb_id=imdb_id,
        year=2024,
        poster_url="https://image.tmdb.org/t/p/w342/dune.jpg",
        synopsis="A hero's journey continues.",
        rating=8.5,
        runtime_mins=166,
        genres=["Science Fiction"],
        showtimes=[],
    )


def test_api_allows_local_requests_when_origin_token_unset(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)
    monkeypatch.setattr(
        pipeline,
        "load_cinemas",
        lambda: {"verdi": {"address": "", "neighborhood": "Gracia"}},
    )

    response = client.get("/api/cinemas")

    assert response.status_code == 200


def test_api_rejects_direct_requests_when_origin_token_is_configured(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(app._ORIGIN_AUTH_ENV, "shared-secret")

    response = client.get("/api/cinemas")

    assert response.status_code == 403
    assert response.get_json() == {"error": "Forbidden"}


def test_api_accepts_requests_with_matching_origin_header(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(app._ORIGIN_AUTH_ENV, "shared-secret")
    monkeypatch.setattr(pipeline, "get_listings", _listings)
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})

    response = client.get("/api/listings", headers={app._ORIGIN_AUTH_HEADER: "shared-secret"})

    assert response.status_code == 200
    assert response.get_json() == {
        "generated_at": "2026-03-28T12:00:00+00:00",
        "stale": False,
        "theaters": [],
        "movies": [],
    }
    assert response.headers["X-Request-Id"].startswith("req-")


def test_api_listings_includes_imdb_link_for_valid_movie(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)
    monkeypatch.setattr(
        pipeline,
        "get_listings",
        lambda: Listings(
            fetched_at="2026-03-28T12:00:00+00:00",
            stale=False,
            movies=[_movie("tt15239678")],
        ),
    )
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})

    response = client.get("/api/listings")

    assert response.status_code == 200
    movie = response.get_json()["movies"][0]
    assert movie["links"]["imdb"] == "https://www.imdb.com/title/tt15239678"
    assert movie["poster_url"] == "https://image.tmdb.org/t/p/w342/dune.jpg"
    assert set(movie["links"].keys()) == {"imdb"}


def test_api_listings_includes_null_imdb_link_when_missing(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)
    monkeypatch.setattr(
        pipeline,
        "get_listings",
        lambda: Listings(
            fetched_at="2026-03-28T12:00:00+00:00",
            stale=False,
            movies=[_movie(None)],
        ),
    )
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})

    response = client.get("/api/listings")

    assert response.status_code == 200
    movie = response.get_json()["movies"][0]
    assert "links" in movie
    assert movie["links"]["imdb"] is None


def test_api_rejects_requests_with_wrong_origin_header(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(app._ORIGIN_AUTH_ENV, "shared-secret")

    response = client.get("/api/listings", headers={app._ORIGIN_AUTH_HEADER: "wrong-secret"})

    assert response.status_code == 403
    assert response.get_json() == {"error": "Forbidden"}


def test_listings_returns_stale_cache_when_pipeline_errors(
    client: Any, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="observability")
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)
    monkeypatch.setattr(pipeline, "get_listings", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(
        cache,
        "read",
        lambda: Listings(fetched_at="2026-03-28T12:00:00+00:00", stale=False, movies=[]),
    )
    monkeypatch.setattr(pipeline, "load_cinemas", lambda: {})

    response = client.get("/api/listings")

    assert response.status_code == 200
    assert response.get_json() == {
        "generated_at": "2026-03-28T12:00:00+00:00",
        "stale": True,
        "theaters": [],
        "movies": [],
    }
    assert '"event": "listings_request_summary"' in caplog.text
    assert '"fallback_used": true' in caplog.text


def test_listings_returns_503_when_cache_is_unavailable(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)
    monkeypatch.setattr(
        pipeline,
        "get_listings",
        lambda: (_ for _ in ()).throw(RuntimeError("cache missing")),
    )
    monkeypatch.setattr(cache, "read", lambda: None)

    response = client.get("/api/listings")

    assert response.status_code == 503
    assert response.get_json() == {"error": "Service unavailable"}


def test_listings_returns_503_when_stale_cache_read_also_fails(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)
    monkeypatch.setattr(
        pipeline,
        "get_listings",
        lambda: (_ for _ in ()).throw(RuntimeError("provider failure details")),
    )
    monkeypatch.setattr(
        cache,
        "read",
        lambda: (_ for _ in ()).throw(RuntimeError("cache backend details")),
    )

    response = client.get("/api/listings")

    assert response.status_code == 503
    assert response.get_json() == {"error": "Service unavailable"}


def test_cinemas_returns_safe_500_when_loading_fails(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)
    monkeypatch.setattr(
        pipeline,
        "load_cinemas",
        lambda: (_ for _ in ()).throw(RuntimeError("secret config path")),
    )

    response = client.get("/api/cinemas")

    assert response.status_code == 500
    assert response.get_json() == {"error": "Internal server error"}


def test_api_404_uses_json_error_shape(client: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)

    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.get_json() == {"error": "Not Found"}


def test_api_405_uses_json_error_shape(client: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)

    response = client.post("/api/listings")

    assert response.status_code == 405
    assert response.get_json() == {"error": "Method Not Allowed"}


def test_api_unhandled_exception_uses_generic_json_500(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(app._ORIGIN_AUTH_ENV, raising=False)
    original_view = app.app.view_functions["cinemas"]

    def _test_crash() -> Any:
        raise RuntimeError("sensitive stack detail")

    monkeypatch.setitem(app.app.view_functions, "cinemas", _test_crash)

    response = client.get("/api/cinemas")

    assert response.status_code == 500
    assert response.get_json() == {"error": "Internal server error"}
    assert app.app.view_functions["cinemas"] is not original_view


def test_scheduled_refresh_failure_returns_200_without_error_details(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="observability")
    monkeypatch.setattr(
        pipeline,
        "force_refresh",
        lambda: (_ for _ in ()).throw(RuntimeError("tmdb outage details")),
    )

    response = app.handler({"source": "aws.events"}, context=None)

    assert response == {"statusCode": 200}
    assert '"event": "refresh_started"' in caplog.text


def test_warmup_ping_returns_200_without_calling_pipeline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = []
    monkeypatch.setattr(pipeline, "force_refresh", lambda: called.append("refresh"))

    response = app.handler({"source": "warmup"}, context=None)

    assert response == {"statusCode": 200}
    assert called == []


def test_debug_mode_is_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(app._LOCAL_DEBUG_ENV, raising=False)
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.delenv("AWS_EXECUTION_ENV", raising=False)

    assert app._debug_enabled() is False


def test_debug_mode_requires_explicit_local_env_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(app._LOCAL_DEBUG_ENV, "true")
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.delenv("AWS_EXECUTION_ENV", raising=False)

    assert app._debug_enabled() is True


def test_debug_mode_is_disabled_in_lambda_even_when_flag_is_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(app._LOCAL_DEBUG_ENV, "1")
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "barcelona-api")

    assert app._debug_enabled() is False
