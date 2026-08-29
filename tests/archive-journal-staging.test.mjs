import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname,join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const studio=readFileSync(join(ROOT,"studio","archive-notes-manager.js"),"utf8");
const publicArchive=readFileSync(join(ROOT,"js","archive-public.js"),"utf8");

test("Journal staging is bounded, ordered, internal, and retryable",()=>{
  assert.match(studio,/MAX_PENDING_ASSETS=50,JOURNAL_UPLOAD_CONCURRENCY=2/);
  assert.match(studio,/accept="image\/jpeg,image\/png,image\/webp,image\/gif" multiple data-journal-files/);
  assert.match(studio,/pendingFingerprint/);
  assert.match(studio,/knownFingerprints/);
  assert.match(studio,/knownExisting/);
  assert.match(studio,/data-journal-lead/);
  assert.match(studio,/data-journal-up/);
  assert.match(studio,/data-journal-down/);
  assert.match(studio,/data-journal-remove/);
  assert.match(studio,/data-journal-retry/);
  assert.match(studio,/runConcurrent\(uploads,JOURNAL_UPLOAD_CONCURRENCY/);
  assert.match(studio,/mediaId:"",assetId:"",tokenAppended:false/);
  assert.match(studio,/assetId:item\.attachId/);
  assert.match(studio,/publicVisible:false/);
  assert.match(studio,/form\.append\("privacy",publicVisible\?"public":"internal"\)/);
  assert.doesNotMatch(studio,/consent_status/);
});

test("Journal tokens and dossier links are checkpointed after attachment",()=>{
  assert.match(studio,/newlyAttached=pendingAssets\.filter\(item=>item\.assetId&&!item\.tokenAppended\)/);
  assert.match(studio,/appendAssetTokenLines/);
  assert.match(studio,/Choose exactly one primary linked record for this Journal moment/);
  assert.match(studio,/note_type:"journal-entry"/);
  assert.match(studio,/journalPrefill:\{primaryEntityId,relatedEntityIds,title,slug,dateLabel,relationshipRole\}/);
  assert.match(studio,/archive_note_mode=journal&primary_entity_id=ID&related_entity_ids=ID,ID/);
  assert.match(studio,/is_primary:true,public_visible:false/);
  assert.match(studio,/selectedId&&!known[\s\S]*linked record/);
});

test("public dossier labels Journal moments without renaming Open notebook",()=>{
  assert.match(publicArchive,/journal\?"Journal moment":"Archive Note"/);
  assert.match(publicArchive,/Open complete Journal moment/);
  assert.match(publicArchive,/Complete \$\{publicLabel\}/);
  assert.doesNotMatch(publicArchive,/Journal entr(?:y|ies)/);
  assert.match(publicArchive,/>Open notebook<\/h2>/);
});
