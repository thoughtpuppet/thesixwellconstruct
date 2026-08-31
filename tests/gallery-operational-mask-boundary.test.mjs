import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));

function database(){
  const sql=new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for(const name of readdirSync(join(ROOT,"migrations")).filter(value=>value.endsWith(".sql")).sort())sql.exec(readFileSync(join(ROOT,"migrations",name),"utf8"));
  return sql;
}

test("orphaned interaction and alpha masks never acquire Archive catalogue identities",()=>{
  const sql=database();
  const insert=sql.prepare(`INSERT INTO media_assets(id,storage_key,original_filename,mime_type,byte_size,alt_text,privacy,state,created_by,created_at,updated_at,public_presentation)
    VALUES(?,?,?,?,1,?,'internal','active','test',datetime('now'),datetime('now'),'hidden')`);

  insert.run("media-orphan-hotspot","construct/test/fragment-hotspot-test.png","fragment-hotspot-test.png","image/png","Interaction mask for test fragment");
  insert.run("media-orphan-alpha","construct/test/generated.png","generated.png","image/png","Alpha mask for test fragment");

  for(const mediaId of ["media-orphan-hotspot","media-orphan-alpha"]){
    assert.equal(sql.prepare("SELECT archive_catalogue_eligible FROM media_assets WHERE id=?").get(mediaId).archive_catalogue_eligible,0);
    assert.equal(sql.prepare("SELECT COUNT(*) count FROM media_catalogue_entries WHERE media_id=?").get(mediaId).count,0);
    assert.equal(sql.prepare("SELECT COUNT(*) count FROM gallery_entries WHERE media_id=?").get(mediaId).count,0);
  }
});
