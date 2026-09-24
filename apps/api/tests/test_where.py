from app.services.arcgis.where import (
    contains_all_tokens_clause,
    normalize_search_text,
    prefix_clause,
    sql_literal,
    upper_like,
)


def test_normalize_keeps_letters_of_any_script() -> None:
    assert normalize_search_text("  Сүхбаатарын   талбай ") == "Сүхбаатарын талбай"
    assert normalize_search_text("Peace Ave. 44") == "Peace Ave. 44"


def test_normalize_removes_sql_wildcards_and_control_characters() -> None:
    assert normalize_search_text("50%_off\\;--") == "50 off --"
    assert normalize_search_text("a\x00b") == "a b"


def test_quotes_are_doubled() -> None:
    assert sql_literal("O'Brien") == "'O''Brien'"


def test_injection_attempt_stays_inside_the_literal() -> None:
    text = normalize_search_text("x' OR 1=1 --")
    clause = upper_like("name", f"%{text}%")
    assert clause == "UPPER(name) LIKE '%X'' OR 1 1 --%'"
    # The only quotes are the literal delimiters and the doubled quote.
    assert clause.count("'") == 4


def test_clauses_cover_every_field_and_token() -> None:
    assert (
        prefix_clause(["name", "alt_name"], "sukh")
        == "(UPPER(name) LIKE 'SUKH%' OR UPPER(alt_name) LIKE 'SUKH%')"
    )
    clause = contains_all_tokens_clause(["name"], ["peace", "ave"])
    assert clause == "(UPPER(name) LIKE '%PEACE%') AND (UPPER(name) LIKE '%AVE%')"


def test_field_names_are_validated() -> None:
    import pytest

    with pytest.raises(ValueError, match="Invalid ArcGIS field name"):
        upper_like("name; DROP", "X")
