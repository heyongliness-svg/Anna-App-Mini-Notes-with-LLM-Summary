import { readHostLocale, resolveLocale, t } from "./i18n";
import { loadNotes, saveNotes } from "./notes-storage";
import { connectAnna } from "./runtime";
import { summarizeNotes } from "./summarize";
import { applyTheme, readHostTheme } from "./theme";
import type { Note } from "./types";
import { hideHarnessFrameUrl, mountApp } from "./ui";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("缺少 #app");

void boot(root);

async function boot(appRoot: HTMLElement) {
  hideHarnessFrameUrl();
  applyTheme(readHostTheme());
  let locale = readHostLocale();
  appRoot.textContent = t(locale, "connecting");
  try {
    const anna = await connectAnna();
    applyTheme(anna.theme);
    locale = resolveLocale(anna.locale);
    let notes = await loadNotes(anna);
    const view = mountApp(appRoot, {
      async onSave(content) {
        const text = content.trim();
        view.setMessage("");
        if (!text) {
          view.setMessage("emptyContent");
          return;
        }
        view.setBusy(true);
        try {
          const order = notes.reduce((max, note) => Math.max(max, note.order), 0) + 1;
          const note: Note = {
            id: crypto.randomUUID(),
            content: text,
            order,
            createdAt: new Date().toISOString(),
          };
          notes = [...notes, note];
          await saveNotes(anna, notes);
          view.setNotes(notes);
          view.clearDraft();
          view.setSummary("");
        } catch (error) {
          notes = await loadNotes(anna);
          view.setNotes(notes);
          view.setError(errorText(error, locale));
        } finally {
          view.setBusy(false);
        }
      },
      async onDelete(id) {
        view.setMessage("");
        view.setBusy(true);
        try {
          notes = notes.filter((note) => note.id !== id);
          await saveNotes(anna, notes);
          view.setNotes(notes);
        } catch (error) {
          notes = await loadNotes(anna);
          view.setNotes(notes);
          view.setError(errorText(error, locale));
        } finally {
          view.setBusy(false);
        }
      },
      async onSummarize() {
        view.setMessage("");
        if (notes.length === 0) {
          view.setMessage("noNotes");
          return;
        }
        view.setBusy(true);
        try {
          const summary = await summarizeNotes(anna, notes);
          view.setSummary(summary);
        } catch (error) {
          view.setSummary("");
          view.setError(errorText(error, locale));
        } finally {
          view.setBusy(false);
        }
      },
    }, locale);
    view.setLocale(locale);
    view.setNotes(notes);
    anna.onThemeChange(({ theme }) => applyTheme(theme));
    anna.onLocaleChange(({ lang }) => {
      locale = resolveLocale(lang);
      view.setLocale(locale);
    });
  } catch (error) {
    appRoot.textContent = `${t(locale, "connectFailed")}${errorText(error, locale)}`;
  }
}

function errorText(error: unknown, locale: ReturnType<typeof readHostLocale>): string {
  if (!(error instanceof Error)) return t(locale, "unknown");
  const code = (error as Error & { code?: string | number }).code;
  if (code === undefined || error.message.includes(`[${code}]`) || /\[-?\d+\]/.test(error.message)) {
    return error.message;
  }
  return `[${code}] ${error.message}`;
}
