from datetime import date as CalendarDate

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
)
from typing_extensions import Annotated


NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class StrictSchema(BaseModel):
    """Base API schema that rejects fields outside the public contract."""

    model_config = ConfigDict(extra="forbid")


class AnalyzeRequest(BaseModel):
    """The hotspot selected by the user for further analysis."""

    # Ignore extra fields so the frontend may pass a complete trending card.
    model_config = ConfigDict(extra="ignore")

    title: NonEmptyText = Field(description="用户选中的热点标题")
    metrics: NonEmptyText | None = Field(
        default=None,
        description="可选的热度指标，例如：点赞 10w+",
    )
    category: NonEmptyText | None = Field(
        default=None,
        description="可选的热点分类",
    )
    summary: NonEmptyText | None = Field(
        default=None,
        description="可选的热点摘要",
    )
    context: NonEmptyText | None = Field(
        default=None,
        description="可选的来源或补充上下文",
    )


class OriginalPost(StrictSchema):
    title: NonEmptyText = Field(description="原帖爆款标题")
    metrics: NonEmptyText = Field(description="原帖热度指标，例如：点赞 10w+")


class DerivedDirection(StrictSchema):
    direction_title: NonEmptyText = Field(description="衍生创作方向名称")
    xiaohongshu_titles: list[NonEmptyText] = Field(
        min_length=3,
        max_length=3,
        description="严格生成 3 个小红书爆款标题",
    )
    copywriting: NonEmptyText = Field(
        description="包含自然话题标签的小红书正文模板"
    )
    image_prompt: NonEmptyText = Field(
        description="适用于 Imagen 或 Midjourney 的英文图片提示词"
    )
    video_prompt: NonEmptyText = Field(
        description="包含镜头运动信息的英文 Veo 视频提示词"
    )


class AnalyzeResponse(StrictSchema):
    """Exact response contract consumed by POST /api/analyze."""

    original_post: OriginalPost
    ai_diagnosis: NonEmptyText = Field(description="爆款成因的深度诊断")
    derived_directions: list[DerivedDirection] = Field(
        min_length=3,
        max_length=3,
        description="严格生成 3 个可执行的衍生方向",
    )


class TrendSource(StrictSchema):
    title: NonEmptyText = Field(description="公开来源标题或站点名称")
    url: AnyHttpUrl = Field(description="Google Search Grounding 找到的来源 URL")


class TrendingItem(StrictSchema):
    rank: int = Field(ge=1, le=20, description="当前列表内的热度排序")
    title: NonEmptyText = Field(description="适合小红书创作的热点标题")
    metrics: NonEmptyText = Field(
        description="可核验的公开热度；无法核验时写“公开数据未披露”"
    )
    category: NonEmptyText = Field(description="热点所属赛道")
    summary: NonEmptyText = Field(description="热点事件或内容形式摘要")
    heat_reason: NonEmptyText = Field(description="该热点当前升温的原因")
    keywords: list[NonEmptyText] = Field(
        min_length=2,
        max_length=6,
        description="用于创作和检索的关键词",
    )
    sources: list[TrendSource] = Field(
        min_length=1,
        max_length=3,
        description="支持该热点判断的公开来源",
    )


class TrendingResponse(StrictSchema):
    date: CalendarDate = Field(description="热点扫描日期，Asia/Shanghai")
    items: list[TrendingItem] = Field(
        min_length=1,
        max_length=20,
        description="今日热点列表",
    )
    disclaimer: NonEmptyText = Field(
        description="关于热度与平台公开数据可见性的说明"
    )


class HealthResponse(StrictSchema):
    status: str
    version: str
