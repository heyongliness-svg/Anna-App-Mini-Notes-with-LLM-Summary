import { SUMMARIZE_METHOD, TOOL_ID } from "./identity";
import { HostError, unwrapHost } from "./rpc";
import type { AnnaClient, Note } from "./types";

export async function summarizeNotes(anna: AnnaClient, notes: Note[]): Promise<string> {
  const raw = await anna.tools.invoke({
    tool_id: TOOL_ID,
    method: SUMMARIZE_METHOD,
    args: {
      notes: notes.map((note) => ({
        order: note.order,
        content: note.content,
      })),
    },
  });
  return readSummary(unwrapHost<unknown>(raw));
}

function readSummary(result: unknown): string {
  if (!result || typeof result !== "object") {
    throw new HostError("Executa 没有返回 sampling 总结");
  }
  const row = result as {
    success?: boolean;
    error?: string;
    summary?: string;
    data?: { success?: boolean; error?: string; summary?: string };
  };
  if (row.success === false) throw new HostError(row.error || "总结失败");
  if (typeof row.summary === "string" && row.summary.trim()) return row.summary;
  const nested = row.data;
  if (nested?.success === false) throw new HostError(nested.error || "总结失败");
  const summary = nested?.summary;
  if (typeof summary === "string" && summary.trim()) return summary;
  throw new HostError("Executa 没有返回 sampling 总结");
}
