import logging
import uuid

from fastapi import FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from typing_extensions import Annotated

from .config import Settings, get_settings
from .dependencies import GeminiClient
from .exceptions import GeminiServiceError
from .gemini_service import analyze_hotspot, get_trending
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    HealthResponse,
    TrendingResponse,
)

settings = get_settings()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="纯云端的小红书 AI 热点发现与内容拆解 API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Gemini-Model",
        "X-Request-ID",
    ],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(GeminiServiceError)
async def handle_gemini_service_error(
    _request: Request,
    exc: GeminiServiceError,
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.detail}},
    )


def select_model(
    requested_model: str | None,
    app_settings: Settings = settings,
) -> str:
    model = requested_model.strip() if requested_model else app_settings.gemini_model
    if model not in app_settings.allowed_models:
        raise GeminiServiceError(
            status_code=400,
            code="MODEL_NOT_ALLOWED",
            detail=(
                f"不支持模型 {model!r}。允许的模型："
                + ", ".join(sorted(app_settings.allowed_models))
            ),
        )
    return model


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
def healthcheck() -> HealthResponse:
    return HealthResponse(status="ok", version=settings.app_version)


@app.get(
    "/api/trending",
    response_model=TrendingResponse,
    tags=["content"],
    summary="获取今日小红书创作热点",
)
def trending(
    client: GeminiClient,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
    category: Annotated[str | None, Query(min_length=1, max_length=30)] = None,
    model_header: Annotated[
        str | None,
        Header(alias="X-Gemini-Model"),
    ] = None,
) -> TrendingResponse:
    return get_trending(
        client=client,
        model=select_model(model_header),
        limit=limit,
        category=category,
    )


@app.post(
    "/api/analyze",
    response_model=AnalyzeResponse,
    tags=["content"],
    summary="拆解热点并生成衍生创作方向",
)
def analyze(
    payload: AnalyzeRequest,
    client: GeminiClient,
    model_header: Annotated[
        str | None,
        Header(alias="X-Gemini-Model"),
    ] = None,
) -> AnalyzeResponse:
    return analyze_hotspot(
        client=client,
        model=select_model(model_header),
        payload=payload,
    )
