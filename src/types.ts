export interface Note {
  id: string;
  content: string;
  order: number;
  createdAt?: string;
}

export interface StorageGetResult {
  value: unknown;
  exists?: boolean;
}

export interface InvokeResult {
  success?: boolean;
  data?: { summary?: string };
  error?: string;
}

export interface AnnaClient {
  theme: "light" | "dark" | null;
  themeMode: string | null;
  locale: string | null;
  onThemeChange(fn: (theme: { theme: "light" | "dark"; mode: string }) => void): () => void;
  onLocaleChange(fn: (locale: { lang: string }) => void): () => void;
  storage: {
    get(args: { key: string }): Promise<unknown>;
    set(args: { key: string; value: unknown }): Promise<unknown>;
  };
  tools: {
    invoke(args: {
      tool_id: string;
      method?: string;
      args?: Record<string, unknown>;
    }): Promise<unknown>;
  };
}
