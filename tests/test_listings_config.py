"""Tests for listings_config.py."""

from unittest.mock import MagicMock, patch

import pytest

import listings_config


@pytest.fixture(autouse=True)
def reset_cache(monkeypatch):
    monkeypatch.setattr(listings_config, "_cached_listings_feed_url", None)


def test_listings_feed_url_reads_direct_env(monkeypatch):
    monkeypatch.setenv("LISTINGS_FEED_URL", "https://example.com/listings")
    monkeypatch.delenv("LISTINGS_FEED_SSM_PARAMETER", raising=False)

    assert listings_config.listings_feed_url() == "https://example.com/listings"


def test_listings_feed_url_reads_ssm_parameter(monkeypatch):
    monkeypatch.delenv("LISTINGS_FEED_URL", raising=False)
    monkeypatch.setenv("LISTINGS_FEED_SSM_PARAMETER", "/app/listings-feed-url")
    ssm = MagicMock()
    ssm.get_parameter.return_value = {"Parameter": {"Value": "https://example.com/listings"}}

    with patch("boto3.client", return_value=ssm):
        assert listings_config.listings_feed_url() == "https://example.com/listings"

    ssm.get_parameter.assert_called_once_with(Name="/app/listings-feed-url", WithDecryption=True)


def test_listings_feed_url_prefers_env_over_ssm(monkeypatch):
    monkeypatch.setenv("LISTINGS_FEED_URL", "https://example.com/override")
    monkeypatch.setenv("LISTINGS_FEED_SSM_PARAMETER", "/app/listings-feed-url")

    with patch("boto3.client") as mock_client:
        assert listings_config.listings_feed_url() == "https://example.com/override"

    mock_client.assert_not_called()


def test_listings_feed_url_raises_when_unset(monkeypatch):
    monkeypatch.delenv("LISTINGS_FEED_URL", raising=False)
    monkeypatch.delenv("LISTINGS_FEED_SSM_PARAMETER", raising=False)

    with pytest.raises(
        OSError, match="Neither LISTINGS_FEED_URL nor LISTINGS_FEED_SSM_PARAMETER is set"
    ):
        listings_config.listings_feed_url()


def test_listings_feed_url_raises_when_ssm_value_empty(monkeypatch):
    monkeypatch.delenv("LISTINGS_FEED_URL", raising=False)
    monkeypatch.setenv("LISTINGS_FEED_SSM_PARAMETER", "/app/listings-feed-url")
    ssm = MagicMock()
    ssm.get_parameter.return_value = {"Parameter": {"Value": ""}}

    with (
        patch("boto3.client", return_value=ssm),
        pytest.raises(OSError, match="did not contain a value"),
    ):
        listings_config.listings_feed_url()
