export type QueryValue = string | number | boolean | undefined;
export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface ApiResult<T = unknown> {
  data: T;
  meta: { fetchedAt: string; quotaRemaining: number | null; quotaResetAt: string; attempts: number };
}

function nextReset(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}
function quota(headers: Headers): number | null {
  const raw = headers.get("X-RateLimit-Remaining");
  return raw !== null && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

export class SeatsAeroApiError extends Error {
  constructor(readonly status: number, readonly quotaRemaining: number | null, readonly retryAfter: string | null) {
    const advice = status === 429
      ? quotaRemaining === 0 ? `Daily quota exhausted; resume after ${nextReset()}.` : "Rate limited; wait before trying again."
      : status === 401 || status === 403 ? "Check the API key, account eligibility and plan." : "Upstream request failed.";
    // Upstream bodies and exception strings can echo credentials. Never relay them.
    super(`Seats.aero API returned HTTP ${status}. ${advice}${retryAfter ? ` Retry-After: ${retryAfter}.` : ""}`);
    this.name = "SeatsAeroApiError";
  }
}
export interface SeatsAeroClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
  retryDelayMs?: number;
}
export class SeatsAeroClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  constructor(private readonly options: SeatsAeroClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://seats.aero/partnerapi").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }
  get<T = unknown>(path: string, query: Record<string, QueryValue>): Promise<ApiResult<T>> {
    return this.request<T>("GET", path, query);
  }
  post<T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> {
    return this.request<T>("POST", path, undefined, body);
  }
  private async request<T>(method: "GET" | "POST", path: string, query?: Record<string, QueryValue>, body?: unknown): Promise<ApiResult<T>> {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      for (let attempt = 1; ; attempt++) {
        const response = await this.fetchImplementation(url, {
          method, redirect: "error", signal: controller.signal,
          headers: {
            Accept: "application/json", "Partner-Authorization": this.options.apiKey,
            "User-Agent": "seats-aero-mcp", ...(method === "POST" ? { "Content-Type": "application/json" } : {})
          },
          body: method === "POST" ? JSON.stringify(body) : undefined
        });
        const remaining = quota(response.headers);
        const rawRetry = response.headers.get("Retry-After");
        // Preserve only valid Retry-After values, never arbitrary upstream text.
        const retryAfter = rawRetry && (/^\d+$/.test(rawRetry) || Number.isFinite(Date.parse(rawRetry))) ? rawRetry : null;
        if (!response.ok) {
          await response.body?.cancel();
          const error = new SeatsAeroApiError(response.status, remaining, retryAfter);
          // At most ONE retry; never retry refresh, auth errors, 429, or known exhausted quota.
          if (method !== "GET" || attempt >= 2 || remaining === 0 || ![502, 503, 504].includes(response.status)) throw error;
          const wait = retryAfter
            ? /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())
            : this.options.retryDelayMs ?? 500;
          if (wait > 2000) throw error;
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(delay); reject(new DOMException("aborted", "AbortError")); };
            const delay = setTimeout(() => { controller.signal.removeEventListener("abort", abort); resolve(); }, wait);
            controller.signal.addEventListener("abort", abort, { once: true });
            if (controller.signal.aborted) abort();
          });
          continue;
        }
        const reader = response.body?.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        if (reader) {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 4 * 1024 * 1024) {
                await reader.cancel();
                throw new Error("RESPONSE_TOO_LARGE");
              }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        let data: T;
        try { data = JSON.parse(new TextDecoder().decode(bytes)) as T; }
        catch { throw new Error("INVALID_JSON"); }
        return { data, meta: { fetchedAt: new Date().toISOString(), quotaRemaining: remaining, quotaResetAt: nextReset(), attempts: attempt } };
      }
    } catch (error) {
      if (error instanceof SeatsAeroApiError) throw error;
      if (controller.signal.aborted) throw new Error(`Seats.aero API request timed out after ${this.timeoutMs}ms`);
      if (error instanceof Error && error.message === "RESPONSE_TOO_LARGE") throw new Error("Seats.aero response exceeded 4 MiB. Narrow the search or reduce take.");
      if (error instanceof Error && error.message === "INVALID_JSON") throw new Error("Seats.aero returned an invalid JSON response. Try again later.");
      throw new Error("Seats.aero network request failed. Try again later.");
    } finally { clearTimeout(timer); }
  }
}
