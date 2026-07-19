# 小红书爆款制造机前端

Next.js 前端，连接本仓库 FastAPI 后端。

功能：

- 腾讯云 TokenHub 联网热点扫描
- DeepSeek V4 热点拆解
- 3 个衍生创作方向
- 标题、正文、图片和视频提示词复制
- 用户自带腾讯云 TokenHub API Key

用户 Key 只保存在浏览器 `localStorage`，每次请求通过
`Authorization: Bearer <key>` 发送；留空时使用后端 `TOKENHUB_API_KEY`。

## Vercel

- Framework Preset：Next.js
- Root Directory：`frontend`
- 环境变量：

```text
NEXT_PUBLIC_API_BASE_URL=https://你的后端.vercel.app
```

保存环境变量后重新部署。
