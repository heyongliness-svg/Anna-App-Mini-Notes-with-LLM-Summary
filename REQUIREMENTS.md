# Mini Notes with LLM Summary — 项目需求文档

本文把测试题 `question.md` 落成可执行的项目需求，并写明实现和验收时要用的工具、命令和协议约束。实现必须遵守 Anna 本地开发模型，不能做成普通浏览器笔记应用。

参考：

- 测试题：`question.md`
- 开发文档：https://staging.anna.partners/developers
- 示例仓库：https://github.com/whtcjdtc2007/anna-executa-examples
- 二进制分发：https://staging.anna.partners/developers/tools/executa-binary

---

## 1. 项目目标

实现一个本地运行的 Anna App：**Mini Notes with LLM Summary**。

用户可以创建、查看、删除短笔记。笔记通过 Anna App 的 storage Host API 保存。用户点击 Summarize 后，前端通过 Host API 调用本地 Executa Tool；该 Tool 用 reverse JSON-RPC `sampling/createMessage` 向 host LLM 请求总结，再把总结返回给 UI。

不接入真实 Anna 账号，不执行 `anna-app login`，不使用真实 LLM API key，不使用云端数据库。本地用 `anna-app dev` 的 harness 完成 UI 与 storage / tools 接线验证；后端 sampling 用 `anna-app executa dev --mock-sampling` 单独验证。

## 2. 必须走通的平台链路

```text
Anna App iframe
  -> AnnaAppRuntime.connect()
  -> anna.storage.* 保存 / 读取 notes
  -> anna.tools.invoke(...)
  -> 本地 Executa Tool invoke
  -> reverse JSON-RPC sampling/createMessage
  -> host LLM 或本地 mock sampling fixture
  -> summary 返回 UI
```

两条验收路径必须分开，不能互相替代：

| 路径 | 命令 | 要证明的事 | 预期 |
| --- | --- | --- | --- |
| UI harness | `anna-app dev --no-llm` | App、`anna.storage.*`、`anna.tools.invoke` 接线 | 创建 / 删除笔记成功。点击 Summarize 仍会调用 tool，并得到 `[-32603] harness started with --no-llm` 或等价错误 |
| 后端 sampling | `anna-app executa dev --mock-sampling <fixture.jsonl>` | Tool 真的发起了 `sampling/createMessage`，summary 来自 host 响应 | fixture 里的文本出现在 invoke 结果中 |

不允许：

- 只把笔记放在 React/Vue/Svelte state、`localStorage`、IndexedDB 或本地文件里。
- 前端直接调用 `anna.llm.complete` 做总结。
- 前端 `fetch` 自建 HTTP API。
- 前端或 Tool 用固定规则拼接 summary，再假装是 LLM。
- 在 UI harness 里用 mock fixture 伪造最终 summary，用来代替后端 sampling 测试。

## 3. 功能需求

### 3.1 创建笔记

- 用户输入一段短文本并保存。
- 空输入（空白字符视为空）不能保存。
- 保存成功后清空输入框。
- 每条笔记至少包含：内容、添加顺序（从 1 递增，或等价的稳定序号）。
- 保存必须调用 `anna.storage.set`（或等价 storage Host API），不能只改内存。

示例内容：

- 明天跟客户 follow up
- 修复登录 bug
- Workshop 内容想法

### 3.2 查看笔记列表

页面展示已保存笔记，至少显示内容和添加顺序。

建议同时做，但不作为硬性美化要求：

- 时间戳
- 空状态（还没有笔记）
- 错误状态（storage / tool 调用失败时把错误展示出来）

列表数据来自 `anna.storage.get` 的结果，或来自已经和该次 `get` / `set` 同步的内存副本。启动时必须先 `get`，不能假设内存里已有数据。

### 3.3 删除笔记

- 用户可以删除一条笔记。
- 删除后列表立即更新。
- 删除后必须再次 `anna.storage.set`（或 `delete` + 重写列表），使 storage 中的 notes 与界面一致。

### 3.4 Storage / APS KV

本地无登录时，`anna-app dev` 默认 `--storage legacy`：笔记落在 harness 的 **in-memory `runtime_state`**。这只用于无 login 调试。

不要求：

- 刷新外层 `anna-app dev` dashboard 后笔记仍在。
- 重启 dev 进程后笔记仍在。
- 连接真实 APS / Postgres。

要求：

- 创建、读取、删除都经过 `anna.storage.get` / `anna.storage.set`（删除可再配合 `anna.storage.delete`）。
- manifest 的 `ui.host_api.storage` 必须放行实际调用的方法，至少 `get` 和 `set`。
- 使用默认 bucket：`scope=app`、`owner=self`。不要申请跨应用或 `scope=user`。
- 建议单 key 保存整表，例如 key = `notes`，value 为笔记数组。legacy backend 整个 bucket 上限 256 KiB，对本题足够。
- 读回时用 `exists` 判断 key 是否存在。`value === null` 不等于“没有这条 key”。

建议笔记结构：

```json
{
  "id": "note-1",
  "content": "修复登录 bug",
  "order": 1,
  "createdAt": "2026-10-29T09:00:00.000Z"
}
```

`createdAt` 可选。`content` 与 `order` 必填。

### 3.5 LLM 总结

页面提供 Summarize 按钮。点击后：

1. 从 storage 读取当前 notes，或使用刚与 storage 同步的当前 notes。
2. 调用 `anna.tools.invoke({ tool_id, method: "summarize", args })`。
3. Executa 的 `invoke` 处理 `summarize`。
4. Tool 在同一次 invoke 内发起 reverse JSON-RPC `sampling/createMessage`，prompt 包含当前笔记内容。
5. summary 文本取自 sampling 响应的 `result.content.text`。
6. UI 展示该 summary。

没有笔记时，按钮应给出明确提示，不要发空总结请求。

`--no-llm` 下这次调用预期失败。UI 应展示错误，而不是吞掉错误或改走本地拼接。

## 4. 技术需求

### 4.1 Anna App manifest

仓库根目录提供 `manifest.json`。本题要求声明 `permissions`，而 **schema 3 会拒绝 `permissions`**。因此使用 **schema 2**：它启用 `ui`，并允许 display-only 的 `permissions`。真正生效的门禁是 `ui.host_api`，不是 `permissions`。

必须声明：

| 字段 | 要求 |
| --- | --- |
| `schema` | `2` |
| `required_executas` | 至少一项，`tool_id` 与本地 Executa 一致 |
| `permissions` | 从官方允许列表里选取，至少包含 `storage.read`、`storage.write`、`tools.invoke`。这些值只用于展示，运行时不检查 |
| `ui.bundle` | `format: "static-spa"`，`entry` 指向构建产物入口，例如 `index.html` |
| `ui.views` | 至少一个 view，且恰好一个 `default: true`。`min_size.h ≤ 600`，`min_size.w ≤ 1024` |
| `ui.host_api.storage` | 至少 `["get", "set"]`。若实现 delete/list，把对应方法写进去 |
| `ui.host_api.tools` | `required:*`，或 `required:<tool_id>` / 裸 `tool_id`。引用的 id 必须出现在 `required_executas` |
| `dev` | 本地 harness 配置。生产会忽略它。不要在这里用 `mocks.tools.invoke` 伪造 summary |

建议同时声明 `host_capabilities: ["llm.sample"]`，与 Executa 的 sampling 能力对齐。默认 storage scope 不需要额外的 `aps.*`。

`dev` 只放 harness 需要的项，例如：

```json
{
  "dev": {
    "user_id": 1,
    "seed_storage": {}
  }
}
```

身份必须全仓一致：

- `manifest.required_executas[].tool_id`
- `manifest.ui.host_api.tools` 里的 tool id
- 前端 `anna.tools.invoke` 的 `tool_id` 常量
- `executas/<name>/executa.json` 的 `tool_id`
- `describe` 返回的插件身份（`name` 使用同一个 tool id）

工具方法名同样固定为 `summarize`：`describe.tools[].name`、`invoke` 的 `params.tool`、前端 `method` 三者一致。

`describe.tools[]` 使用 Anna 的 `parameters[]`，不要只写 MCP 风格的 `input_schema`。

```json
{
  "name": "summarize",
  "description": "Summarize the current notes by asking the host LLM.",
  "parameters": [
    {
      "name": "notes",
      "type": "array",
      "description": "Notes already loaded from Anna storage.",
      "required": true
    }
  ]
}
```

参数名可以是 `notes` 或 `text`，但前端、schema、invoke 处理必须是同一个名字。

### 4.2 工程化前端

- 有源码目录，例如 `src/`。
- UI、runtime 连接、storage、tools 调用拆开，不要堆在一个文件里。
- 有包管理文件和构建脚本。
- `npm run build` 生成 Anna 可加载的静态 bundle。
- `manifest.json` 的 `ui.bundle.entry` 指向该 bundle 的 HTML 入口。
- 构建产物目录与 `anna-app dev --bundle` 一致。建议输出到 `bundle/`，入口为 `bundle/index.html`。

不接受手写单文件 SPA，也不接受只能当普通网页打开、不能进 `anna-app dev` iframe 的应用。

SDK 不打进业务 bundle。页面在 iframe 里从 harness 提供的地址加载：

```js
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
const anna = await AnnaAppRuntime.connect();
```

Vite 必须把这个 URL 保留为运行时外部导入，不能把它解析成本地 npm 包。

连接成功后再读 storage。storage 与 tools 的调用形态：

```js
await anna.storage.get({ key: "notes" });
await anna.storage.set({ key: "notes", value: notes });
await anna.tools.invoke({
  tool_id: TOOL_ID,
  method: "summarize",
  args: { notes }
});
```

本地 harness 里，`tool_id` 就是 `executa.json` 注册的 id，不是线上 mint 出来的 `tool-...` id。`method` 必须显式传入。

### 4.3 Executa Tool

在 `executas/<tool-dir>/` 实现一个长驻进程，协议为 JSON-RPC 2.0 over stdio。

传输规则：

- stdin 每行一个 JSON-RPC 消息。
- stdout 只写 JSON-RPC 消息，每行一条，写完立刻 flush。
- 日志、banner、debug 只写 stderr。
- 进程持续读 stdin，直到 EOF。处理完一次请求不能退出。
- 同一个 stdin 循环会收到两类帧：带 `method` 的 Agent 请求，以及只有 `id` + `result`/`error` 的 host 对 reverse RPC 的响应。必须按有没有 `method` 分流。

至少实现：

| 方法 | 要求 |
| --- | --- |
| `initialize` | 协商 protocol `2.0`。响应里声明 `capabilities.sampling = {}`（即 `client_capabilities.sampling`）。回显 `protocolVersion: "2.0"` |
| `describe` | 返回裸 manifest，字段见下 |
| `invoke` | 处理 `summarize`：组 prompt、发 `sampling/createMessage`、把 `content.text` 放进结果 |
| `health` | 建议实现，返回 `{ "status": "ready" }` |
| `shutdown` | 建议实现；即使不实现，stdin EOF 时也要正常退出 |

`describe` 至少包含：

- `name`
- `display_name`
- `version`
- `description`
- `host_capabilities: ["llm.sample"]`
- `tools[]`
- `runtime`

`invoke` 成功结果使用平台信封：

```json
{ "success": true, "data": { "summary": "<sampling 返回的文本>" } }
```

失败时返回 `{ "success": false, "error": "..." }`，或 JSON-RPC error。不要在成功路径里塞规则拼接的摘要。

目录发现：`executas/<dir>/executa.json` 必须同时有 `tool_id` 和 `type`（`go` / `node` / `python` / `binary`）。缺一会被 harness 跳过，随后 `tools.invoke` 报不可用。Go 插件只有 `go.mod`、没有 `executa.json` 时无法被发现。

### 4.4 Sampling

三条前置条件都要满足：

1. `initialize` 成功协商 v2，并声明 sampling capability。
2. `describe` 声明 `host_capabilities: ["llm.sample"]`。
3. 本地 mock 路径由 `anna-app executa dev --mock-sampling` 提供响应。本题不要求用户在 Admin 里打开真实 sampling grant。

`sampling/createMessage` 要求：

- `messages` 非空，内容包含当前笔记。
- `maxTokens` 为正整数，不超过 8192。
- `includeContext` 使用 `"none"`。
- `metadata` 带上本次 `invoke` 的 `invoke_id`（字段名使用 `executa_invoke_id`）。`invoke_id` 来自 `params.context.invoke_id`。
- 发出 reverse request 后，等待同一 stdin 上 id 匹配的 response，再回复原来的 `invoke`。
- summary 只取 `result.content.text`。

请求形状：

```json
{
  "jsonrpc": "2.0",
  "id": "<uuid>",
  "method": "sampling/createMessage",
  "params": {
    "messages": [
      {
        "role": "user",
        "content": { "type": "text", "text": "Summarize these notes:\n1. ..." }
      }
    ],
    "maxTokens": 400,
    "systemPrompt": "You are a concise notes assistant. Summarize the user's notes.",
    "includeContext": "none",
    "metadata": { "executa_invoke_id": "<invoke_id>" }
  }
}
```

### 4.5 本地测试与 fixture

仓库必须包含 mock sampling fixture，例如 `fixtures/mock-sampling.jsonl`。一行一个 JSON 对象：

```json
{"ns":"sampling","method":"createMessage","result":{"role":"assistant","content":{"type":"text","text":"Mock summary: follow up with the client, fix the login bug, and capture workshop ideas."},"model":"mock-model","stopReason":"endTurn"}}
```

README 必须说明如何确认 Tool 发起过 `sampling/createMessage`：看 `anna-app executa dev` 的 stderr / 协议日志，或看手动协议脚本记录的 stdout 帧里出现该方法。fixture 文本出现在 invoke 的 `data.summary` 中，证明 summary 来自 host 响应。

### 4.6 二进制打包

发布物必须是二进制 archive，不能是“源码 + 解释器”。

本机打包脚本：

- 识别当前 OS 与 CPU 架构。
- 只构建当前机器能运行的那一个平台 archive。
- archive 根目录包含 `manifest.json`。
- macOS 产物为 `.tar.gz`，Windows 产物为 `.zip`。

平台 key：

| 主机 | key | 本题是否必须 |
| --- | --- | --- |
| macOS Apple Silicon | `darwin-arm64` | 是 |
| macOS Intel | `darwin-x86_64` | 是 |
| Windows x64 | `windows-x86_64` | 是 |

当前开发机是 Windows x64，本机脚本应产出 `*-windows-x86_64.zip`。另外两个 macOS 包由 GitHub Actions 构建。

Archive 根 `manifest.json` 与 `describe` 返回的 manifest 不是同一个文件。分发 manifest 负责入口和权限，建议：

```json
{
  "name": "mini-notes-summarizer",
  "version": "0.1.0",
  "runtime": {
    "binary": {
      "entrypoint": {
        "default": "mini-notes-summarizer",
        "windows-x86_64": "mini-notes-summarizer.exe",
        "windows-arm64": "mini-notes-summarizer.exe"
      },
      "permissions": {
        "mini-notes-summarizer": "0o755"
      }
    }
  }
}
```

单文件二进制可以把可执行文件和 `manifest.json` 直接放在 archive 根目录。entrypoint 必须指向 archive 内真实相对路径。

### 4.7 GitHub Actions

文件放在 `.github/workflows/`。触发方式至少包含 `workflow_dispatch` 或 tag / release。

一次发布必须构建并上传 GitHub Release assets：

- `*-darwin-arm64.tar.gz`
- `*-darwin-x86_64.tar.gz`
- `*-windows-x86_64.zip`

Workflow artifacts 可以额外保留，不能代替 Release assets。需要 `contents: write` 才能上传 Release。

每个构建出来的二进制做 smoke test：向 stdin 发送 `describe` JSON-RPC，检查 stdout 是合法 JSON-RPC，且 `result.name`、`result.host_capabilities` 含 `llm.sample`、`result.tools` 含 `summarize`。stderr 不参与断言。

### 4.8 README

README 必须包含 `question.md` 列出的全部说明项：项目结构、安装、构建 bundle、`anna-app validate --strict`、`anna-app dev --no-llm`、为什么 `--no-llm` 下 Summarize 预期报 `-32603`、如何用 `--mock-sampling` 测后端、如何手测 `initialize` / `describe` / `invoke`、如何证明 storage 与 sampling 链路、如何跑本机打包、workflow 触发方式与三个 release asset、以及 manifest / bundle / executas / storage / sampling / binary archive 的关系。

## 5. 建议仓库结构

```text
.
├── manifest.json
├── package.json
├── README.md
├── REQUIREMENTS.md
├── src/                          # 前端源码
│   ├── main.ts
│   ├── ui/
│   ├── runtime.ts                # AnnaAppRuntime.connect
│   ├── notes-storage.ts          # anna.storage.*
│   └── summarize.ts              # anna.tools.invoke
├── bundle/                       # npm run build 输出，可 gitignore
├── executas/
│   └── mini-notes-summarizer/
│       ├── executa.json
│       └── ...                   # Tool 源码
├── fixtures/
│   └── mock-sampling.jsonl
├── scripts/
│   ├── pack-binary.ps1           # 或 pack-binary.sh，识别本机架构
│   └── rpc-smoke.mjs             # 手动 / CI 的 stdio JSON-RPC 测试
└── .github/workflows/
    └── release-executa.yml
```

## 6. 建议技术选型

| 部分 | 选型 | 原因 |
| --- | --- | --- |
| 前端 | Vite + TypeScript | 满足工程化、`src/` 拆分和 `npm run build`。不引入 UI 框架也能完成 |
| Executa | Go | 单文件二进制；本机和 CI 都能交叉编译 darwin/windows；stdout 不会被解释器 banner 污染 |
| CLI | npm 包 `@anna-ai/cli`（当前 0.1.61，命令名 `anna-app`） | 官方开发者 CLI。示例仓库里的 `@anna-ai/app-cli` 已不存在 |
| 运行时 | Node.js 22+，以及 Astral `uv` | `anna-app dev` 通过 `uvx` 拉取 `anna-app-runtime-local` |
| CI | GitHub Actions + `softprops/action-gh-release` | 一次矩阵构建三个平台并上传 Release assets |

Go 的 `executa.json`：

```json
{
  "tool_id": "mini-notes-summarizer",
  "type": "go",
  "command": ["go", "run", "."]
}
```

发布时 CI 和本机打包脚本改用编译出的二进制，不再依赖 `go run`。

## 7. 工具与使用方法

以下命令按 Windows PowerShell 书写。macOS / Linux 把路径分隔符换成 `/` 即可。安装 CLI 使用官方包：

```powershell
npm install -g @anna-ai/cli
anna-app --version
anna-app doctor
```

`doctor` 会检查 `uv` 和运行时缓存。本机还需要：

- Node.js 22 或更高
- Go 1.22 或更高（若 Executa 用 Go）
- Git
- `uv`：https://docs.astral.sh/uv/getting-started/installation/

### 7.1 安装依赖与构建前端

```powershell
npm install
npm run build
```

`npm run build` 必须生成 `bundle/index.html` 以及被它引用的 JS/CSS。然后：

```powershell
anna-app validate --strict
```

`--strict` 会把 manifest 的 `host_api` 与 bundle 源码对上。`storage.get` / `storage.set` / `tools.invoke` 若出现在 bundle 里，manifest 必须授权。校验失败先改 manifest 或删掉多余调用，不要加无关权限。

### 7.2 UI harness

```powershell
npm run build
anna-app dev --no-llm
```

可以用 npm script 包一层，例如 `"dev": "anna-app dev --no-llm"`。

默认打开 `http://127.0.0.1:5180/dev/?t=<token>`。在页面里：

1. 输入非空笔记并保存，确认输入框被清空、列表出现内容和序号。
2. 再保存一条，确认序号递增。
3. 删除一条，确认列表立即变化。
4. 点击 Summarize。前端仍调用 `anna.tools.invoke`。因为 harness 禁用了 LLM/sampling，预期错误类似 `[-32603] harness started with --no-llm`。这是 UI 调试路径的预期结果，不代表 Executa sampling 实现失败。

不要加 `--mock-llm` 来让 Summarize 按钮显示一条假总结。storage 后端保持默认 `legacy`，不要加 `--storage aps`（该模式不能和 `--no-llm` 同时使用，而且需要登录）。

证明 storage 走 Host API 的方式：源码中创建 / 删除路径调用 `anna.storage.get` / `anna.storage.set`；harness 日志或 recording 里能看到对应 RPC。可选：

```powershell
anna-app dev --no-llm --record recordings/ui.jsonl
anna-app fixture summarize recordings/ui.jsonl
```

### 7.3 后端 sampling

先构建或让 CLI 按 `executa.json` 用 `go run` 启动，然后：

```powershell
anna-app executa dev --dir .\executas\mini-notes-summarizer --mock-sampling .\fixtures\mock-sampling.jsonl --invoke summarize --args "{\"notes\":[{\"order\":1,\"content\":\"修复登录 bug\"}]}" --json
```

成功时 JSON 里的 `summary` 等于 fixture 的 `content.text`。若结果是本地拼接、且没有发 `sampling/createMessage`，验收失败。

交互模式：

```powershell
anna-app executa dev --dir .\executas\mini-notes-summarizer --mock-sampling .\fixtures\mock-sampling.jsonl
```

REPL 里依次执行 `describe`、`health`、`invoke summarize <json>`。

确认 sampling 被调用：

- stderr 或 CLI 协议日志出现 `sampling/createMessage`。
- invoke 结果中的 summary 与 fixture 文本一致，而不是笔记原文的机械拼接。
- 若脚本把 stdout 帧存成 JSONL，其中应有一条 `method` 为 `sampling/createMessage` 的请求，以及 id 相同的 host response。

### 7.4 手动 JSON-RPC

PowerShell 管道可能把字符串写成 UTF-16，不能直接把 JSON 管道给二进制。用 Node 脚本写 stdin、读 stdout，并把 stderr 分开打印。脚本至少发送：

1. `initialize`，检查 `protocolVersion === "2.0"` 且 `capabilities.sampling` 存在。
2. `describe`，检查 `name`、`host_capabilities`、`tools[].name === "summarize"`、`parameters`。
3. `invoke`。没有 host 时，纯脚本必须自己在读到 `sampling/createMessage` 后，向插件 stdin 回一条 id 匹配的 result，再断言 `invoke` 结果里的 summary 来自这条 result。

`anna-app executa dev --describe` 和 `--invoke ... --mock-sampling` 是同一组方法的官方跑法，README 里两种都要写。

### 7.5 本机二进制打包

```powershell
.\scripts\pack-binary.ps1
```

脚本应：

1. 读取 `GOOS` / `GOARCH` 或运行时平台，映射到 `windows-x86_64` 等平台 key。
2. 编译当前平台二进制。Windows 文件名以 `.exe` 结尾。
3. 生成 archive 根目录的 `manifest.json`。
4. 打成 `dist/mini-notes-summarizer-<version>-windows-x86_64.zip`。
5. 解压后检查根上同时有可执行文件和 `manifest.json`，且 `runtime.binary.entrypoint` 指向该文件。

本机 smoke test：

```powershell
node .\scripts\rpc-smoke.mjs .\dist\mini-notes-summarizer.exe
```

### 7.6 GitHub Actions 发布

触发：Actions 页面 `workflow_dispatch`，或推送 `v*` tag / 创建 GitHub Release。

矩阵至少：

| runner | 平台 key | asset |
| --- | --- | --- |
| `macos-14` 或 Go 交叉编译 | `darwin-arm64` | `mini-notes-summarizer-<version>-darwin-arm64.tar.gz` |
| `macos-13` 或 Go 交叉编译 | `darwin-x86_64` | `mini-notes-summarizer-<version>-darwin-x86_64.tar.gz` |
| `windows-latest` 或 Go 交叉编译 | `windows-x86_64` | `mini-notes-summarizer-<version>-windows-x86_64.zip` |

Go 可以在 `ubuntu-latest` 上用 `GOOS` / `GOARCH` 交叉编译全部三个目标。每个 job 在打包前对二进制执行 `describe` smoke test。上传使用 Release assets，而不是只调用 `actions/upload-artifact`。

### 7.7 各概念的关系

| 概念 | 作用 |
| --- | --- |
| `manifest.json`（App） | 告诉 harness 加载哪个 bundle、允许哪些 Host API、捆绑哪个 Executa |
| bundle | iframe 里的静态前端。只通过 `AnnaAppRuntime` 调 Host API |
| executas | harness 按 `executa.json` 拉起的本地插件进程 |
| Anna storage / APS KV | 前端用 `anna.storage.*` 存笔记。本地无登录时是 in-memory `runtime_state`；线上同一 API 背后是 APS |
| sampling | 插件向 host 借 LLM。UI 不直接调模型 |
| binary archive | 给 Anna Agent 安装的发布物。根上的 `manifest.json` 只描述可执行文件入口，不替代 App manifest |

## 8. 验收清单

审阅顺序：

1. 安装依赖。
2. 构建前端 bundle。
3. `anna-app validate --strict` 通过。
4. `anna-app dev --no-llm` 能打开 UI。
5. 创建、删除笔记，并能证明读写是 `anna.storage.get` / `anna.storage.set`。
6. Summarize 触发 `anna.tools.invoke`；`--no-llm` 下出现 `[-32603] harness started with --no-llm` 或等价错误。
7. `anna-app executa dev --mock-sampling <fixture.jsonl>` 单独跑通 summarize。
8. 日志、fixture 或协议脚本证明出现过 `sampling/createMessage`，且 summary 来自该响应。
9. 手测 `initialize`、`describe`、`invoke`。
10. 本机打包脚本产出的 archive 根目录含 `manifest.json`，entrypoint 正确。
11. workflow 能一次发布三个平台的 GitHub Release assets。

## 9. 明确不做

- 真实 Anna 账号、`anna-app login`、真实 LLM key、真实云端 APS。
- 刷新或重启 dev 后仍保留 legacy runtime_state。
- 把 App 发布到 Anna App Store。
- 代码签名、macOS 公证、Windows Authenticode。
- 复杂视觉设计。
- 编辑、搜索、标签、多笔记本、富文本、附件、协同。
