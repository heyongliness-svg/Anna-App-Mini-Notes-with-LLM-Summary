import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cli = join(process.env.APPDATA ?? "", "npm", "node_modules", "@anna-ai", "cli", "dist", "cli.js");
const command = process.platform === "win32" && existsSync(cli) ? process.execPath : "anna-app";
const prefix = command === process.execPath ? [cli] : [];
const args = {
  notes: [{ order: 1, content: "修复登录 bug" }],
};
const result = spawnSync(
  command,
  [
    ...prefix,
    "executa",
    "dev",
    "--dir",
    "executas/mini-notes-summarizer",
    "--mock-sampling",
    "fixtures/mock-sampling.jsonl",
    "--invoke",
    "summarize",
    "--args",
    JSON.stringify(args),
    "--json",
  ],
  { cwd: root, stdio: "inherit" },
);
process.exit(result.status ?? 1);
