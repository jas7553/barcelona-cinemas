"""Minimal structured logging and EMF metric helpers."""

from __future__ import annotations

import json
import logging
import os
from contextvars import ContextVar
from time import perf_counter, time
from typing import Literal
from uuid import uuid4

MetricUnit = Literal["Count", "Milliseconds", "None"]

_NAMESPACE = "BarcelonaMovieDatabase"
_logger = logging.getLogger("observability")
_context: ContextVar[dict[str, str] | None] = ContextVar("observability_context", default=None)


def environment() -> str:
    configured = os.environ.get("ENVIRONMENT", "").strip()
    if configured:
        return configured
    if os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return "prod"
    return "dev"


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def set_context(**values: str | None) -> None:
    current = dict(_context.get() or {})
    for key, value in values.items():
        if value is None:
            current.pop(key, None)
        else:
            current[key] = value
    _context.set(current)


def clear_context() -> None:
    _context.set(None)


def get_context() -> dict[str, str]:
    return dict(_context.get() or {})


def log_event(
    event: str,
    *,
    logger: logging.Logger | None = None,
    level: int = logging.INFO,
    **fields: object,
) -> None:
    payload: dict[str, object] = {
        "event": event,
        "environment": environment(),
        **get_context(),
        **fields,
    }
    (logger or _logger).log(level, json.dumps(payload, sort_keys=True, default=str))


def emit_metric(
    name: str,
    value: int | float,
    *,
    unit: MetricUnit = "Count",
    route: str | None = None,
    trigger: str | None = None,
) -> None:
    context = get_context()
    dimensions = {"Environment": environment()}
    route_value = route if route is not None else context.get("route")
    trigger_value = trigger if trigger is not None else context.get("trigger")
    if route_value:
        dimensions["Route"] = route_value
    if trigger_value:
        dimensions["Trigger"] = trigger_value

    payload: dict[str, object] = {
        "_aws": {
            "Timestamp": int(time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": _NAMESPACE,
                    "Dimensions": [list(dimensions.keys())],
                    "Metrics": [{"Name": name, "Unit": unit}],
                }
            ],
        },
        **dimensions,
        name: value,
    }
    _logger.info(json.dumps(payload, sort_keys=True, default=str))


def now_ms() -> float:
    return perf_counter() * 1000
