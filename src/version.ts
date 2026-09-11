import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version?: unknown };

if (typeof manifest.version !== "string" || !manifest.version) {
  throw new Error("package.json must contain a version");
}

export const PACKAGE_VERSION = manifest.version;
