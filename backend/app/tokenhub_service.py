import logging
import json
from datetime import datetime, timedelta, timezone
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .exceptions import TokenHubServiceError
from .prompts import build_analyze_prompt, build_trending_prompt
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    TrendSource,
    TrendingResponse,
)

logger = logging.getLogger(__name__)
SHANGHAI_TZ = timezone(timedelta(hours=8), name="Asia/Shanghai")
SchemaT = TypeVar("SchemaT", bound=BaseModel)


def _validate_model_output(
    *,
    client: httpx.Client,
    model: str,
    prompt: str,
    response_model: type[SchemaT],
    enable_web_search: bool = False,
    search_source: str = "lite",
    enable_thinking: bool = False,
) -> tuple[SchemaT, list[dict[str, object]]]:
    schema_json = json.dumps(
        response_model.model_json_schema(),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    request = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是小红书内容策划助手。必须只返回有效 JSON，"
                    "不输出 Markdown 或 JSON 之外的文字。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"{prompt}\n\n输出必须符合以下 JSON Schema："
                    f"{schema_json}"
                ),
            },
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
        "max_tokens": 8192,
        "thinking": {"type": "enabled" if enable_thinking else "disabled"},
    }
    if enable_web_search:
        request["web_search_options"] = {
            "enable": True,
            "search_source": (
                search_source if search_source in {"lite", "standard"} else "lite"
            ),
            "user_location": {
                "type": "approximate",
                "country": "CN",
                "timezone": "Asia/Shanghai",
            },
        }

    try:
        response = client.post("/chat/completions", json=request)
        if response.status_code >= 400:
            raise _map_http_error(response)

        payload = response.json()
        message = payload["choices"][0]["message"]
        output_text = message["content"]
        if not output_text or not output_text.strip():
            raise TokenHubServiceError(
                status_code=502,
                code="EMPTY_MODEL_RESPONSE",
                detail="腾讯云 TokenHub 没有返回可用内容，请稍后重试。",
            )
        search_results = message.get("search_results") or []
        if not isinstance(search_results, list):
            search_results = []
        return response_model.model_validate_json(output_text), search_results
    except TokenHubServiceError:
        raise
    except (KeyError, TypeError, ValueError, ValidationError) as exc:
        logger.warning("TokenHub returned invalid structured output: %s", exc)
        raise TokenHubServiceError(
            status_code=502,
            code="INVALID_MODEL_OUTPUT",
            detail="TokenHub DeepSeek 返回的数据未通过结构校验，请重试。",
        ) from exc
    except httpx.TimeoutException as exc:
        raise TokenHubServiceError(
            status_code=504,
            code="TOKENHUB_TIMEOUT",
            detail="腾讯云 TokenHub 联网搜索响应超时，请稍后重试。",
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("TokenHub network error: %s", exc)
        raise TokenHubServiceError(
            status_code=502,
            code="TOKENHUB_UNAVAILABLE",
            detail="腾讯云 TokenHub 服务暂时不可用，请稍后重试。",
        ) from exc


def _map_http_error(response: httpx.Response) -> TokenHubServiceError:
    status_code = response.status_code
    if status_code in {401, 403}:
        return TokenHubServiceError(
            status_code=401,
            code="INVALID_TOKENHUB_API_KEY",
            detail="腾讯云 TokenHub API Key 无效、已过期或没有模型访问权限。",
        )
    if status_code == 402:
        return TokenHubServiceError(
            status_code=402,
            code="TOKENHUB_INSUFFICIENT_BALANCE",
            detail="腾讯云账户余额或联网搜索额度不足，请充值或更换 API Key。",
        )
    if status_code == 429:
        return TokenHubServiceError(
            status_code=429,
            code="TOKENHUB_RATE_LIMITED",
            detail="腾讯云 TokenHub 请求过于频繁，请稍后重试。",
        )
    if status_code in {400, 422}:
        return TokenHubServiceError(
            status_code=400,
            code="TOKENHUB_BAD_REQUEST",
            detail="TokenHub 拒绝了本次请求，请检查 DeepSeek 模型和联网搜索权限。",
        )
    return TokenHubServiceError(
        status_code=502,
        code="TOKENHUB_UPSTREAM_ERROR",
        detail="腾讯云 TokenHub 上游服务异常，请稍后重试。",
    )


def _enforce_grounded_sources(
    result: TrendingResponse,
    search_results: list[dict[str, object]],
) -> int:
    """Keep only URLs that TokenHub actually returned in search_results."""

    allowed: dict[str, TrendSource] = {}
    for source in search_results:
        if not isinstance(source, dict):
            continue
        url = str(source.get("url") or "").strip()
        title = str(source.get("name") or source.get("title") or "").strip()
        if not url or not title:
            continue
        try:
            validated = TrendSource(title=title, url=url)
        except ValidationError:
            continue
        allowed[url.rstrip("/")] = validated

    used_urls: set[str] = set()
    for item in result.items:
        grounded: list[TrendSource] = []
        for candidate in item.sources:
            key = str(candidate.url).rstrip("/")
            source = allowed.get(key)
            if source is not None and key not in {str(s.url).rstrip("/") for s in grounded}:
                grounded.append(source)
                used_urls.add(key)
        item.sources = grounded[:3]
    return len(used_urls)


def get_trending(
    *,
    client: httpx.Client,
    model: str,
    limit: int,
    category: str | None,
    search_source: str,
) -> TrendingResponse:
    today = datetime.now(SHANGHAI_TZ).date()
    result, search_results = _validate_model_output(
        client=client,
        model=model,
        prompt=build_trending_prompt(
            today=today,
            limit=limit,
            category=category,
        ),
        response_model=TrendingResponse,
        enable_web_search=True,
        search_source=search_source,
    )

    result.items = result.items[:limit]
    for index, item in enumerate(result.items, start=1):
        item.rank = index
    result.date = today
    grounded_count = _enforce_grounded_sources(result, search_results)
    if search_results:
        result.disclaimer = (
            "结果由腾讯云 TokenHub 联网搜索与 DeepSeek 综合生成，不代表小红书官方榜单；"
            f"本次已校验 {grounded_count} 个引用 URL，发布前请继续核验事实与时效。"
        )
    else:
        result.disclaimer = (
            "腾讯云 TokenHub 本次未返回可核验的联网搜索来源，结果可能基于模型已有知识；"
            "请稍后重试或在发布前自行核验。"
        )
    return result


def analyze_hotspot(
    *,
    client: httpx.Client,
    model: str,
    payload: AnalyzeRequest,
) -> AnalyzeResponse:
    result, _search_results = _validate_model_output(
        client=client,
        model=model,
        prompt=build_analyze_prompt(payload),
        response_model=AnalyzeResponse,
        enable_thinking=True,
    )

    result.original_post.title = payload.title
    result.original_post.metrics = payload.metrics or "暂无公开数据"
    return result
