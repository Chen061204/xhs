# 小红书 AI 起号工具

纯云端 FastAPI + Next.js 应用。后端通过腾讯云 TokenHub 托管的 DeepSeek V4
执行联网搜索、趋势整理、热点拆解，并返回前端所需的结构化 JSON。

## API

- `GET /api/health`：健康检查，不需要 API Key
- `GET /api/trending`：联网搜索并生成今日小红书热点
- `POST /api/analyze`：拆解选中热点并生成 3 个衍生方向
- `GET /docs`：FastAPI 在线接口文档

`/api/trending` 会向 TokenHub Chat API 发送 `web_search_options.enable=true`，
并读取 `choices[0].message.search_results`。后端只保留确实出现在搜索结果中的 URL，
模型编造或无法对应的来源会被剔除。

## API Key 规则

每个模型请求按以下顺序选择 Key：

1. `Authorization: Bearer <用户的腾讯云 TokenHub API Key>`
2. Vercel 环境变量 `TOKENHUB_API_KEY`

腾讯云 TokenHub Key 与 DeepSeek 官方 Key 不能混用。

前端通过 `X-TokenHub-Model` 选择允许的模型：

- `deepseek-v4-pro-202606`（腾讯云实际服务 ID）

## Vercel 后端部署

从 GitHub 仓库导入后端项目：

- Framework Preset：Other
- Root Directory：留空
- Build Command：留空
- Output Directory：留空

在 Settings → Environment Variables 中设置：

```text
TOKENHUB_API_KEY=你的腾讯云TokenHubKey
TOKENHUB_BASE_URL=https://tokenhub.tencentmaas.com/v1
TOKENHUB_MODEL=deepseek-v4-pro-202606
TOKENHUB_SEARCH_MODEL=deepseek-v4-pro
TOKENHUB_ALLOWED_MODELS=deepseek-v4-pro-202606,deepseek-v4-pro
TOKENHUB_SEARCH_SOURCE=lite
TOKENHUB_TIMEOUT_SECONDS=90
CORS_ORIGINS=https://你的前端.vercel.app
```

热点扫描固定使用支持联网搜索的 `TOKENHUB_SEARCH_MODEL`；拆解与文案生成使用
`TOKENHUB_MODEL`，并通过 DeepSeek 官方 `thinking.type=enabled` 开启思考能力。

需要先在腾讯云 TokenHub 控制台开通 DeepSeek V4，并领取联网搜索资源包或开通后付费。

部署成功后访问：

```text
https://你的后端.vercel.app/api/health
```

应返回：

```json
{"status":"ok","version":"1.0.0"}
```

## Vercel 前端部署

从同一仓库导入另一个前端项目：

- Framework Preset：Next.js
- Root Directory：`frontend`
- 环境变量：

```text
NEXT_PUBLIC_API_BASE_URL=https://你的后端.vercel.app
```

前端后端地址只填写域名，不要填写 `/api/health`，末尾也不要加 `/`。

## 错误格式

```json
{
  "error": {
    "code": "INVALID_TOKENHUB_API_KEY",
    "message": "腾讯云 TokenHub API Key 无效、已过期或没有模型访问权限。"
  }
}
```

常见错误码：

- `INVALID_TOKENHUB_API_KEY`
- `TOKENHUB_INSUFFICIENT_BALANCE`
- `TOKENHUB_RATE_LIMITED`
- `TOKENHUB_TIMEOUT`
- `TOKENHUB_UPSTREAM_ERROR`

## 测试

```bash
python -m pytest -q
```
