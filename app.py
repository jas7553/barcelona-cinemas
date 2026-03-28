"""
HTTP layer only. No business logic lives here.
All orchestration is delegated to pipeline.py.
"""

import logging
import os
from typing import Any

from asgiref.wsgi import WsgiToAsgi
from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, send_from_directory
from mangum import Mangum
from werkzeug.exceptions import HTTPException

load_dotenv()

import cache  # noqa: E402
import observability  # noqa: E402
import pipeline  # noqa: E402

logging.basicConfig(level=logging.INFO)

app = Flask(__name__, static_folder="static", static_url_path="")

_ORIGIN_AUTH_HEADER = "X-Origin-Verify"
_ORIGIN_AUTH_ENV = "ORIGIN_VERIFY_TOKEN"
_GENERIC_SERVER_ERROR = "Internal server error"
_GENERIC_SERVICE_UNAVAILABLE = "Service unavailable"
_LOCAL_DEBUG_ENV = "APP_DEBUG"


@app.get("/")
def index() -> Any:
    return send_from_directory(app.static_folder, "index.html")  # type: ignore[arg-type]


@app.get("/api/cinemas")
def cinemas() -> Any:
    try:
        return jsonify(pipeline.load_cinemas())
    except Exception:
        logging.exception("Failed to load cinemas")
        return _api_error(_GENERIC_SERVER_ERROR, 500)


@app.get("/api/listings")
def listings() -> Any:
    try:
        payload = pipeline.get_listings()
        g.listings_stale = payload.get("stale", False)
        g.listings_fallback_used = False
        g.listings_cache_age_hours = cache.age_hours(payload)
        return jsonify(payload)
    except Exception:
        logging.exception("Failed to get listings")
        return _stale_or_error()


@app.before_request
def require_trusted_origin_for_api() -> Any | None:
    """
    In production, CloudFront injects a shared-secret header for every /api/*
    request. Direct API Gateway calls do not have that header and are rejected.

    Local development leaves ORIGIN_VERIFY_TOKEN unset, which keeps localhost
    requests working without extra setup.
    """
    if not request.path.startswith("/api/"):
        return None
    g.request_started_ms = observability.now_ms()
    g.request_id = observability.new_id("req")
    observability.set_context(request_id=g.request_id, route=request.path, trigger="http")

    expected_token = os.environ.get(_ORIGIN_AUTH_ENV)
    if not expected_token:
        return None

    provided_token = request.headers.get(_ORIGIN_AUTH_HEADER)
    if provided_token == expected_token:
        return None

    logging.warning("Rejected API request without trusted origin header for path %s", request.path)
    return _api_error("Forbidden", 403)


@app.after_request
def add_api_observability(response: Any) -> Any:
    if not _is_api_request():
        return response

    request_id = getattr(g, "request_id", None)
    if request_id:
        response.headers["X-Request-Id"] = request_id

    if request.path == "/api/listings":
        duration_ms = round(observability.now_ms() - getattr(g, "request_started_ms", observability.now_ms()), 2)
        stale = bool(getattr(g, "listings_stale", False))
        fallback_used = bool(getattr(g, "listings_fallback_used", False))
        cache_age_hours = getattr(g, "listings_cache_age_hours", None)
        observability.emit_metric("ListingsRequest", 1)
        if response.status_code >= 500:
            observability.emit_metric("ListingsError", 1)
        if stale:
            observability.emit_metric("ListingsStaleResponse", 1)
        observability.log_event(
            "listings_request_summary",
            route=request.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
            stale=stale,
            fallback_used=fallback_used,
            cache_age_hours=cache_age_hours,
        )
    observability.clear_context()
    return response


@app.errorhandler(HTTPException)
def handle_http_exception(exc: HTTPException) -> Any:
    if not _is_api_request():
        return exc
    return _api_error(exc.name, exc.code or 500)


@app.errorhandler(Exception)
def handle_unexpected_exception(exc: Exception) -> Any:
    if not _is_api_request():
        raise exc
    logging.exception("Unhandled API exception")
    return _api_error(_GENERIC_SERVER_ERROR, 500)


def _stale_or_error() -> Any:
    try:
        stale = cache.read()
    except Exception:
        logging.exception("Failed to read stale cache during listings fallback")
        stale = None

    if stale:
        stale["stale"] = True
        g.listings_stale = True
        g.listings_fallback_used = True
        g.listings_cache_age_hours = cache.age_hours(stale)
        return jsonify(stale)
    g.listings_stale = False
    g.listings_fallback_used = False
    g.listings_cache_age_hours = None
    return _api_error(_GENERIC_SERVICE_UNAVAILABLE, 503)


def _api_error(message: str, status_code: int) -> Any:
    return jsonify({"error": message}), status_code


def _is_api_request() -> bool:
    return request.path.startswith("/api/")


def _debug_enabled() -> bool:
    """
    Only allow Werkzeug debug mode in explicit local development.

    This prevents a stray APP_DEBUG setting from enabling the interactive
    debugger in deployed Lambda or other hosted environments.
    """
    if os.environ.get("AWS_LAMBDA_FUNCTION_NAME") or os.environ.get("AWS_EXECUTION_ENV"):
        return False
    return os.environ.get(_LOCAL_DEBUG_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


_mangum_handler: Any | None = None


def _get_mangum_handler() -> Any:
    global _mangum_handler
    if _mangum_handler is None:
        _mangum_handler = Mangum(WsgiToAsgi(app), lifespan="off")  # type: ignore[no-untyped-call]
    return _mangum_handler


def handler(event: dict[str, Any], context: Any) -> Any:
    """
    Lambda entry point.

    EventBridge scheduled events have {"source": "aws.events"} and are routed
    to pipeline.force_refresh() to proactively warm the S3 cache.

    All other events (HTTP API Gateway proxy format) are delegated to Mangum,
    which translates them into WSGI requests for Flask.
    """
    if event.get("source") == "aws.events":
        logging.info("EventBridge scheduled refresh triggered")
        refresh_id = observability.new_id("refresh")
        observability.set_context(refresh_id=refresh_id, trigger="schedule")
        observability.log_event("refresh_started")
        try:
            pipeline.force_refresh()
            logging.info("Scheduled refresh completed")
        except Exception:
            logging.exception("Scheduled refresh failed")
        finally:
            observability.clear_context()
        return {"statusCode": 200}
    return _get_mangum_handler()(event, context)

if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 5000)), debug=_debug_enabled())
