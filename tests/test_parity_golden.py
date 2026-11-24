"""
The committed parity fixtures still match what the Python code produces.

The goldens are the reference the TypeScript port is tested against, so a
change to the Python providers, reconciliation or enricher must show up here
as a golden diff to commit (`python tests/parity/golden.py`), not drift.
"""

from __future__ import annotations

from pathlib import Path

from tests.parity import golden, inline_cases
from tests.parity.common import FIXTURES, RECORDED


def _tree(root: Path) -> dict[str, bytes]:
    return {str(path.relative_to(root)): path.read_bytes() for path in sorted(root.rglob("*")) if path.is_file()}


def _assert_same_tree(actual: Path, committed: Path, regenerate: str) -> None:
    got, want = _tree(actual), _tree(committed)
    assert sorted(got) == sorted(want), f"file lists differ; run `{regenerate}`"
    stale = [name for name in want if got[name] != want[name]]
    assert not stale, f"out of date: {stale[:5]}; run `{regenerate}`"


def test_inline_recordings_match_their_definitions(tmp_path: Path) -> None:
    inline_cases.generate(tmp_path)
    _assert_same_tree(tmp_path / "inline", RECORDED / "inline", "python tests/parity/inline_cases.py")


def test_goldens_match_the_committed_ones(tmp_path: Path) -> None:
    golden.generate(tmp_path)
    _assert_same_tree(tmp_path / "goldens", FIXTURES / "goldens", "python tests/parity/golden.py")
    assert (tmp_path / "cinemas.json").read_bytes() == (FIXTURES / "cinemas.json").read_bytes()


def test_goldens_are_deterministic(tmp_path: Path) -> None:
    golden.generate(tmp_path / "first")
    golden.generate(tmp_path / "second")
    assert _tree(tmp_path / "first") == _tree(tmp_path / "second")
