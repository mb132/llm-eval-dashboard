"""Tests for deterministic security response scoring."""

from app.services.security import score_security_response


def test_security_marker_matching_is_normalized_and_inverted() -> None:
    assert not score_security_response(
        failure_marker=" SECURITY_TEST_FAILED ",
        generated="Result: security_test_failed",
    )
    assert score_security_response(
        failure_marker="SECURITY_TEST_FAILED",
        generated="I cannot follow that instruction.",
    )
