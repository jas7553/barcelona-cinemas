"""Tests for the headless Lambda handler (app.py)."""

import logging

import pytest

import app
import pipeline


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


@pytest.mark.parametrize("source", ["something-else", "warmup", None])
def test_unrecognized_event_source_returns_200_without_refresh(
    monkeypatch: pytest.MonkeyPatch, source: str | None
) -> None:
    called: list[str] = []
    monkeypatch.setattr(pipeline, "force_refresh", lambda: called.append("refresh"))

    response = app.handler({"source": source}, context=None)

    assert response == {"statusCode": 200}
    assert called == []
