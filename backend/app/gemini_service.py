import logging
from datetime import datetime, timedelta, timezone
from typing import TypeVar

from google import genai
from google.genai import errors
from pydantic import BaseModel, ValidationError

from .exceptions import GeminiServiceError
from .prompts import build_analyze_prompt, build_trending_prompt
from .schemas import AnalyzeRequest, AnalyzeResponse, TrendingResponse

logger = logging.getLogger(__name__)
# China Standard Time has been UTC+08:00 year-round since 1991. A fixed offset
# avoids depending on an OS tzdata package during a serverless cold start.
SHANGHAI_TZ = timezone(timedelta(hours=8), name="Asia/Shanghai")
SchemaT = TypeVar("SchemaT", bound=BaseModel)


def _validate_model_output(
    *,
    client: genai.Client,
    model: str,
    prompt: str,
    response_model: type[SchemaT],
    use_google_search: bool,
) -> SchemaT:
    request: dict[str, object] = {
        "model": model,
        "input": prompt,
        "response_format": {
            "type": "text",
            "mime_type": "application/json",
            "schema": response_model.model_json_schema(),
        },
    }
    if use_google_search:
        request["tools"] = [{"type": "google_search"}]

    try:
        interaction = client.interactions.create(**request)
        output_text = interaction.output_text
        if not output_text:
            raise GeminiServiceError(
                status_code=502,
                code="EMPTY_MODEL_RESPONSE",
                detail="Gemini 没有返回可用内容，请稍后重试。",
            )
        return response_model.model_validate_json(output_text)
    except GeminiServiceError:
        raise
    except ValidationError as exc:
        logger.warning("Gemini returned invalid structured output: %s", exc)
        raise GeminiServiceError(
            status_code=502,
            code="INVALID_MODEL_OUTPUT",
            detail="Gemini 返回的数据未通过结构校验，请重试。",
        ) from exc
    except errors.APIError as exc:
        logger.warning(
            "Gemini API error code=%s status=%s",
            getattr(exc, "code", None),
            getattr(exc, "status", None),
        )
        raise _map_api_error(exc) from exc
    except Exception as exc:
        logger.exception("Unexpected error while calling Gemini")
        raise GeminiServiceError(
            status_code=502,
            code="GEMINI_UNAVAILABLE",
            detail="Gemini 服务暂时不可用，请稍后重试。",
        ) from exc


def _map_api_error(exc: errors.APIError) -> GeminiServiceError:
    api_code = int(getattr(exc, "code", 0) or 0)
    api_status = str(getattr(exc, "status", "") or "").upper()
    api_message = str(getattr(exc, "message", "") or "").lower()

    invalid_key = (
        api_code in {401, 403}
        or "api_key_invalid" in api_status.lower()
        or "api key not valid" in api_message
    )
    if invalid_key:
        return GeminiServiceError(
            status_code=401,
            code="INVALID_GEMINI_API_KEY",
            detail="Gemini API Key 无效、已过期或没有模型访问权限。",
        )
    if api_code == 429 or "resource_exhausted" in api_status.lower():
        return GeminiServiceError(
            status_code=429,
            code="GEMINI_RATE_LIMITED",
            detail="Gemini 配额不足或请求过于频繁，请稍后重试。",
        )
    if api_code == 400:
        return GeminiServiceError(
            status_code=400,
            code="GEMINI_BAD_REQUEST",
            detail="Gemini 拒绝了本次请求，请检查模型权限或输入内容。",
        )
    return GeminiServiceError(
        status_code=502,
        code="GEMINI_UPSTREAM_ERROR",
        detail="Gemini 上游服务异常，请稍后重试。",
    )


def get_trending(
    *,
    client: genai.Client,
    model: str,
    limit: int,
    category: str | None,
) -> TrendingResponse:
    today = datetime.now(SHANGHAI_TZ).date()
    result = _validate_model_output(
        client=client,
        model=model,
        prompt=build_trending_prompt(
            today=today,
            limit=limit,
            category=category,
        ),
        response_model=TrendingResponse,
        use_google_search=True,
    )

    result.items = result.items[:limit]
    for index, item in enumerate(result.items, start=1):
        item.rank = index
    result.date = today
    return result


def analyze_hotspot(
    *,
    client: genai.Client,
    model: str,
    payload: AnalyzeRequest,
) -> AnalyzeResponse:
    result = _validate_model_output(
        client=client,
        model=model,
        prompt=build_analyze_prompt(payload),
        response_model=AnalyzeResponse,
        use_google_search=False,
    )

    # Do not let model output alter the source fields selected by the user.
    result.original_post.title = payload.title
    result.original_post.metrics = payload.metrics or "暂无公开数据"
    return result
