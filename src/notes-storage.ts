import { NOTES_STORAGE_KEY } from "./identity";
import { unwrapHost } from "./rpc";
import type { AnnaClient, Note, StorageGetResult } from "./types";

export async function loadNotes(anna: AnnaClient): Promise<Note[]> {
  const raw = await anna.storage.get({ key: NOTES_STORAGE_KEY });
  const stored = unwrapHost<StorageGetResult>(raw);
  if (stored?.exists === false || stored?.value == null) return [];
  return parseNotes(stored.value);
}

export async function saveNotes(anna: AnnaClient, notes: Note[]): Promise<void> {
  const raw = await anna.storage.set({ key: NOTES_STORAGE_KEY, value: notes });
  unwrapHost(raw);
}

function parseNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  const notes: Note[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.content !== "string" || typeof row.order !== "number") continue;
    notes.push({
      id: typeof row.id === "string" ? row.id : `note-${row.order}`,
      content: row.content,
      order: row.order,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
    });
  }
  return notes.sort((left, right) => left.order - right.order);
}
