"""Unit tests for the comment keyword filter (pure functions)."""

from app.services.moderation_filter import matched_keywords, normalize


def test_normalize_strips_accents_case_and_extra_spaces():
    assert normalize("  CÁ   Độ ") == "ca do"
    assert normalize("ĐĂNG") == "dang"
    assert normalize("Woo  Min-ho") == "woo min-ho"


def test_matched_keywords_keeps_configuration_order_and_spelling():
    assert matched_keywords("spam và CÁ ĐỘ", ["cá độ", "spam"]) == [
        "cá độ",
        "spam",
    ]


def test_matched_keywords_ignores_empty_input():
    assert matched_keywords("spam", []) == []
    assert matched_keywords("", ["spam"]) == []
    assert matched_keywords("   ", ["spam"]) == []


def test_keywords_without_letters_never_match():
    assert matched_keywords("anything", ["!!!", "---", " "]) == []


def test_diacritic_insensitive_match():
    # The point of the filter: "go88" typed without the accents still matches.
    assert matched_keywords("Xem ngay tai go88 nhe", ["go88"]) == ["go88"]
    assert matched_keywords("cá độ bóng đá", ["ca do"]) == ["ca do"]
