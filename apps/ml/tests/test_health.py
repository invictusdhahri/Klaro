from fastapi.testclient import TestClient

from klaro_ml.main import app


def test_health() -> None:
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_score_endpoint_returns_shape() -> None:
    client = TestClient(app)
    res = client.post("/score", json={"userId": "u1", "features": {}})
    assert res.status_code == 200
    body = res.json()
    assert "score" in body
    assert 0 <= body["score"] <= 1000
    assert body["band"] in {"POOR", "FAIR", "GOOD", "VERY_GOOD", "EXCELLENT"}
