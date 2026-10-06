"""Template smoke tests for observability resources."""

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml  # type: ignore[import-untyped]

import app
import pipeline


class _CloudFormationLoader(yaml.SafeLoader):  # type: ignore[misc]
    pass


def _construct_passthrough(loader: yaml.SafeLoader, tag_suffix: str, node: yaml.nodes.Node) -> object:
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_mapping(node)


_CloudFormationLoader.add_multi_constructor("!", _construct_passthrough)


@pytest.fixture(scope="module")
def template() -> dict[str, Any]:
    return yaml.load(Path("template.yaml").read_text(), Loader=_CloudFormationLoader)  # type: ignore[no-any-return]


def test_template_is_valid_yaml(template: dict[str, Any]) -> None:
    assert template["Resources"]


def test_template_includes_observability_resources() -> None:
    template = Path("template.yaml").read_text()

    assert "LambdaErrorAlarm" in template
    assert "SsgErrorAlarm" in template
    assert "RefreshFailureAlarm" in template
    assert "RefreshHeartbeatAlarm" in template
    assert "ProviderDegradationAlarm" in template
    assert "CoverageDropAlarm" in template


def test_every_alarm_notifies_the_alert_topic(template: dict[str, Any]) -> None:
    alarms = {
        name: resource["Properties"]
        for name, resource in template["Resources"].items()
        if resource["Type"] == "AWS::CloudWatch::Alarm"
    }
    assert alarms, "expected at least one CloudWatch alarm in the template"

    for name, properties in alarms.items():
        assert properties.get("AlarmActions"), f"{name} has no AlarmActions — it would flip state silently"
        assert properties.get("OKActions"), f"{name} has no OKActions — no recovery email"


def test_custom_metric_alarms_match_emitted_dimensions(template: dict[str, Any]) -> None:
    # emit_metric always tags refresh-path metrics with Trigger=schedule; an
    # alarm keyed on Environment alone watches a series that never receives
    # data and sits at OK forever (the former CacheAgeAlarm did exactly this).
    # Covers both plain (Namespace/Dimensions) and metric-math (Metrics list)
    # alarm shapes.
    for name, resource in template["Resources"].items():
        if resource["Type"] != "AWS::CloudWatch::Alarm":
            continue
        properties = resource["Properties"]

        if "Metrics" in properties:
            for metric_entry in properties["Metrics"]:
                metric_stat = metric_entry.get("MetricStat")
                if metric_stat is None:
                    continue  # a pure math expression (e.g. FILL(...) + FILL(...)) has no Dimensions
                metric = metric_stat["Metric"]
                if metric["Namespace"] != "BarcelonaMovieDatabase":
                    continue
                dims = {dim["Name"]: dim["Value"] for dim in metric["Dimensions"]}
                assert dims == {"Environment": "prod", "Trigger": "schedule"}, (
                    f"{name} watches dimensions nothing emits"
                )
            continue

        if properties.get("Namespace") != "BarcelonaMovieDatabase":
            continue
        dims = {dim["Name"]: dim["Value"] for dim in properties["Dimensions"]}
        assert dims == {"Environment": "prod", "Trigger": "schedule"}, f"{name} watches dimensions nothing emits"


def test_heartbeat_alarm_treats_missing_data_as_breaching(template: dict[str, Any]) -> None:
    heartbeat = template["Resources"]["RefreshHeartbeatAlarm"]["Properties"]
    assert heartbeat["TreatMissingData"] == "breaching"


def test_provider_degradation_alarm_fires_on_a_single_bad_run(template: dict[str, Any]) -> None:
    # A single failed-or-zero-result provider in one refresh run must alert,
    # not require two full days of accumulated failures (the old design).
    properties = template["Resources"]["ProviderDegradationAlarm"]["Properties"]
    metrics_by_id = {m["Id"]: m for m in properties["Metrics"]}

    assert metrics_by_id["failures"]["MetricStat"]["Metric"]["MetricName"] == "ProviderFailure"
    assert metrics_by_id["zero_results"]["MetricStat"]["Metric"]["MetricName"] == "ProviderZeroResult"
    assert metrics_by_id["degraded_providers"]["ReturnData"] is True
    assert "failures" in metrics_by_id["degraded_providers"]["Expression"]
    assert "zero_results" in metrics_by_id["degraded_providers"]["Expression"]

    assert properties["EvaluationPeriods"] == 1
    assert properties["DatapointsToAlarm"] == 1
    assert properties["Threshold"] == 1
    assert properties["ComparisonOperator"] == "GreaterThanOrEqualToThreshold"
    assert properties["TreatMissingData"] == "notBreaching"


def test_coverage_drop_alarm_has_a_static_floor_below_normal_range(template: dict[str, Any]) -> None:
    properties = template["Resources"]["CoverageDropAlarm"]["Properties"]
    dims = {dim["Name"]: dim["Value"] for dim in properties["Dimensions"]}

    assert dims == {"Environment": "prod", "Trigger": "schedule"}
    assert properties["MetricName"] == "MoviesPublished"
    assert properties["ComparisonOperator"] == "LessThanThreshold"
    # Normal range is 40-66 published movies; the floor must sit below it so
    # ordinary week-to-week variation doesn't false-positive.
    assert properties["Threshold"] < 40
    assert properties["TreatMissingData"] == "notBreaching"


def test_template_includes_listings_feed_runtime_configuration() -> None:
    template = Path("template.yaml").read_text()

    assert "LISTINGS_FEED_SSM_PARAMETER" in template
    assert "SsmListingsFeedUrl" in template


def _refresh_schedule(template: dict[str, Any]) -> dict[str, Any]:
    events = template["Resources"]["ApiFunction"]["Properties"]["Events"]
    assert list(events) == ["ScheduledRefresh"]
    return events["ScheduledRefresh"]  # type: ignore[no-any-return]


def test_refresh_runs_on_madrid_clock(template: dict[str, Any]) -> None:
    schedule = _refresh_schedule(template)

    assert schedule["Type"] == "ScheduleV2"
    assert schedule["Properties"]["ScheduleExpressionTimezone"] == "Europe/Madrid"
    assert schedule["Properties"]["State"] == "ENABLED"


def test_refresh_schedule_fits_the_horizon_and_heartbeat(template: dict[str, Any]) -> None:
    expression = _refresh_schedule(template)["Properties"]["ScheduleExpression"]
    match = re.fullmatch(r"cron\(0 ([\d,]+) \* \* \? \*\)", expression)
    assert match, f"expected a daily cron at fixed Madrid hours, got {expression!r}"
    hours = [int(h) for h in match.group(1).split(",")]

    assert min(hours) <= 7
    # One failed run mustn't trip the 24h heartbeat.
    assert len(hours) >= 2
    assert template["Resources"]["RefreshHeartbeatAlarm"]["Properties"]["Period"] == 86400


def test_refresh_schedule_input_routes_to_a_refresh(template: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[str] = []
    monkeypatch.setattr(pipeline, "force_refresh", lambda: called.append("refresh"))

    event = json.loads(_refresh_schedule(template)["Properties"]["Input"])
    app.handler(event, context=None)

    assert called == ["refresh"]


def _deploy_override_parser() -> str:
    """The Python deploy.sh runs to turn samconfig.toml overrides into sam args."""
    script = Path("deploy.sh").read_text()
    match = re.search(r'python3 -c "\n(.*?)\n"\)', script, re.S)
    assert match, "deploy.sh no longer embeds its parameter-override parser"
    return match.group(1).replace('\\"', '"')


def test_deploy_drops_retired_parameters_and_keeps_live_ones(template: dict[str, Any], tmp_path: Path) -> None:
    (tmp_path / "samconfig.toml").write_text(
        "[default.deploy.parameters]\n"
        'parameter_overrides = "CacheTtlHours=\\"12\\" ScheduleExpression=\\"rate(12 hours)\\" '
        'ApiOriginVerifyToken=\\"x\\" NotificationEmail=\\"a@example.com\\""\n'
    )

    result = subprocess.run(
        [sys.executable, "-c", _deploy_override_parser()],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=True,
    )
    passed = [token.partition("=")[0] for token in result.stdout.split("\0") if token]

    assert passed == ["NotificationEmail"]
    assert set(passed) <= set(template["Parameters"])


def test_deploy_never_drops_a_live_parameter(template: dict[str, Any]) -> None:
    match = re.search(r"RETIRED_PARAMETERS = \{(.*?)\}", _deploy_override_parser())
    assert match
    retired = set(re.findall(r"'(\w+)'", match.group(1)))

    assert retired.isdisjoint(template["Parameters"])
