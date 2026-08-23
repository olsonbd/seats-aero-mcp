export type SeatsAeroPlan = "commercial" | "pro";

export interface AppConfig {
  apiKey: string;
  plan: SeatsAeroPlan;
  baseUrl: string;
  requestTimeoutMs: number;
  httpHost: string;
  httpPort: number;
  httpBearerToken?: string;
}

const DEFAULT_BASE_URL = "https://seats.aero/partnerapi";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 3000;

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const plan = required(env.SEATS_AERO_PLAN, "SEATS_AERO_PLAN");
  if (plan !== "commercial" && plan !== "pro") {
    throw new Error("SEATS_AERO_PLAN must be either commercial or pro");
  }

  const httpHost = env.MCP_HTTP_HOST?.trim() || DEFAULT_HTTP_HOST;
  const httpBearerToken = env.MCP_HTTP_BEARER_TOKEN?.trim() || undefined;
  if (!isLoopbackHost(httpHost) && !httpBearerToken) {
    throw new Error("MCP_HTTP_BEARER_TOKEN is required when MCP_HTTP_HOST is not loopback");
  }

  return {
    apiKey: required(env.SEATS_AERO_API_KEY, "SEATS_AERO_API_KEY"),
    plan,
    baseUrl: (env.SEATS_AERO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ""),
    requestTimeoutMs: positiveInteger(
      env.SEATS_AERO_REQUEST_TIMEOUT_MS,
      "SEATS_AERO_REQUEST_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS
    ),
    httpHost,
    httpPort: positiveInteger(env.MCP_HTTP_PORT, "MCP_HTTP_PORT", DEFAULT_HTTP_PORT),
    httpBearerToken
  };
}

export function isLoopbackHttpHost(host: string): boolean {
  return isLoopbackHost(host);
}
