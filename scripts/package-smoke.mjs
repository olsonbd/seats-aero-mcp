import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installRoot = await mkdtemp(join(tmpdir(), "seats-aero-mcp-package-"));
let tarball;
let child;

try {
  const packed = run("npm", ["pack", "--ignore-scripts", "--json"], root);
  const packResult = JSON.parse(packed.stdout);
  const entries = Array.isArray(packResult) ? packResult : Object.values(packResult);
  assert.equal(entries.length, 1, "expected npm pack to produce one tarball");
  tarball = join(root, entries[0].filename);

  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--prefix",
    installRoot,
    tarball
  ], root);

  const packageRoot = join(installRoot, "node_modules", "@olsonbd", "seats-aero-mcp");
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "@olsonbd/seats-aero-mcp");

  child = spawn(process.execPath, [join(packageRoot, "dist", "index.js")], {
    env: { ...process.env, SEATS_AERO_API_KEY: "package-smoke-key", SEATS_AERO_PLAN: "pro" },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const messages = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) messages.push(JSON.parse(line));
    }
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "package-smoke", version: "1.0.0" }
    }
  })}\n`);
  await waitFor(() => messages.some((message) => message.id === 1));
  const initialized = messages.find((message) => message.id === 1);
  assert.equal(initialized.result.serverInfo.version, manifest.version);

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  await waitFor(() => messages.some((message) => message.id === 2));
  const tools = messages.find((message) => message.id === 2).result.tools;
  assert.equal(tools.length, 7);
  assert.ok(tools.some((tool) => tool.name === "seats_aero_cached_search"));
  console.log(`Verified packed ${manifest.name}@${manifest.version} with ${tools.length} Pro tools`);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (tarball) await rm(tarball, { force: true });
  await rm(installRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (child?.exitCode !== null) throw new Error(`packed server exited early with code ${child?.exitCode}`);
    if (Date.now() >= deadline) throw new Error("timed out waiting for packed MCP response");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
