"""Shared pytest fixtures."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

import pytest

# Signature of the `find_event` fixture, for annotating tests that take it.
FindEvent = Callable[[str], dict[str, Any]]


@pytest.fixture
def find_event(caplog: pytest.LogCaptureFixture) -> FindEvent:
    """
    Return a lookup for structured `log_event` payloads emitted during a test.

    `observability.log_event` serializes to JSON on the "observability" logger,
    so asserting on behaviour means parsing that back rather than substring
    matching on the rendered line.
    """
    caplog.set_level(logging.INFO, logger="observability")

    def find(event: str) -> dict[str, Any]:
        for record in caplog.records:
            if record.name != "observability":
                continue
            payload: dict[str, Any] = json.loads(record.message)
            if payload.get("event") == event:
                return payload
        raise AssertionError(f"no {event!r} event logged; saw {caplog.text!r}")

    return find
