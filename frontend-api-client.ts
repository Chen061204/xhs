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

export interface OriginalPost {
  title: string;
  metrics: string;
}

export interface DerivedDirection {
  direction_title: string;
  xiaohongshu_titles: [string, string, string];
  copywriting: string;
  image_prompt: string;
  video_prompt: string;
}

export interface AnalyzeResponse {
  original_post: OriginalPost;
  ai_diagnosis: string;
  derived_directions: [
    DerivedDirection,
    DerivedDirection,
    DerivedDirection,
  ];
}

export interface ApiClientOptions {
  apiBase: string;
  apiKey?: string;
  model?: GeminiModel;
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

function buildHeaders(options: ApiClientOptions): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.apiKey?.trim()) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`;
  }
  if (options.model) {
    headers["X-Gemini-Model"] = options.model;
  }
  return headers;
}

async function requestJson<T>(
  path: string,
  options: ApiClientOptions,
  init: RequestInit = {},
): Promise<T> {
  const base = options.apiBase.replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(options),
      ...init.headers,
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code ?? `HTTP_${response.status}`;
    const message =
      data?.error?.message ?? data?.detail ?? "请求失败，请稍后重试。";
    throw new ApiError(response.status, code, message);
  }
  return data as T;
}

export async function getTrending(
  options: ApiClientOptions & {
    limit?: number;
    category?: string;
  },
): Promise<TrendingResponse> {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 10),
  });
  if (options.category?.trim()) {
    params.set("category", options.category.trim());
  }
  return requestJson<TrendingResponse>(
    `/api/trending?${params.toString()}`,
    options,
  );
}

export async function analyzeHotspot(
  options: ApiClientOptions,
  hotspot: TrendingItem,
): Promise<AnalyzeResponse> {
  return requestJson<AnalyzeResponse>("/api/analyze", options, {
    method: "POST",
    body: JSON.stringify(hotspot),
  });
}
