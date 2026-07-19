export type GeminiModel =
  | "gemini-3.5-flash"
  | "gemini-2.5-flash"
  | "gemini-2.5-pro";

export interface TrendSource {
  title: string;
  url: string;
}

export interface TrendingItem {
  rank: number;
  title: string;
  metrics: string;
  category: string;
  summary: string;
  heat_reason: string;
  keywords: string[];
  sources: TrendSource[];
}

export interface TrendingResponse {
  date: string;
  items: TrendingItem[];
  disclaimer: string;
}

export interface DerivedDirection {
  direction_title: string;
  xiaohongshu_titles: [string, string, string];
  copywriting: string;
  image_prompt: string;
  video_prompt: string;
}

export interface AnalyzeResponse {
  original_post: {
    title: string;
    metrics: string;
  };
  ai_diagnosis: string;
  derived_directions: [
    DerivedDirection,
    DerivedDirection,
    DerivedDirection,
  ];
}

export interface ApiOptions {
  apiBase: string;
  apiKey?: string;
  model: GeminiModel;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function normalizeBase(apiBase: string): string {
  return apiBase.trim().replace(/\/+$/, "");
}

function buildHeaders(options: ApiOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Gemini-Model": options.model,
  };
  if (options.apiKey?.trim()) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`;
  }
  return headers;
}

async function requestJson<T>(
  path: string,
  options: ApiOptions,
  init: RequestInit = {},
): Promise<T> {
  const apiBase = normalizeBase(options.apiBase);
  if (!apiBase) {
    throw new ApiError(0, "API_BASE_MISSING", "请先填写后端 API 地址。");
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        ...buildHeaders(options),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "无法连接后端，请检查 API 地址与 CORS 配置。",
    );
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code ?? `HTTP_${response.status}`;
    const message =
      data?.error?.message ?? data?.detail ?? "请求失败，请稍后重试。";
    throw new ApiError(response.status, code, message);
  }
  return data as T;
}

export async function checkHealth(apiBase: string): Promise<boolean> {
  const base = normalizeBase(apiBase);
  if (!base) return false;
  try {
    const response = await fetch(`${base}/api/health`, {
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getTrending(
  options: ApiOptions,
  limit = 10,
  category?: string,
): Promise<TrendingResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (category?.trim() && category !== "今日总榜") {
    params.set("category", category.trim());
  }
  return requestJson<TrendingResponse>(
    `/api/trending?${params.toString()}`,
    options,
  );
}

export async function analyzeHotspot(
  options: ApiOptions,
  hotspot: TrendingItem,
): Promise<AnalyzeResponse> {
  return requestJson<AnalyzeResponse>("/api/analyze", options, {
    method: "POST",
    body: JSON.stringify(hotspot),
  });
}
