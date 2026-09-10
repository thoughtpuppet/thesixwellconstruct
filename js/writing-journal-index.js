import {escapeWriting as esc} from "/shared/writing-content.js";
import {canonicalJournalEntries, journalNoteHref} from "/shared/writing-journal.js";

const root = document.querySelector("[data-writing-journal-index]");

function renderJournalEntry(note) {
  const dateLabel = String(note.reflected_on_label ?? note.reflectedOnLabel ?? note.date_label ?? note.dateLabel ?? "").trim();
  return `<li class="writing-entry-card writing-journal-card">${dateLabel ? `<p class="writing-entry-date">${esc(dateLabel)}</p>` : ""}<h3><a href="${journalNoteHref(note)}">${esc(note.title)}</a></h3>${note.excerpt ? `<p>${esc(note.excerpt)}</p>` : ""}<a class="venture-link" href="${journalNoteHref(note)}">Read Journal Entry</a></li>`;
}

async function loadJournal() {
  try {
    const response = await fetch("/api/archive/notes", {cache:"no-store"});
    if (!response.ok) throw new Error("Journal Entries are unavailable.");
    const payload = await response.json();
    const entries = canonicalJournalEntries(payload.records ?? payload.notes);
    root.innerHTML = entries.length
      ? `<ul class="writing-entry-list writing-journal-list">${entries.map(renderJournalEntry).join("")}</ul>`
      : '<p class="writing-empty">No Journal Entries are published yet.</p>';
  } catch {
    root.innerHTML = '<p class="writing-empty" role="status">The Journal Entries couldn’t be loaded.</p><button type="button" class="venture-link" data-journal-retry>Try again</button>';
    root.querySelector("[data-journal-retry]").addEventListener("click", loadJournal);
  }
}

if (root) loadJournal();
