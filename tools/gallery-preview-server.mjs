import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";

import worker from "../_worker.js";

const ROOT = normalize(join(import.meta.dirname, ".."));
const PORT = Number(process.argv[2] || process.env.PORT || 4188);
const TOKEN = "gallery-qa-token";

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.database.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes || 0) } }; }
}
class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new Statement(this.database, sql); }
  async batch(statements) { this.database.exec("BEGIN"); try { const output=[]; for(const statement of statements) output.push(await statement.run()); this.database.exec("COMMIT"); return output; } catch(error) { this.database.exec("ROLLBACK"); throw error; } }
}
class LocalBucket {
  constructor() {
    this.objects = new Map([
      ["gallery/masters/peer-amid/f063b9839fe6cfbc1908edbaa907971849ddf950bbd38ac1adec7c59f24dbde8.png",new Uint8Array(readFileSync(join(ROOT,"assets","gallery","peer-amid","avery peer amid black.png")))],
      ["gallery/masters/peer-amid/291c661aadc94bd6c55a70db5926c82faad94394b98e21c6f7be268e0f84280d.png",new Uint8Array(readFileSync(join(ROOT,"assets","gallery","peer-amid","avery peer amid tan no huh.png")))],
    ]);
  }
  async put(key,value) { this.objects.set(key,value instanceof Uint8Array?value:new Uint8Array(await new Response(value).arrayBuffer())); }
  async delete(key) { this.objects.delete(key); }
  async head(key) { const bytes=this.objects.get(key);return bytes?{size:bytes.length,httpEtag:'"local-preview"',writeHttpMetadata(){}}:null; }
  async get(key,options={}) { const bytes=this.objects.get(key);if(!bytes)return null;const range=options.range,body=range?bytes.slice(range.offset,range.offset+range.length):bytes;return{body,size:bytes.length,range:range?{offset:range.offset,length:body.length}:undefined,httpEtag:'"local-preview"',writeHttpMetadata(){}}; }
}

const types = new Map([[".html","text/html; charset=utf-8"],[".css","text/css; charset=utf-8"],[".js","text/javascript; charset=utf-8"],[".json","application/json; charset=utf-8"],[".png","image/png"],[".jpg","image/jpeg"],[".jpeg","image/jpeg"],[".svg","image/svg+xml"],[".wav","audio/wav"],[".mp4","video/mp4"],[".mov","video/quicktime"]]);
function localAsset(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/__gallery-studio-acceptance") return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Gallery Studio Acceptance</title><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/studio/construct-manager.css"><link rel="stylesheet" href="/studio/media-catalogue-manager.css"></head><body><main id="acceptance-root"></main><p id="acceptance-status" role="status"></p><script type="module">const token="${TOKEN}",root=document.querySelector("#acceptance-root"),status=document.querySelector("#acceptance-status");async function api(path,options={}){const headers=new Headers(options.headers||{});headers.set("authorization","Bearer "+token);const response=await fetch(path,{...options,headers});const payload=response.headers.get("content-type")?.includes("json")?await response.json():null;if(!response.ok)throw new Error(payload?.error||("Request failed ("+response.status+")"));return payload}window.addEventListener("studio:navigate",event=>{document.body.dataset.navigation=JSON.stringify(event.detail||{});const detail=event.detail||{};status.textContent="Navigated to "+(detail.tab||"")+" / "+(detail.view||"")});const {mountMediaCatalogue}=await import("/studio/media-catalogue-manager.js?v=acceptance");void mountMediaCatalogue(root,api,message=>{status.textContent=message},{view:new URLSearchParams(location.search).get("view")==="media"?"media":"gallery"}).catch(error=>{status.textContent=error.message;document.body.dataset.error=error.stack||error.message});</script></body></html>`,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  if (pathname === "/js/live-text-editor.js") pathname = "/tools/live-text-editor.js";
  if (pathname.endsWith("/")) pathname += "index.html";
  const target = normalize(join(ROOT, pathname.replace(/^\/+/, "")));
  if (!target.startsWith(ROOT) || !existsSync(target) || !statSync(target).isFile()) return new Response("Not found", { status: 404 });
  const body = Readable.toWeb(createReadStream(target));
  return new Response(body, { headers: { "content-type": types.get(extname(target).toLowerCase()) || "application/octet-stream", "cache-control": "no-store" } });
}

const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys=ON");
for (const name of readdirSync(join(ROOT,"migrations")).filter(name=>name.endsWith(".sql")).sort()) database.exec(readFileSync(join(ROOT,"migrations",name),"utf8"));
database.exec(`
  UPDATE media_archive_admission_reviews
  SET review_state='pending',suggested_reason='Local browser acceptance fixture',reviewed_by='',reviewed_at=NULL,updated_at=datetime('now')
  WHERE media_id IN (
    SELECT review.media_id
    FROM media_archive_admission_reviews review
    LEFT JOIN media_catalogue_entries catalogue ON catalogue.media_id=review.media_id
    WHERE catalogue.media_id IS NULL
    ORDER BY review.media_id
    LIMIT 2
  );
`);
const galleryRows = database.prepare(`SELECT gallery.media_id,catalogue.catalogue_id FROM gallery_entries gallery JOIN media_catalogue_entries catalogue ON catalogue.media_id=gallery.media_id JOIN media_assets media ON media.id=gallery.media_id WHERE media.mime_type LIKE 'image/%' AND media.source_url<>'' ORDER BY catalogue.catalogue_id LIMIT 6`).all();
database.prepare(`INSERT INTO gallery_sets(id,slug,title,summary,set_type,date_precision,state,published_at,created_by,updated_by,created_at,updated_at) VALUES('gallery-qa-set','studio-field-notes','Studio Field Notes','A local-only sequence used to verify Gallery set order and permanent routes.','session','undated','published',datetime('now'),'qa','qa',datetime('now'),datetime('now'))`).run();
for (const [index,row] of galleryRows.entries()) {
  database.prepare("UPDATE media_assets SET privacy='public',public_presentation='inline',state='active',alt_text=COALESCE(NULLIF(alt_text,''),'Creative work and studio documentation') WHERE id=?").run(row.media_id);
  database.prepare("UPDATE gallery_entries SET title=CASE WHEN ?=0 THEN 'Peer Amid, versions in the field' ELSE title END,accessibility_text=CASE WHEN ?=0 THEN 'A layered blue, rust, and black composition showing a person wearing a Peer Amid shirt.' ELSE 'Creative work, process, or studio documentation from the SIX.WELL archive.' END,accessibility_status='described',credit='SIX.WELL',rights_status='owned',date_precision='undated',state='published',published_at=datetime('now','-'||?||' minutes') WHERE media_id=?").run(index,index,index,row.media_id);
  database.prepare("INSERT INTO gallery_set_items(set_id,media_id,sort_order,created_at) VALUES('gallery-qa-set',?,?,datetime('now'))").run(row.media_id,index+1);
  if(index<2)database.prepare("INSERT OR IGNORE INTO gallery_entry_lenses(media_id,lens_id,sort_order,created_at) VALUES(?, 'gallery-lens-works',1,datetime('now'))").run(row.media_id);
}

const env={SUBMISSIONS_DB:new LocalD1(database),SUBMISSIONS_ADMIN_TOKEN:TOKEN,SUBMISSION_FILES:new LocalBucket(),ASSETS:{fetch:localAsset},PUBLIC_SITE_URL:`http://127.0.0.1:${PORT}`};
createServer(async (incoming,outgoing)=>{
  try {
    const url=`http://127.0.0.1:${PORT}${incoming.url}`;
    const init={method:incoming.method,headers:incoming.headers};
    if(!["GET","HEAD"].includes(incoming.method))init.body=Readable.toWeb(incoming),init.duplex="half";
    const response=new URL(url).pathname==="/__gallery-studio-acceptance"
      ? localAsset(new Request(url,init))
      : await worker.fetch(new Request(url,init),env,{waitUntil(){}});
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    if(!response.body)return outgoing.end();
    Readable.fromWeb(response.body).pipe(outgoing);
  } catch(error) { outgoing.writeHead(500,{"content-type":"text/plain"});outgoing.end(error.stack||error.message); }
}).listen(PORT,"127.0.0.1",()=>console.log(`Gallery QA: http://127.0.0.1:${PORT}/gallery/\nStudio token: ${TOKEN}`));
