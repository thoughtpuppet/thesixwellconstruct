export const JOURNAL_NOTE_TYPE = "journal-entry";
export const JOURNAL_ROOT = "/archive/notes/";

function isPublicJournal(note) {
  if (!note || typeof note !== "object") return false;
  if ((note.note_type ?? note.noteType) !== JOURNAL_NOTE_TYPE) return false;
  if (note.state !== undefined && note.state !== "published") return false;
  if (note.public_visible !== undefined && Number(note.public_visible) !== 1) return false;
  if (note.publicVisible !== undefined && !note.publicVisible) return false;
  return Boolean(String(note.slug || "").trim());
}

export function canonicalJournalEntries(records = []) {
  const seen = new Set();
  return (Array.isArray(records) ? records : []).filter(note => {
    if (!isPublicJournal(note)) return false;
    const key = String(note.entity_id ?? note.entityId ?? note.id ?? note.slug).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function journalNoteHref(note = {}) {
  const route = String(note.route || "").trim();
  if (/^\/archive\/notes\/[^/?#]+\/$/.test(route)) return route;
  const slug = String(note.slug || "").trim();
  return slug ? `${JOURNAL_ROOT}${encodeURIComponent(slug)}/` : "";
}
