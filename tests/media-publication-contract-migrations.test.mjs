import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {dirname,join} from "node:path";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS=join(ROOT,"migrations");
const VISIBILITY_MIGRATION="0185_media_publication_visibility.sql";
const REMOVAL_MIGRATION="0186_remove_media_publication_consent.sql";
const OBSOLETE_COLUMNS=[
  ["media_assets","consent_status"],
  ["media_upload_sessions","consent_status"],
  ["portfolio_items","primary_consent_status"],
  ["archive_source_material_sets","permission_status"],
];

function migrationNames(){return readdirSync(MIGRATIONS).filter(name=>name.endsWith(".sql")&&name<=REMOVAL_MIGRATION).sort()}
function applyMigration(database,name){database.exec(readFileSync(join(MIGRATIONS,name),"utf8"))}
function replayThrough0186(){const database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON");for(const name of migrationNames())applyMigration(database,name);return database}
function columns(database,table){return database.prepare(`PRAGMA table_info('${table}')`).all().map(row=>({...row}))}
function fragmentCount(database,id){return database.prepare("SELECT COUNT(*) count FROM archive_search_fragments WHERE id=? AND public_visible=1").get(id).count}
function expectPortfolioGuard(database,sql){assert.throws(()=>database.exec(sql),/published portfolio cover must remain eligible/)}

test("0185 backfills explicit primary visibility before 0186 removes only publication-consent columns",()=>{
  const names=migrationNames();
  for(const required of ["0182_archive_reference_colors.sql","0183_archive_editable_studio_records.sql","0184_archive_note_history_suggestions.sql",VISIBILITY_MIGRATION,REMOVAL_MIGRATION])assert.ok(names.includes(required),`${required} must participate in the replay`);
  const visibilityIndex=names.indexOf(VISIBILITY_MIGRATION),database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON");
  for(const name of names.slice(0,visibilityIndex))applyMigration(database,name);

  database.exec(`INSERT INTO portfolio_items(id,title,state,primary_consent_status,created_at,updated_at) VALUES
    ('backfill-draft-granted','Draft granted','draft','granted',datetime('now'),datetime('now')),
    ('backfill-draft-not-required','Draft not required','draft','not-required',datetime('now'),datetime('now')),
    ('backfill-draft-required','Draft required','draft','required',datetime('now'),datetime('now')),
    ('backfill-draft-denied','Draft denied','draft','denied',datetime('now'),datetime('now')),
    ('backfill-draft-unknown','Draft unknown','draft','unknown',datetime('now'),datetime('now')),
    ('backfill-published-unknown','Published unknown','published','unknown',datetime('now'),datetime('now'));`);
  applyMigration(database,VISIBILITY_MIGRATION);
  assert.deepEqual(database.prepare("SELECT id,primary_public_visible FROM portfolio_items WHERE id LIKE 'backfill-%' ORDER BY id").all().map(row=>({...row})),[
    {id:"backfill-draft-denied",primary_public_visible:0},
    {id:"backfill-draft-granted",primary_public_visible:1},
    {id:"backfill-draft-not-required",primary_public_visible:1},
    {id:"backfill-draft-required",primary_public_visible:0},
    {id:"backfill-draft-unknown",primary_public_visible:0},
    {id:"backfill-published-unknown",primary_public_visible:1},
  ]);
  for(const name of names.slice(visibilityIndex+1))applyMigration(database,name);

  for(const [table,column] of OBSOLETE_COLUMNS)assert.equal(columns(database,table).some(item=>item.name===column),false,`${table}.${column} must be absent`);
  const primaryVisibility=columns(database,"portfolio_items").find(item=>item.name==="primary_public_visible");
  assert.deepEqual({type:primaryVisibility.type,notnull:primaryVisibility.notnull,default:primaryVisibility.dflt_value},{type:"INTEGER",notnull:1,default:"0"});
  assert.ok(columns(database,"media_assets").some(item=>item.name==="rights_notes"),"legal rights notes remain part of the media record");

  const schema=database.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all();
  for(const [,column] of OBSOLETE_COLUMNS)assert.doesNotMatch(schema.map(row=>row.sql).join("\n"),new RegExp(`\\b${column}\\b`,`i`));
  for(const table of ["archive_search_fragments","search_documents"])for(const [,column] of OBSOLETE_COLUMNS)assert.equal(columns(database,table).some(item=>item.name===column),false);

  const triggers=new Map(database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all().map(row=>[row.name,row.sql]));
  for(const name of ["archive_material_privacy_insert","archive_material_privacy_update","archive_media_privacy_update","archive_source_material_fragment_insert","archive_source_material_fragment_update","portfolio_published_cover_item_guard","portfolio_published_cover_media_guard"])assert.ok(triggers.has(name),`${name} must be rebuilt`);
  assert.match(triggers.get("archive_media_privacy_update"),/NEW\.state='active'[\s\S]*NEW\.privacy='public'[\s\S]*NEW\.public_presentation='inline'/);
  assert.match(triggers.get("archive_material_privacy_insert"),/ad\.state='published'[\s\S]*ad\.public_visible=1[\s\S]*NEW\.state='published'[\s\S]*NEW\.visibility='public'/);
  assert.match(triggers.get("portfolio_published_cover_item_guard"),/primary_public_visible[\s\S]*em\.public_visible=1[\s\S]*m\.state='active'[\s\S]*m\.privacy='public'[\s\S]*m\.public_presentation='inline'/);
  assert.match(triggers.get("portfolio_published_cover_media_guard"),/NEW\.state<>'active'[\s\S]*NEW\.privacy<>'public'[\s\S]*NEW\.public_presentation<>'inline'/);

  const invalidMaterialProjection=database.prepare(`SELECT COUNT(*) count FROM archive_search_fragments fragment
    JOIN archive_materials material ON material.id=fragment.source_id
    JOIN archive_dossiers dossier ON dossier.entity_id=material.dossier_entity_id
    JOIN content_entities entity ON entity.id=dossier.entity_id
    LEFT JOIN media_assets media ON media.id=material.media_id
    WHERE fragment.fragment_type='material' AND fragment.public_visible=1 AND (
      material.state<>'published' OR material.visibility<>'public'
      OR dossier.state<>'published' OR dossier.public_visible<>1 OR entity.visibility<>'public'
      OR (material.media_id IS NOT NULL AND (media.state<>'active' OR media.privacy<>'public' OR media.public_presentation<>'inline'))
    )`).get().count;
  assert.equal(invalidMaterialProjection,0);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM archive_search_fragments fragment
    JOIN archive_source_material_sets source_set ON source_set.id=fragment.source_id
    WHERE fragment.fragment_type='source-material' AND fragment.public_visible<>
      CASE WHEN source_set.publication_state='published' AND source_set.visibility='public' THEN 1 ELSE 0 END`).get().count,0);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
  database.close();
});

test("rebuilt Archive projections require public records and active public inline media",()=>{
  const database=replayThrough0186(),materialFragment="archive-fragment-material-contract-archive-material";
  database.exec(`UPDATE content_entities SET visibility='public',search_visibility=1 WHERE id='art-marbles';
    UPDATE archive_dossiers SET state='published',public_visible=1 WHERE entity_id='art-marbles';
    INSERT INTO media_assets(id,source_url,original_filename,mime_type,alt_text,rights_notes,privacy,state,public_presentation,created_at,updated_at)
      VALUES('contract-archive-media','https://cdn.example.test/contract-archive.jpg','contract-archive.jpg','image/jpeg','Contract Archive media','Artist-owned documentation','public','active','inline',datetime('now'),datetime('now'));
    INSERT INTO archive_materials(id,dossier_entity_id,media_id,material_type,title,caption,visibility,state,created_at,updated_at)
      VALUES('contract-archive-material','art-marbles','contract-archive-media','process-photo','Contract Archive material','Publication projection fixture.','public','published',datetime('now'),datetime('now'));`);
  assert.equal(fragmentCount(database,materialFragment),1);
  assert.equal(database.prepare("SELECT rights_notes FROM media_assets WHERE id='contract-archive-media'").get().rights_notes,"Artist-owned documentation");

  database.exec("UPDATE media_assets SET public_presentation='hidden' WHERE id='contract-archive-media'");assert.equal(fragmentCount(database,materialFragment),0);
  database.exec("UPDATE media_assets SET public_presentation='inline' WHERE id='contract-archive-media'");assert.equal(fragmentCount(database,materialFragment),1);
  database.exec("UPDATE media_assets SET privacy='internal' WHERE id='contract-archive-media'");assert.equal(fragmentCount(database,materialFragment),0);
  database.exec("UPDATE media_assets SET privacy='public' WHERE id='contract-archive-media'");assert.equal(fragmentCount(database,materialFragment),1);
  database.exec("UPDATE media_assets SET state='archived' WHERE id='contract-archive-media'");assert.equal(fragmentCount(database,materialFragment),0);
  database.exec("UPDATE media_assets SET state='active' WHERE id='contract-archive-media'");assert.equal(fragmentCount(database,materialFragment),1);
  database.exec("UPDATE archive_materials SET visibility='internal' WHERE id='contract-archive-material'");assert.equal(fragmentCount(database,materialFragment),0);
  database.exec("UPDATE archive_materials SET visibility='public',state='draft' WHERE id='contract-archive-material'");assert.equal(fragmentCount(database,materialFragment),0);
  database.exec("UPDATE archive_materials SET state='published' WHERE id='contract-archive-material'");assert.equal(fragmentCount(database,materialFragment),1);
  database.exec("UPDATE archive_dossiers SET state='draft',public_visible=0 WHERE entity_id='art-marbles'; UPDATE archive_materials SET updated_at=updated_at WHERE id='contract-archive-material'");assert.equal(fragmentCount(database,materialFragment),0);
  database.exec("UPDATE archive_dossiers SET state='published',public_visible=1 WHERE entity_id='art-marbles'; UPDATE archive_materials SET updated_at=updated_at WHERE id='contract-archive-material'");assert.equal(fragmentCount(database,materialFragment),1);
  database.exec("UPDATE content_entities SET visibility='internal' WHERE id='art-marbles'; UPDATE archive_materials SET updated_at=updated_at WHERE id='contract-archive-material'");assert.equal(fragmentCount(database,materialFragment),0);
  database.exec("UPDATE content_entities SET visibility='public' WHERE id='art-marbles'; UPDATE archive_materials SET updated_at=updated_at WHERE id='contract-archive-material'");assert.equal(fragmentCount(database,materialFragment),1);

  database.exec(`INSERT INTO archive_source_material_sets(id,dossier_entity_id,source_kind,title,caption,visibility,publication_state,created_at,updated_at)
    VALUES('contract-source-set','art-marbles','client-correspondence','Contract source set','Explicit source publication fixture.','internal','draft',datetime('now'),datetime('now'))`);
  const sourceFragment="archive-source-material-contract-source-set";
  assert.equal(database.prepare("SELECT public_visible FROM archive_search_fragments WHERE id=?").get(sourceFragment).public_visible,0);
  database.exec("UPDATE archive_source_material_sets SET visibility='public',publication_state='published' WHERE id='contract-source-set'");
  assert.equal(database.prepare("SELECT public_visible FROM archive_search_fragments WHERE id=?").get(sourceFragment).public_visible,1);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
  database.close();
});

test("rebuilt Portfolio guards require explicit cover visibility and active public inline gallery media",()=>{
  const database=replayThrough0186();
  database.exec(`INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_at,updated_at)
      VALUES('contract-primary-portfolio','portfolio_item','node-tattoos','internal',0,datetime('now'),datetime('now'));
    INSERT INTO portfolio_items(id,title,state,cover_image_ref,primary_public_visible,created_at,updated_at)
      VALUES('contract-primary-portfolio','Primary cover contract','draft','primary',0,datetime('now'),datetime('now'));`);
  expectPortfolioGuard(database,"UPDATE portfolio_items SET state='published' WHERE id='contract-primary-portfolio'");
  database.exec("UPDATE portfolio_items SET primary_public_visible=1,state='published' WHERE id='contract-primary-portfolio'");
  assert.deepEqual({...database.prepare("SELECT state,primary_public_visible FROM portfolio_items WHERE id='contract-primary-portfolio'").get()},{state:"published",primary_public_visible:1});
  expectPortfolioGuard(database,"UPDATE portfolio_items SET primary_public_visible=0 WHERE id='contract-primary-portfolio'");

  database.exec(`INSERT INTO content_entities(id,entity_type,node_id,visibility,search_visibility,created_at,updated_at)
      VALUES('contract-gallery-portfolio','portfolio_item','node-tattoos','internal',0,datetime('now'),datetime('now'));
    INSERT INTO portfolio_items(id,title,state,cover_image_ref,primary_public_visible,created_at,updated_at)
      VALUES('contract-gallery-portfolio','Gallery cover contract','draft','contract-gallery-media',0,datetime('now'),datetime('now'));
    INSERT INTO media_assets(id,source_url,original_filename,mime_type,alt_text,rights_notes,privacy,state,public_presentation,created_at,updated_at)
      VALUES('contract-gallery-media','https://cdn.example.test/contract-gallery.jpg','contract-gallery.jpg','image/jpeg','Gallery cover','Artist-controlled publication','public','active','inline',datetime('now'),datetime('now'));
    INSERT INTO entity_media(entity_id,media_id,role,public_visible,created_at)
      VALUES('contract-gallery-portfolio','contract-gallery-media','gallery',0,datetime('now'));`);
  expectPortfolioGuard(database,"UPDATE portfolio_items SET state='published' WHERE id='contract-gallery-portfolio'");
  database.exec("UPDATE entity_media SET public_visible=1 WHERE entity_id='contract-gallery-portfolio' AND media_id='contract-gallery-media' AND role='gallery'; UPDATE portfolio_items SET state='published' WHERE id='contract-gallery-portfolio'");
  assert.equal(database.prepare("SELECT state FROM portfolio_items WHERE id='contract-gallery-portfolio'").get().state,"published");
  expectPortfolioGuard(database,"UPDATE entity_media SET public_visible=0 WHERE entity_id='contract-gallery-portfolio' AND media_id='contract-gallery-media' AND role='gallery'");
  expectPortfolioGuard(database,"UPDATE media_assets SET privacy='internal' WHERE id='contract-gallery-media'");
  expectPortfolioGuard(database,"UPDATE media_assets SET state='archived' WHERE id='contract-gallery-media'");
  expectPortfolioGuard(database,"UPDATE media_assets SET public_presentation='hidden' WHERE id='contract-gallery-media'");
  assert.deepEqual({...database.prepare("SELECT privacy,state,public_presentation,rights_notes FROM media_assets WHERE id='contract-gallery-media'").get()},{privacy:"public",state:"active",public_presentation:"inline",rights_notes:"Artist-controlled publication"});
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
  database.close();
});
