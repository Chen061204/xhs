import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from backend.app.config import Settings
from backend.app.dependencies import (
    get_gemini_client,
    resolve_gemini_api_key,
)
from backend.app.main import app
from backend.app.schemas import AnalyzeResponse


def make_direction(index: int) -> dict[str, object]:
    return {
        "direction_title": f"衍生方向{index}",
        "xiaohongshu_titles": [
            f"标题{index}-1",
            f"标题{index}-2",
            f"标题{index}-3",
        ],
        "copywriting": f"正文模板{index} #热点 #创作 #小红书",
        "image_prompt": (
            "Editorial lifestyle photography, natural light, bold colors, "
            "35mm lens, vertical 3:4 composition"
        ),
        "video_prompt": (
            "A lifestyle scene, slow dolly in, natural light, brisk rhythm, "
            "8 seconds, vertical 9:16"
        ),
    }


TRENDING_OUTPUT = {
    "date": "2026-07-19",
    "items": [
        {
            "rank": 9,
            "title": "测试热点",
            "metrics": "公开数据未披露",
            "category": "生活方式",
            "summary": "用于测试的热点摘要",
            "heat_reason": "近期讨论快速增加",
            "keywords": ["热点", "生活方式"],
            "sources": [
                {
                    "title": "公开来源",
                    "url": "https://example.com/source",
                }
            ],
        }
    ],
    "disclaimer": "公开数据存在延迟，结果仅供内容策划参考。",
}

ANALYZE_OUTPUT = {
    "original_post": {
        "title": "模型不应覆盖用户标题",
        "metrics": "模型不应覆盖用户指标",
    },
    "ai_diagnosis": "这个热点同时具备情绪价值、视觉钩子和讨论空间。",
    "derived_directions": [make_direction(1), make_direction(2), make_direction(3)],
}


class FakeInteraction:
    def __init__(self, output: dict[str, object]) -> None:
        self.output_text = json.dumps(output, ensure_ascii=False)


class FakeInteractions:
    def __init__(self, outputs: list[dict[str, object]]) -> None:
        self.outputs = iter(outputs)
        self.calls: list[dict[str, object]] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return FakeInteraction(next(self.outputs))


class FakeGeminiClient:
    def __init__(self, outputs: list[dict[str, object]]) -> None:
        self.interactions = FakeInteractions(outputs)


class FakeNewSdkError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.body = {"error": {"code": status_code, "message": message}}


class RaisingInteractions:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def create(self, **kwargs):
        raise self.error


class RaisingGeminiClient:
    def __init__(self, error: Exception) -> None:
        self.interactions = RaisingInteractions(error)


def test_bearer_key_takes_precedence_over_server_key() -> None:
    settings = Settings(
        _env_file=None,
        gemini_api_key=SecretStr("server-key"),
    )
    resolved = resolve_gemini_api_key("Bearer user-key", settings)
    assert resolved == "user-key"


def test_server_key_is_used_when_header_is_missing() -> None:
    settings = Settings(
        _env_file=None,
        gemini_api_key=SecretStr("server-key"),
    )
    resolved = resolve_gemini_api_key(None, settings)
    assert resolved == "server-key"


@pytest.mark.parametrize(
    "authorization",
    ["Basic abc", "Bearer", "Bearer   "],
)
def test_malformed_authorization_is_rejected(authorization: str) -> None:
    settings = Settings(
        _env_file=None,
        gemini_api_key=SecretStr("server-key"),
    )
    with pytest.raises(HTTPException) as exc_info:
        resolve_gemini_api_key(authorization, settings)
    assert exc_info.value.status_code == 401


def test_missing_key_is_rejected() -> None:
    settings = Settings(_env_file=None, gemini_api_key=None)
    with pytest.raises(HTTPException) as exc_info:
        resolve_gemini_api_key(None, settings)
    assert exc_info.value.status_code == 401


def test_trending_uses_search_grounding_and_normalizes_rank() -> None:
    fake_client = FakeGeminiClient([TRENDING_OUTPUT])
    app.dependency_overrides[get_gemini_client] = lambda: fake_client
    try:
        response = TestClient(app).get(
            "/api/trending?limit=1&category=生活方式",
            headers={"X-Gemini-Model": "gemini-3.5-flash"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["items"][0]["rank"] == 1
    call = fake_client.interactions.calls[0]
    assert call["tools"] == [{"type": "google_search"}]
    assert call["response_format"]["mime_type"] == "application/json"


def test_analyze_matches_frontend_contract_and_preserves_source_fields() -> None:
    fake_client = FakeGeminiClient([ANALYZE_OUTPUT])
    app.dependency_overrides[get_gemini_client] = lambda: fake_client
    try:
        response = TestClient(app).post(
            "/api/analyze",
            json={
                "title": "用户选择的标题",
                "metrics": "点赞 10w+",
                "category": "生活方式",
                "rank": 1,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "original_post",
        "ai_diagnosis",
        "derived_directions",
    }
    assert body["original_post"] == {
        "title": "用户选择的标题",
        "metrics": "点赞 10w+",
    }
    assert len(body["derived_directions"]) == 3
    assert "tools" not in fake_client.interactions.calls[0]


def test_analyze_response_rejects_extra_fields() -> None:
    invalid = {**ANALYZE_OUTPUT, "unexpected": True}
    with pytest.raises(ValidationError):
        AnalyzeResponse.model_validate(invalid)


def test_disallowed_model_returns_structured_error() -> None:
    fake_client = FakeGeminiClient([TRENDING_OUTPUT])
    app.dependency_overrides[get_gemini_client] = lambda: fake_client
    try:
        response = TestClient(app).get(
            "/api/trending",
            headers={"X-Gemini-Model": "unknown-model"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "MODEL_NOT_ALLOWED"


def test_new_sdk_invalid_key_error_is_not_reported_as_unavailable() -> None:
    fake_client = RaisingGeminiClient(
        FakeNewSdkError(400, "API key not valid. Please pass a valid API key.")
    )
    app.dependency_overrides[get_gemini_client] = lambda: fake_client
    try:
        response = TestClient(app).get("/api/trending?limit=1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_GEMINI_API_KEY"


def test_new_sdk_rate_limit_error_is_mapped() -> None:
    fake_client = RaisingGeminiClient(
        FakeNewSdkError(429, "RESOURCE_EXHAUSTED: quota exceeded")
    )
    app.dependency_overrides[get_gemini_client] = lambda: fake_client
    try:
        response = TestClient(app).get("/api/trending?limit=1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "GEMINI_RATE_LIMITED"


def test_healthcheck_does_not_require_an_api_key() -> None:
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "1.0.0"}
