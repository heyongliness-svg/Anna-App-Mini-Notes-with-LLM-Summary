import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.1.0";
const targets = {
  "windows-x86_64": { goos: "windows", goarch: "amd64", ext: ".exe", archive: "zip" },
  "windows-arm64": { goos: "windows", goarch: "arm64", ext: ".exe", archive: "zip" },
  "darwin-arm64": { goos: "darwin", goarch: "arm64", ext: "", archive: "tar.gz" },
  "darwin-x86_64": { goos: "darwin", goarch: "amd64", ext: "", archive: "tar.gz" },
};
const current = {
  "win32:x64": "windows-x86_64",
  "win32:arm64": "windows-arm64",
  "darwin:arm64": "darwin-arm64",
  "darwin:x64": "darwin-x86_64",
};

const flag = process.argv.indexOf("--platform");
const platform = flag >= 0 ? process.argv[flag + 1] : current[`${process.platform}:${process.arch}`];
const target = targets[platform];
if (!target) {
  console.error(`unsupported platform: ${platform ?? `${process.platform}:${process.arch}`}`);
  process.exit(1);
}

const binaryName = `mini-notes-summarizer${target.ext}`;
const stage = resolve(root, "dist", "stage", platform);
const archiveName = `mini-notes-summarizer-${version}-${platform}.${target.archive === "zip" ? "zip" : "tar.gz"}`;
const archivePath = resolve(root, "dist", archiveName);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const build = spawnSync(
  "go",
  ["build", "-ldflags=-s -w", "-o", resolve(stage, binaryName), "."],
  {
    cwd: resolve(root, "executas/mini-notes-summarizer"),
    stdio: "inherit",
    env: { ...process.env, CGO_ENABLED: "0", GOOS: target.goos, GOARCH: target.goarch },
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);

writeFileSync(
  resolve(stage, "manifest.json"),
  `${JSON.stringify(
    {
      name: "mini-notes-summarizer",
      version,
      runtime: {
        binary: {
          entrypoint: {
            default: "mini-notes-summarizer",
            "windows-x86_64": "mini-notes-summarizer.exe",
            "windows-arm64": "mini-notes-summarizer.exe",
          },
          permissions: { "mini-notes-summarizer": "0o755" },
        },
      },
    },
    null,
    2,
  )}\n`,
);

mkdirSync(dirname(archivePath), { recursive: true });
const tarArgs =
  target.archive === "zip"
    ? ["-a", "-cf", archivePath, "-C", stage, binaryName, "manifest.json"]
    : ["-czf", archivePath, "-C", stage, binaryName, "manifest.json"];
const packed = spawnSync("tar", tarArgs, { stdio: "inherit" });
if (packed.status !== 0) process.exit(packed.status ?? 1);
console.log(`binary=${resolve(stage, binaryName)}`);
console.log(`archive=${archivePath}`);
