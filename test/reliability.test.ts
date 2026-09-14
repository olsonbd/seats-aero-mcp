import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SeatsAeroClient, SeatsAeroApiError } from "../src/seats-aero-client.js";
import { loadConfig } from "../src/config.js";
import { startHttp } from "../src/transports.js";

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version as string;

const cfg = loadConfig({ SEATS_AERO_API_KEY: "test-secret", SEATS_AERO_PLAN: "pro", MCP_HTTP_BEARER_TOKEN: "transport-secret" });

test("GET retries one transient failure and surfaces quota with the successful response", async () => {
  let calls = 0;
  const client = new SeatsAeroClient({ apiKey: "key", retryDelayMs: 1, fetchImplementation: async () => {
    calls++;
    return new Response(JSON.stringify({ data: [] }), { status: calls === 1 ? 503 : 200, headers: { "X-RateLimit-Remaining": "998" } });
  } });
  const result = await client.get("/search", {});
  assert.equal(calls, 2);
  assert.equal(result.meta.attempts, 2);
  assert.equal(result.meta.quotaRemaining, 998);
  assert.match(result.meta.quotaResetAt, /T00:00:00.000Z$/);
});

test("no blind retries for exhausted quota, auth, refresh, or long Retry-After", async () => {
  for (const entry of [
    { status: 429, method: "GET", headers: { "X-RateLimit-Remaining": "0" } },
    { status: 401, method: "GET", headers: {} },
    { status: 503, method: "POST", headers: {} },
    { status: 503, method: "GET", headers: { "Retry-After": "30" } }
  ]) {
    let calls = 0;
    const client = new SeatsAeroClient({ apiKey: "key", fetchImplementation: async () => {
      calls++;
      return new Response("sensitive upstream body", { status: entry.status, headers: entry.headers as HeadersInit });
    } });
    await assert.rejects(() => entry.method === "GET" ? client.get("/search", {}) : client.post("/refresh", {}), SeatsAeroApiError);
    assert.equal(calls, 1);
  }
});

test("retry budget stops after two requests and respects the total timeout", async () => {
  let calls = 0;
  const client = new SeatsAeroClient({ apiKey: "key", retryDelayMs: 1, fetchImplementation: async () => {
    calls++;
    return new Response("unavailable", { status: 503 });
  } });
  await assert.rejects(() => client.get("/search", {}), /HTTP 503/);
  assert.equal(calls, 2);
  const timeout = new SeatsAeroClient({ apiKey: "key", timeoutMs: 5, fetchImplementation: async () => new Response("no", { status: 503 }) });
  await assert.rejects(() => timeout.get("/search", {}), /timed out/);
});

test("successful malformed/oversized bodies and network exceptions never leak credentials", async () => {
  for (const fetchImplementation of [
    async () => new Response("key-in-html"),
    async () => new Response('"' + "x".repeat(4 * 1024 * 1024) + '"'),
    async () => { throw new Error("key-in-html"); }
  ]) {
    const client = new SeatsAeroClient({ apiKey: "key-in-html", fetchImplementation });
    await assert.rejects(() => client.get("/search", {}), (error: Error) => !error.message.includes("key-in-html"));
  }
});

test("real HTTP protects auth/origins and serves bounded Pro searches, pagination, trips and refresh", async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fixture = {
    data: [{ ID: "cached-1", Date: "2026-12-10", UpdatedAt: "2026-09-10T00:00:00Z", JAvailable: true, JMileageCost: "70000", JRemainingSeats: 2,
      JTaxes: 5300, TaxesCurrency: "USD", Route: { OriginAirport: "SFO", DestinationAirport: "LHR", Source: "united" }, AvailabilityTrips: [{ large: "omitted" }] }],
    hasMore: true, cursor: 345, count: 1
  };
  const api = new SeatsAeroClient({ apiKey: cfg.apiKey, fetchImplementation: async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    const path = String(url);
    const body = path.includes("/refresh") ? { complete: false } : path.includes("/routes") ? Array.from({ length: 30 }, (_, i) => ({ ID: i })) : fixture;
    return new Response(JSON.stringify(body), { headers: { "X-RateLimit-Remaining": "950" } });
  } });
  const server = await startHttp({ ...cfg, httpPort: 0 }, api);
  const url = `http://127.0.0.1:${server.port}`;
  const client = new Client({ name: "integration", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: "Bearer transport-secret" } } });
  try {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", version: packageVersion });
    assert.equal((await fetch(`${url}/mcp`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${url}/mcp`, { method: "POST", headers: { Authorization: "Bearer wrong" } })).status, 401);
    assert.equal((await fetch(`${url}/mcp`, { method: "POST", headers: { Authorization: "Bearer transport-secret", Origin: "https://evil.example" } })).status, 403);
    assert.equal(calls.length, 0);
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 7);
    assert.ok(!listed.tools.some(t => t.name.includes("live_search")));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name: `seats_aero_${name}`, arguments: args });
      return { ...result, parsed: result.isError ? null : JSON.parse((result.content as { text: string }[])[0].text) };
    };
    const first = await call("cached_search", { originAirports: ["sfo"], destinationAirports: ["lhr"] });
    assert.equal(first.isError, undefined);
    assert.equal(calls.at(-1)?.url.searchParams.get("take"), "25");
    assert.equal(calls.at(-1)?.url.searchParams.get("include_trips"), "false");
    assert.equal(first.parsed.meta.quotaRemaining, 950);
    assert.equal(first.parsed.data.cursor, 345);
    assert.equal(first.parsed.data.hasMore, true);
    assert.equal(first.parsed.data.data[0].JTaxes, 5300);
    assert.equal(first.parsed.data.data[0].AvailabilityTrips, undefined);
    await call("cached_search", { originAirports: ["SFO"], destinationAirports: ["LHR"], cursor: 345 });
    assert.equal(calls.at(-1)?.url.searchParams.get("cursor"), "345");
    for (const args of [{ startDate: "2026-02-30" }, { startDate: "2026-12-10", endDate: "2026-12-01" }, { take: 101 }]) {
      const before = calls.length;
      const invalid = await call("cached_search", { originAirports: ["SFO"], destinationAirports: ["LHR"], ...args });
      assert.equal(invalid.isError, true);
      assert.equal(calls.length, before);
    }
    const routes = await call("get_routes", { source: "united", offset: 25, limit: 5 });
    assert.equal(routes.parsed.data.data[0].ID, 25);
    assert.equal(routes.parsed.data.page.nextOffset, null);
    await call("get_trips", { id: "cached-1" });
    assert.equal(calls.at(-1)?.url.searchParams.get("min_cabin_pct"), "100");
    await call("refresh_cached_data", { availabilityIds: ["cached-1", "cached-1"] });
    assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), { availability_ids: ["cached-1"] });
    const before = calls.length;
    const tooMany = await call("refresh_cached_data", { availabilityIds: Array.from({ length: 11 }, (_, i) => String(i)) });
    assert.equal(tooMany.isError, true);
    assert.equal(calls.length, before);
  } finally { await client.close(); await server.close(); }
});
