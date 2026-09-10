import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {canonicalJournalEntries, journalNoteHref, JOURNAL_ROOT} from "../shared/writing-journal.js";

test("Writings presents WRKNG and canonical Journal Entries as distinct streams", () => {
  const page = readFileSync(new URL("../writings/index.html", import.meta.url), "utf8");
  assert.match(page,/>WRKNG\*</);
  assert.match(page,/id="journal-entries"/);
  assert.match(page,/>Journal Entries</);
  assert.match(page,/data-writing-journal-index/);
  assert.match(page,/src="\/js\/writing-journal-index\.js"/);
  assert.doesNotMatch(page,/Journal Entries[^]*\/writings\/mindful-darkness\/wrkng\/journal/i);
});

test("Journal discovery includes only public published Journal records and deduplicates placements", () => {
  const journal = {entity_id:"note-journal", slug:"studio-turning-point", title:"A studio turning point", note_type:"journal-entry", state:"published", public_visible:1};
  const records = canonicalJournalEntries([
    journal,
    {...journal},
    {entity_id:"note-private", slug:"private", note_type:"journal-entry", state:"published", public_visible:0},
    {entity_id:"note-draft", slug:"draft", note_type:"journal-entry", state:"draft", public_visible:1},
    {entity_id:"note-evidence", slug:"evidence", note_type:"concept-note", state:"published", public_visible:1},
  ]);
  assert.deepEqual(records.map(note => note.entity_id), ["note-journal"]);
});

test("Journal cards always open the standalone Archive Note route", () => {
  assert.equal(JOURNAL_ROOT, "/archive/notes/");
  assert.equal(journalNoteHref({slug:"studio-turning-point"}), "/archive/notes/studio-turning-point/");
  assert.equal(journalNoteHref({slug:"ignored", route:"/archive/notes/canonical-entry/"}), "/archive/notes/canonical-entry/");
  assert.equal(journalNoteHref({slug:"safe-entry", route:"https://example.test/copied-writing"}), "/archive/notes/safe-entry/");
  const client = readFileSync(new URL("../js/writing-journal-index.js", import.meta.url), "utf8");
  assert.match(client,/fetch\("\/api\/archive\/notes"/);
  assert.doesNotMatch(client,/\/api\/writings\/entries/);
  assert.doesNotMatch(client,/POST|PATCH|archive\/notes\/[^"']+\/convert/i);
});
