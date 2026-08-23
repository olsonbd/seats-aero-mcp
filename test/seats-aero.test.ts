import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { loadConfig, type AppConfig } from "../src/config.js";
import { createSeatsAeroMcpServer } from "../src/mcp-server.js";
import { SeatsAeroClient, type FetchImplementation } from "../src/seats-aero-client.js";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function config(plan: AppConfig["plan"]): AppConfig {
  return {
    apiKey: "test-secret",
    plan,
    baseUrl: "https://seats.aero/partnerapi",
    requestTimeoutMs: 1_000,
    httpHost: "127.0.0.1",
    httpPort: 30_001
  };
}

function mockFetch(...responses: Array<{ status?: number; body: unknown }>): {
  calls: FetchCall[];
  fetchImplementation: FetchImplementation;
} {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetchImplementation: FetchImplementation = async (input, init) => {
    calls.push({ url: String(input), init });
    const response = responses[Math.min(index++, responses.length - 1)];
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { calls, fetchImplementation };
}

async function callTool(
  appConfig: AppConfig,
  fetchImplementation: FetchImplementation,
  name: string,
  args: Record<string, unknown>
) {
  const apiClient = new SeatsAeroClient({
    apiKey: appConfig.apiKey,
    baseUrl: appConfig.baseUrl,
    timeoutMs: appConfig.requestTimeoutMs,
    fetchImplementation
  });
  const handler = createMcpHandler(() => createSeatsAeroMcpServer(appConfig, apiClient));
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init))
  });
  const client = new Client(
    { name: "seats-aero-test-client", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } }
  );

  try {
    await client.connect(transport);
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await handler.close();
  }
}

function textResult(result: { content?: Array<{ type: string; text?: string }> }): string {
  const text = result.content?.find((content) => content.type === "text")?.text;
  assert.ok(text, "expected a text content block");
  return text;
}

test("serializes GET requests and sends the raw Partner-Authorization key", async () => {
  const mocked = mockFetch({ body: { ok: true } });
  const client = new SeatsAeroClient({
    apiKey: "raw-key",
    baseUrl: "https://seats.aero/partnerapi",
    fetchImplementation: mocked.fetchImplementation
  });

  await client.get("/destinations", { origin_airport: "SFO", include_filtered: false });

  assert.equal(
    mocked.calls[0]?.url,
    "https://seats.aero/partnerapi/destinations?origin_airport=SFO&include_filtered=false"
  );
  assert.equal(mocked.calls[0]?.init?.headers
    ? new Headers(mocked.calls[0].init.headers).get("Partner-Authorization")
    : null, "raw-key");
  assert.equal(new Headers(mocked.calls[0]?.init?.headers).get("Authorization"), null);
});

test("get destinations requires exactly one direction and serializes it", async () => {
  const mocked = mockFetch({ body: [{ airport: "JFK" }] });
  const result = await callTool(config("pro"), mocked.fetchImplementation, "seats_aero_get_destinations", {
    originAirport: "sfo"
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(textResult(result)), [{ airport: "JFK" }]);
  assert.match(mocked.calls[0]?.url ?? "", /origin_airport=SFO/);
  assert.doesNotMatch(mocked.calls[0]?.url ?? "", /destination_airport/);

  const invalidMock = mockFetch({ body: { shouldNot: "be called" } });
  const invalid = await callTool(config("pro"), invalidMock.fetchImplementation, "seats_aero_get_destinations", {
    originAirport: "SFO",
    destinationAirport: "JFK"
  });
  assert.equal(invalid.isError, true);
  assert.match(textResult(invalid), /exactly one/i);
  assert.equal(invalidMock.calls.length, 0);
});

test("refresh cached data is Pro-only and posts availability_ids", async () => {
  const mocked = mockFetch({ body: { complete: false, items: [{ id: "a", status: "queued" }] } });
  const proConfig = config("pro");
  const first = await callTool(proConfig, mocked.fetchImplementation, "seats_aero_refresh_cached_data", {
    availabilityIds: ["a", "b"]
  });

  assert.equal(first.isError, undefined);
  assert.deepEqual(JSON.parse(String(mocked.calls[0]?.init?.body)), { availability_ids: ["a", "b"] });
  assert.equal(new Headers(mocked.calls[0]?.init?.headers).get("content-type"), "application/json");

  const commercialMock = mockFetch({ body: { shouldNot: "be called" } });
  const commercial = await callTool(config("commercial"), commercialMock.fetchImplementation, "seats_aero_refresh_cached_data", {
    availabilityIds: ["a"]
  });
  assert.equal(commercial.isError, true);
  assert.match(textResult(commercial), /Pro API key/i);
  assert.equal(commercialMock.calls.length, 0);
});

test("refresh status can be polled by repeating the same call without internal retries", async () => {
  const mocked = mockFetch(
    { body: { complete: false, items: [{ id: "a", status: "queued" }] } },
    { body: { complete: true, items: [{ id: "a", status: "complete" }] } }
  );
  const appConfig = config("pro");
  const first = await callTool(appConfig, mocked.fetchImplementation, "seats_aero_refresh_cached_data", {
    availabilityIds: ["a"]
  });
  const second = await callTool(appConfig, mocked.fetchImplementation, "seats_aero_refresh_cached_data", {
    availabilityIds: ["a"]
  });

  assert.equal(JSON.parse(textResult(first)).complete, false);
  assert.equal(JSON.parse(textResult(second)).complete, true);
  assert.equal(mocked.calls.length, 2);
});

test("Live Search is commercial-only", async () => {
  const commercialMock = mockFetch({ body: [{ id: "live-trip" }] });
  const commercial = await callTool(config("commercial"), commercialMock.fetchImplementation, "seats_aero_live_search", {
    originAirport: "SFO",
    destinationAirport: "LHR",
    departureDate: "2026-09-01",
    source: "united",
    seatCount: 2
  });
  assert.equal(commercial.isError, undefined);
  assert.deepEqual(JSON.parse(textResult(commercial)), [{ id: "live-trip" }]);
  assert.equal(JSON.parse(String(commercialMock.calls[0]?.init?.body)).origin_airport, "SFO");

  const proMock = mockFetch({ body: { shouldNot: "be called" } });
  const pro = await callTool(config("pro"), proMock.fetchImplementation, "seats_aero_live_search", {
    originAirport: "SFO",
    destinationAirport: "LHR",
    departureDate: "2026-09-01",
    source: "united"
  });
  assert.equal(pro.isError, true);
  assert.match(textResult(pro), /commercial/i);
  assert.equal(proMock.calls.length, 0);
});

test("upstream errors are returned as tool errors without leaking the API key", async () => {
  const mocked = mockFetch({ status: 403, body: { error: "bad test-secret credential" } });
  const result = await callTool(config("pro"), mocked.fetchImplementation, "seats_aero_get_routes", {
    source: "united"
  });

  assert.equal(result.isError, true);
  assert.match(textResult(result), /HTTP 403/);
  assert.doesNotMatch(textResult(result), /test-secret/);
});

test("request timeouts abort the upstream request", async () => {
  const client = new SeatsAeroClient({
    apiKey: "timeout-key",
    timeoutMs: 10,
    fetchImplementation: async (_input, init) => {
      await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true
        });
      });
      throw new Error("unreachable");
    }
  });

  await assert.rejects(() => client.get("/routes", { source: "united" }), /timed out after 10ms/);
});

test("non-loopback HTTP configuration requires a bearer token", () => {
  assert.throws(
    () =>
      loadConfig({
        SEATS_AERO_API_KEY: "key",
        SEATS_AERO_PLAN: "pro",
        MCP_HTTP_HOST: "0.0.0.0"
      }),
    /MCP_HTTP_BEARER_TOKEN is required/
  );

  const configured = loadConfig({
    SEATS_AERO_API_KEY: "key",
    SEATS_AERO_PLAN: "commercial",
    MCP_HTTP_HOST: "0.0.0.0",
    MCP_HTTP_BEARER_TOKEN: "http-secret"
  });
  assert.equal(configured.httpBearerToken, "http-secret");
});

test("stdio transport initializes and lists the Seats.aero tools", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      SEATS_AERO_API_KEY: "stdio-test-key",
      SEATS_AERO_PLAN: "pro"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  let buffer = "";
  const messages: Array<Record<string, unknown>> = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (const line of buffer.split("\n").slice(0, -1)) {
      if (line.trim()) {
        messages.push(JSON.parse(line) as Record<string, unknown>);
      }
    }
    buffer = buffer.split("\n").at(-1) ?? "";
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stdio-test", version: "0.1.0" }
    }
  })}\n`);

  await waitFor(() => messages.some((message) => message.id === 1));
  assert.equal((messages.find((message) => message.id === 1)?.result as Record<string, unknown>)?.serverInfo instanceof Object, true);

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  await waitFor(() => messages.some((message) => message.id === 2));
  const tools = ((messages.find((message) => message.id === 2)?.result as Record<string, unknown>)?.tools ?? []) as Array<{ name: string }>;
  assert.ok(tools.some((tool) => tool.name === "seats_aero_get_destinations"));
  assert.ok(tools.some((tool) => tool.name === "seats_aero_refresh_cached_data"));

  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (!child.killed) {
    child.kill("SIGKILL");
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for stdio MCP response");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
