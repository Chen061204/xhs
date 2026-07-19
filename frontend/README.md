# 爆款制造机前端

独立的 Next.js 前端应用，连接仓库根目录中的 FastAPI 后端。

## 云端环境变量

在前端部署平台中配置：

```text
NEXT_PUBLIC_API_BASE_URL=https://你的后端域名.vercel.app
```

该变量不是必填。用户也可以在页面右侧的“后端 API 地址”中填写，设置会保存在
浏览器 localStorage。

## Vercel 部署

推荐从同一个 GitHub 仓库新建第二个 Vercel Project：

1. 导入仓库。
2. 将 `Root Directory` 设置为 `frontend`。
3. Framework Preset 选择 `Next.js`。
4. 添加 `NEXT_PUBLIC_API_BASE_URL`。
5. 部署。

后端 Vercel Project 仍保持仓库根目录，不要改成 `frontend`。

部署前端后，请回到后端 Project，把：

```text
CORS_ORIGINS=https://你的前端域名.vercel.app
```

配置为前端的真实域名，然后重新部署后端。

## 功能

- Gemini Search Grounding 热点扫描
- 赛道筛选与实时连接状态
- 用户自带 API Key，浏览器本地保存
- 服务器 Key 自动回退
- 热点深度诊断
- 三组衍生选题、正文、图片提示词和视频提示词
- 一键复制内容
- 桌面、平板和移动端响应式布局
