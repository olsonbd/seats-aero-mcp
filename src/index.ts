#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { startHttp, startStdio } from "./transports.js";

try {
  const config = loadConfig();
  const httpRequested = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";
  if (httpRequested) {
    await startHttp(config);
  } else {
    startStdio(config);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to start Seats.aero MCP server");
  process.exitCode = 1;
}
