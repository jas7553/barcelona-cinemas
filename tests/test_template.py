"""Template smoke tests for observability resources."""

from pathlib import Path
from typing import Any

import pytest
import yaml  # type: ignore[import-untyped]


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
    for name, resource in template["Resources"].items():
        if resource["Type"] != "AWS::CloudWatch::Alarm":
            continue
        properties = resource["Properties"]
        if properties["Namespace"] != "BarcelonaMovieDatabase":
            continue
        dims = {dim["Name"]: dim["Value"] for dim in properties["Dimensions"]}
        assert dims == {"Environment": "prod", "Trigger": "schedule"}, f"{name} watches dimensions nothing emits"


def test_heartbeat_alarm_treats_missing_data_as_breaching(template: dict[str, Any]) -> None:
    heartbeat = template["Resources"]["RefreshHeartbeatAlarm"]["Properties"]
    assert heartbeat["TreatMissingData"] == "breaching"


def test_provider_degradation_alarm_requires_two_consecutive_failing_days(template: dict[str, Any]) -> None:
    properties = template["Resources"]["ProviderDegradationAlarm"]["Properties"]
    dims = {dim["Name"]: dim["Value"] for dim in properties["Dimensions"]}

    assert dims == {"Environment": "prod", "Trigger": "schedule"}
    assert properties["MetricName"] == "ProviderFailure"
    assert properties["Statistic"] == "Sum"
    assert properties["Period"] == 86400
    assert properties["EvaluationPeriods"] == 2
    assert properties["DatapointsToAlarm"] == 2
    assert properties["Threshold"] == 2
    assert properties["ComparisonOperator"] == "GreaterThanOrEqualToThreshold"
    assert properties["TreatMissingData"] == "notBreaching"


def test_template_includes_listings_feed_runtime_configuration() -> None:
    template = Path("template.yaml").read_text()

    assert "LISTINGS_FEED_SSM_PARAMETER" in template
    assert "SsmListingsFeedUrl" in template
