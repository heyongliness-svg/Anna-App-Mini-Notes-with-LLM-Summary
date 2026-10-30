import { APP_TITLE } from "./identity";
import { localeTag, t, type Locale, type MessageKey } from "./i18n";
import type { Note } from "./types";

export interface AppHandlers {
  onSave(content: string): Promise<void>;
  onDelete(id: string): Promise<void>;
  onSummarize(): Promise<void>;
}

export interface AppView {
  setNotes(notes: Note[]): void;
  setSummary(summary: string): void;
  setMessage(key: MessageKey | ""): void;
  setError(message: string): void;
  setBusy(busy: boolean): void;
  setLocale(locale: Locale): void;
  clearDraft(): void;
}

export function mountApp(root: HTMLElement, handlers: AppHandlers, initialLocale: Locale): AppView {
  root.innerHTML = "";

  const heading = document.createElement("h1");
  heading.textContent = APP_TITLE;
  const lede = document.createElement("p");
  lede.className = "lede";
  lede.textContent = "记下短句，需要时再总结。";

  const form = document.createElement("form");
  form.className = "composer";
  const input = document.createElement("textarea");
  input.rows = 4;
  input.placeholder = "写一条短笔记";
  input.setAttribute("aria-label", "笔记内容");
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "保存";
  form.append(input, save);

  const error = document.createElement("p");
  error.className = "error";
  error.hidden = true;
  error.setAttribute("role", "alert");

  const listHeading = document.createElement("h2");
  listHeading.textContent = "笔记";
  const list = document.createElement("ul");
  list.className = "notes";
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "还没有笔记";

  const summaryButton = document.createElement("button");
  summaryButton.type = "button";
  summaryButton.className = "summarize";
  summaryButton.textContent = "Summarize";
  const summary = document.createElement("section");
  summary.className = "summary";
  summary.hidden = true;
  const summaryLabel = document.createElement("h2");
  summaryLabel.textContent = "总结";
  const summaryText = document.createElement("p");
  summary.append(summaryLabel, summaryText);

  root.append(heading, lede, form, error, listHeading, empty, list, summaryButton, summary);

  let notes: Note[] = [];
  let busy = false;
  let locale = initialLocale;
  let messageKey: MessageKey | "" = "";

  const paintCopy = () => {
    document.documentElement.lang = localeTag(locale);
    lede.textContent = t(locale, "lede");
    input.placeholder = t(locale, "placeholder");
    input.setAttribute("aria-label", t(locale, "noteLabel"));
    save.textContent = t(locale, "save");
    listHeading.textContent = t(locale, "notes");
    empty.textContent = t(locale, "empty");
    summaryButton.textContent = t(locale, "summarize");
    summaryLabel.textContent = t(locale, "summary");
    if (messageKey) error.textContent = t(locale, messageKey);
  };

  const render = () => {
    list.replaceChildren();
    const hasNotes = notes.length > 0;
    empty.hidden = hasNotes;
    listHeading.hidden = !hasNotes;
    for (const note of notes) {
      const item = document.createElement("li");
      const body = document.createElement("div");
      const order = document.createElement("span");
      order.className = "order";
      order.textContent = String(note.order);
      const content = document.createElement("p");
      content.textContent = note.content;
      body.append(order, content);
      if (note.createdAt) {
        const time = document.createElement("time");
        time.dateTime = note.createdAt;
        time.textContent = formatTime(note.createdAt, locale);
        body.append(time);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete";
      remove.textContent = t(locale, "delete");
      remove.disabled = busy;
      remove.addEventListener("click", () => {
        void handlers.onDelete(note.id);
      });
      item.append(body, remove);
      list.append(item);
    }
    save.disabled = busy;
    summaryButton.disabled = busy;
    input.disabled = busy;
  };

  paintCopy();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handlers.onSave(input.value);
  });
  summaryButton.addEventListener("click", () => {
    void handlers.onSummarize();
  });

  return {
    setNotes(next) {
      notes = next;
      render();
    },
    setSummary(text) {
      summary.hidden = text.length === 0;
      summaryText.textContent = text;
    },
    setMessage(key) {
      messageKey = key;
      error.hidden = key.length === 0;
      error.textContent = key ? t(locale, key) : "";
    },
    setError(message) {
      messageKey = "";
      error.hidden = message.length === 0;
      error.textContent = message;
    },
    setBusy(next) {
      busy = next;
      render();
    },
    setLocale(next) {
      locale = next;
      paintCopy();
      render();
    },
    clearDraft() {
      input.value = "";
    },
  };
}

function formatTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function hideHarnessFrameUrl(): void {
  try {
    const frameUrl = window.parent.document.getElementById("iframe-src");
    if (frameUrl) frameUrl.hidden = true;
  } catch {
    // Outside the local harness there is no parent frame URL to hide.
  }
}
