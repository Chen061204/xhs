import json

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from backend.app.config import Settings
from backend.app.dependencies import (
    get_tokenhub_client,
    resolve_tokenhub_api_key,
)
from backend.app.main import app
from backend.app.prompts import build_analyze_prompt
from backend.app.schemas import AnalyzeRequest, AnalyzeResponse


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
            "metrics": "多家公开媒体今日集中报道",
            "category": "生活方式",
            "summary": "用于测试的热点摘要",
            "heat_reason": "近期讨论快速增加",
            "keywords": ["热点", "生活方式"],
            "sources": [
                {
                    "title": "模型给出的标题会被后端覆盖",
                    "url": "https://example.com/source",
                }
            ],
        }
    ],
    "disclaimer": "模型免责声明会被后端覆盖。",
}

TOKENHUB_SEARCH_RESULTS = [
    {
        "index": 1,
        "url": "https://example.com/source",
        "name": "TokenHub 真实来源",
        "snippet": "公开网页摘要",
        "site": "示例站点",
    }
]

ANALYZE_OUTPUT = {
    "original_post": {
        "title": "模型不应覆盖用户标题",
        "metrics": "模型不应覆盖用户指标",
    },
    "ai_diagnosis": "这个热点同时具备情绪价值、视觉钩子和讨论空间。",
    "derived_directions": [make_direction(1), make_direction(2), make_direction(3)],
}


class FakeTokenHubClient:
    def __init__(
        self,
        outputs: list[dict[str, object]] | None = None,
        status_code: int = 200,
        search_results: list[dict[str, object]] | None = None,
    ) -> None:
        self.outputs = iter(outputs or [])
        self.status_code = status_code
        self.search_results = (
            TOKENHUB_SEARCH_RESULTS if search_results is None else search_results
        )
        self.calls: list[dict[str, object]] = []

    def post(self, path: str, *, json: dict[str, object]) -> httpx.Response:
        self.calls.append({"path": path, "json": json})
        if self.status_code >= 400:
            return httpx.Response(
                self.status_code,
                json={"error": {"message": "upstream error"}},
            )
        output = next(self.outputs)
        message: dict[str, object] = {
            "content": __import__("json").dumps(output, ensure_ascii=False)
        }
        if "web_search_options" in json:
            message["search_results"] = self.search_results
        return httpx.Response(
            200,
            json={"choices": [{"message": message}]},
        )


def test_bearer_key_takes_precedence_over_server_key() -> None:
    settings = Settings(_env_file=None, tokenhub_api_key=SecretStr("server-key"))
    assert resolve_tokenhub_api_key("Bearer user-key", settings) == "user-key"


def test_server_key_is_used_when_header_is_missing() -> None:
    settings = Settings(_env_file=None, tokenhub_api_key=SecretStr("server-key"))
    assert resolve_tokenhub_api_key(None, settings) == "server-key"


@pytest.mark.parametrize("authorization", ["Basic abc", "Bearer", "Bearer   "])
def test_malformed_authorization_is_rejected(authorization: str) -> None:
    settings = Settings(_env_file=None, tokenhub_api_key=SecretStr("server-key"))
    with pytest.raises(HTTPException) as exc_info:
        resolve_tokenhub_api_key(authorization, settings)
    assert exc_info.value.status_code == 401


def test_missing_key_is_rejected() -> None:
    settings = Settings(_env_file=None, tokenhub_api_key=None)
    with pytest.raises(HTTPException) as exc_info:
        resolve_tokenhub_api_key(None, settings)
    assert exc_info.value.status_code == 401


def test_trending_enables_tokenhub_search_and_normalizes_sources() -> None:
    fake_client = FakeTokenHubClient([TRENDING_OUTPUT])
    app.dependency_overrides[get_tokenhub_client] = lambda: fake_client
    try:
        response = TestClient(app).get(
            "/api/trending?limit=1&category=生活方式",
            headers={"X-TokenHub-Model": "deepseek-v4-pro-202606"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["rank"] == 1
    assert body["items"][0]["sources"] == [
        {
            "title": "TokenHub 真实来源",
            "url": "https://example.com/source",
        }
    ]
    call = fake_client.calls[0]
    assert call["path"] == "/chat/completions"
    assert call["json"]["model"] == "deepseek-v4-pro-202606"
    assert call["json"]["response_format"] == {"type": "json_object"}
    assert call["json"]["web_search_options"]["enable"] is True
    assert call["json"]["web_search_options"]["search_source"] == "lite"


def test_unverified_source_url_is_removed() -> None:
    forged = json.loads(json.dumps(TRENDING_OUTPUT))
    forged["items"][0]["sources"][0]["url"] = "https://forged.example/fake"
    fake_client = FakeTokenHubClient([forged])
    app.dependency_overrides[get_tokenhub_client] = lambda: fake_client
    try:
        response = TestClient(app).get("/api/trending?limit=1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["items"][0]["sources"] == []


def test_analyze_matches_contract_and_does_not_enable_web_search() -> None:
    fake_client = FakeTokenHubClient([ANALYZE_OUTPUT])
    app.dependency_overrides[get_tokenhub_client] = lambda: fake_client
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
    assert "web_search_options" not in fake_client.calls[0]["json"]
    assert fake_client.calls[0]["json"]["reasoning_effort"] == "medium"


def test_analyze_prompt_grounds_gemini_prompts_in_copywriting() -> None:
    prompt = build_analyze_prompt(
        AnalyzeRequest(
            title="40℃通勤防晒穿搭",
            category="职场穿搭",
            summary="高温地铁通勤时兼顾防晒、透气和职场感",
        )
    )

    assert "Gemini 图像生成模型" in prompt
    assert "Gemini Veo" in prompt
    assert "核心人物/主体、核心冲突或卖点、关键动作" in prompt
    assert "同一方向的 copywriting、image_prompt 和 video_prompt 必须讲同一件事" in prompt
    assert "0-3s 强钩子、3-10s 展示过程/证据" in prompt
    assert "40℃通勤防晒穿搭" in prompt


def test_analyze_response_rejects_extra_fields() -> None:
    invalid = {**ANALYZE_OUTPUT, "unexpected": True}
    with pytest.raises(ValidationError):
        AnalyzeResponse.model_validate(invalid)


def test_disallowed_model_returns_structured_error() -> None:
    fake_client = FakeTokenHubClient([TRENDING_OUTPUT])
    app.dependency_overrides[get_tokenhub_client] = lambda: fake_client
    try:
        response = TestClient(app).get(
            "/api/trending",
            headers={"X-TokenHub-Model": "unknown-model"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "MODEL_NOT_ALLOWED"


@pytest.mark.parametrize(
    ("upstream_status", "expected_status", "expected_code"),
    [
        (401, 401, "INVALID_TOKENHUB_API_KEY"),
        (402, 402, "TOKENHUB_INSUFFICIENT_BALANCE"),
        (429, 429, "TOKENHUB_RATE_LIMITED"),
        (503, 502, "TOKENHUB_UPSTREAM_ERROR"),
    ],
)
def test_tokenhub_errors_are_mapped(
    upstream_status: int,
    expected_status: int,
    expected_code: str,
) -> None:
    fake_client = FakeTokenHubClient(status_code=upstream_status)
    app.dependency_overrides[get_tokenhub_client] = lambda: fake_client
    try:
        response = TestClient(app).get("/api/trending?limit=1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == expected_status
    assert response.json()["error"]["code"] == expected_code


def test_healthcheck_does_not_require_an_api_key() -> None:
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "1.0.0"}
