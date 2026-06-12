"""Helpers for runtime-resolved configuration values."""

import os
from typing import Any, cast

_resolved_cache: dict[str, str] = {}


def resolve_env_or_ssm(env_var: str, ssm_param_env_var: str, description: str) -> str:
    """
    Return a config value from the environment, or from the SSM parameter
    named by `ssm_param_env_var` (SecureString, decrypted).

    Local dev sets `env_var` directly; Lambda sets `ssm_param_env_var` and the
    value is fetched on first use, then cached for the process lifetime.
    """
    cached = _resolved_cache.get(env_var)
    if cached:
        return cached

    value = os.environ.get(env_var, "").strip()
    if value:
        _resolved_cache[env_var] = value
        return value

    param_name = os.environ.get(ssm_param_env_var, "").strip()
    if not param_name:
        raise OSError(f"Neither {env_var} nor {ssm_param_env_var} is set")

    import boto3  # type: ignore[import-untyped]  # imported lazily for local dev

    ssm: Any = boto3.client("ssm")
    response = ssm.get_parameter(Name=param_name, WithDecryption=True)
    parameter = cast(dict[str, Any], response.get("Parameter", {}))
    value = cast(str, parameter.get("Value", ""))
    if not value:
        raise OSError(f"{description} SSM parameter {param_name!r} did not contain a value")

    _resolved_cache[env_var] = value
    return value


def listings_feed_url() -> str:
    """Return the configured listings feed URL."""
    return resolve_env_or_ssm("LISTINGS_FEED_URL", "LISTINGS_FEED_SSM_PARAMETER", "Listings feed")
