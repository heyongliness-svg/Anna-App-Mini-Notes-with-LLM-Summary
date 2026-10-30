export class HostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostError";
  }
}

export function unwrapHost<T>(raw: unknown): T {
  if (!raw || typeof raw !== "object" || !("ok" in raw)) return raw as T;
  const envelope = raw as {
    ok: boolean;
    result?: T;
    error?: { code?: number | string; message?: string };
  };
  const hasRpcShape = "result" in envelope || "error" in envelope;
  if (!hasRpcShape) return raw as T;
  if (!envelope.ok) {
    const code = envelope.error?.code;
    const message = envelope.error?.message ?? "Host API 调用失败";
    throw new HostError(code === undefined ? message : `[${code}] ${message}`);
  }
  return envelope.result as T;
}
