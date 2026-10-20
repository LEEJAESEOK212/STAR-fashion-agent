export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

type ApiErrorBody = { detail?: string | Array<{ msg?: string }> };
export type ApiStreamEvent = { event: string; data: unknown };

type ApiCacheEntry = {
  value?: unknown;
  promise?: Promise<unknown>;
  expiresAt: number;
};

const apiCache = new Map<string, ApiCacheEntry>();
const DEFAULT_CACHE_TTL_MS = 30_000;

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    const detail = Array.isArray(body.detail)
      ? body.detail[0]?.msg
      : body.detail;
    throw new Error(detail ?? "요청을 처리하지 못했습니다.");
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function apiCachedRequest<T>(
  path: string,
  options: { ttlMs?: number; force?: boolean } = {},
): Promise<T> {
  const now = Date.now();
  const cached = apiCache.get(path);
  if (!options.force && cached?.promise) return cached.promise as Promise<T>;
  if (!options.force && cached && cached.value !== undefined && cached.expiresAt > now) {
    return Promise.resolve(cached.value as T);
  }

  const promise = apiRequest<T>(path)
    .then((value) => {
      apiCache.set(path, {
        value,
        expiresAt: Date.now() + (options.ttlMs ?? DEFAULT_CACHE_TTL_MS),
      });
      return value;
    })
    .catch((error) => {
      apiCache.delete(path);
      throw error;
    });
  apiCache.set(path, { promise, expiresAt: now });
  return promise;
}

export function primeApiCache<T>(path: string, value: T, ttlMs = DEFAULT_CACHE_TTL_MS) {
  apiCache.set(path, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateApiCache(pathPrefix?: string) {
  if (!pathPrefix) {
    apiCache.clear();
    return;
  }
  for (const path of apiCache.keys()) {
    if (path.startsWith(pathPrefix)) apiCache.delete(path);
  }
}

export async function apiEventStream(
  path: string,
  onEvent: (message: ApiStreamEvent) => void,
  init?: RequestInit,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    const detail = Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail;
    throw new Error(detail ?? "스트리밍 요청을 처리하지 못했습니다.");
  }
  if (!response.body) throw new Error("브라우저가 스트리밍 응답을 지원하지 않습니다.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent({ event, data: JSON.parse(data) as unknown });
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
}
