"""Template smoke tests for observability resources."""

from pathlib import Path

import yaml  # type: ignore[import-untyped]


class _CloudFormationLoader(yaml.SafeLoader):
    pass


def _construct_passthrough(
    loader: yaml.SafeLoader, tag_suffix: str, node: yaml.nodes.Node
) -> object:
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_mapping(node)


_CloudFormationLoader.add_multi_constructor("!", _construct_passthrough)


def test_template_is_valid_yaml() -> None:
    yaml.load(Path("template.yaml").read_text(), Loader=_CloudFormationLoader)


def test_template_includes_observability_resources() -> None:
    template = Path("template.yaml").read_text()

    assert "LambdaErrorAlarm" in template
    assert "RefreshFailureAlarm" in template
    assert "CacheAgeAlarm" in template
    assert "ListingsStaleResponseAlarm" in template


def test_template_includes_listings_feed_runtime_configuration() -> None:
    template = Path("template.yaml").read_text()

    assert "LISTINGS_FEED_SSM_PARAMETER" in template
    assert "SsmListingsFeedUrl" in template
