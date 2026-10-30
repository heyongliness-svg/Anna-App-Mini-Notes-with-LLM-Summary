import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(
  readFileSync(resolve(root, "fixtures/mock-sampling.jsonl"), "utf8").split(/\r?\n/).find((line) => line.trim()),
);
const expectedSummary = fixture.result.content.text;
const binary = process.argv[2];
const command = binary
  ? { cmd: resolve(binary), args: [], cwd: root }
  : { cmd: "go", args: ["run", "."], cwd: resolve(root, "executas/mini-notes-summarizer") };

const child = spawn(command.cmd, command.args, { cwd: command.cwd, stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

const pending = new Map();
const reverse = [];
let sequence = 0;

createInterface({ input: child.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (typeof message.method === "string") {
    reverse.push(message);
    if (message.method === "sampling/createMessage") {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: fixture.result })}\n`);
    }
    return;
  }
  const waiter = pending.get(JSON.stringify(message.id));
  if (!waiter) return;
  pending.delete(JSON.stringify(message.id));
  waiter(message);
});

function request(method, params) {
  const id = ++sequence;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 60000);
    pending.set(JSON.stringify(id), (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`[${message.error.code}] ${message.error.message}`));
      else resolveResult(message.result);
    });
  });
}

try {
  const initialized = await request("initialize", { protocolVersion: "2.0", capabilities: { sampling: {} } });
  if (initialized.protocolVersion !== "2.0") throw new Error(`protocol ${initialized.protocolVersion}`);
  const samplingCapability = initialized.client_capabilities?.sampling ?? initialized.capabilities?.sampling;
  if (!samplingCapability) throw new Error("initialize did not declare sampling");

  const described = await request("describe", {});
  if (described.name !== "mini-notes-summarizer") throw new Error(`describe name ${described.name}`);
  if (!described.host_capabilities?.includes("llm.sample")) throw new Error("missing llm.sample");
  const summarize = described.tools?.find((tool) => tool.name === "summarize");
  if (!Array.isArray(summarize?.parameters)) throw new Error("summarize parameters[] missing");

  const invoked = await request("invoke", {
    tool: "summarize",
    arguments: { notes: [{ order: 1, content: "修复登录 bug" }] },
    context: { invoke_id: "smoke-invoke" },
  });
  if (invoked?.data?.summary !== expectedSummary) {
    throw new Error(`summary was not the sampling response: ${JSON.stringify(invoked)}`);
  }
  if (!reverse.some((message) => message.method === "sampling/createMessage")) {
    throw new Error("sampling/createMessage was not sent");
  }
  const samplingRequest = reverse.find((message) => message.method === "sampling/createMessage");
  if (samplingRequest.params?.metadata?.executa_invoke_id !== "smoke-invoke") {
    throw new Error("sampling metadata missing executa_invoke_id");
  }
  console.log("rpc smoke passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  await new Promise((resolveExit) => child.once("exit", resolveExit));
}
