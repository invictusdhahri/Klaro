"""Tests for environment-based score data sufficiency (production vs development)."""

import pytest

from klaro_ml.scoring.data_checker import InsufficientDataError, check_data_sufficiency
from klaro_ml.settings import get_settings


def test_development_accepts_minimal_transactions_without_bank(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ML_ENV", "development")
    get_settings.cache_clear()
    try:
        user_data = {
            "transactions": [
                {
                    "transaction_date": "2026-04-01",
                    "transaction_type": "debit",
                    "amount": 10,
                }
            ],
            "bank_connections": [],
            "bank_statements": [],
        }
        assert check_data_sufficiency(user_data) == 1.0
    finally:
        get_settings.cache_clear()


def test_production_rejects_sparse_history(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ML_ENV", "production")
    get_settings.cache_clear()
    try:
        user_data = {
            "transactions": [
                {
                    "transaction_date": "2026-04-01",
                    "transaction_type": "debit",
                    "amount": 10,
                }
            ],
            "bank_connections": [{"created_at": "2025-01-01"}],
            "bank_statements": [],
        }
        with pytest.raises(InsufficientDataError) as exc_info:
            check_data_sufficiency(user_data)
        gaps = " ".join(exc_info.value.data_gaps)
        assert "20" in gaps or "60" in gaps
    finally:
        get_settings.cache_clear()
