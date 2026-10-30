export type Locale = "zh" | "en";

export type MessageKey =
  | "connecting"
  | "lede"
  | "placeholder"
  | "noteLabel"
  | "save"
  | "notes"
  | "empty"
  | "delete"
  | "summarize"
  | "summary"
  | "emptyContent"
  | "noNotes"
  | "connectFailed"
  | "unknown";

const copy: Record<Locale, Record<MessageKey, string>> = {
  zh: {
    connecting: "正在连接 Anna…",
    lede: "记下短句，需要时再总结。",
    placeholder: "写一条短笔记",
    noteLabel: "笔记内容",
    save: "保存",
    notes: "笔记",
    empty: "还没有笔记",
    delete: "删除",
    summarize: "总结",
    summary: "总结",
    emptyContent: "内容不能为空",
    noNotes: "还没有笔记可以总结",
    connectFailed: "无法连接 Anna Runtime。请用 anna-app dev --no-llm 启动。",
    unknown: "未知错误",
  },
  en: {
    connecting: "Connecting to Anna…",
    lede: "Jot a short note, then summarize when you need to.",
    placeholder: "Write a short note",
    noteLabel: "Note",
    save: "Save",
    notes: "Notes",
    empty: "No notes yet",
    delete: "Delete",
    summarize: "Summarize",
    summary: "Summary",
    emptyContent: "Content cannot be empty",
    noNotes: "There are no notes to summarize",
    connectFailed: "Could not connect to Anna Runtime. Start it with anna-app dev --no-llm.",
    unknown: "Unknown error",
  },
};

export function resolveLocale(lang: string | null | undefined): Locale {
  return (lang || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function readHostLocale(): Locale {
  const lang = new URLSearchParams(location.search).get("lang");
  return resolveLocale(lang || navigator.language);
}

export function t(locale: Locale, key: MessageKey): string {
  return copy[locale][key];
}

export function localeTag(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}
