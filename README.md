# 小红书 AI 起号工具后端

这是一个无状态、纯云端的 FastAPI 服务。模型调用使用 Google Gemini API，
不依赖 Gemini CLI、本地模型、浏览器自动化或本地数据库。

## 已提供的接口

### `GET /api/trending`

通过 Gemini Google Search Grounding 获取最近 24–72 小时内适合小红书创作的热点。

查询参数：

- `limit`：返回数量，`1–20`，默认 `10`
- `category`：可选赛道，例如 `美妆`、`职场`

### `POST /api/analyze`

请求体：

```json
{
  "title": "用户选中的热点标题",
  "metrics": "点赞 10w+",
  "category": "生活方式",
  "summary": "热点摘要",
  "context": "可选补充信息"
}
```

响应严格遵守前端约定的 `original_post`、`ai_diagnosis` 和
`derived_directions` 结构。服务固定生成 3 个衍生方向，每个方向固定生成 3 个标题。

## 鉴权

每个需要 Gemini 的请求都按以下顺序选择 Key：

1. `Authorization: Bearer <用户的 Gemini API Key>`
2. 云端环境变量 `GEMINI_API_KEY`
3. 两者都没有时返回 `401`

如果请求显式携带了错误格式的 `Authorization`，服务会直接返回 `401`，
不会静默使用服务器 Key。用户 Key 只用于当前请求，不会写入日志、磁盘或全局缓存。

前端调用示例：

```ts
const headers = {
  Authorization: `Bearer ${userGeminiKey}`,
  "Content-Type": "application/json",
  "X-Gemini-Model": "gemini-3.5-flash",
};

const trending = await fetch(
  `${API_BASE}/api/trending?limit=10`,
  { headers },
).then((response) => response.json());

const analysis = await fetch(`${API_BASE}/api/analyze`, {
  method: "POST",
  headers,
  body: JSON.stringify(trending.items[0]),
}).then((response) => response.json());
```

`POST /api/analyze` 会忽略热点卡片中的 `rank`、`keywords`、`sources` 等额外字段，
因此前端可以直接把选中的热点对象作为请求体。
项目根目录的 [`frontend-api-client.ts`](frontend-api-client.ts) 已包含完整类型、
错误处理和两个请求函数，可直接交给前端使用。

## 云端环境变量

复制 [backend/.env.example](backend/.env.example) 中的变量到部署平台的环境变量面板。

- `GEMINI_API_KEY`：可选的服务器回退 Key
- `GEMINI_MODEL`：默认 `gemini-3.5-flash`
- `GEMINI_ALLOWED_MODELS`：允许前端通过 `X-Gemini-Model` 选择的模型
- `CORS_ORIGINS`：逗号分隔的前端域名

生产环境应把 `CORS_ORIGINS` 设置为真实前端域名。若启用服务器回退 Key，
还应在云平台网关配置限流，避免匿名请求消耗服务器配额。

## 部署

### Vercel

在 Vercel 控制台导入代码仓库并配置上述环境变量即可。根目录
[`app.py`](app.py) 暴露标准 FastAPI `app`，Vercel Python Runtime 可零配置识别；
Python 版本由 [`.python-version`](.python-version) 固定为 3.12。

### Zeabur

在 Zeabur 控制台创建 Git 服务、导入代码仓库并配置环境变量。
[`zbpack.json`](zbpack.json) 已指定 Python 3.12、pip 和 `app.py` 入口。
服务自动读取平台分配的 `PORT`。

部署完成后可访问：

- `/docs`：Swagger 交互文档
- `/api/health`：无需 Key 的健康检查

## 错误格式

Gemini 相关错误统一返回：

```json
{
  "error": {
    "code": "INVALID_GEMINI_API_KEY",
    "message": "Gemini API Key 无效、已过期或没有模型访问权限。"
  }
}
```

常见状态码：`400` 参数或模型错误、`401` Key 错误、`429` Gemini 配额限制、
`502` Gemini 上游或结构化输出异常。
