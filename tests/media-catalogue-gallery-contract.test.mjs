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

test("catalogue backfill is complete, launch-published, unique, and relational", () => {
  const sql = database();
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_assets WHERE archive_catalogue_eligible=1").get().count, sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries").get().count);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE state='published'").get().count, sql.prepare("SELECT COUNT(*) count FROM media_assets WHERE state='active' AND archive_catalogue_eligible=1").get().count);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE state='draft'").get().count, 0);
  assert.ok(sql.prepare("SELECT COUNT(*) count FROM media_assets WHERE archive_catalogue_eligible=0").get().count>0);
  assert.equal(sql.prepare(`SELECT COUNT(*) count FROM media_catalogue_entries catalogue
    JOIN gallery_entries gallery ON gallery.media_id=catalogue.media_id
    WHERE catalogue.source_class='site_asset' AND gallery.state='published'`).get().count,sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE source_class='site_asset'").get().count);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries catalogue JOIN media_assets media ON media.id=catalogue.media_id WHERE media.archive_catalogue_eligible=0").get().count,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entries gallery JOIN media_assets media ON media.id=gallery.media_id WHERE media.archive_catalogue_eligible=0").get().count,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries catalogue JOIN media_assets media ON media.id=catalogue.media_id WHERE lower(media.original_filename) IN ('ring-ripple-reference.mov','ring-ripple-reference.mp4') OR lower(replace(media.source_url,'\\','/')) LIKE '/assets/events/%'").get().count,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragment_edits edit JOIN media_catalogue_entries catalogue ON catalogue.media_id=edit.alpha_mask_media_id").get().count,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_blackboard_fragment_placements placement JOIN media_catalogue_entries catalogue ON catalogue.media_id=placement.hotspot_mask_media_id").get().count,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM (SELECT catalogue_id FROM media_catalogue_entries GROUP BY catalogue_id HAVING COUNT(*)>1)").get().count, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM (SELECT sha256 FROM media_catalogue_entries WHERE sha256 IS NOT NULL GROUP BY sha256 HAVING COUNT(*)>1)").get().count, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM pragma_foreign_key_check").get().count, 0);
  const peerAmid = sql.prepare(`SELECT printf('MED-%06d',catalogue.catalogue_id) accession,catalogue.entity_id,catalogue.sha256,catalogue.import_source,
    catalogue.editing_software,catalogue.raw_metadata_json,media.storage_key,media.width,media.height,media.privacy,media.public_presentation,gallery.state gallery_state
    FROM media_catalogue_entries catalogue
    JOIN media_assets media ON media.id=catalogue.media_id
    JOIN gallery_entries gallery ON gallery.media_id=media.id
    WHERE media.storage_key LIKE 'gallery/masters/peer-amid/%'
    ORDER BY catalogue.catalogue_id`).all();
  assert.equal(peerAmid.length, 2);
  assert.deepEqual(peerAmid.map((row) => row.sha256), [
    "f063b9839fe6cfbc1908edbaa907971849ddf950bbd38ac1adec7c59f24dbde8",
    "291c661aadc94bd6c55a70db5926c82faad94394b98e21c6f7be268e0f84280d",
  ]);
  for (const row of peerAmid) {
    assert.match(row.accession, /^MED-\d{6}$/);
    assert.equal(row.import_source, "user-provided-original");
    assert.match(row.editing_software, /Adobe XMP Core 5\.6/);
    assert.equal(row.width, 5472);
    assert.equal(row.height, 3648);
    assert.equal(row.privacy, "public");
    assert.equal(row.public_presentation, "inline");
    assert.equal(row.gallery_state, "published");
    assert.match(row.storage_key, /^gallery\/masters\/peer-amid\/[a-f0-9]{64}\.png$/);
    const evidence = JSON.parse(row.raw_metadata_json);
    assert.match(evidence.originalSourcePath, /^E:\\From HP All-In-One/);
    assert.equal(evidence.metadataEvidence.embeddedArtworkDatePresent, false);
    assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id=?").get(row.entity_id).count, 0);
  }
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_set_items WHERE set_id='gallery-set-peer-amid-versions'").get().count, 2);
  assert.equal(sql.prepare("SELECT state FROM gallery_sets WHERE id='gallery-set-peer-amid-versions'").get().state, "draft");
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_relationships WHERE id='relationship-peer-amid-black-tan-alternate' AND relationship_type_id='rel-alternate-of' AND public_visible=0").get().count, 1);
  sql.prepare(`INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-trigger-check','','test/trigger-check.png','trigger-check.png','image/png',1,'internal','active','test',datetime('now'),datetime('now'),'hidden')`).run();
  const created = sql.prepare("SELECT catalogue_id,entity_id FROM media_catalogue_entries WHERE media_id='media-trigger-check'").get();
  assert.ok(created.catalogue_id > 0);
  assert.equal(sql.prepare("SELECT entity_type FROM content_entities WHERE id=?").get(created.entity_id).entity_type, "media_asset");
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_dossiers WHERE entity_id=?").get(created.entity_id).count, 0);
});

test("operational media never receives or retains an Archive catalogue identity", () => {
  const sql=database();
  sql.prepare(`INSERT INTO media_assets(id,source_url,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation,archive_catalogue_eligible)
    VALUES('media-private-reference','/assets/private/reference.png','reference.png','image/png',1,'internal','active','test',datetime('now'),datetime('now'),'hidden',0)`).run();
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE media_id='media-private-reference'").get().count,0);

  sql.prepare(`INSERT INTO media_assets(id,source_url,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-calendar-bound','/assets/test/calendar-bound.png','calendar-bound.png','image/png',1,'public','active','test',datetime('now'),datetime('now'),'inline')`).run();
  sql.prepare(`INSERT INTO gallery_entries(media_id,display_media_id,title,date_precision,state,created_by,updated_by,created_at,updated_at)
    VALUES('media-calendar-bound','media-calendar-bound','Calendar-bound test','undated','published','test','test',datetime('now'),datetime('now'))`).run();
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE media_id='media-calendar-bound'").get().count,1);
  const candidate=sql.prepare("SELECT id FROM calendar_candidates ORDER BY id LIMIT 1").get();
  assert.ok(candidate);
  sql.prepare("UPDATE calendar_candidates SET flyer_media_id=? WHERE id=?").run("media-calendar-bound",candidate.id);
  assert.equal(sql.prepare("SELECT archive_catalogue_eligible FROM media_assets WHERE id='media-calendar-bound'").get().archive_catalogue_eligible,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE media_id='media-calendar-bound'").get().count,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE media_id='media-calendar-bound'").get().count,0);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM content_entities WHERE id='media-catalogue-media-calendar-bound'").get().count,0);
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
  const entries = sql.prepare("SELECT media_id,display_media_id FROM gallery_entries ORDER BY media_id LIMIT 2").all();
  assert.equal(entries.length,2);
  for (const entry of entries) {
    sql.prepare("UPDATE gallery_entries SET state='draft',date_precision='unreviewed',accessibility_text='',accessibility_status='unreviewed',rights_status='unreviewed' WHERE media_id=?").run(entry.media_id);
    sql.prepare("UPDATE media_assets SET privacy='internal',public_presentation='hidden' WHERE id=?").run(entry.display_media_id);
  }
  const result = await api(env,"/api/admin/gallery/batch",{ method:"POST",admin:true,body:{ action:"publish",media_ids:entries.map(entry=>entry.media_id) } });
  assert.equal(result.response.status,200);
  assert.equal(result.payload.count,2);
  assert.deepEqual(result.payload.failed,[]);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE media_id IN (?,?) AND state='published' AND date_precision='undated'").get(...entries.map(entry=>entry.media_id)).count,2);
});

test("public and Studio Gallery hydration returns catalogues larger than one SQL parameter batch", async () => {
  const sql=database(),env=environment(sql);
  const insertMedia=sql.prepare(`INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES(?,?,?,?, 'image/png',1,'public','active','test',datetime('now'),datetime('now'),'inline')`);
  const insertGallery=sql.prepare(`INSERT INTO gallery_entries(media_id,display_media_id,title,date_precision,state,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,?,'undated','published','test','test',datetime('now'),datetime('now'))`);
  for(let index=0;index<120;index+=1){const mediaId=`media-large-gallery-${index}`,filename=`large-gallery-${index}.png`;insertMedia.run(mediaId,`/assets/test/${filename}`,"",filename);insertGallery.run(mediaId,mediaId,`Large Gallery ${index}`)}
  const expected=sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE state='published'").get().count;
  assert.ok(expected>100);
  const publicIndex=await api(env,"/api/gallery");
  assert.equal(publicIndex.response.status,200);
  assert.equal(publicIndex.payload.records.length,expected);
  const studioIndex=await api(env,"/api/admin/gallery",{admin:true});
  assert.equal(studioIndex.response.status,200);
  assert.equal(studioIndex.payload.records.length,expected);
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
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_relationships WHERE source_entity_id=? AND target_entity_id=?").get(row.entity_id, target.id).count, 1);

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
  assert.equal(publicRecord.sets.length, 1, "only the published set is exposed");
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
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM entity_relationships WHERE source_entity_id=?").get(row.entity_id).count, 1);
});

test("rights, accessibility, and timed-media transcripts are optional while document delivery remains public-safe", async () => {
  const sql = database(), bucket = new MemoryBucket(), env = environment(sql, bucket);
  await bucket.put("gallery-test/audio.wav", new TextEncoder().encode("audio"));
  sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation,transcript_status)
    VALUES('media-gallery-audio','gallery-test/audio.wav','process.wav','audio/wav',5,'public','active','test',datetime('now'),datetime('now'),'inline','not-requested')`).run();
  sql.prepare(`INSERT INTO gallery_entries(media_id,display_media_id,title,accessibility_text,accessibility_status,credit,rights_status,date_precision,state,created_by,updated_by,created_at,updated_at)
    VALUES('media-gallery-audio','media-gallery-audio','Screen-printing ambience','','unreviewed','SIX.WELL','unreviewed','undated','draft','test','test',datetime('now'),datetime('now'))`).run();
  const publishedAudio = await api(env, "/api/admin/gallery/media-gallery-audio/publish", { method: "POST", admin: true });
  assert.equal(publishedAudio.response.status, 200);
  const audioAccession = `MED-${String(sql.prepare("SELECT catalogue_id FROM media_catalogue_entries WHERE media_id='media-gallery-audio'").get().catalogue_id).padStart(6,"0")}`;
  const audioPublic = await api(env, `/api/gallery/items/${audioAccession}`);
  assert.equal(audioPublic.payload.record.transcript, "");

  await bucket.put("gallery-test/process-notes.docx", new TextEncoder().encode("document"));
  sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES('media-gallery-document','gallery-test/process-notes.docx','process-notes.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',8,'public','active','test',datetime('now'),datetime('now'),'inline')`).run();
  sql.prepare(`INSERT INTO gallery_entries(media_id,display_media_id,title,accessibility_text,accessibility_status,credit,rights_status,date_precision,state,created_by,updated_by,created_at,updated_at)
    VALUES('media-gallery-document','media-gallery-document','Process notes','A downloadable document containing studio process notes.','described','SIX.WELL','owned','undated','published','test','test',datetime('now'),datetime('now'))`).run();
  const documentAccession = `MED-${String(sql.prepare("SELECT catalogue_id FROM media_catalogue_entries WHERE media_id='media-gallery-document'").get().catalogue_id).padStart(6,"0")}`;
  const documentResponse = await handleConstructApi(request(`/api/gallery/media/${documentAccession}`), env);
  assert.equal(documentResponse.status, 200);
  assert.match(documentResponse.headers.get("content-disposition") || "", /^attachment;/);
});

test("repository scanner emits deterministic provenance and a private-master R2 manifest", () => {
  const scanner = join(ROOT,"tools","media-catalogue-backfill.mjs");
  const inventory = JSON.parse(execFileSync(process.execPath,[scanner,"--json"],{cwd:ROOT,encoding:"utf8"}));
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
  assert.ok(inventory.records.filter((record)=>record.relative.startsWith("assets/events/")).every((record)=>record.archiveCatalogueEligible===false));
});

test("Gallery surfaces preserve the shared shell and expose the complete relational workflow", () => {
  const page = readFileSync(join(ROOT, "gallery", "index.html"), "utf8");
  const publicScript = readFileSync(join(ROOT, "js", "gallery.js"), "utf8");
  const publicStyles = readFileSync(join(ROOT, "css", "gallery.css"), "utf8");
  const studio = readFileSync(join(ROOT, "studio", "media-catalogue-manager.js"), "utf8");
  const studioShell = readFileSync(join(ROOT, "studio", "submissions", "index.html"), "utf8");
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
  assert.match(studio, /AbortController/);
  assert.match(studio, /data-draft-preview/);
  assert.match(studio, /data-gallery-select-all/);
  assert.match(studio, /data-gallery-publish-selected/);
  assert.match(studio, /\/api\/admin\/gallery\/batch/);
  assert.match(studio, /display_media_id/);
  assert.match(studio, /poster_media_id/);
  assert.match(studio, /Open Archive Record/);
  assert.match(studio, /media-handoffs/);
  assert.doesNotMatch(studio, /crypto\.subtle\.digest\('SHA-256',b\)/);
  assert.match(studioShell, /\["gallery","Public Gallery"\]/);
  assert.match(navigation, /utilityLinks/);
  assert.doesNotMatch(navigation, /node-gallery/);
  assert.match(blackboardStudio,/archiveCatalogueEligible:false/);
  assert.match(calendarApi,/archive_catalogue_eligible\)\s*\n?\s*VALUES[\s\S]{0,180}'calendar-scout'/);
  assert.match(calendarSubmissionsApi,/archive_catalogue_eligible\)\s*\n?\s*VALUES[\s\S]{0,180}'calendar-public-submission'/);
});
