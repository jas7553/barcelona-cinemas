"""Tests for the headless Lambda handler (app.py)."""

import logging

import pytest

import app
import pipeline


def test_warmup_ping_returns_200_without_calling_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[str] = []
    monkeypatch.setattr(pipeline, "force_refresh", lambda: called.append("refresh"))

    response = app.handler({"source": "warmup"}, context=None)

    assert response == {"statusCode": 200}
    assert called == []


def test_scheduled_event_triggers_force_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[str] = []
    monkeypatch.setattr(pipeline, "force_refresh", lambda: called.append("refresh"))

    response = app.handler({"source": "aws.events"}, context=None)

    assert response == {"statusCode": 200}
    assert called == ["refresh"]


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


def test_unrecognized_event_source_returns_200_without_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[str] = []
    monkeypatch.setattr(pipeline, "force_refresh", lambda: called.append("refresh"))

    response = app.handler({"source": "something-else"}, context=None)

    assert response == {"statusCode": 200}
    assert called == []
