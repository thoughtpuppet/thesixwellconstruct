import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN = "media-gallery-test-token";

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT")) return { results: statement.all(...this.values) };
    const result = statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class MemoryBucket {
  constructor() { this.objects = new Map(); }
  async put(key, value) { this.objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer())); }
  async head(key) {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.length, httpEtag: '"test-etag"', writeHttpMetadata() {} } : null;
  }
  async get(key, options = {}) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    const range = options.range;
    const body = range ? bytes.slice(range.offset, range.offset + range.length) : bytes;
    return { body, size: bytes.length, range: range ? { offset: range.offset, length: body.length } : undefined, httpEtag: '"test-etag"', writeHttpMetadata() {} };
  }
}

class NoMultipartBucket extends MemoryBucket {
  async createMultipartUpload() { throw new Error("multipart upload should not start for a duplicate"); }
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(join(ROOT, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(ROOT, "migrations", name), "utf8"));
  }
  return db;
}

function environment(database, bucket = new MemoryBucket()) {
  return { SUBMISSIONS_DB: new LocalD1(database), SUBMISSIONS_ADMIN_TOKEN: TOKEN, SUBMISSION_FILES: bucket };
}

function request(path, { method = "GET", body, admin = false, headers = {} } = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(admin ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function api(env, path, options) {
  const response = await handleConstructApi(request(path, options), env);
  return { response, payload: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
}

function admitFixture(sql, mediaId, { title = "Fixture media", originality = "sixwell_original", role = "creative_master", basis = "direct", sourceEntityId = null, state = "published" } = {}) {
  sql.prepare("UPDATE media_asset_provenance SET originality=?,asset_role=?,creator_credit='Six.Well' WHERE media_id=?").run(originality, role, mediaId);
  sql.prepare(`INSERT OR IGNORE INTO content_entities(id,entity_type,node_id,visibility,search_visibility,featured,internal_notes,created_by,updated_by,created_at,updated_at)
    VALUES(?,'media_asset',NULL,'internal',0,0,'','test','test',datetime('now'),datetime('now'))`).run(`media-catalogue-${mediaId}`);
  sql.prepare(`INSERT OR IGNORE INTO media_catalogue_entries(media_id,entity_id,source_class,catalogue_state,admission_basis,source_entity_id,manual_gallery_approved,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,'creative','active',?,?,?,'test','test',datetime('now'),datetime('now'))`).run(mediaId, `media-catalogue-${mediaId}`, basis, sourceEntityId, originality === "collaborative_original" ? 1 : 0);
  sql.prepare(`INSERT OR REPLACE INTO gallery_entries(media_id,display_media_id,title,date_precision,state,published_at,publication_basis,source_entity_id,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,?,'undated',?,CASE WHEN ?='published' THEN datetime('now') ELSE NULL END,?,?,'test','test',datetime('now'),datetime('now'))`).run(mediaId, mediaId, title, state, state, basis, sourceEntityId);
}

test("confirmed originals and qualifying preexisting Archive media form one contiguous public catalogue", async () => {
  const sql = database();
  const catalogue = sql.prepare(`SELECT catalogue.catalogue_id,catalogue.media_id,provenance.originality,provenance.asset_role
    FROM media_catalogue_entries catalogue JOIN media_asset_provenance provenance ON provenance.media_id=catalogue.media_id
    WHERE catalogue.catalogue_state='active' ORDER BY catalogue.catalogue_id`).all();
  assert.ok(catalogue.length >= 9, "direct originals plus qualifying public process, studio, Note, and Blackboard media");
  assert.deepEqual(catalogue.map((row) => row.catalogue_id), Array.from({length:catalogue.length},(_,index)=>index+1));
  assert.ok(catalogue.every((row) => row.originality === "sixwell_original"));
  assert.ok(catalogue.every((row) => ["creative_master", "editorial_fragment"].includes(row.asset_role)));
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE state='published'").get().count, catalogue.length);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries catalogue JOIN media_assets media ON media.id=catalogue.media_id WHERE lower(media.original_filename) LIKE '%poster%'").get().count, 0);
  assert.deepEqual(sql.prepare("SELECT catalogue.media_id,media.source_url,media.storage_key FROM media_catalogue_entries catalogue JOIN media_assets media ON media.id=catalogue.media_id WHERE lower(replace(media.source_url,'\\','/')) LIKE '/assets/flash/%' OR lower(replace(media.source_url,'\\','/')) LIKE '/assets/paintings/%' OR lower(replace(media.storage_key,'\\','/')) LIKE 'portfolio/%' ORDER BY catalogue.media_id").all(),[]);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries catalogue JOIN media_assets media ON media.id=catalogue.media_id WHERE lower(media.original_filename) IN ('ring-ripple-reference.mov','ring-ripple-reference.mp4') OR lower(replace(media.source_url,'\\','/')) LIKE '/assets/events/%'").get().count, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragment_edits edit JOIN media_catalogue_entries catalogue ON catalogue.media_id=edit.alpha_mask_media_id").get().count, 0);
  assert.deepEqual(sql.prepare("SELECT media_id,suggested_reason FROM media_archive_admission_reviews WHERE review_state='pending' ORDER BY media_id").all(),[]);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE source_entity_id='archive-practice-making-the-canvas'").get().count,2);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE source_entity_id='archive-record-saiel-goat-farm-studio-years'").get().count,4);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE media_id IN (SELECT alpha_mask_media_id FROM archive_blackboard_fragment_edits WHERE alpha_mask_media_id IS NOT NULL)").get().count,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM pragma_foreign_key_check").get().count, 0);
  assert.equal(sql.prepare("SELECT state FROM gallery_sets WHERE id='gallery-set-peer-amid-versions'").get().state, "published");
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_set_items WHERE set_id='gallery-set-peer-amid-versions'").get().count, 2);

  const publicIndex = await api(environment(sql), "/api/gallery");
  assert.equal(publicIndex.response.status, 200);
  assert.equal(publicIndex.payload.count, catalogue.length, "every published MED record must clear the public ownership gate");

  const audit = sql.prepare("SELECT COUNT(*) count FROM media_catalogue_renumber_audit WHERE run_id='0215-original-media-rebuild'").get().count;
  assert.ok(audit > catalogue.length);
  sql.prepare(`INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-trigger-check','','test/trigger-check.png','trigger-check.png','image/png',1,'internal','active','test',datetime('now'),datetime('now'),'hidden')`).run();
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE media_id='media-trigger-check'").get().count, 0);
  assert.equal(sql.prepare("SELECT originality FROM media_asset_provenance WHERE media_id='media-trigger-check'").get().originality, "unknown");
});

test("operational, site, external, and unknown managed media stays outside the Gallery catalogue", async () => {
  const sql=database();
  sql.prepare(`INSERT INTO media_assets(id,source_url,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation,archive_catalogue_eligible)
    VALUES('media-private-reference','/assets/private/reference.png','reference.png','image/png',1,'internal','active','test',datetime('now'),datetime('now'),'hidden',0)`).run();
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE media_id='media-private-reference'").get().count,0);

  sql.prepare(`INSERT INTO media_assets(id,source_url,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-unknown','/assets/test/unknown.png','unknown.png','image/png',1,'internal','active','test',datetime('now'),datetime('now'),'hidden')`).run();
  const env=environment(sql);
  const rejected=await api(env,"/api/admin/gallery",{method:"POST",admin:true,body:{media_id:"media-unknown"}});
  assert.equal(rejected.response.status,409);
  assert.match(rejected.payload.error,/classify.*original/i);
  const review=await api(env,"/api/admin/media-admission-review",{admin:true});
  assert.equal(review.response.status,200);
  assert.ok(review.payload.records.every((record)=>!record.accession));
});

test("generated masks stay operational and HEIC masters publish through one automatic JPEG display pair", async () => {
  const sql=database(),env=environment(sql);
  sql.prepare(`INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,byte_size,alt_text,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-orphan-mask','','test/fragment-hotspot-old.png','fragment-hotspot-old.png','image/png',1,'Interaction mask for an old fragment','internal','active','test',datetime('now'),datetime('now'),'hidden')`).run();
  assert.equal(sql.prepare("SELECT archive_catalogue_eligible FROM media_assets WHERE id='media-orphan-mask'").get().archive_catalogue_eligible,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE media_id='media-orphan-mask'").get().count,0);

  sql.prepare(`INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-heic-master','','test/studio-fragment.heic','studio-fragment.heic','image/heic',10,'internal','active','test',datetime('now'),datetime('now'),'hidden')`).run();
  sql.prepare(`INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,byte_size,alt_text,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-heic-display','','test/studio-fragment.edit-proxy.jpg','studio-fragment.edit-proxy.jpg','image/jpeg',8,'Studio fragment','internal','active','test',datetime('now'),datetime('now'),'hidden')`).run();
  const paired=await api(env,"/api/admin/media/media-heic-master/variants",{method:"POST",admin:true,body:{derivative_media_id:"media-heic-display",activate_derivative:false}});
  assert.equal(paired.response.status,201);
  assert.equal(sql.prepare("SELECT asset_role FROM media_asset_provenance WHERE media_id='media-heic-display'").get().asset_role,"technical_derivative");
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE media_id='media-heic-display'").get().count,0);

  const admitted=await api(env,"/api/admin/media-admission-review",{method:"POST",admin:true,body:{action:"admit",media_ids:["media-heic-master"],originality:"sixwell_original",asset_role:"creative_master",publish:true}});
  assert.equal(admitted.payload.failed.length,0);

  const draft=await api(env,"/api/admin/gallery",{method:"POST",admin:true,body:{media_id:"media-heic-master"}});
  assert.equal(draft.response.status,200);
  assert.equal(draft.payload.record.gallery.display_media_id,"media-heic-display");
  assert.match(draft.payload.record.admin_url,/media-heic-display\/file$/);
  const published=await api(env,"/api/admin/gallery/media-heic-master/publish",{method:"POST",admin:true});
  assert.equal(published.response.status,200);
  assert.deepEqual({...sql.prepare("SELECT privacy,public_presentation FROM media_assets WHERE id='media-heic-master'").get()},{privacy:"internal",public_presentation:"hidden"});
  assert.deepEqual({...sql.prepare("SELECT privacy,public_presentation FROM media_assets WHERE id='media-heic-display'").get()},{privacy:"internal",public_presentation:"hidden"});
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE media_id='media-heic-display'").get().count,0);
  const publicIndex=await api(env,"/api/gallery");
  const accession=`MED-${String(sql.prepare("SELECT catalogue_id FROM media_catalogue_entries WHERE media_id='media-heic-master'").get().catalogue_id).padStart(6,"0")}`;
  const publicRecord=publicIndex.payload.records.find(record=>record.accession===accession&&record.mimeType==="image/jpeg");
  assert.ok(publicRecord);
  assert.match(publicRecord.mediaUrl,/\?asset=media-heic-display$/);
});

test("published Blackboard fragments authorize their private masters through public display derivatives", async () => {
  const sql=database(),env=environment(sql);
  const board=sql.prepare(`SELECT record.id record_entity_id
    FROM archive_records record JOIN content_entities owner ON owner.id=record.id
    WHERE owner.visibility='public' LIMIT 1`).get();
  assert.ok(board);
  sql.prepare(`INSERT OR IGNORE INTO archive_blackboard_records(record_entity_id,created_by,updated_by,created_at,updated_at)
    VALUES(?,'test','test',datetime('now'),datetime('now'))`).run(board.record_entity_id);
  sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-fragment-master','test/fragment.heic','fragment.heic','image/heic',10,'internal','active','test',datetime('now'),datetime('now'),'hidden')`).run();
  sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-fragment-display','test/fragment.jpg','fragment.jpg','image/jpeg',8,'public','active','test',datetime('now'),datetime('now'),'inline')`).run();
  sql.prepare(`INSERT INTO media_asset_variants(master_media_id,derivative_media_id,purpose,created_by,created_at,updated_at)
    VALUES('media-fragment-master','media-fragment-display','public-display','test',datetime('now'),datetime('now'))`).run();
  admitFixture(sql,'media-fragment-master',{title:'Published Blackboard fragment',basis:'record',sourceEntityId:board.record_entity_id});
  sql.prepare("UPDATE gallery_entries SET display_media_id='media-fragment-display' WHERE media_id='media-fragment-master'").run();
  sql.prepare(`INSERT INTO content_entities(id,entity_type,visibility,search_visibility,featured,created_by,updated_by,created_at,updated_at)
    VALUES('fragment-public-gate-test','archive_blackboard_fragment','public',0,0,'test','test',datetime('now'),datetime('now'))`).run();
  sql.prepare(`INSERT INTO archive_blackboard_fragments(id,record_entity_id,slug,title,master_media_id,derivative_media_id,state,public_visible,created_by,updated_by,created_at,updated_at,published_at)
    VALUES('fragment-public-gate-test',?,'fragment-public-gate-test','Public gate test','media-fragment-master','media-fragment-display','published',1,'test','test',datetime('now'),datetime('now'),datetime('now'))`).run(board.record_entity_id);
  const accession=`MED-${String(sql.prepare("SELECT catalogue_id FROM media_catalogue_entries WHERE media_id='media-fragment-master'").get().catalogue_id).padStart(6,'0')}`;
  const publicRecord=await api(env,`/api/gallery/items/${accession}`);
  assert.equal(publicRecord.response.status,200);
  assert.equal(publicRecord.payload.record.mimeType,'image/jpeg');
  assert.match(publicRecord.payload.record.mediaUrl,/asset=media-fragment-display$/);
});

test("Studio draft creation is idempotent and one-click publication does not require rights or accessibility review", async () => {
  const sql = database(), env = environment(sql);
  const media = sql.prepare("SELECT media_id FROM media_catalogue_entries WHERE source_class='creative' ORDER BY catalogue_id LIMIT 1").get().media_id;
  sql.prepare("DELETE FROM gallery_entries WHERE media_id=?").run(media);
  const unauthenticated = await api(env, "/api/admin/media-catalogue");
  assert.equal(unauthenticated.response.status, 401);
  const first = await api(env, "/api/admin/gallery", { method: "POST", admin: true, body: { media_id: media } });
  assert.equal(first.response.status, 201);
  assert.match(first.payload.record.accession, /^MED-\d{6}$/);
  const second = await api(env, "/api/admin/gallery", { method: "POST", admin: true, body: { media_id: media } });
  assert.equal(second.response.status, 200);
  assert.equal(second.payload.record.id, first.payload.record.id);
  const published = await api(env, `/api/admin/gallery/${encodeURIComponent(media)}/publish`, { method: "POST", admin: true });
  assert.equal(published.response.status, 200);
  const publishedEntry = sql.prepare("SELECT state,date_precision,accessibility_status,rights_status FROM gallery_entries WHERE media_id=?").get(media);
  assert.deepEqual({ ...publishedEntry }, { state:"published", date_precision:"undated", accessibility_status:"unreviewed", rights_status:"unreviewed" });
  assert.deepEqual(
    { ...sql.prepare("SELECT privacy,public_presentation,state FROM media_assets WHERE id=(SELECT display_media_id FROM gallery_entries WHERE media_id=?)").get(media) },
    { privacy:"public", public_presentation:"inline", state:"active" },
  );
});

test("batch publication accepts multiple Gallery selections and publishes each in one action", async () => {
  const sql = database(), env = environment(sql);
  const entries = sql.prepare("SELECT gallery.media_id,gallery.display_media_id FROM gallery_entries gallery JOIN media_catalogue_entries catalogue ON catalogue.media_id=gallery.media_id AND catalogue.catalogue_state='active' ORDER BY catalogue.catalogue_id LIMIT 2").all();
  assert.equal(entries.length,2);
  for (const entry of entries) {
    sql.prepare("UPDATE gallery_entries SET state='draft',date_precision='unreviewed',accessibility_text='',accessibility_status='unreviewed',rights_status='unreviewed' WHERE media_id=?").run(entry.media_id);
    sql.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden' WHERE id=?").run(entry.display_media_id);
  }
  const result = await api(env,"/api/admin/gallery/batch",{ method:"POST",admin:true,body:{ action:"publish",media_ids:entries.map(entry=>entry.media_id) } });
  assert.equal(result.response.status,200);
  assert.equal(result.payload.count,2,JSON.stringify(result.payload));
  assert.deepEqual(result.payload.failed,[]);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE media_id IN (?,?) AND state='published' AND date_precision='undated'").get(...entries.map(entry=>entry.media_id)).count,2);
  const createdSet=await api(env,"/api/admin/gallery-sets",{method:"POST",admin:true,body:{title:"Selected process sequence",set_type:"series",state:"published",media_ids:entries.map(entry=>entry.media_id)}});
  assert.equal(createdSet.response.status,201,JSON.stringify(createdSet.payload));
  assert.equal(createdSet.payload.record.item_count,2);
  assert.deepEqual(createdSet.payload.media_ids,entries.map(entry=>entry.media_id));
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_set_items WHERE set_id=?").get(createdSet.payload.record.id).count,2);
});

test("public and Studio Gallery hydration returns catalogues larger than one SQL parameter batch", async () => {
  const sql=database(),env=environment(sql);
  const insertMedia=sql.prepare(`INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES(?,?,?,?, 'image/png',1,'public','active','test',datetime('now'),datetime('now'),'inline')`);
  for(let index=0;index<120;index+=1){const mediaId=`media-large-gallery-${index}`,filename=`large-gallery-${index}.png`;insertMedia.run(mediaId,`/assets/test/${filename}`,"",filename);admitFixture(sql,mediaId,{title:`Large Gallery ${index}`})}
  const expected=sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE state='published'").get().count;
  assert.ok(expected>100);
  const publicIndex=await api(env,"/api/gallery");
  assert.equal(publicIndex.response.status,200);
  assert.equal(publicIndex.payload.records.length,expected);
  const studioIndex=await api(env,"/api/admin/gallery",{admin:true});
  assert.equal(studioIndex.response.status,200);
  assert.equal(studioIndex.payload.records.length,expected);
});

test("Studio media workbench endpoints paginate, filter, preserve legacy shapes, and defer detail hydration", async () => {
  const sql=database(),env=environment(sql);
  const insertMedia=sql.prepare(`INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation,archive_catalogue_eligible)
    VALUES(?,?,?,?,?,1,'internal','active','test',datetime('now'),datetime('now'),'hidden',?)`);
  for(let index=0;index<31;index+=1){
    const mediaId=`media-workbench-${String(index).padStart(2,"0")}`,operational=index%7===0;
    insertMedia.run(mediaId,`/assets/workbench/${mediaId}.${index%3===0?"mp4":"png"}`,"",`${mediaId}.${index%3===0?"mp4":"png"}`,index%3===0?"video/mp4":"image/png",operational?0:1);
    sql.prepare("UPDATE media_asset_provenance SET originality=?,asset_role=? WHERE media_id=?").run(operational?"external_source":"unknown",operational?"operational":"unclassified",mediaId);
  }
  const legacy=await api(env,"/api/admin/media-library",{admin:true});
  assert.equal(legacy.response.status,200);
  assert.equal(Object.hasOwn(legacy.payload,"total_pages"),false,"calls without pagination keep the legacy response shape");

  const first=await api(env,"/api/admin/media-library?page=1&limit=24&scope=all",{admin:true});
  assert.equal(first.response.status,200);
  assert.equal(first.payload.records.length,24);
  assert.equal(first.payload.page,1);
  assert.equal(first.payload.page_size,24);
  assert.equal(first.payload.total_pages,Math.ceil(first.payload.total/24));
  const second=await api(env,"/api/admin/media-library?page=2&limit=24&scope=all",{admin:true});
  assert.equal(second.payload.page,2);
  assert.ok(second.payload.records.length>0&&second.payload.records.length<=24);
  assert.equal(new Set([...first.payload.records,...second.payload.records].map(record=>record.id)).size,first.payload.records.length+second.payload.records.length);

  const catalogue=await api(env,"/api/admin/media-library?page=1&limit=24&scope=catalogue",{admin:true});
  assert.ok(catalogue.payload.records.every(record=>record.accession));
  const uncatalogued=await api(env,"/api/admin/media-library?page=1&limit=100&scope=uncatalogued",{admin:true});
  assert.ok(uncatalogued.payload.records.some(record=>record.id==="media-workbench-01"));
  assert.ok(uncatalogued.payload.records.every(record=>!record.accession&&Number(record.archive_catalogue_eligible)!==0));
  const operational=await api(env,"/api/admin/media-library?page=1&limit=100&scope=site_operational&asset_role=operational",{admin:true});
  assert.ok(operational.payload.records.length>=5);
  assert.ok(operational.payload.records.every(record=>record.asset_role==="operational"));
  const videos=await api(env,"/api/admin/media-library?page=1&limit=100&scope=all&type=video&q=media-workbench",{admin:true});
  assert.ok(videos.payload.records.length>=10);
  assert.ok(videos.payload.records.every(record=>record.media_type==="video"));

  const galleryPage=await api(env,"/api/admin/gallery?page=1&limit=5&state=published&type=image",{admin:true});
  assert.equal(galleryPage.payload.records.length,Math.min(5,galleryPage.payload.total));
  assert.ok(galleryPage.payload.records.every(record=>record.gallery.state==="published"&&record.media_type==="image"));
  const sample=galleryPage.payload.records[0];
  const detail=await api(env,`/api/admin/gallery/${sample.id}`,{admin:true});
  assert.ok(Array.isArray(detail.payload.record.relationships));
  assert.ok(Array.isArray(detail.payload.record.sets));

  const set=sql.prepare("SELECT id FROM gallery_sets WHERE EXISTS (SELECT 1 FROM gallery_set_items item WHERE item.set_id=gallery_sets.id) ORDER BY id LIMIT 1").get();
  const setDetail=await api(env,`/api/admin/gallery-sets/${set.id}`,{admin:true});
  assert.equal(setDetail.response.status,200);
  assert.equal(setDetail.payload.items.length,setDetail.payload.record.item_count);
  assert.ok(setDetail.payload.items.every(record=>record.accession&&record.gallery?.title&&Number(record.sort_order)>0));
});

test("admission review pagination distinguishes pending from deferred and reports both counts", async () => {
  const sql=database(),env=environment(sql);
  const candidates=sql.prepare("SELECT media_id FROM media_archive_admission_reviews ORDER BY media_id LIMIT 3").all();
  assert.ok(candidates.length>=3);
  sql.prepare("UPDATE media_archive_admission_reviews SET review_state='pending' WHERE media_id IN (?,?)").run(candidates[0].media_id,candidates[1].media_id);
  sql.prepare("UPDATE media_archive_admission_reviews SET review_state='deferred' WHERE media_id=?").run(candidates[2].media_id);
  const pending=await api(env,"/api/admin/media-admission-review?page=1&limit=1&review_state=pending",{admin:true});
  assert.equal(pending.response.status,200);
  assert.equal(pending.payload.page_size,1);
  assert.ok(pending.payload.total>=2);
  assert.ok(pending.payload.records.every(record=>record.review_state==="pending"));
  assert.equal(pending.payload.counts.pending,pending.payload.total);
  assert.ok(pending.payload.counts.deferred>=1);
  const deferred=await api(env,"/api/admin/media-admission-review?page=1&limit=24&review_state=deferred",{admin:true});
  assert.ok(deferred.payload.records.length>=1);
  assert.ok(deferred.payload.records.every(record=>record.review_state==="deferred"));
  assert.equal(deferred.payload.total,deferred.payload.counts.deferred);
});

test("Gallery-set intake preserves master provenance and connects every design graphic to several Archive nodes privately", async () => {
  const sql=database(),env=environment(sql),targets=sql.prepare("SELECT id FROM content_entities WHERE entity_type<>'media_asset' ORDER BY id LIMIT 2").all();
  assert.equal(targets.length,2);
  const insert=sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation,archive_catalogue_eligible)
    VALUES(?,?,?,?,1,'internal','active','test',datetime('now'),datetime('now'),'hidden',1)`);
  insert.run("media-intake-design-a","intake/design-a.png","sixwell-mark-a.png","image/png");
  insert.run("media-intake-design-b","intake/design-b.svg","sixwell-mark-b.svg","image/svg+xml");
  const hashes=["a".repeat(64),"b".repeat(64)];
  sql.prepare("UPDATE media_asset_provenance SET sha256=?,raw_metadata_json=? WHERE media_id=?").run(hashes[0],'{"capture":"preserved-a"}',"media-intake-design-a");
  sql.prepare("UPDATE media_asset_provenance SET sha256=?,raw_metadata_json=? WHERE media_id=?").run(hashes[1],'{"capture":"preserved-b"}',"media-intake-design-b");

  const intake=await api(env,"/api/admin/gallery-intakes",{method:"POST",admin:true,body:{
    intake_kind:"design-graphics",media_ids:["media-intake-design-a","media-intake-design-b"],title:"Identity studies",slug:"identity-studies-intake",
    summary:"Two related Six.Well design studies.",publication:"draft",creator_credit:"Six.Well",target_entity_ids:targets.map(row=>row.id),connection_public_visible:false,
  }});
  assert.equal(intake.response.status,201);
  assert.equal(intake.payload.record.state,"draft");
  assert.equal(intake.payload.record.set_type,"series");
  assert.equal(intake.payload.record.item_count,2);
  assert.deepEqual(intake.payload.connections.target_entity_ids,targets.map(row=>row.id));
  for(const [index,mediaId] of ["media-intake-design-a","media-intake-design-b"].entries()){
    const media=sql.prepare("SELECT original_filename,storage_key,privacy,public_presentation FROM media_assets WHERE id=?").get(mediaId);
    assert.equal(media.privacy,"internal");
    assert.equal(media.public_presentation,"hidden");
    assert.match(media.original_filename,/sixwell-mark/);
    assert.match(media.storage_key,/intake\/design/);
    const provenance=sql.prepare("SELECT sha256,originality,asset_role,creator_credit,raw_metadata_json FROM media_asset_provenance WHERE media_id=?").get(mediaId);
    assert.deepEqual({...provenance},{sha256:hashes[index],originality:"sixwell_original",asset_role:"creative_master",creator_credit:"Six.Well",raw_metadata_json:`{"capture":"preserved-${index?"b":"a"}"}`});
    assert.equal(sql.prepare("SELECT state FROM gallery_entries WHERE media_id=?").get(mediaId).state,"draft");
    assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entry_lenses WHERE media_id=? AND lens_id='gallery-lens-works'").get(mediaId).count,1);
    assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_media WHERE media_id=? AND role='design-graphic' AND public_visible=0").get(mediaId).count,2);
    assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_relationships relation JOIN media_catalogue_entries catalogue ON catalogue.entity_id=relation.source_entity_id WHERE catalogue.media_id=? AND relation.relationship_type_id='rel-depicts' AND relation.public_visible=0").get(mediaId).count,2);
  }
  const publicGallery=await api(env,"/api/gallery");
  assert.ok(!publicGallery.payload.records.some(record=>intake.payload.records.some(item=>item.accession===record.accession)));
});

test("Gallery-set intake maps process videos and studio photographs to their focused lenses while keeping publication explicit", async () => {
  const sql=database(),env=environment(sql),target=sql.prepare("SELECT id FROM content_entities WHERE entity_type<>'media_asset' AND visibility='public' ORDER BY id LIMIT 1").get();
  const insert=sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation,archive_catalogue_eligible)
    VALUES(?,?,?,?,1,'internal','active','test',datetime('now'),datetime('now'),'hidden',1)`);
  insert.run("media-intake-print-video","intake/print.mp4","pulling-red-ink.mp4","video/mp4");
  insert.run("media-intake-studio-photo","intake/studio.jpg","screen-rack.jpg","image/jpeg");
  const process=await api(env,"/api/admin/gallery-intakes",{method:"POST",admin:true,body:{intake_kind:"screen-print-process",media_ids:["media-intake-print-video"],title:"Pulling red ink",publication:"published",target_entity_ids:[target.id],connection_public_visible:true}});
  const studio=await api(env,"/api/admin/gallery-intakes",{method:"POST",admin:true,body:{intake_kind:"studio-photographs",media_ids:["media-intake-studio-photo"],title:"Screen rack afternoon",publication:"draft",target_entity_ids:[target.id],connection_public_visible:false}});
  assert.equal(process.response.status,201);
  assert.equal(process.payload.record.state,"published");
  assert.equal(process.payload.record.set_type,"series");
  assert.equal(studio.response.status,201);
  assert.equal(studio.payload.record.state,"draft");
  assert.equal(studio.payload.record.set_type,"session");
  assert.deepEqual({...sql.prepare("SELECT originality,asset_role FROM media_asset_provenance WHERE media_id='media-intake-print-video'").get()},{originality:"sixwell_original",asset_role:"editorial_fragment"});
  assert.deepEqual({...sql.prepare("SELECT originality,asset_role FROM media_asset_provenance WHERE media_id='media-intake-studio-photo'").get()},{originality:"sixwell_original",asset_role:"editorial_fragment"});
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entry_lenses WHERE media_id='media-intake-print-video' AND lens_id='gallery-lens-making'").get().count,1);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entry_lenses WHERE media_id='media-intake-studio-photo' AND lens_id='gallery-lens-studio'").get().count,1);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_media WHERE media_id='media-intake-print-video' AND role='process-video' AND public_visible=1").get().count,1);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_media WHERE media_id='media-intake-studio-photo' AND role='studio-photograph' AND public_visible=0").get().count,1);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_relationships relation JOIN media_catalogue_entries catalogue ON catalogue.entity_id=relation.source_entity_id WHERE catalogue.media_id='media-intake-print-video' AND relation.relationship_type_id='rel-process-of' AND relation.public_visible=1").get().count,1);
  const publicSet=await api(env,`/api/gallery/sets/${process.payload.record.slug}`);
  assert.equal(publicSet.response.status,200);
  assert.equal(publicSet.payload.records.length,1);
  assert.equal(publicSet.payload.records[0].mediaType,"video");
  const invalid=await api(env,"/api/admin/gallery-intakes",{method:"POST",admin:true,body:{intake_kind:"screen-print-process",media_ids:["media-intake-studio-photo"],title:"Wrong family",publication:"draft"}});
  assert.equal(invalid.response.status,409);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_sets WHERE title='Wrong family'").get().count,0);
});

test("Gallery-set intake maps Notes, Blackboards, WIP, Notebook scans, and Ephemera without flattening their Archive meaning", async () => {
  const sql=database(),env=environment(sql),target=sql.prepare("SELECT id FROM content_entities WHERE entity_type<>'media_asset' AND visibility='public' ORDER BY id LIMIT 1").get();
  const insert=sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation,archive_catalogue_eligible)
    VALUES(?,?,?,?,1,'internal','active','test',datetime('now'),datetime('now'),'hidden',1)`);
  const cases=[
    {kind:"notes",id:"media-intake-note",file:"archive-note.jpg",mime:"image/jpeg",role:"note",relationship:"rel-source-for",lens:"gallery-lens-making"},
    {kind:"blackboards",id:"media-intake-blackboard",file:"south-wall.jpg",mime:"image/jpeg",role:"blackboard-fragment",relationship:"rel-process-of",lens:"gallery-lens-making"},
    {kind:"work-in-progress",id:"media-intake-wip",file:"layer-in-progress.mp4",mime:"video/mp4",role:"work-in-progress",relationship:"rel-process-of",lens:"gallery-lens-making"},
    {kind:"notebook-scans",id:"media-intake-notebook",file:"notebook-pages.pdf",mime:"application/pdf",role:"notebook-scan",relationship:"rel-source-for",lens:"gallery-lens-making"},
    {kind:"ephemera",id:"media-intake-ephemera",file:"studio-card.pdf",mime:"application/pdf",role:"ephemera",relationship:"rel-documents",lens:"gallery-lens-ephemera"},
  ];
  for(const item of cases){
    insert.run(item.id,`intake/${item.file}`,item.file,item.mime);
    const response=await api(env,"/api/admin/gallery-intakes",{method:"POST",admin:true,body:{intake_kind:item.kind,media_ids:[item.id],title:`${item.kind} intake`,publication:"draft",target_entity_ids:[target.id],connection_public_visible:false}});
    assert.equal(response.response.status,201,item.kind);
    assert.equal(response.payload.record.set_type,"series",item.kind);
    assert.deepEqual({...sql.prepare("SELECT originality,asset_role FROM media_asset_provenance WHERE media_id=?").get(item.id)},{originality:"sixwell_original",asset_role:"editorial_fragment"},item.kind);
    assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entry_lenses WHERE media_id=? AND lens_id=?").get(item.id,item.lens).count,1,item.kind);
    assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_media WHERE media_id=? AND role=? AND public_visible=0").get(item.id,item.role).count,1,item.kind);
    assert.equal(sql.prepare(`SELECT COUNT(*) count FROM entity_relationships relation JOIN media_catalogue_entries catalogue ON catalogue.entity_id=relation.source_entity_id
      WHERE catalogue.media_id=? AND relation.relationship_type_id=? AND relation.public_visible=0`).get(item.id,item.relationship).count,1,item.kind);
  }
  insert.run("media-intake-blackboard-pdf","intake/board.pdf","board.pdf","application/pdf");
  const invalid=await api(env,"/api/admin/gallery-intakes",{method:"POST",admin:true,body:{intake_kind:"blackboards",media_ids:["media-intake-blackboard-pdf"],title:"Blackboard PDF mismatch",publication:"draft"}});
  assert.equal(invalid.response.status,409);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_sets WHERE title='Blackboard PDF mismatch'").get().count,0);
});

test("checksum preflight and resumable creation reuse an existing Media Asset before uploading bytes", async () => {
  const sql = database(), env = environment(sql, new NoMultipartBucket());
  const existing = sql.prepare("SELECT media_id,sha256 FROM media_catalogue_entries WHERE sha256 IS NOT NULL ORDER BY catalogue_id LIMIT 1").get();
  const preflight = await api(env, "/api/admin/media-catalogue/preflight", { method: "POST", admin: true, body: { sha256: existing.sha256 } });
  assert.equal(preflight.response.status, 200);
  assert.equal(preflight.payload.duplicate, true);
  assert.equal(preflight.payload.record.id, existing.media_id);

  const resumable = await api(env, "/api/admin/media/uploads", { method: "POST", admin: true, body: {
    uploadKind: "video", filename: "duplicate.mp4", mimeType: "video/mp4", byteSize: 32, sha256: existing.sha256,
    privacy: "internal", publicPresentation: "hidden", sourceClass: "creative",
  } });
  assert.equal(resumable.response.status, 200);
  assert.equal(resumable.payload.deduplicated, true);
  assert.equal(resumable.payload.record.id, existing.media_id);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_upload_sessions").get().count, 0);
});

test("durable creator handoffs cover every creatable type and complete media plus semantic links atomically", async () => {
  const sql = database(), env = environment(sql);
  const media = sql.prepare("SELECT media_id FROM media_catalogue_entries ORDER BY catalogue_id LIMIT 1").get().media_id;
  const target = sql.prepare("SELECT id FROM content_entities WHERE entity_type<>'media_asset' ORDER BY id LIMIT 1").get();
  const creatorTypes = ["cultural-object","art","merch","tattoo-design","flash","event","legend-symbol","person","place","organization","note","failed-experiment","blackboard","origin-thread","collection","timeline"];
  for (const creator_type of creatorTypes) {
    const created = await api(env, `/api/admin/media-catalogue/${media}/handoffs`, { method: "POST", admin: true, body: { creator_type } });
    assert.equal(created.response.status, 201, creator_type);
    const handoffId = created.payload.handoff.id;
    const restored = await api(env, `/api/admin/media-handoffs/${handoffId}`, { admin: true });
    assert.equal(restored.payload.handoff.creator_type, creator_type);
    const completed = await api(env, `/api/admin/media-handoffs/${handoffId}/complete`, { method: "POST", admin: true, body: { target_entity_id: target.id } });
    assert.equal(completed.response.status, 200, creator_type);
    assert.equal(sql.prepare("SELECT state FROM media_creator_handoffs WHERE id=?").get(handoffId).state, "completed");
  }
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_creator_handoffs WHERE state='completed'").get().count, creatorTypes.length);
  assert.ok(sql.prepare("SELECT COUNT(*) count FROM entity_media WHERE entity_id=? AND media_id=?").get(target.id, media).count >= 1);
  assert.ok(sql.prepare("SELECT COUNT(*) count FROM entity_relationships relation JOIN media_catalogue_entries catalogue ON catalogue.entity_id=relation.source_entity_id WHERE catalogue.media_id=? AND relation.target_entity_id=?").get(media, target.id).count >= 1);

  const invalid = await api(env, `/api/admin/media-catalogue/${media}/handoffs`, { method: "POST", admin: true, body: { creator_type: "dossier" } });
  assert.equal(invalid.response.status, 400);
});

test("published Gallery entries support optional lenses, several sets, public-safe connections, ranges, and reversible hiding", async () => {
  const sql = database(), bucket = new MemoryBucket(), env = environment(sql, bucket);
  const row = sql.prepare(`SELECT catalogue.media_id,catalogue.catalogue_id,catalogue.entity_id,media.storage_key
    FROM media_catalogue_entries catalogue JOIN media_assets media ON media.id=catalogue.media_id
    WHERE catalogue.source_class='creative' ORDER BY catalogue.catalogue_id LIMIT 1`).get();
  const bytes = new TextEncoder().encode("0123456789");
  const storageKey = row.storage_key || `gallery-test/${row.media_id}`;
  await bucket.put(storageKey, bytes);
  sql.prepare("UPDATE media_assets SET source_url='',storage_key=?,privacy='public',public_presentation='inline',state='active',mime_type='image/png',alt_text='A test image' WHERE id=?").run(storageKey, row.media_id);

  const setOne = await api(env, "/api/admin/gallery-sets", { method: "POST", admin: true, body: { title: "Peer Amid Editorial Test", slug: "peer-amid-editorial-test", set_type: "series" } });
  const setTwo = await api(env, "/api/admin/gallery-sets", { method: "POST", admin: true, body: { title: "Studio Session", slug: "studio-session", set_type: "session" } });
  assert.equal(setOne.response.status, 201);
  assert.equal(setTwo.response.status, 201);
  const changedSlug = await api(env, `/api/admin/gallery-sets/${setOne.payload.record.id}`, { method: "PATCH", admin: true, body: { slug: "changed-route" } });
  assert.equal(changedSlug.response.status, 409);
  assert.equal(sql.prepare("SELECT slug FROM gallery_sets WHERE id=?").get(setOne.payload.record.id).slug, "peer-amid-editorial-test");
  const lenses = (await api(env, "/api/admin/gallery-lenses", { admin: true })).payload.records;
  assert.equal(lenses.length, 4);

  const saved = await api(env, `/api/admin/gallery/${encodeURIComponent(row.media_id)}`, {
    method: "PATCH", admin: true, body: {
      title: "Peer Amid — black silhouette",
      accessibility_text: "",
      accessibility_status: "unreviewed",
      credit: "SIX.WELL",
      rights_status: "unreviewed",
      date_precision: "undated",
      lens_ids: [],
      set_ids: [setOne.payload.record.id, setTwo.payload.record.id],
    },
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.record.lenses.length, 0);
  assert.equal(saved.payload.record.sets.length, 2);

  const target = sql.prepare("SELECT id FROM content_entities WHERE visibility='public' AND id<>? ORDER BY id LIMIT 1").get(row.entity_id);
  const linked = await api(env, `/api/admin/media-catalogue/${encodeURIComponent(row.media_id)}/link`, {
    method: "POST", admin: true, body: { target_entity_id: target.id, relationship_type_id: "rel-depicts", role: "documentation", public_visible: true },
  });
  assert.equal(linked.response.status, 201);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_media WHERE media_id=? AND entity_id=? AND role='documentation'").get(row.media_id, target.id).count, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_relationships WHERE source_entity_id=? AND target_entity_id=? AND relationship_type_id='rel-depicts'").get(row.entity_id, target.id).count, 1);

  const published = await api(env, `/api/admin/gallery/${encodeURIComponent(row.media_id)}/publish`, { method: "POST", admin: true });
  assert.equal(published.response.status, 200);
  const publishedSet = await api(env, `/api/admin/gallery-sets/${setOne.payload.record.id}`, { method: "PATCH", admin: true, body: { state: "published", cover_media_id: row.media_id } });
  assert.equal(publishedSet.response.status, 200);
  const index = await api(env, "/api/gallery");
  assert.equal(index.response.status, 200);
  const publicRecord = index.payload.records.find((record) => record.accession === `MED-${String(row.catalogue_id).padStart(6, "0")}`);
  assert.ok(publicRecord);
  assert.equal(Object.hasOwn(publicRecord, "sha256"), false);
  assert.equal(Object.hasOwn(publicRecord, "raw_metadata"), false);
  assert.ok(publicRecord.sets.some((set)=>set.slug==="peer-amid-editorial-test"));
  const publicSet = await api(env, "/api/gallery/sets/peer-amid-editorial-test");
  assert.equal(publicSet.response.status, 200);
  assert.equal(publicSet.payload.set.cover.accession, publicRecord.accession);

  const range = await handleConstructApi(request(`/api/gallery/media/${publicRecord.accession}`, { headers: { range: "bytes=2-5" } }), env);
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await range.text(), "2345");

  const hidden = await api(env, `/api/admin/gallery/${encodeURIComponent(row.media_id)}/hide`, { method: "POST", admin: true });
  assert.equal(hidden.response.status, 200);
  assert.equal((await api(env, `/api/gallery/items/${publicRecord.accession}`)).response.status, 404);
  assert.ok(sql.prepare("SELECT id FROM media_assets WHERE id=?").get(row.media_id));
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_set_items WHERE media_id=?").get(row.media_id).count, 2);
  assert.ok(sql.prepare("SELECT COUNT(*) count FROM entity_relationships WHERE source_entity_id=? AND target_entity_id=?").get(row.entity_id,target.id).count >= 1);
});

test("rights, accessibility, and timed-media transcripts are optional while document delivery remains public-safe", async () => {
  const sql = database(), bucket = new MemoryBucket(), env = environment(sql, bucket);
  await bucket.put("gallery-test/audio.wav", new TextEncoder().encode("audio"));
  sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation,transcript_status)
    VALUES('media-gallery-audio','gallery-test/audio.wav','process.wav','audio/wav',5,'public','active','test',datetime('now'),datetime('now'),'inline','not-requested')`).run();
  admitFixture(sql,"media-gallery-audio",{title:"Screen-printing ambience",state:"draft"});
  const publishedAudio = await api(env, "/api/admin/gallery/media-gallery-audio/publish", { method: "POST", admin: true });
  assert.equal(publishedAudio.response.status, 200);
  const audioAccession = `MED-${String(sql.prepare("SELECT catalogue_id FROM media_catalogue_entries WHERE media_id='media-gallery-audio'").get().catalogue_id).padStart(6,"0")}`;
  const audioPublic = await api(env, `/api/gallery/items/${audioAccession}`);
  assert.equal(audioPublic.payload.record.transcript, "");

  await bucket.put("gallery-test/process-notes.docx", new TextEncoder().encode("document"));
  sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-gallery-document','gallery-test/process-notes.docx','process-notes.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',8,'public','active','test',datetime('now'),datetime('now'),'inline')`).run();
  admitFixture(sql,"media-gallery-document",{title:"Process notes"});
  const documentAccession = `MED-${String(sql.prepare("SELECT catalogue_id FROM media_catalogue_entries WHERE media_id='media-gallery-document'").get().catalogue_id).padStart(6,"0")}`;
  const documentResponse = await handleConstructApi(request(`/api/gallery/media/${documentAccession}`), env);
  assert.equal(documentResponse.status, 200);
  assert.match(documentResponse.headers.get("content-disposition") || "", /^attachment;/);
});

test("repository scanner emits deterministic provenance and a private-master R2 manifest", () => {
  const scanner = join(ROOT,"tools","media-catalogue-backfill.mjs");
  const inventory = JSON.parse(execFileSync(process.execPath,[scanner,"--json"],{cwd:ROOT,encoding:"utf8"}));
  assert.equal(inventory.root,".");
  assert.equal(inventory.mode,"dry-run-first");
  const peers = inventory.records.filter((record)=>record.relative.startsWith("assets/gallery/peer-amid/"));
  const expectedHashes = [
    "f063b9839fe6cfbc1908edbaa907971849ddf950bbd38ac1adec7c59f24dbde8",
    "291c661aadc94bd6c55a70db5926c82faad94394b98e21c6f7be268e0f84280d",
  ];
  const privateSourcesPresent = [
    join(ROOT,"assets","gallery","peer-amid","avery peer amid black.png"),
    join(ROOT,"assets","gallery","peer-amid","avery peer amid tan no huh.png"),
  ].every(existsSync);
  assert.equal(peers.length,privateSourcesPresent?2:0);
  if(privateSourcesPresent){
    assert.deepEqual(peers.map((record)=>record.sha256),expectedHashes);
    assert.ok(peers.every((record)=>record.sourceUrl===""&&record.storageKey.startsWith("gallery/masters/peer-amid/")));
  }
  const manifest = JSON.parse(execFileSync(process.execPath,[scanner,"--r2-manifest"],{cwd:ROOT,encoding:"utf8"}));
  assert.equal(manifest.bucketBinding,"SUBMISSION_FILES");
  assert.equal(manifest.count,privateSourcesPresent?2:0);
  assert.ok(manifest.privateMasters.every((record)=>record.storageKey.includes(record.sha256)));
  const migration = readFileSync(join(ROOT,"migrations","0203_repository_media_catalogue_backfill.sql"),"utf8");
  for(const hash of expectedHashes){
    assert.match(migration,new RegExp(`gallery/masters/peer-amid/${hash}\\.png`));
    assert.match(migration,new RegExp(`sha256='${hash}'`));
  }
  const rippleReferences=inventory.records.filter((record)=>/^assets\/entry-room\/ring-ripple-reference\.(?:mov|mp4)$/i.test(record.relative));
  const rippleSourcesPresent=[join(ROOT,"assets","entry-room","ring-ripple-reference.mov"),join(ROOT,"assets","entry-room","ring-ripple-reference.mp4")].every(existsSync);
  assert.equal(rippleReferences.length,rippleSourcesPresent?2:0);
  assert.ok(rippleReferences.every((record)=>record.archiveCatalogueEligible===false));
  assert.ok(rippleReferences.every((record)=>record.registryAction==="skip"));
  assert.ok(inventory.records.filter((record)=>record.relative.startsWith("assets/events/")).every((record)=>record.registryAction==="skip"));
  assert.ok(inventory.records.filter((record)=>/mask/i.test(record.filename)).every((record)=>record.registryAction==="skip"));
  assert.equal(inventory.records.some((record)=>record.relative.startsWith(".cloudflare-backups/")),false);
  assert.equal(inventory.records.some((record)=>record.relative.startsWith(".playwright-cli/")),false);
  const generated=execFileSync(process.execPath,[scanner],{cwd:ROOT,encoding:"utf8",maxBuffer:4*1024*1024});
  assert.doesNotMatch(generated,/INSERT(?: OR IGNORE)? INTO gallery_entries/);
  assert.doesNotMatch(generated,/INSERT(?: OR IGNORE)? INTO media_catalogue_entries/);
  const first=database(),before=first.prepare("SELECT COUNT(*) count FROM gallery_entries").get().count;
  first.exec(generated);first.exec(generated);
  assert.equal(first.prepare("SELECT COUNT(*) count FROM gallery_entries").get().count,before);
});

test("Gallery surfaces preserve the shared shell and expose the complete relational workflow", () => {
  const page = readFileSync(join(ROOT, "gallery", "index.html"), "utf8");
  const publicScript = readFileSync(join(ROOT, "js", "gallery.js"), "utf8");
  const publicStyles = readFileSync(join(ROOT, "css", "gallery.css"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "media-catalogue-manager.js"), "utf8");
  const studioStyles = readFileSync(join(ROOT, "studio", "media-catalogue-manager.css"), "utf8");
  const studioShell = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
  const studioManager = readFileSync(join(ROOT, "studio", "construct-manager.js"), "utf8");
  const navigation = readFileSync(join(ROOT, "js", "construct-nav.js"), "utf8");
  const blackboardStudio = readFileSync(join(ROOT,"studio","archive-blackboards-manager.js"),"utf8");
  const calendarApi = readFileSync(join(ROOT,"functions","api","calendar","_lib.js"),"utf8");
  const calendarSubmissionsApi = readFileSync(join(ROOT,"functions","api","calendar-submissions","_lib.js"),"utf8");

  assert.match(publicScript, /hero-descriptor/);
  assert.match(page, /construct-nav\.js/);
  assert.match(publicStyles, /border:\s*5px solid/);
  assert.match(publicStyles, /gap:\s*16px/);
  assert.match(publicStyles, /prefers-reduced-motion/);
  assert.match(publicScript, /Connected node/);
  assert.match(publicScript, /name="node"/);
  assert.match(publicScript, /name="lens"/);
  assert.match(publicScript, /name="set"/);
  assert.match(studio, /data-set-edit-form/);
  assert.match(studio, /Connected record/);
  assert.match(studio, /class SHA256/);
  assert.match(studio, /media-catalogue\/preflight/);
  assert.match(studio, /XMLHttpRequest/);
  assert.match(studio, /StudioResumableMedia\.upload/);
  assert.match(studio, /IntersectionObserver/);
  assert.match(studio, /rootMargin:"600px 0px"/);
  assert.doesNotMatch(studio, /mountMediaCatalogueLegacy|simplifiedGalleryNote/);
  assert.match(studio, /createHeicEditProxy/);
  assert.match(studio, /isHeicUpload/);
  assert.match(studio, /activate_derivative/);
  assert.match(studio, /AbortController/);
  assert.match(studio, /data-draft-preview/);
  assert.match(studio, /data-gallery-select-all/);
  assert.match(studio, /data-gallery-publish-selected/);
  assert.match(studio, /data-gallery-set-selected-form/);
  assert.match(studio, /pageSize:24/);
  assert.match(studio, /data-primary-card/);
  assert.match(studio, /mcm-card\$\{view==="media"\?" mcm-card--asset":""\}/);
  assert.match(studio, /mcm-grid\$\{view==="media"\?" mcm-grid--assets":""\}/);
  assert.match(studio, /data-open-upload/);
  assert.match(studio, /data-open-uploads/);
  assert.match(studio, /data-upload-dropzone/);
  assert.match(studio, /data-upload-file-input/);
  assert.match(studio, /dataTransfer\?\.files/);
  assert.match(studio, /addEventListener\("dragover"/);
  assert.match(studio, /addEventListener\("drop"/);
  assert.match(studio, /pendingUploadFiles/);
  assert.match(studio, /unsupported file/);
  assert.match(studio, /data-detail-workspace/);
  assert.match(studio, /Back to \$\{view==="gallery"\?"Gallery entries":"Media Library"\}/);
  assert.match(studio, /restoreBrowseScroll/);
  assert.match(studio, /preserveDetailForms/);
  assert.match(studio, /data-open-intake/);
  assert.match(studio, /data-gallery-intake-form/);
  assert.match(studio, /design-graphics/);
  assert.match(studio, /screen-print-process/);
  assert.match(studio, /studio-photographs/);
  assert.match(studio, /notes/);
  assert.match(studio, /blackboards/);
  assert.match(studio, /work-in-progress/);
  assert.match(studio, /notebook-scans/);
  assert.match(studio, /ephemera/);
  assert.match(studio, /target_entity_ids/);
  assert.match(studio, /connection_public_visible/);
  assert.match(studio, /\/api\/admin\/gallery-intakes/);
  assert.match(studio, /data-select-mode/);
  assert.match(studio, /Admission Review/);
  assert.match(studio, /Deferred/);
  assert.match(studio, /if\(!state\.selecting\)return`<div class="mcm-reviewbar">/);
  assert.match(studio, /Identity/);
  assert.match(studio, /Provenance/);
  assert.match(studio, /Connections/);
  assert.match(studio, /Presentation/);
  assert.match(studio, /Organization/);
  assert.match(studio, /Display/);
  assert.match(studio, /Site asset · not part of Public Gallery/);
  assert.match(studio, /\/api\/admin\/gallery\/batch/);
  assert.match(studio, /display_media_id/);
  assert.match(studio, /poster_media_id/);
  assert.match(studio, /Open Archive Record/);
  assert.match(studio, /media-handoffs/);
  assert.doesNotMatch(studio, /crypto\.subtle\.digest\('SHA-256',b\)/);
  assert.match(studioShell, /\["gallery","Public Gallery"\]/);
  assert.match(studioShell, /construct-manager\.js\?v=20260904-media-drag-drop/);
  assert.match(studioShell, /media-catalogue-manager\.css\?v=20260904-media-drag-drop/);
  assert.match(studioManager, /media-catalogue-manager\.js\?v=20260904-media-drag-drop/);
  assert.match(studioStyles,/\.mcm-grid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(190px,1fr\)\)/);
  assert.match(studioStyles,/\.mcm-grid--assets\{grid-template-columns:repeat\(auto-fill,minmax\(132px,1fr\)\);gap:10px\}/);
  assert.match(studioStyles,/\.mcm-card--asset \.mcm-preview\{[^}]*aspect-ratio:1\/1/);
  assert.match(studioStyles,/\.mcm-detail-workspace\{display:grid/);
  assert.match(studioStyles,/\.mcm-drop-zone\{[^}]*border:5px dashed/);
  assert.match(studioStyles,/\.mcm-drop-zone\.is-dragging\{[^}]*border-color:var\(--color-archive-bright/);
  assert.match(studioStyles,/@media\(max-width:420px\)[^{]*\{[^}]*\.mcm-grid\{grid-template-columns:1fr\}\.mcm-grid--assets\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(studioStyles,/\.mcm-overlay\{position:fixed/);
  assert.match(studioStyles,/\.mcm-intake-form fieldset[^}]*border:5px/);
  assert.match(studioStyles,/\.mcm-inspector-actions\{position:sticky/);
  assert.match(studioStyles,/@media\(max-width:900px\)[^{]*\{[\s\S]{0,180}\.mcm-modal\{width:100%/);
  assert.match(studioStyles,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(navigation, /utilityLinks/);
  assert.match(navigation, /mountManagedFooterLinks\(utilityLinks\)/);
  assert.match(navigation, /data-construct-footer-link/);
  assert.doesNotMatch(navigation, /className = 'construct-utility-links'/);
  assert.doesNotMatch(navigation, /node-gallery/);
  assert.match(blackboardStudio,/archiveCatalogueEligible:false/);
  assert.match(calendarApi,/archive_catalogue_eligible\)\s*\n?\s*VALUES[\s\S]{0,180}'calendar-scout'/);
  assert.match(calendarSubmissionsApi,/archive_catalogue_eligible\)\s*\n?\s*VALUES[\s\S]{0,180}'calendar-public-submission'/);
});
