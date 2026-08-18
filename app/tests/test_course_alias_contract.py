"""Conformance suite for the Python port of alias expansion.

Cases live in shared/course-alias-cases.json and are ALSO run against the
reference (mern/server/scripts/lib/course-ids.test.mjs) and the client port
(mern/client/src/utils/courseIds.test.mjs). If any port drifts, its suite
goes red.
"""
import json
from pathlib import Path

import pytest

from catalog import aliases_for

CASES_PATH = (Path(__file__).resolve().parents[2]
              / "shared" / "course-alias-cases.json")
CASES = json.loads(CASES_PATH.read_text())["cases"]


def test_shared_alias_fixture_is_present_and_non_trivial():
    assert len(CASES) >= 10


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_alias_expansion_matches_shared_spec(case):
    assert aliases_for(case["input"]) == case["aliases"]
