import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {__blackboardBatchTest as batch} from "../studio/archive-blackboards-manager.js";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE=readFileSync(join(ROOT,"studio","archive-blackboards-manager.js"),"utf8");
const STYLE=readFileSync(join(ROOT,"studio","archive-blackboards-manager.css"),"utf8");
const file=(name,{type="",size=100,lastModified=1}={})=>({name,type,size,lastModified});

test("Blackboard batch filenames derive editable catalogue metadata",()=>{
  assert.deepEqual(batch.metadataFromFilename("2026-08-25_tentacle-and-marbles_master.tif"),{
    title:"Tentacle And Marbles",
    slug:"tentacle-and-marbles",
    caption:"Tentacle And Marbles",
    occurredDate:"2026-08-25",
    dateLabel:"August 25, 2026",
  });
  assert.equal(batch.metadataFromFilename("tentacle_2026-08-25_public.jpg").title,"Tentacle");
  assert.equal(batch.metadataFromFilename("2026-02-30_impossible.tif").occurredDate,"");
});

test("Blackboard batch pairs roles by basename and enforces derivative formats",()=>{
  assert.equal(batch.pairBasename("chalk-study_master.tiff"),"chalk-study");
  assert.equal(batch.pairBasename("chalk-study_public.jpg"),"chalk-study");
  assert.equal(batch.mimeFor(file("scan.TIFF")),"image/tiff");
  assert.equal(batch.mimeFor(file("scan.tif",{type:"image/x-tiff"})),"image/tiff");
  assert.equal(batch.mimeFor(file("scan.jpg",{type:"image/jpg"})),"image/jpeg");
  assert.equal(batch.mimeFor(file("scan.HEIF")),"image/heif");
  assert.equal(batch.needsSuppliedDerivative(file("scan.tiff")),true);
  assert.equal(batch.needsSuppliedDerivative(file("scan.heic")),false);
  assert.equal(batch.needsSuppliedDerivative(file("scan.jpg")),false);
  assert.equal(batch.needsSuppliedDerivative(file("scan.png")),false);
  assert.equal(batch.needsSuppliedDerivative(file("scan.webp")),false);
});

test("Blackboard batch uses name, size, and lastModified for exact duplicate detection",()=>{
  const first=file("fragment.jpg",{type:"image/jpeg",size:500,lastModified:20});
  const same=file("fragment.jpg",{type:"image/png",size:500,lastModified:20});
  const changed=file("fragment.jpg",{type:"image/jpeg",size:501,lastModified:20});
  assert.equal(batch.fileFingerprint(first),batch.fileFingerprint(same));
  assert.notEqual(batch.fileFingerprint(first),batch.fileFingerprint(changed));
  const initial=batch.planFragmentBatchSelection([],new Map(),[first],[],"blackboard-1");
  const repeated=batch.planFragmentBatchSelection(initial.rows,initial.pool,[same,changed],[],"blackboard-1");
  assert.equal(repeated.rows.length,2);
  assert.deepEqual(repeated.duplicates,["fragment.jpg"]);
});

test("Blackboard derivatives can be staged with or after their matching masters",()=>{
  const master=file("2026-08-25-chalk_master.tif",{type:"image/tiff"});
  const derivative=file("2026-08-25-chalk_public.jpg",{type:"image/jpeg"});
  const staged=batch.planFragmentBatchSelection([],new Map(),[master],[],"blackboard-1");
  assert.equal(staged.rows[0].derivativeFile,null);
  const paired=batch.planFragmentBatchSelection(staged.rows,staged.pool,[],[derivative],"blackboard-1");
  assert.equal(paired.rows[0].derivativeFile,derivative);
});

test("Blackboard queue previews readable masters and waits for a TIFF editing source",()=>{
  const jpeg=file("chalk-study.jpg",{type:"image/jpeg"});
  const heic=file("chalk-study.heic",{type:"image/heic"});
  const tiff=file("chalk-study.tiff",{type:"image/tiff"});
  const companion=file("chalk-study-webp.webp",{type:"image/webp"});
  assert.equal(batch.batchPreviewFile({masterFile:jpeg,derivativeFile:null,generatedDerivativeFile:null}),jpeg);
  assert.equal(batch.batchPreviewFile({masterFile:heic,derivativeFile:null,generatedDerivativeFile:companion}),companion);
  assert.equal(batch.batchPreviewFile({masterFile:tiff,derivativeFile:null,generatedDerivativeFile:null}),null);
  assert.equal(batch.batchPreviewFile({masterFile:tiff,derivativeFile:companion,generatedDerivativeFile:null}),companion);
});

test("Blackboard session tray caps logical fragment rows at 50",()=>{
  const masters=Array.from({length:51},(_,index)=>file(`fragment-${index}.jpg`,{type:"image/jpeg",size:index+1,lastModified:index+1}));
  const planned=batch.planFragmentBatchSelection([],new Map(),masters,[],"blackboard-1");
  assert.equal(batch.BATCH_MAX_FRAGMENTS,50);
  assert.equal(planned.rows.length,50);
  assert.equal(planned.rejected.length,1);
  assert.match(planned.rejected[0],/tray limit is 50/);
});

test("Blackboard batch upload contract preserves private sources, independent drafts, checkpoints, and two pipelines",()=>{
  assert.equal(batch.BATCH_CONCURRENCY,2);
  assert.doesNotMatch(SOURCE,/consent_status/);
  assert.match(SOURCE,/uploadKind:"archive-master",privacy:"internal",publicPresentation:"hidden"/);
  assert.match(SOURCE,/uploadFragmentEditSource\(file,alt,output\).*privacy:"internal",presentation:"hidden"/);
  assert.match(SOURCE,/edit_source_media_id:row\.derivativeMediaId/);
  assert.match(SOURCE,/collection:"\/api\/admin\/archive-blackboards\/fragments"/);
  assert.match(SOURCE,/queuedHeicEditProxy/);
  assert.match(SOURCE,/createHeicEditProxy/);
  assert.match(SOURCE,/state:"draft",public_visible:false/);
  assert.doesNotMatch(SOURCE,/createBatchRow\(file,recordId/);
  assert.match(SOURCE,/if\(!row\.masterMediaId\)/);
  assert.match(SOURCE,/if\(!row\.derivativeMediaId\)/);
  assert.match(SOURCE,/if\(row\.createAttempted\)/);
  assert.match(SOURCE,/recoverCompletedMaster/);
  assert.match(SOURCE,/recoverBatchDerivative/);
  assert.match(SOURCE,/fragmentBatchDerivativeMediaIds/);
  assert.match(SOURCE,/fragmentBatchRunning<BATCH_CONCURRENCY/);
  assert.match(SOURCE,/data-batch-cancel/);
  assert.match(SOURCE,/data-batch-retry/);
  assert.match(SOURCE,/name="masters" multiple/);
  assert.match(SOURCE,/name="derivatives" multiple/);
  assert.match(SOURCE,/data-batch-dropzone="masters"/);
  assert.match(SOURCE,/data-batch-dropzone="derivatives"/);
  assert.match(SOURCE,/host\.addEventListener\("dragover",onBatchDragOver\)/);
  assert.match(SOURCE,/host\.addEventListener\("drop",onBatchDrop\)/);
  assert.match(SOURCE,/stageFragmentFiles\(role==="masters"\?files:\[\],role==="derivatives"\?files:\[\],output\)/);
  assert.match(SOURCE,/URL\.createObjectURL\(source\)/);
  assert.match(SOURCE,/URL\.revokeObjectURL\(row\.previewUrl\)/);
  assert.match(SOURCE,/queueBatchPreviews\(\)/);
  assert.match(SOURCE,/bb-batch-row-preview/);
});

test("Blackboard batch intake opens wide and exposes large drag targets",()=>{
  assert.match(STYLE,/\.bb-fragment-intake \.bb-add-entry\[open\][\s\S]*?flex:\s*1 0 100%/);
  assert.match(STYLE,/\.bb-fragment-library \.bb-manager-head[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(STYLE,/\.bb-batch-dropzone--masters[\s\S]*?min-height:\s*300px/);
  assert.match(STYLE,/\.bb-batch-dropzone\.is-dragover[\s\S]*?border-color:\s*var\(--accent\)/);
  assert.match(STYLE,/\.bb-batch-row-preview[\s\S]*?min-height:\s*170px/);
  assert.match(STYLE,/@media \(max-width:\s*720px\)[\s\S]*?\.bb-batch-drop-grid[\s\S]*?grid-template-columns:\s*1fr/);
});
