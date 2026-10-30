import type { AnnaClient } from "./types";

declare module "/static/anna-apps/_sdk/latest/index.js" {
  export const AnnaAppRuntime: {
    connect(): Promise<AnnaClient>;
  };
}
