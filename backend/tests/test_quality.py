"""Unit tests for deterministic response-quality metrics."""

from app.services.quality import normalize_quality_text, score_response


def test_quality_normalization_is_unicode_case_and_whitespace_insensitive() -> None:
    assert normalize_quality_text("  CAFÉ\n au   lait ") == "café au lait"
    assert normalize_quality_text("Cafe\u0301 au lait") == "café au lait"


def test_exact_and_contains_scores_remain_distinct() -> None:
    exact = score_response(expected=" Paris ", generated="PARIS")
    explanatory = score_response(
        expected="Paris",
        generated="The answer is Paris.",
    )
    punctuation_difference = score_response(expected="Paris", generated="Paris!")

    assert exact[("normalized_exact_match", 1)] == 1.0
    assert exact[("normalized_contains_match", 1)] == 1.0
    assert explanatory[("normalized_exact_match", 1)] == 0.0
    assert explanatory[("normalized_contains_match", 1)] == 1.0
    assert punctuation_difference[("normalized_exact_match", 1)] == 0.0
    assert punctuation_difference[("normalized_contains_match", 1)] == 1.0
