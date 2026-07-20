"use client";

import {
  Archive,
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
  DeepSeekModel,
  TrendingItem,
  analyzeHotspot,
  checkHealth,
  getTrending,
} from "@/lib/api";

const CATEGORIES = ["今日总榜", "美妆穿搭", "生活方式", "职场成长", "旅行美食"];
const TREND_CACHE_KEY = "xhs-trending-cache-v2";
const ANALYSIS_CACHE_KEY = "xhs-analysis-cache-v1";
const ANALYSIS_LIBRARY_KEY = "xhs-analysis-library-v1";
const MAX_SAVED_ANALYSES = 20;
const EMPTY_TRENDS_MESSAGE =
  "尚未扫描联网热点。首次扫描后，结果会自动保存在当前浏览器。";

const MODEL_OPTIONS: Array<{
  value: DeepSeekModel;
  name: string;
  note: string;
}> = [
  {
    value: "deepseek-v4-pro-202606",
    name: "DeepSeek V4 Pro 202606",
    note: "腾讯云",
  },
];

const POSTER_STYLES = [
  { emoji: "✦", className: "poster-pink" },
  { emoji: "⌁", className: "poster-blue" },
  { emoji: "●", className: "poster-yellow" },
  { emoji: "✳", className: "poster-green" },
];

type ConnectionState = "idle" | "checking" | "online" | "offline";
type ViewState = "radar" | "analysis" | "library";
type WorkflowSection =
  | "radar"
  | "diagnosis"
  | "directions"
  | "copywriting"
  | "prompts";
type NavigationSection = WorkflowSection | "library";

type CachedTrendResult = {
  items: TrendingItem[];
  date: string;
  disclaimer: string;
  savedAt: string;
};

type TrendCache = {
  version: 2;
  activeCategory: string;
  results: Record<string, CachedTrendResult>;
};

type AnalysisCache = {
  version: 1;
  selectedTrend: TrendingItem;
  analysis: AnalyzeResponse;
  activeDirection: number;
  view: ViewState;
  activeSection: NavigationSection;
  savedAt: string;
};

type AnalysisRecord = {
  id: string;
  selectedTrend: TrendingItem;
  analysis: AnalyzeResponse;
  savedAt: string;
};

type AnalysisLibraryCache = {
  version: 1;
  items: AnalysisRecord[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isTrendingItem(value: unknown): value is TrendingItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TrendingItem>;
  return (
    typeof item.rank === "number" &&
    typeof item.title === "string" &&
    typeof item.metrics === "string" &&
    typeof item.category === "string" &&
    typeof item.summary === "string" &&
    typeof item.heat_reason === "string" &&
    isStringArray(item.keywords) &&
    Array.isArray(item.sources) &&
    item.sources.every(
      (source) =>
        source &&
        typeof source === "object" &&
        typeof source.title === "string" &&
        typeof source.url === "string",
    )
  );
}

function isCachedTrendResult(value: unknown): value is CachedTrendResult {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<CachedTrendResult>;
  return (
    Array.isArray(cache.items) &&
    cache.items.every(isTrendingItem) &&
    typeof cache.date === "string" &&
    typeof cache.disclaimer === "string" &&
    typeof cache.savedAt === "string" &&
    Number.isFinite(Date.parse(cache.savedAt))
  );
}

function isTrendCache(value: unknown): value is TrendCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<TrendCache>;
  return (
    cache.version === 2 &&
    typeof cache.activeCategory === "string" &&
    Boolean(cache.results) &&
    typeof cache.results === "object" &&
    Object.values(
      cache.results as Record<string, unknown>,
    ).every(isCachedTrendResult)
  );
}

function isAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<AnalyzeResponse>;
  const originalPost = result.original_post;
  return (
    Boolean(originalPost) &&
    typeof originalPost?.title === "string" &&
    typeof originalPost.metrics === "string" &&
    typeof result.ai_diagnosis === "string" &&
    Array.isArray(result.derived_directions) &&
    result.derived_directions.length === 3 &&
    result.derived_directions.every(
      (direction) =>
        direction &&
        typeof direction === "object" &&
        typeof direction.direction_title === "string" &&
        Array.isArray(direction.xiaohongshu_titles) &&
        direction.xiaohongshu_titles.length === 3 &&
        direction.xiaohongshu_titles.every((title) => typeof title === "string") &&
        typeof direction.copywriting === "string" &&
        typeof direction.image_prompt === "string" &&
        typeof direction.video_prompt === "string",
    )
  );
}

function createAnalysisRecordId(trend: TrendingItem): string {
  return `${trend.category}\u0000${trend.title}`;
}

function isAnalysisRecord(value: unknown): value is AnalysisRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AnalysisRecord>;
  return (
    typeof record.id === "string" &&
    isTrendingItem(record.selectedTrend) &&
    isAnalyzeResponse(record.analysis) &&
    typeof record.savedAt === "string" &&
    Number.isFinite(Date.parse(record.savedAt))
  );
}

function isAnalysisLibraryCache(value: unknown): value is AnalysisLibraryCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<AnalysisLibraryCache>;
  return (
    cache.version === 1 &&
    Array.isArray(cache.items) &&
    cache.items.length <= MAX_SAVED_ANALYSES &&
    cache.items.every(isAnalysisRecord)
  );
}

function isAnalysisCache(value: unknown): value is AnalysisCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<AnalysisCache>;
  const validSection =
    cache.activeSection === "radar" ||
    cache.activeSection === "diagnosis" ||
    cache.activeSection === "directions" ||
    cache.activeSection === "copywriting" ||
    cache.activeSection === "prompts" ||
    cache.activeSection === "library";
  return (
    cache.version === 1 &&
    isTrendingItem(cache.selectedTrend) &&
    isAnalyzeResponse(cache.analysis) &&
    Number.isInteger(cache.activeDirection) &&
    Number(cache.activeDirection) >= 0 &&
    Number(cache.activeDirection) < 3 &&
    (cache.view === "radar" ||
      cache.view === "analysis" ||
      cache.view === "library") &&
    validSection &&
    typeof cache.savedAt === "string" &&
    Number.isFinite(Date.parse(cache.savedAt))
  );
}

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
  const [model, setModel] = useState<DeepSeekModel>("deepseek-v4-pro-202606");
  const [showKey, setShowKey] = useState(false);
  const [category, setCategory] = useState("今日总榜");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [trends, setTrends] = useState<TrendingItem[]>([]);
  const [trendCache, setTrendCache] = useState<
    Record<string, CachedTrendResult>
  >({});
  const [scanDate, setScanDate] = useState<string | null>(null);
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState(EMPTY_TRENDS_MESSAGE);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [analyzingRank, setAnalyzingRank] = useState<number | null>(null);
  const [selectedTrend, setSelectedTrend] = useState<TrendingItem | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [analysisSavedAt, setAnalysisSavedAt] = useState<string | null>(null);
  const [analysisLibrary, setAnalysisLibrary] = useState<AnalysisRecord[]>([]);
  const [activeDirection, setActiveDirection] = useState(0);
  const [view, setView] = useState<ViewState>("radar");
  const [activeSection, setActiveSection] =
    useState<NavigationSection>("radar");
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const storedBase = window.localStorage.getItem("xhs-api-base");
    const storedKey = window.localStorage.getItem("xhs-tokenhub-key");
    const storedModel = window.localStorage.getItem(
      "xhs-tokenhub-model",
    ) as DeepSeekModel | null;
    const storedTrends = window.localStorage.getItem(TREND_CACHE_KEY);
    const storedAnalysis = window.localStorage.getItem(ANALYSIS_CACHE_KEY);
    const storedLibrary = window.localStorage.getItem(ANALYSIS_LIBRARY_KEY);
    let restoredAnalysis: AnalysisCache | null = null;

    if (storedBase) setApiBase(storedBase);
    if (storedKey) setApiKey(storedKey);
    if (storedModel && MODEL_OPTIONS.some((item) => item.value === storedModel)) {
      setModel(storedModel);
    }
    if (storedTrends) {
      try {
        const cache: unknown = JSON.parse(storedTrends);
        if (isTrendCache(cache)) {
          const activeCategory = CATEGORIES.includes(cache.activeCategory)
            ? cache.activeCategory
            : "今日总榜";
          const activeResult = cache.results[activeCategory];
          setTrendCache(cache.results);
          setCategory(activeCategory);
          if (activeResult) {
            setTrends(activeResult.items);
            setScanDate(activeResult.date);
            setDisclaimer(activeResult.disclaimer);
            setCacheSavedAt(activeResult.savedAt);
          }
        } else {
          window.localStorage.removeItem(TREND_CACHE_KEY);
        }
      } catch {
        window.localStorage.removeItem(TREND_CACHE_KEY);
      }
    }
    if (storedAnalysis) {
      try {
        const cache: unknown = JSON.parse(storedAnalysis);
        if (isAnalysisCache(cache)) {
          restoredAnalysis = cache;
          setSelectedTrend(cache.selectedTrend);
          setAnalysis(cache.analysis);
          setAnalysisSavedAt(cache.savedAt);
          setActiveDirection(cache.activeDirection);
          setView(cache.view);
          setActiveSection(cache.activeSection);
        } else {
          window.localStorage.removeItem(ANALYSIS_CACHE_KEY);
        }
      } catch {
        window.localStorage.removeItem(ANALYSIS_CACHE_KEY);
      }
    }
    let restoredLibrary: AnalysisRecord[] = [];
    if (storedLibrary) {
      try {
        const cache: unknown = JSON.parse(storedLibrary);
        if (isAnalysisLibraryCache(cache)) {
          restoredLibrary = cache.items;
        } else {
          window.localStorage.removeItem(ANALYSIS_LIBRARY_KEY);
        }
      } catch {
        window.localStorage.removeItem(ANALYSIS_LIBRARY_KEY);
      }
    }
    if (restoredAnalysis) {
      const restoredId = createAnalysisRecordId(restoredAnalysis.selectedTrend);
      if (!restoredLibrary.some((record) => record.id === restoredId)) {
        restoredLibrary = [
          {
            id: restoredId,
            selectedTrend: restoredAnalysis.selectedTrend,
            analysis: restoredAnalysis.analysis,
            savedAt: restoredAnalysis.savedAt,
          },
          ...restoredLibrary,
        ].slice(0, MAX_SAVED_ANALYSES);
        try {
          window.localStorage.setItem(
            ANALYSIS_LIBRARY_KEY,
            JSON.stringify({ version: 1, items: restoredLibrary }),
          );
        } catch {
          // The current analysis remains available even if migration cannot persist.
        }
      }
    }
    setAnalysisLibrary(restoredLibrary);
    setStorageReady(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("xhs-api-base", apiBase);
    window.localStorage.setItem("xhs-tokenhub-key", apiKey);
    window.localStorage.setItem("xhs-tokenhub-model", model);
  }, [apiBase, apiKey, model]);

  useEffect(() => {
    if (
      !storageReady ||
      !selectedTrend ||
      !analysis ||
      !analysisSavedAt
    ) {
      return;
    }
    const cache: AnalysisCache = {
      version: 1,
      selectedTrend,
      analysis,
      activeDirection,
      view,
      activeSection,
      savedAt: analysisSavedAt,
    };
    try {
      window.localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Keep the live result usable when browser storage is unavailable.
    }
  }, [
    activeDirection,
    activeSection,
    analysis,
    analysisSavedAt,
    selectedTrend,
    storageReady,
    view,
  ]);

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

  function showCachedResult(nextCategory: string, result: CachedTrendResult) {
    setCategory(nextCategory);
    setTrends(result.items);
    setScanDate(result.date);
    setDisclaimer(result.disclaimer);
    setCacheSavedAt(result.savedAt);
    setView("radar");
    setActiveSection("radar");
  }

  function persistTrendCache(
    activeCategory: string,
    results: Record<string, CachedTrendResult>,
  ) {
    const cache: TrendCache = { version: 2, activeCategory, results };
    try {
      window.localStorage.setItem(TREND_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // A storage quota/privacy error must not discard successful live data.
    }
  }

  function persistAnalysisLibrary(items: AnalysisRecord[]) {
    const cache: AnalysisLibraryCache = { version: 1, items };
    try {
      window.localStorage.setItem(ANALYSIS_LIBRARY_KEY, JSON.stringify(cache));
    } catch {
      // Keep the in-memory library usable when browser storage is unavailable.
    }
  }

  async function scanTrends(nextCategory = category) {
    setError(null);
    setLoadingTrends(true);
    setCategory(nextCategory);
    setView("radar");
    setActiveSection("radar");
    if (!trendCache[nextCategory]) {
      setTrends([]);
      setScanDate(null);
      setCacheSavedAt(null);
      setDisclaimer(EMPTY_TRENDS_MESSAGE);
    }
    try {
      const result = await getTrending(apiOptions, 10, nextCategory);
      const savedAt = new Date().toISOString();
      const cachedResult: CachedTrendResult = {
        items: result.items,
        date: result.date,
        disclaimer: result.disclaimer,
        savedAt,
      };
      const nextCache = { ...trendCache, [nextCategory]: cachedResult };
      setTrendCache(nextCache);
      showCachedResult(nextCategory, cachedResult);
      persistTrendCache(nextCategory, nextCache);
    } catch (caught) {
      presentError(caught);
    } finally {
      setLoadingTrends(false);
    }
  }

  function chooseCategory(nextCategory: string) {
    if (loadingTrends) return;
    const cached = trendCache[nextCategory];
    if (cached) {
      if (nextCategory === category) return;
      showCachedResult(nextCategory, cached);
      persistTrendCache(nextCategory, trendCache);
      return;
    }
    void scanTrends(nextCategory);
  }

  function goToWorkflowSection(section: WorkflowSection) {
    setError(null);
    if (section === "radar") {
      setView("radar");
      setActiveSection("radar");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!analysis || !selectedTrend) {
      setView("radar");
      setActiveSection("radar");
      setError({
        code: "请先生成拆解",
        message: "请先从热点列表选择选题并生成拆解",
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setView("analysis");
    setActiveSection(section);
    window.setTimeout(() => {
      document
        .getElementById(`workflow-${section}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function openAnalysisLibrary() {
    setError(null);
    setView("library");
    setActiveSection("library");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSavedAnalysis(record: AnalysisRecord) {
    setSelectedTrend(record.selectedTrend);
    setAnalysis(record.analysis);
    setAnalysisSavedAt(record.savedAt);
    setActiveDirection(0);
    setView("analysis");
    setActiveSection("diagnosis");
    window.setTimeout(() => {
      document
        .getElementById("workflow-diagnosis")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  async function runAnalysis(trend: TrendingItem) {
    setError(null);
    setAnalyzingRank(trend.rank);
    try {
      const result = await analyzeHotspot(apiOptions, trend);
      const savedAt = new Date().toISOString();
      const savedRecord: AnalysisRecord = {
        id: createAnalysisRecordId(trend),
        selectedTrend: trend,
        analysis: result,
        savedAt,
      };
      setSelectedTrend(trend);
      setAnalysis(result);
      setAnalysisSavedAt(savedAt);
      setActiveDirection(0);
      setView("analysis");
      setActiveSection("diagnosis");
      setAnalysisLibrary((records) => {
        const nextRecords = [
          savedRecord,
          ...records.filter((record) => record.id !== savedRecord.id),
        ].slice(0, MAX_SAVED_ANALYSES);
        persistAnalysisLibrary(nextRecords);
        return nextRecords;
      });
      window.setTimeout(() => {
        document
          .getElementById("workflow-diagnosis")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (caught) {
      presentError(caught);
    } finally {
      setAnalyzingRank(null);
    }
  }

  const currentDirection = analysis?.derived_directions[activeDirection];
  const hasSavedResult = cacheSavedAt !== null;
  const cacheTimeLabel = cacheSavedAt
    ? new Date(cacheSavedAt).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const analysisTimeLabel = analysisSavedAt
    ? new Date(analysisSavedAt).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="site-frame">
      <div className="ticker" aria-label="产品状态">
        <div className="ticker-track">
          <span>LIVE SIGNAL</span>
          <CircleDot size={13} fill="currentColor" />
          <span>TENCENT TOKENHUB WEB SEARCH</span>
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
              { n: "01", label: "今日爆款雷达", icon: Radar, section: "radar" },
              { n: "02", label: "爆款深度拆解", icon: Search, section: "diagnosis" },
              { n: "03", label: "生成衍生选题", icon: Sparkles, section: "directions" },
              { n: "04", label: "一键生成文案", icon: FileText, section: "copywriting" },
              { n: "05", label: "多模态提示词", icon: Video, section: "prompts" },
            ].map((step) => {
              const Icon = step.icon;
              const section = step.section as WorkflowSection;
              const active = activeSection === section;
              return (
                <button
                  key={step.n}
                  type="button"
                  className={`step ${active ? "step-active" : ""}`}
                  onClick={() => goToWorkflowSection(section)}
                  aria-current={active ? "step" : undefined}
                >
                  <span className="step-number">{step.n}</span>
                  <Icon size={19} strokeWidth={2.8} />
                  <span>{step.label}</span>
                  {active && <ArrowRight className="step-arrow" size={17} />}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            className={`library-nav-button ${activeSection === "library" ? "active" : ""}`}
            onClick={openAnalysisLibrary}
            aria-current={activeSection === "library" ? "page" : undefined}
          >
            <Archive size={19} strokeWidth={2.8} />
            <span>已解析内容</span>
            <strong>{analysisLibrary.length.toString().padStart(2, "0")}</strong>
          </button>

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
                  onClick={() => chooseCategory(item)}
                  disabled={loadingTrends}
                  aria-pressed={category === item}
                >
                  {item === "今日总榜" && <Flame size={16} fill="currentColor" />}
                  {loadingTrends && category === item ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : null}
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
                    LIVE WEB CONTENT SIGNALS
                  </div>
                  <h2>
                    今日爆款
                    <span>扫描结果</span>
                  </h2>
                  <p>
                    搜索最新公开网页，从实时信号中提炼有辨识度的创作方向。
                  </p>
                </div>
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => scanTrends()}
                  disabled={loadingTrends}
                >
                  {loadingTrends ? (
                    <LoaderCircle className="spin" size={21} strokeWidth={3} />
                  ) : (
                    <RefreshCw size={20} strokeWidth={3} />
                  )}
                  {loadingTrends ? "正在联网搜索…" : "扫描联网热点"}
                </button>
              </section>

              <div className="data-notice">
                <span className={hasSavedResult ? "live-badge" : "ready-badge"}>
                  {hasSavedResult ? "SAVED" : "READY"}
                </span>
                <p>
                  {cacheTimeLabel ? `已保存“${category}” ${cacheTimeLabel} 的扫描结果。` : ""}
                  {disclaimer}
                </p>
              </div>

              <section className="trend-list" aria-label="热点列表">
                {trends.length === 0 ? (
                  <div className="empty-trends">
                    <Radar size={46} strokeWidth={2.6} />
                    <h3>{hasSavedResult ? "本次扫描暂无热点" : "还没有联网热点"}</h3>
                    <p>
                      {hasSavedResult
                        ? "该分类已完成扫描，但暂时没有返回可用热点。你可以稍后强制刷新。"
                        : "首次使用请点击“扫描联网热点”；扫描成功后刷新页面也会保留。"}
                    </p>
                  </div>
                ) : trends.map((trend, index) => {
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
          ) : view === "library" ? (
            <div className="content-area saved-library-area">
              <section className="library-heading">
                <div>
                  <div className="section-kicker">
                    <Archive size={18} strokeWidth={3} />
                    LOCAL ANALYSIS ARCHIVE
                  </div>
                  <h2>已解析内容库</h2>
                  <p>拆解结果保存在当前浏览器，重新打开不会消耗模型额度。</p>
                </div>
                <span className="library-total">
                  {analysisLibrary.length.toString().padStart(2, "0")} SAVED
                </span>
              </section>

              {analysisLibrary.length === 0 ? (
                <div className="empty-trends saved-library-empty">
                  <Archive size={46} strokeWidth={2.6} />
                  <h3>还没有已解析内容</h3>
                  <p>从热点雷达点击“拆解并生成”，结果会自动进入这里。</p>
                </div>
              ) : (
                <section className="saved-analysis-grid" aria-label="已解析内容列表">
                  {analysisLibrary.map((record) => (
                    <article className="saved-analysis-card" key={record.id}>
                      <div className="saved-analysis-meta">
                        <span>{record.selectedTrend.category}</span>
                        <time dateTime={record.savedAt}>
                          {new Date(record.savedAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <h3>{record.analysis.original_post.title}</h3>
                      <p>{record.analysis.ai_diagnosis}</p>
                      <div className="saved-direction-list">
                        {record.analysis.derived_directions.map((direction, index) => (
                          <span key={direction.direction_title}>
                            0{index + 1} {direction.direction_title}
                          </span>
                        ))}
                      </div>
                      <button type="button" onClick={() => openSavedAnalysis(record)}>
                        打开完整拆解
                        <ArrowRight size={17} strokeWidth={3} />
                      </button>
                    </article>
                  ))}
                </section>
              )}
            </div>
          ) : (
            <div className="content-area analysis-area">
              <button
                type="button"
                className="back-button"
                onClick={() => goToWorkflowSection("radar")}
              >
                <ArrowLeft size={18} strokeWidth={3} />
                返回热点雷达
              </button>

              {analysis && selectedTrend ? (
                <>
                  <section className="analysis-hero" id="workflow-diagnosis">
                    <div className="analysis-index">DIAGNOSIS / 01</div>
                    <div className="analysis-title-row">
                      <div>
                        {analysisTimeLabel && (
                          <div className="analysis-save-status" role="status">
                            <Check size={14} strokeWidth={3} />
                            LOCAL SAVED · {analysisTimeLabel}
                          </div>
                        )}
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

                  <section className="direction-section" id="workflow-directions">
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
                          aria-pressed={activeDirection === index}
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

                        <section
                          className="output-block copy-output"
                          id="workflow-copywriting"
                        >
                          <div className="output-heading">
                            <div>
                              <FileText size={20} strokeWidth={3} />
                              <h4>小红书正文模板</h4>
                            </div>
                            <CopyButton text={currentDirection.copywriting} />
                          </div>
                          <p className="long-copy">{currentDirection.copywriting}</p>
                        </section>

                        <div className="prompt-grid" id="workflow-prompts">
                          <section className="output-block prompt-output image-output">
                            <div className="output-heading">
                              <div>
                                <ImageIcon size={20} strokeWidth={3} />
                                <h4>GEMINI IMAGE PROMPT</h4>
                              </div>
                              <CopyButton text={currentDirection.image_prompt} />
                            </div>
                            <p>{currentDirection.image_prompt}</p>
                          </section>

                          <section className="output-block prompt-output video-output">
                            <div className="output-heading">
                              <div>
                                <Video size={20} strokeWidth={3} />
                              <h4>GEMINI VEO PROMPT</h4>
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
                  onChange={(event) => setModel(event.target.value as DeepSeekModel)}
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
                腾讯云 TokenHub API Key
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
                    ? "健康检查通过，可以开始生成"
                    : "状态来自 /api/health"}
                </p>
              </div>
            </div>

            <button
              className="settings-scan-button"
              type="button"
              onClick={() => scanTrends()}
              disabled={loadingTrends}
            >
              {loadingTrends ? (
                <LoaderCircle className="spin" size={20} />
              ) : (
                <Radar size={20} strokeWidth={3} />
              )}
              {loadingTrends ? "联网搜索中" : "扫描联网热点"}
            </button>

            <div className="source-note">
              <div>
                <CircleDot size={15} fill="currentColor" />
                TOKENHUB WEB SEARCH
              </div>
              <p>由腾讯云 TokenHub 联网搜索并交给 DeepSeek 分析，来源 URL 会经后端校验。</p>
              {trends[0]?.sources?.[0] && (
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
