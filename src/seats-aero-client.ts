export type QueryValue = string | number | boolean | undefined;
export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export class SeatsAeroApiError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(status: number, statusText: string, responseBody: unknown, apiKey: string) {
    const bodyText = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody);
    const sanitized = bodyText.replaceAll(apiKey, "[redacted]");
    super(`Seats.aero API returned HTTP ${status}${statusText ? ` ${statusText}` : ""}: ${sanitized}`);
    this.name = "SeatsAeroApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export interface SeatsAeroClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
}

export class SeatsAeroClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;

  constructor(options: SeatsAeroClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://seats.aero/partnerapi").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  get<T>(path: string, query: Record<string, QueryValue>): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, undefined, body);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    query?: Record<string, QueryValue>,
    body?: unknown
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\//, "")}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Partner-Authorization": this.apiKey
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }

    try {
      const response = await this.fetchImplementation(url, {
        method,
        headers,
        signal: controller.signal,
        body: method === "POST" ? JSON.stringify(body) : undefined
      });
      const text = await response.text();
      const parsed = parseJsonOrText(text);

      if (!response.ok) {
        throw new SeatsAeroApiError(response.status, response.statusText, parsed, this.apiKey);
      }

      return parsed as T;
    } catch (error) {
      if (error instanceof SeatsAeroApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Seats.aero API request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseJsonOrText(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
