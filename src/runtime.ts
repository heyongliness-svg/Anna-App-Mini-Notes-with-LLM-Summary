import type { AnnaClient } from "./types";

const SDK_URL = "/static/anna-apps/_sdk/latest/index.js";

export async function connectAnna(): Promise<AnnaClient> {
  const sdk = await import(/* @vite-ignore */ SDK_URL);
  return sdk.AnnaAppRuntime.connect();
}
