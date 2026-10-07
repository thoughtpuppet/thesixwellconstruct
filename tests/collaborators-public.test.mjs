import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../_worker.js";
import { handleConstructApi } from "../functions/api/construct/_lib.js";
import { renderCollaborators } from "../functions/api/construct/_collaborators.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
class Statement {
  constructor(database,sql,values=[]) { this.database=database;this.sql=sql;this.values=values; }
  bind(...values) { return new Statement(this.database,this.sql,values); }
  async all() { return {results:this.database.prepare(this.sql).all(...this.values)}; }
  async first() { return this.database.prepare(this.sql).get(...this.values)||null; }
  async run() { return {success:true,meta:this.database.prepare(this.sql).run(...this.values)}; }
}
function fixture() {
  const database=new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(path.join(root,"migrations")).filter(file=>file.endsWith(".sql")).sort()) {
    if(file==='0237_kinmarking_collaborators.sql') database.exec("INSERT INTO events(id,slug,title,publication_state,status,created_at,updated_at) VALUES('kinmarking-collaborator-test','kinmarking','KINMARKING','announced','closed',datetime('now'),datetime('now'))");
    database.exec(readFileSync(path.join(root,"migrations",file),"utf8"));
  }
  const env={PUBLIC_SITE_URL:"https://thesixwellconstruct.com",SUBMISSIONS_DB:{prepare:sql=>new Statement(database,sql)},ASSETS:{async fetch(request) {
    try {return new Response(readFileSync(path.join(root,new URL(request.url).pathname)),{headers:{"content-type":"text/html; charset=utf-8"}});} catch {return new Response("Not found",{status:404});}
  }}};
  return {database,env};
}
const request=route=>new Request(`https://thesixwellconstruct.com${route}`);

test("migration registers separate collaborators, supplied portraits, co-founders, and edition-scoped credit",async()=>{
  const {database,env}=fixture();
  const response=await handleConstructApi(request("/api/collaborators"),env);
  assert.equal(response.status,200);
  const {records}=await response.json();
  assert.deepEqual(records.map(record=>record.name),["Dartricia Rollins","Ashby Combahee","Georgia Dusk"]);
  assert.equal(records[1].pronouns,"s/he/they");
  assert.equal(records[2].entityType,"organization");
  assert.deepEqual(records.map(record=>record.kindLabel),["Individual","Individual","Organization"]);
  assert.equal(records[2].descriptionLabel,"Community archive");
  assert.equal(records[2].image,null);
  assert.equal(records[0].image.width,683);
  assert.equal(records[1].image.width,512);
  for (const record of records) {
    assert.equal(record.credits.length,1);
    assert.equal(record.credits[0].editionNumber,"01");
    assert.match(record.credits[0].route,/kinmarking-01-oral-histories-and-tattooing/);
    assert.ok(!("internal_notes" in record));
  }
  assert.equal(records[2].affiliations.filter(link=>link.label==="Co-founder").length,2);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
  database.exec("UPDATE people SET bio='Later authored biography' WHERE slug='ashby-combahee'");
  database.exec(readFileSync(path.join(root,"migrations/0237_kinmarking_collaborators.sql"),"utf8"));
  assert.equal(database.prepare("SELECT bio FROM people WHERE slug='ashby-combahee'").get().bio,"Later authored biography");
  assert.equal(database.prepare("SELECT count(*) count FROM collaborator_profiles").get().count,3);
});

test("privacy and publication withdrawals remove profiles and reciprocal public links",async()=>{
  const {database,env}=fixture();
  database.exec("UPDATE people SET privacy='private' WHERE slug='ashby-combahee'");
  assert.equal((await handleConstructApi(request("/api/collaborators/ashby-combahee"),env)).status,404);
  let payload=await (await handleConstructApi(request("/api/collaborators/georgia-dusk"),env)).json();
  assert.deepEqual(payload.record.affiliations.map(item=>item.name),["Dartricia Rollins"]);
  database.exec("UPDATE organizations SET state='draft' WHERE slug='georgia-dusk'");
  assert.equal((await handleConstructApi(request("/api/collaborators/georgia-dusk"),env)).status,404);
  payload=await (await handleConstructApi(request("/api/connections/person-dartricia-rollins"),env)).json();
  assert.ok(!payload.records.some(item=>["person-ashby-combahee","org-georgia-dusk"].includes(item.related.id)));
});

test("Worker serves complete profiles, canonical URLs, correct person/organization metadata, and no private provenance",async()=>{
  const {env}=fixture();
  for (const [slug,type] of [["dartricia-rollins","Person"],["ashby-combahee","Person"],["georgia-dusk","Organization"]]) {
    const response=await worker.fetch(request(`/about/collaborators/${slug}/`),env,{});
    assert.equal(response.status,200);
    const html=await response.text();
    assert.match(html,new RegExp(`about/collaborators/${slug}/`));
    assert.ok(html.includes(`"@type":"${type}"`));
    assert.match(html,/Co-found(?:ed|er)/);
    assert.doesNotMatch(html,/original_sha256|camera_model|embedded_capture_at|Kinmarking follow-up/);
  }
  const missing=await worker.fetch(request("/about/collaborators/missing-person/"),env,{});
  assert.equal(missing.status,404);
  const redirect=await worker.fetch(request("/about/collaborators/ashby-combahee"),env,{});
  assert.equal(redirect.status,308);
});

test("rendering escapes supplied biographies and declines unsafe public links",()=>{
  const html=renderCollaborators({record:{id:"person-test",name:"<script>x</script>",entityType:"person",kindLabel:"Collaborator",pronouns:"",bio:"<img src=x onerror=alert(1)>",image:null,affiliations:[],credits:[],websiteUrl:"javascript:alert(1)"}});
  assert.ok(html.includes("&lt;img"));
  assert.doesNotMatch(html,/<script>|javascript:/);
});
