"""
Lambda entry point — headless scheduled generator. No public HTTP surface.

The frontend is a static SSG site served by CloudFront from S3; there is no
runtime read API. This Lambda only:
  * answers warmup pings ({"source": "warmup"}) to stay warm, and
  * runs the 12h EventBridge refresh ({"source": "aws.events"}), which scrapes +
    enriches, writes the cache, publishes the public listings JSON, and triggers
    the Node SSG renderer to regenerate the static pages.

All orchestration is delegated to pipeline.py.
"""

import logging
import os
from typing import Any

from dotenv import load_dotenv

if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
    load_dotenv()

import observability  # noqa: E402
import pipeline  # noqa: E402

# Lambda's runtime installs a root-logger handler before this module imports,
# so logging.basicConfig() is a no-op there and INFO logs (incl. EMF metrics)
# get dropped. Set the root level explicitly instead.
logging.getLogger().setLevel(logging.INFO)


def handler(event: dict[str, Any], context: Any) -> dict[str, int]:
    """
    Lambda entry point.

    Warmup ping events have {"source": "warmup"} and are returned immediately to
    keep the container alive without triggering any business logic.

    EventBridge scheduled events have {"source": "aws.events"} and are routed to
    pipeline.force_refresh(), which refreshes the cache and regenerates the site.
    """
    source = event.get("source")
    if source == "warmup":
        logging.info("Warmup ping received")
        return {"statusCode": 200}
    if source == "aws.events":
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

    logging.warning("Ignoring event with unrecognized source: %r", source)
    return {"statusCode": 200}
