import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import type { AppConfig } from "./config.js";
import { isLoopbackHttpHost } from "./config.js";
import { createSeatsAeroMcpServer } from "./mcp-server.js";
import { SeatsAeroClient } from "./seats-aero-client.js";

export function createMcpHandlerForConfig(config: AppConfig, client = createClient(config)) {
  return createMcpHandler(() => createSeatsAeroMcpServer(config, client));
}

export function startStdio(config: AppConfig): void {
  const handle = serveStdio(() => createSeatsAeroMcpServer(config, createClient(config)));
  console.error("Seats.aero MCP server running on stdio");
  process.once("SIGINT", () => {
    void handle.close();
  });
  process.once("SIGTERM", () => {
    void handle.close();
  });
}

export async function startHttp(config: AppConfig, client = createClient(config)) {
  const handler = createMcpHandlerForConfig(config, client);
  const nodeHandler = toNodeHandler(handler);
  const validateHost = isLoopbackHttpHost(config.httpHost) ? localhostHostValidation() : undefined;
  const validateOrigin = isLoopbackHttpHost(config.httpHost) ? localhostOriginValidation() : undefined;

  const server = createNodeServer((request, response) => {
    if (request.url === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ status: "ok", version: "0.2.0" }));
      return;
    }
    if (request.url?.split("?", 1)[0] !== "/mcp") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    if (validateHost && !validateHost(request, response)) {
      return;
    }
    if (validateOrigin && !validateOrigin(request, response)) {
      return;
    }
    if (request.headers.origin && !(config.allowedOrigins ?? []).includes(request.headers.origin)) {
      response.writeHead(403);
      response.end("Origin not allowed");
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    if (config.httpBearerToken && !hasBearerToken(request, config.httpBearerToken)) {
      response.writeHead(401, {
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": "Bearer"
      });
      response.end("Unauthorized");
      return;
    }

    void nodeHandler(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.httpPort, config.httpHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.error(`Seats.aero MCP server listening on http://${config.httpHost}:${config.httpPort}/mcp`);

  const close = async () => {
    await handler.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  };
  const shutdown = () => { void close(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : config.httpPort,
    close: async () => {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
      await close();
    }
  };
}

function createClient(config: AppConfig): SeatsAeroClient {
  return new SeatsAeroClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.requestTimeoutMs
  });
}

function hasBearerToken(request: IncomingMessage, expected: string): boolean {
  const value = request.headers.authorization;
  const prefix = "Bearer ";
  if (!value?.startsWith(prefix)) {
    return false;
  }

  const actual = Buffer.from(value.slice(prefix.length));
  const expectedBuffer = Buffer.from(expected);
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export type NodeMcpHandler = (request: IncomingMessage, response: ServerResponse) => void;
