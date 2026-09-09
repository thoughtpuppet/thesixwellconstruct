import {escapeWriting as esc, WRITING_ROOT, writingDate} from "/shared/writing-content.js";
const root = document.querySelector("[data-writing-index]");
async function load() {
  try {
    const response = await fetch("/api/writings/entries", {cache:"no-store"});
    if (!response.ok) throw new Error("Entries are unavailable.");
    const {entries} = await response.json();
    root.innerHTML = entries.length ? `<ul class="writing-entry-list">${entries.map(entry => `<li class="writing-entry-card"><p class="writing-entry-date"><time datetime="${esc(entry.firstPublishedAt)}">${writingDate(entry.firstPublishedAt)}</time></p><h2><a href="${WRITING_ROOT}${encodeURIComponent(entry.slug)}/">${esc(entry.title)}</a></h2>${entry.excerpt ? `<p>${esc(entry.excerpt)}</p>` : ""}</li>`).join("")}</ul>` : '<p class="writing-empty">No entries published yet.</p>';
  } catch {
    root.innerHTML = '<p class="writing-empty" role="status">The entries couldn’t be loaded.</p><button type="button" class="venture-link" data-retry>Try again</button>';
    root.querySelector("[data-retry]").addEventListener("click", load);
  }
}
if (root) load();
