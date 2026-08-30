import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {runInNewContext} from "node:vm";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE=readFileSync(join(ROOT,"studio","construct-manager.js"),"utf8");
const NOTES_SOURCE=readFileSync(join(ROOT,"studio","archive-notes-manager.js"),"utf8");

function sourceSection(startMarker,endMarker){
  const start=SOURCE.indexOf(startMarker);
  assert.notEqual(start,-1,`Missing source marker: ${startMarker}`);
  const end=SOURCE.indexOf(endMarker,start+startMarker.length);
  assert.notEqual(end,-1,`Missing source marker: ${endMarker}`);
  return SOURCE.slice(start,end);
}

const helperSource=sourceSection("function localFileKey","function artBatchPanel");
const helperSandbox={};
runInNewContext(`${helperSource}\nthis.batchHelpers={localFileKey,batchFilenameTitle,batchSlug,uniqueBatchSlug};`,helperSandbox);
const helpers=helperSandbox.batchHelpers;

const artPanel=sourceSection("function artBatchPanel","function artBatchDefaults");
const artRowMarkup=sourceSection("function artBatchRowMarkup","function renderArtBatchTray");
const artStage=sourceSection("function stageArtBatchFiles","function resolveArtBatchSlugs");
const artSlugResolution=sourceSection("function resolveArtBatchSlugs","async function processArtBatchRow");
const artProcess=sourceSection("async function processArtBatchRow","async function runArtBatch");
const artRun=sourceSection("async function runArtBatch","function showFlashBulkArchiveAction");

const materialDestinations=sourceSection("function archiveMaterialBatchDestinations","function validateArchiveMaterialBatchFile");
const materialRowMarkup=sourceSection("function archiveMaterialBatchRowMarkup","function renderArchiveMaterialBatchTray");
const materialStage=sourceSection("function stageArchiveMaterialBatchFiles","async function processArchiveMaterialBatchRow");
const materialProcess=sourceSection("async function processArchiveMaterialBatchRow","async function runArchiveMaterialBatch");
const materialRun=sourceSection("async function runArchiveMaterialBatch","const archiveTimelineWorkspace");
const dossierBindings=sourceSection("function bindDossierWorkspace","async function renderArchiveDossiers");

test("batch filenames, slugs, and local duplicate fingerprints use the promised inputs",()=>{
  assert.equal(helpers.batchFilenameTitle("blue_moon-study.JPG"),"Blue Moon Study");
  assert.equal(helpers.batchFilenameTitle("---.png","Untitled work"),"Untitled Work");
  assert.equal(helpers.batchSlug("Étude / Blue Moon"),"etude-blue-moon");

  const used=new Set(["blue-moon","blue-moon-2"]);
  assert.equal(helpers.uniqueBatchSlug("blue-moon",used),"blue-moon-3");
  assert.equal(helpers.uniqueBatchSlug("another-work",used),"another-work");

  const first={name:"fragment.jpg",size:500,lastModified:20,type:"image/jpeg"};
  const sameFingerprint={name:"fragment.jpg",size:500,lastModified:20,type:"image/png"};
  assert.equal(helpers.localFileKey(first),helpers.localFileKey(sameFingerprint));
  assert.notEqual(helpers.localFileKey(first),helpers.localFileKey({...first,size:501}));
  assert.notEqual(helpers.localFileKey(first),helpers.localFileKey({...first,lastModified:21}));
  assert.notEqual(helpers.localFileKey(first),helpers.localFileKey({...first,name:"fragment-2.jpg"}));
});

test("Art Works stages no more than 50 editable filename-derived drafts and resolves slug collisions",()=>{
  assert.match(SOURCE,/const BATCH_RECORD_LIMIT=50,ART_BATCH_CONCURRENCY=2/);
  assert.match(SOURCE,/const artBatchSession=\{rows:\[\],running:false,cancelQueued:false\}/);
  assert.match(artPanel,/Batch create works/);
  assert.match(artPanel,/Stage up to 50 images/);
  assert.match(artPanel,/Two records process at a time/);
  assert.match(artPanel,/Drafts only/);
  assert.match(artPanel,/accept="image\/jpeg,image\/png,image\/webp" multiple/);
  assert.match(artPanel,/data-art-default="medium" value="Acrylic on wood panel"/);
  assert.match(artPanel,/data-art-default="availability">\$\{artAvailabilityOptions\("unavailable"\)\}/);
  assert.doesNotMatch(artPanel,/data-art-default="availability" placeholder=/);
  assert.doesNotMatch(artPanel,/data-art-batch-publish/);

  assert.match(artStage,/existingKeys\.has\(localFileKey\(file\)\)/);
  assert.match(artStage,/artBatchSession\.rows\.length>=BATCH_RECORD_LIMIT/);
  assert.match(artStage,/batchFilenameTitle\(file\.name,"Untitled work"\)/);
  assert.match(artStage,/uniqueBatchSlug\(batchSlug\(title,"art-work"\),usedSlugs\)/);
  assert.match(artStage,/title,slug:slugValue,altText:title/);
  assert.match(artRowMarkup,/data-art-row-field="title"/);
  assert.match(artRowMarkup,/data-art-row-field="slug"/);
  assert.match(artRowMarkup,/data-art-row-field="altText"/);
  assert.match(artRowMarkup,/Row overrides/);
  assert.match(SOURCE,/const field=event\.target\.closest\("\[data-art-row-field\]"\)[\s\S]*?row\[field\.dataset\.artRowField\]=field\.value/);
  assert.match(artSlugResolution,/allRecords\.map\(record=>record\.slug\)/);
  assert.match(artSlugResolution,/uniqueBatchSlug\(batchSlug\(row\.slug\|\|row\.title,"art-work"\),used\)/);
  assert.doesNotMatch(`${artStage}${artRun}`,/localStorage|sessionStorage|indexedDB/);
});

test("Art Works creates drafts first, checkpoints every server ID, and retries without duplicating completed stages",()=>{
  const createIndex=artProcess.indexOf("if(!row.entityId)");
  const uploadIndex=artProcess.indexOf("if(!row.mediaId)");
  const attachIndex=artProcess.indexOf("if(!row.attached)");
  assert.ok(createIndex>=0&&createIndex<uploadIndex&&uploadIndex<attachIndex,"draft, upload, and attachment checkpoints must run in order");

  assert.match(artProcess,/api\("\/api\/admin\/art",\{method:"POST"/);
  assert.match(artProcess,/availability=value\("availability"\)\|\|"unavailable"/);
  assert.match(artProcess,/ART_AVAILABILITY_VALUES\.has\(availability\)/);
  assert.match(artProcess,/state:"draft"/);
  assert.match(artProcess,/row\.entityId=created\.record\?\.id/);
  assert.match(artProcess,/upload\.append\("privacy","public"\)/);
  assert.match(artProcess,/upload\.append\("public_presentation","inline"\)/);
  assert.match(artProcess,/row\.mediaId=uploaded\.record\?\.id/);
  assert.match(artProcess,/role:"primary",sort_order:1,public_visible:true/);
  assert.match(artProcess,/row\.attached=true/);
  assert.match(artProcess,/Draft \$\{row\.entityId\} kept/);
  assert.doesNotMatch(artProcess,/consent_status|batch-jobs|\/api\/admin\/batch/);

  assert.match(artRun,/Promise\.all\(Array\.from\(\{length:Math\.min\(ART_BATCH_CONCURRENCY,pending\.length\)\},worker\)\)/);
  assert.match(artRun,/row\.status==="queued"\|\|row\.status==="error"/);
  assert.match(artRun,/artBatchSession\.cancelQueued\|\|row\.status==="cancelled"/);
  assert.match(SOURCE,/data-art-batch-cancel[\s\S]*?artBatchSession\.cancelQueued=true/);
  assert.match(SOURCE,/data-art-row-retry[\s\S]*?artRow\.status="queued"[\s\S]*?runArtBatch\(shell,allRecords\)/);
});

test("dossier intake exposes Separate Materials with the same bounded, retryable two-worker tray",()=>{
  assert.match(SOURCE,/const ARCHIVE_MATERIAL_BATCH_CONCURRENCY=2/);
  assert.match(SOURCE,/archiveMaterialBatchSessions=new Map\(\)/);
  assert.match(materialDestinations,/Batch dossier intake/);
  assert.match(materialDestinations,/<h4>Separate Materials<\/h4>/);
  assert.match(materialDestinations,/<h4>One Journal moment<\/h4>/);
  assert.match(materialDestinations,/Drafts only/);
  assert.doesNotMatch(materialDestinations,/data-material-batch-publish/);

  assert.match(materialStage,/keys\.has\(key\)/);
  assert.match(materialStage,/session\.rows\.length>=BATCH_RECORD_LIMIT/);
  assert.match(materialStage,/batchFilenameTitle\(file\.name,"Untitled material"\)/);
  assert.match(materialStage,/mediaId:"",materialId:""/);
  assert.match(materialRowMarkup,/data-material-row-field="title"/);
  assert.match(materialRowMarkup,/data-material-row-field="altText"/);
  assert.match(materialRowMarkup,/data-material-row-field="caption"/);
  assert.match(materialRowMarkup,/Row overrides/);
  assert.match(dossierBindings,/const batchField=event\.target\.closest\("\[data-material-row-field\]"\)[\s\S]*?row\[batchField\.dataset\.materialRowField\]=batchField\.value/);
  assert.doesNotMatch(`${materialStage}${materialRun}`,/localStorage|sessionStorage|indexedDB/);

  const uploadIndex=materialProcess.indexOf("if(!row.mediaId)");
  const createIndex=materialProcess.indexOf("if(!row.materialId)");
  assert.ok(uploadIndex>=0&&uploadIndex<createIndex,"media checkpoint must precede the Material checkpoint");
  assert.match(materialProcess,/privacy:"internal"/);
  assert.match(materialProcess,/public_presentation:"hidden"/);
  assert.match(materialProcess,/visibility:"internal",state:"draft"/);
  assert.match(materialProcess,/row\.mediaId=await uploadArchiveMaterialFile/);
  assert.match(materialProcess,/row\.materialId=recordFrom\(created,"material"\)\.id/);
  assert.match(materialProcess,/Media checkpointed/);
  assert.doesNotMatch(materialProcess,/consent_status|batch-jobs|\/api\/admin\/batch/);

  assert.match(materialRun,/Promise\.all\(Array\.from\(\{length:Math\.min\(ARCHIVE_MATERIAL_BATCH_CONCURRENCY,pending\.length\)\},worker\)\)/);
  assert.match(materialRun,/session\.cancelQueued\|\|row\.status==="cancelled"/);
  assert.match(dossierBindings,/data-material-batch-cancel[\s\S]*?session\.cancelQueued=true/);
  assert.match(dossierBindings,/data-material-row-retry[\s\S]*?batchRow\.status="queued"[\s\S]*?runArchiveMaterialBatch\(shell,entityId\)/);
});

test("One Journal moment launches the existing ordered Journal intake with one primary dossier and optional related records",()=>{
  assert.match(materialDestinations,/Optional related record IDs/);
  assert.match(materialDestinations,/data-dossier-journal-launch>Start Journal moment/);
  assert.match(dossierBindings,/split\(","\)\.map\(value=>value\.trim\(\)\)\.filter\(value=>value&&value!==entityId\)/);
  assert.match(dossierBindings,/mountArchiveNotes\(root\(\),api,status,\{journalPrefill:\{primaryEntityId:entityId,relatedEntityIds:relatedIds,title:/);
  assert.match(dossierBindings,/relationshipRole:"context"/);
  assert.match(dossierBindings,/onBack:\(\)=>loadArchiveDossier\(entityId\)/);

  assert.match(NOTES_SOURCE,/note_type:"journal-entry"/);
  assert.match(NOTES_SOURCE,/data-journal-lead/);
  assert.match(NOTES_SOURCE,/data-journal-up/);
  assert.match(NOTES_SOURCE,/data-journal-down/);
  assert.match(NOTES_SOURCE,/tokenAppended:false/);
  assert.match(NOTES_SOURCE,/is_primary:true,public_visible:false/);
  assert.match(NOTES_SOURCE,/form\.append\("privacy",publicVisible\?"public":"internal"\)/);
  assert.match(NOTES_SOURCE,/form\.append\("public_presentation",publicVisible\?"inline":"hidden"\)/);
});
