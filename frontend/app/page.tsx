"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDot,
  Cloud,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Flame,
  Hash,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  Radar,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Video,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  AnalyzeResponse,
  ApiError,
  GeminiModel,
  TrendingItem,
  analyzeHotspot,
  checkHealth,
  getTrending,
} from "@/lib/api";

const CATEGORIES = ["今日总榜", "美妆穿搭", "生活方式", "职场成长", "旅行美食"];

const DEMO_TRENDS: TrendingItem[] = [
  {
    rank: 1,
    title: "赛博国风穿搭正在重新定义东方审美",
    metrics: "演示数据 · 热度上升",
    category: "美妆穿搭",
    summary:
      "传统纹样、金属配饰与未来感光影正在形成高辨识度视觉语言，适合做穿搭教程与改造内容。",
    heat_reason: "强视觉反差 + 国风身份认同 + 易于模板化复刻",
    keywords: ["赛博国风", "新中式", "穿搭改造"],
    sources: [{ title: "演示来源", url: "https://example.com" }],
  },
  {
    rank: 2,
    title: "把工位改造成微型疗愈避风港",
    metrics: "演示数据 · 收藏向",
    category: "职场成长",
    summary:
      "低成本桌面改造、情绪疗愈与打工人身份共鸣叠加，形成兼具实用与情绪价值的内容题材。",
    heat_reason: "低门槛改造 + 高收藏价值 + 情绪共鸣",
    keywords: ["工位改造", "打工人", "桌面疗愈"],
    sources: [{ title: "演示来源", url: "https://example.com" }],
  },
  {
    rank: 3,
    title: "周末两小时城市微度假指南",
    metrics: "演示数据 · 搜索向",
    category: "旅行美食",
    summary:
      "不请假、低预算、短半径的城市探索正在替代复杂攻略，适合地图路线和时间轴式内容。",
    heat_reason: "时间成本低 + 路线可复制 + 本地生活搜索需求",
    keywords: ["城市漫游", "微度假", "周末去哪儿"],
    sources: [{ title: "演示来源", url: "https://example.com" }],
  },
];

const MODEL_OPTIONS: Array<{
  value: GeminiModel;
  name: string;
  note: string;
}> = [
  { value: "gemini-3.5-flash", name: "Gemini 3.5 Flash", note: "推荐" },
  { value: "gemini-2.5-flash", name: "Gemini 2.5 Flash", note: "极速" },
  { value: "gemini-2.5-pro", name: "Gemini 2.5 Pro", note: "深度" },
];

const POSTER_STYLES = [
  { emoji: "✦", className: "poster-pink" },
  { emoji: "⌁", className: "poster-blue" },
  { emoji: "●", className: "poster-yellow" },
  { emoji: "✳", className: "poster-green" },
];

type ConnectionState = "idle" | "checking" | "online" | "offline";
type ViewState = "radar" | "analysis";

function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button className="copy-button" type="button" onClick={copy}>
      {copied ? <Check size={15} strokeWidth={3} /> : <Copy size={15} strokeWidth={3} />}
      {copied ? "已复制" : label}
    </button>
  );
}

export default function Home() {
  const [apiBase, setApiBase] = useState(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<GeminiModel>("gemini-3.5-flash");
  const [showKey, setShowKey] = useState(false);
  const [category, setCategory] = useState("今日总榜");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [trends, setTrends] = useState<TrendingItem[]>(DEMO_TRENDS);
  const [isDemo, setIsDemo] = useState(true);
  const [scanDate, setScanDate] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState(
    "当前展示演示数据。配置后端地址后，点击“扫描实时热点”获取 Grounding 结果。",
  );
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [analyzingRank, setAnalyzingRank] = useState<number | null>(null);
  const [selectedTrend, setSelectedTrend] = useState<TrendingItem | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [activeDirection, setActiveDirection] = useState(0);
  const [view, setView] = useState<ViewState>("radar");
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );

  useEffect(() => {
    const storedBase = window.localStorage.getItem("xhs-api-base");
    const storedKey = window.localStorage.getItem("xhs-gemini-key");
    const storedModel = window.localStorage.getItem(
      "xhs-gemini-model",
    ) as GeminiModel | null;

    if (storedBase) setApiBase(storedBase);
    if (storedKey) setApiKey(storedKey);
    if (storedModel && MODEL_OPTIONS.some((item) => item.value === storedModel)) {
      setModel(storedModel);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("xhs-api-base", apiBase);
    window.localStorage.setItem("xhs-gemini-key", apiKey);
    window.localStorage.setItem("xhs-gemini-model", model);
  }, [apiBase, apiKey, model]);

  useEffect(() => {
    if (!apiBase.trim()) {
      setConnection("idle");
      return;
    }
    let active = true;
    setConnection("checking");
    const timer = window.setTimeout(async () => {
      const online = await checkHealth(apiBase);
      if (active) setConnection(online ? "online" : "offline");
    }, 450);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [apiBase]);

  const apiOptions = useMemo(
    () => ({ apiBase, apiKey, model }),
    [apiBase, apiKey, model],
  );

  function presentError(caught: unknown) {
    if (caught instanceof ApiError) {
      setError({ code: caught.code, message: caught.message });
    } else {
      setError({ code: "UNKNOWN_ERROR", message: "发生未知错误，请稍后重试。" });
    }
  }

  async function scanTrends() {
    setError(null);
    setLoadingTrends(true);
    try {
      const result = await getTrending(apiOptions, 10, category);
      setTrends(result.items);
      setScanDate(result.date);
      setDisclaimer(result.disclaimer);
      setIsDemo(false);
      setView("radar");
    } catch (caught) {
      presentError(caught);
    } finally {
      setLoadingTrends(false);
    }
  }

  async function runAnalysis(trend: TrendingItem) {
    setError(null);
    setAnalyzingRank(trend.rank);
    try {
      const result = await analyzeHotspot(apiOptions, trend);
      setSelectedTrend(trend);
      setAnalysis(result);
      setActiveDirection(0);
      setView("analysis");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      presentError(caught);
    } finally {
      setAnalyzingRank(null);
    }
  }

  const currentDirection = analysis?.derived_directions[activeDirection];

  return (
    <div className="site-frame">
      <div className="ticker" aria-label="产品状态">
        <div className="ticker-track">
          <span>LIVE SIGNAL</span>
          <CircleDot size={13} fill="currentColor" />
          <span>GOOGLE SEARCH GROUNDING</span>
          <CircleDot size={13} fill="currentColor" />
          <span>BYOK READY</span>
          <CircleDot size={13} fill="currentColor" />
          <span>AI CONTENT STUDIO</span>
        </div>
        <div className="ticker-date">
          {scanDate ? `SCAN ${scanDate}` : "READY TO SCAN"}
        </div>
      </div>

      <div className="workspace">
        <aside className="sidebar left-sidebar">
          <div className="brand-block">
            <div className="brand-mark">
              <Zap size={24} fill="currentColor" strokeWidth={3} />
            </div>
            <div>
              <p className="eyebrow">XHS VIRAL LAB</p>
              <h1>爆款制造机</h1>
              <p className="brand-subtitle">AI 小红书起号台</p>
            </div>
          </div>

          <nav className="steps" aria-label="创作工作流">
            {[
              { n: "01", label: "今日爆款雷达", icon: Radar, active: view === "radar" },
              { n: "02", label: "爆款深度拆解", icon: Search, active: view === "analysis" },
              { n: "03", label: "生成衍生选题", icon: Sparkles, active: view === "analysis" },
              { n: "04", label: "一键生成文案", icon: FileText, active: view === "analysis" },
              { n: "05", label: "多模态提示词", icon: Video, active: view === "analysis" },
            ].map((step) => {
              const Icon = step.icon;
              return (
                <button
                  key={step.n}
                  type="button"
                  className={`step ${step.active ? "step-active" : ""}`}
                  onClick={() => {
                    if (step.n === "01") setView("radar");
                    if (analysis && step.n !== "01") setView("analysis");
                  }}
                >
                  <span className="step-number">{step.n}</span>
                  <Icon size={19} strokeWidth={2.8} />
                  <span>{step.label}</span>
                  {step.active && <ArrowRight className="step-arrow" size={17} />}
                </button>
              );
            })}
          </nav>

          <div className="sidebar-note">
            <ShieldCheck size={24} strokeWidth={2.8} />
            <div>
              <strong>隐私模式</strong>
              <p>API Key 仅保存在你的浏览器，不进入本站数据库。</p>
            </div>
          </div>
        </aside>

        <main className="main-panel">
          <header className="main-header">
            <div className="category-tabs" aria-label="赛道筛选">
              {CATEGORIES.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={category === item ? "category-active" : ""}
                  onClick={() => setCategory(item)}
                >
                  {item === "今日总榜" && <Flame size={16} fill="currentColor" />}
                  {item}
                </button>
              ))}
            </div>
            <div className="scan-count">
              <span>已发现</span>
              <strong>{trends.length.toString().padStart(2, "0")}</strong>
              <span>个信号</span>
            </div>
          </header>

          {error && (
            <div className="error-banner" role="alert">
              <div className="error-icon">!</div>
              <div>
                <strong>{error.code}</strong>
                <p>{error.message}</p>
              </div>
              <button type="button" onClick={() => setError(null)}>
                关闭
              </button>
            </div>
          )}

          {view === "radar" ? (
            <div className="content-area">
              <section className="hero-row">
                <div>
                  <div className="section-kicker">
                    <TrendingUp size={18} strokeWidth={3} />
                    REAL-TIME CONTENT SIGNALS
                  </div>
                  <h2>
                    今日爆款
                    <span>扫描结果</span>
                  </h2>
                  <p>
                    从实时热度里找切口，把「大家都在聊」变成「只有你能讲」。
                  </p>
                </div>
                <button
                  className="primary-action"
                  type="button"
                  onClick={scanTrends}
                  disabled={loadingTrends}
                >
                  {loadingTrends ? (
                    <LoaderCircle className="spin" size={21} strokeWidth={3} />
                  ) : (
                    <RefreshCw size={20} strokeWidth={3} />
                  )}
                  {loadingTrends ? "正在联网扫描…" : "扫描实时热点"}
                </button>
              </section>

              <div className="data-notice">
                <span className={isDemo ? "demo-badge" : "live-badge"}>
                  {isDemo ? "DEMO" : "LIVE"}
                </span>
                <p>{disclaimer}</p>
              </div>

              <section className="trend-list" aria-label="热点列表">
                {trends.map((trend, index) => {
                  const poster = POSTER_STYLES[index % POSTER_STYLES.length];
                  return (
                    <article className="trend-card" key={`${trend.rank}-${trend.title}`}>
                      <div className={`trend-poster ${poster.className}`}>
                        <span className="poster-rank">
                          #{trend.rank.toString().padStart(2, "0")}
                        </span>
                        <span className="poster-symbol">{poster.emoji}</span>
                        <span className="poster-category">{trend.category}</span>
                        <div className="poster-lines" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </div>
                      </div>

                      <div className="trend-body">
                        <div className="trend-meta">
                          <span className="metric-badge">{trend.metrics}</span>
                          <span className="rank-chip">TREND {trend.rank}</span>
                        </div>
                        <h3>{trend.title}</h3>
                        <p className="trend-summary">{trend.summary}</p>

                        <div className="heat-reason">
                          <Sparkles size={18} strokeWidth={2.8} />
                          <p>
                            <strong>升温逻辑：</strong>
                            {trend.heat_reason}
                          </p>
                        </div>

                        <div className="card-footer">
                          <div className="keyword-list">
                            {trend.keywords.map((keyword) => (
                              <span key={keyword}>
                                <Hash size={12} strokeWidth={3} />
                                {keyword}
                              </span>
                            ))}
                          </div>
                          <button
                            className="analyze-button"
                            type="button"
                            onClick={() => runAnalysis(trend)}
                            disabled={analyzingRank !== null}
                          >
                            {analyzingRank === trend.rank ? (
                              <LoaderCircle className="spin" size={18} />
                            ) : (
                              <Zap size={18} fill="currentColor" />
                            )}
                            {analyzingRank === trend.rank
                              ? "深度拆解中…"
                              : "拆解并生成"}
                            <ArrowRight size={18} strokeWidth={3} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            </div>
          ) : (
            <div className="content-area analysis-area">
              <button
                type="button"
                className="back-button"
                onClick={() => setView("radar")}
              >
                <ArrowLeft size={18} strokeWidth={3} />
                返回热点雷达
              </button>

              {analysis && selectedTrend ? (
                <>
                  <section className="analysis-hero">
                    <div className="analysis-index">DIAGNOSIS / 01</div>
                    <div className="analysis-title-row">
                      <div>
                        <p className="eyebrow">SELECTED SIGNAL</p>
                        <h2>{analysis.original_post.title}</h2>
                      </div>
                      <span className="metric-badge">
                        {analysis.original_post.metrics}
                      </span>
                    </div>
                    <div className="diagnosis-box">
                      <div className="diagnosis-label">
                        <Sparkles size={22} strokeWidth={3} />
                        AI 深度诊断
                      </div>
                      <p>{analysis.ai_diagnosis}</p>
                    </div>
                  </section>

                  <section className="direction-section">
                    <div className="direction-heading">
                      <div>
                        <p className="eyebrow">DERIVED DIRECTIONS</p>
                        <h3>3 条差异化创作路线</h3>
                      </div>
                      <span>选择方向查看完整物料</span>
                    </div>
                    <div className="direction-tabs">
                      {analysis.derived_directions.map((direction, index) => (
                        <button
                          type="button"
                          key={direction.direction_title}
                          className={activeDirection === index ? "active" : ""}
                          onClick={() => setActiveDirection(index)}
                        >
                          <span>0{index + 1}</span>
                          {direction.direction_title}
                        </button>
                      ))}
                    </div>

                    {currentDirection && (
                      <div className="direction-board">
                        <section className="output-block titles-output">
                          <div className="output-heading">
                            <div>
                              <Hash size={20} strokeWidth={3} />
                              <h4>爆款标题组</h4>
                            </div>
                            <CopyButton
                              text={currentDirection.xiaohongshu_titles.join("\n")}
                              label="复制全部"
                            />
                          </div>
                          <ol>
                            {currentDirection.xiaohongshu_titles.map((title, index) => (
                              <li key={title}>
                                <span>{index + 1}</span>
                                <p>{title}</p>
                                <CopyButton text={title} />
                              </li>
                            ))}
                          </ol>
                        </section>

                        <section className="output-block copy-output">
                          <div className="output-heading">
                            <div>
                              <FileText size={20} strokeWidth={3} />
                              <h4>小红书正文模板</h4>
                            </div>
                            <CopyButton text={currentDirection.copywriting} />
                          </div>
                          <p className="long-copy">{currentDirection.copywriting}</p>
                        </section>

                        <div className="prompt-grid">
                          <section className="output-block prompt-output image-output">
                            <div className="output-heading">
                              <div>
                                <ImageIcon size={20} strokeWidth={3} />
                                <h4>IMAGE PROMPT</h4>
                              </div>
                              <CopyButton text={currentDirection.image_prompt} />
                            </div>
                            <p>{currentDirection.image_prompt}</p>
                          </section>

                          <section className="output-block prompt-output video-output">
                            <div className="output-heading">
                              <div>
                                <Video size={20} strokeWidth={3} />
                                <h4>VIDEO PROMPT</h4>
                              </div>
                              <CopyButton text={currentDirection.video_prompt} />
                            </div>
                            <p>{currentDirection.video_prompt}</p>
                          </section>
                        </div>
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <div className="empty-analysis">
                  <Radar size={42} strokeWidth={2.5} />
                  <h2>还没有拆解任务</h2>
                  <p>先从热点雷达选择一个信号。</p>
                </div>
              )}
            </div>
          )}
        </main>

        <aside className="sidebar right-sidebar">
          <div className="settings-title">
            <Settings2 size={23} strokeWidth={3} />
            <div>
              <p className="eyebrow">CONTROL DECK</p>
              <h2>核心引擎配置</h2>
            </div>
          </div>

          <div className="settings-body">
            <div className="field-group">
              <label htmlFor="api-base">
                <Server size={17} strokeWidth={2.8} />
                后端 API 地址
              </label>
              <input
                id="api-base"
                type="url"
                value={apiBase}
                onChange={(event) => setApiBase(event.target.value)}
                placeholder="https://xxx.vercel.app"
                spellCheck={false}
              />
              <p>填写 FastAPI 部署域名，不要在末尾加 /</p>
            </div>

            <div className="field-group">
              <label htmlFor="model">
                <Cloud size={17} strokeWidth={2.8} />
                生成模型
              </label>
              <div className="select-wrap">
                <select
                  id="model"
                  value={model}
                  onChange={(event) => setModel(event.target.value as GeminiModel)}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.name} · {option.note}
                    </option>
                  ))}
                </select>
                <span>⌄</span>
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="api-key">
                <KeyRound size={17} strokeWidth={2.8} />
                Gemini API Key
              </label>
              <div className="secret-input">
                <input
                  id="api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="留空则使用服务器 Key"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((visible) => !visible)}
                  aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p>仅保存在当前浏览器 localStorage</p>
            </div>

            <div className={`connection-card connection-${connection}`}>
              <div className="connection-icon">
                {connection === "online" ? (
                  <Wifi size={23} strokeWidth={3} />
                ) : connection === "checking" ? (
                  <LoaderCircle className="spin" size={23} strokeWidth={3} />
                ) : (
                  <WifiOff size={23} strokeWidth={3} />
                )}
              </div>
              <div>
                <strong>
                  {connection === "online"
                    ? "云端引擎在线"
                    : connection === "checking"
                      ? "正在检查连接"
                      : connection === "offline"
                        ? "后端暂不可达"
                        : "等待配置后端"}
                </strong>
                <p>
                  {connection === "online"
                    ? "健康检查通过，可以开始扫描"
                    : "状态来自 /api/health"}
                </p>
              </div>
            </div>

            <button
              className="settings-scan-button"
              type="button"
              onClick={scanTrends}
              disabled={loadingTrends}
            >
              {loadingTrends ? (
                <LoaderCircle className="spin" size={20} />
              ) : (
                <Radar size={20} strokeWidth={3} />
              )}
              {loadingTrends ? "扫描进行中" : "启动热点扫描"}
            </button>

            <div className="source-note">
              <div>
                <CircleDot size={15} fill="currentColor" />
                SEARCH GROUNDING
              </div>
              <p>实时搜索结果由 Gemini 综合公开网页生成，具体平台数据以原页面为准。</p>
              {!isDemo && trends[0]?.sources?.[0] && (
                <a
                  href={trends[0].sources[0].url}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看首条公开来源
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
