# Mini Notes with LLM Summary

本地运行的 Anna App。笔记通过 Anna storage Host API 保存，总结通过本地 Executa Tool 的 `sampling/createMessage` 向 host LLM 请求。

## 项目结构

```text
manifest.json                         Anna App 清单
index.html                            前端入口
src/                                  前端源码
  main.ts                             启动、保存、删除、总结
  ui.ts                               页面
  runtime.ts                          AnnaAppRuntime.connect()
  notes-storage.ts                    anna.storage.get / set
  summarize.ts                        anna.tools.invoke
  identity.ts                         tool_id、方法名、存储 key
executas/mini-notes-summarizer/       Executa Tool（Go，stdio JSON-RPC）
fixtures/mock-sampling.jsonl          后端 sampling 的 mock 响应
scripts/rpc-smoke.mjs                 手动 JSON-RPC：initialize、describe、invoke
scripts/executa-sampling.mjs          anna-app executa dev --mock-sampling
scripts/pack-binary.mjs               本机 / 指定平台的二进制打包
.github/workflows/release-executa.yml 三平台 GitHub Release
```

`npm run build` 生成 `bundle/`。`npm run pack` 生成 `dist/`。这两个目录不提交。

## 安装依赖

需要 Node.js 22 或更高版本、Go 1.22 或更高版本、`anna-app` CLI，以及能运行 `uvx anna-app-runtime-local` 的 uv。不需要 Anna 账号、`anna-app login` 或 LLM API key。

```bash
npm install
```

## 构建前端 bundle

```bash
npm run build
```

产物入口是 `bundle/index.html`，与 `manifest.json` 的 `ui.bundle.entry` 一致。Anna SDK 从 harness 的 `/static/anna-apps/_sdk/latest/index.js` 加载，不打进 bundle。

## 校验 manifest

```bash
npm run validate
```

等价命令是 `anna-app validate --strict`。它检查清单 schema，并扫描构建后的 bundle，确认实际调用的 Host API 都已授权。

## 用 anna-app dev --no-llm 测试 UI

```bash
npm run dev
```

等价命令是 `anna-app dev --no-llm`。打开终端打印的 dashboard，默认是 http://localhost:5180/ 。

建议按这个顺序点：

1. 只输入空格后保存，页面应提示内容不能为空，列表不变。
2. 保存几条笔记，例如「明天跟客户 follow up」「修复登录 bug」。输入框会清空，列表显示内容和添加顺序。
3. 删除一条，列表立即更新。
4. 点击 Summarize。

右侧 RPC log 是 harness 的调试栏，不是应用页面。创建和删除时应看到 `storage.get` / `storage.set`；点击 Summarize 时应看到 `tools.invoke`。

本地默认使用 legacy in-memory `runtime_state`。刷新外层 dashboard 或重启 `anna-app dev` 后笔记不保留，这是无登录调试的预期，不是存储路径错误。

## 为什么 --no-llm 下 Summarize 会报错

`--no-llm` 只关掉 host LLM。前端仍然调用 `anna.tools.invoke`，Executa 仍然发出 `sampling/createMessage`。harness 拒绝这次 sampling，于是 UI 显示类似：

```text
[-32603] harness started with --no-llm
```

这是 UI 调试路径的预期结果，只说明这条路径没有接真实 LLM。它不代表 Executa 的 sampling 实现失败。不要在 UI harness 里用 mock fixture 伪造一条总结。

## 单独测试后端 sampling

```bash
npm run executa:sampling
```

等价命令：

```bash
anna-app executa dev --dir executas/mini-notes-summarizer --mock-sampling fixtures/mock-sampling.jsonl --invoke summarize --args "{\"notes\":[{\"order\":1,\"content\":\"修复登录 bug\"}]}" --json
```

成功时 JSON 里的 `data.summary` 应等于 fixture 中的这句：

```text
Mock summary: follow up with the client, fix the login bug, and capture workshop ideas.
```

这证明总结文本来自 host 的 sampling 响应，不是 Tool 本地拼出来的。

## 手动测试 JSON-RPC

```bash
npm run test:rpc
```

脚本向 Tool 的 stdin 依次发送 `initialize`、`describe`、`invoke`，并在看到 `sampling/createMessage` 时用 fixture 回复。它检查：

- `initialize` 协商到 protocol `2.0`，并声明 sampling capability。
- `describe` 的 `name` 为 `mini-notes-summarizer`，`host_capabilities` 含 `llm.sample`，`summarize` 使用 `parameters[]`。
- `invoke` 返回的 summary 等于 fixture 文本。
- sampling 请求的 `metadata.executa_invoke_id` 等于本次 invoke id。

对已打包的二进制，把路径传给脚本：

```bash
node scripts/rpc-smoke.mjs dist/stage/windows-x86_64/mini-notes-summarizer.exe
```

macOS 上把路径换成对应的 `dist/stage/darwin-arm64/mini-notes-summarizer` 或 `dist/stage/darwin-x86_64/mini-notes-summarizer`。

## 如何确认笔记走 Anna storage

看两处：

- 源码 `src/notes-storage.ts`：读取调用 `anna.storage.get({ key: "notes" })`，保存和删除调用 `anna.storage.set`。
- `anna-app dev` 的 RPC log：保存和删除各有一次 `storage.set`，启动时有 `storage.get`。页面没有使用 `localStorage` 或自建 HTTP API。

## 如何确认总结走 sampling

链路是 `anna.tools.invoke` → Executa `invoke` → `sampling/createMessage` → UI。

- UI harness 的 RPC log 出现 `tools.invoke`，tool id 为 `mini-notes-summarizer`。
- `npm run test:rpc` 的断言失败会直接说明没有发出 `sampling/createMessage`，或 summary 不是 fixture 文本。
- `npm run executa:sampling` 的 `data.summary` 与 `fixtures/mock-sampling.jsonl` 一致。Tool 自己的日志在 stderr，stdout 只有 JSON-RPC。

## 本机二进制打包

```bash
npm run pack
```

脚本按当前系统选择平台，也可以指定：

```bash
node scripts/pack-binary.mjs --platform darwin-arm64
node scripts/pack-binary.mjs --platform darwin-x86_64
node scripts/pack-binary.mjs --platform windows-x86_64
```

支持的平台 key 是 `darwin-arm64`、`darwin-x86_64`、`windows-x86_64`。macOS 产物是 `.tar.gz`，Windows 产物是 `.zip`。压缩包根目录包含可执行文件和 `manifest.json`，其中 `runtime.binary.entrypoint` 指向该二进制。本机产物位于 `dist/`。

## GitHub Actions Release

workflow 文件是 `.github/workflows/release-executa.yml`。

触发方式：

- 推送 `v*` tag，例如 `v0.1.0`。
- 在 Actions 页手动运行 `Release Executa binaries`。

三个平台先分别构建并做 JSON-RPC smoke test，全部成功后由一个 job 上传到同一个 GitHub Release。预期 asset：

- `mini-notes-summarizer-0.1.0-darwin-arm64.tar.gz`
- `mini-notes-summarizer-0.1.0-darwin-x86_64.tar.gz`
- `mini-notes-summarizer-0.1.0-windows-x86_64.zip`

tag 推送时 Release 使用该 tag。手动触发时 tag 为 `build-<run_id>`。

## 各部分的关系

`manifest.json` 声明这个 Anna App 需要哪个 Executa、开放哪些 Host API，以及 UI bundle 的入口。`bundle/` 是 iframe 里的前端，只通过 Anna Runtime 调用 `anna.storage.*` 和 `anna.tools.invoke`。笔记存在 Anna storage 的 `notes` key；本地无登录时这是 harness 内存里的 legacy runtime_state，不是应用自己的数据库。`executas/mini-notes-summarizer` 是长驻的 stdio JSON-RPC 进程，收到 `summarize` 后用 `sampling/createMessage` 借用 host LLM。`fixtures/mock-sampling.jsonl` 只用于单独的后端测试。`dist/` 里的 binary archive 是这个 Tool 的发布形态，由 GitHub Actions 上传到 Release。
