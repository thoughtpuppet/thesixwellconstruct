import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import worker from "../_worker.js";
import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=file=>readFile(path.join(ROOT,file),"utf8");
const assets={async fetch(request){return new Response(new URL(request.url).pathname,{status:200,headers:{"content-type":"text/html"}})}};
class D1Statement{constructor(database,sql,values=[]){this.database=database;this.sql=sql;this.values=values}bind(...values){return new D1Statement(this.database,this.sql,values)}async first(){return this.database.prepare(this.sql).get(...this.values)||null}async all(){return{results:this.database.prepare(this.sql).all(...this.values)}}async run(){const statement=this.database.prepare(this.sql);if(statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT"))return{results:statement.all(...this.values)};const result=statement.run(...this.values);return{success:true,meta:{changes:Number(result.changes||0)}}}}
class LocalD1{constructor(database){this.database=database}prepare(sql){return new D1Statement(this.database,sql)}async batch(statements){this.database.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.exec("COMMIT");return results}catch(error){this.database.exec("ROLLBACK");throw error}}}
function migratedDatabase(){const database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON");for(const name of readdirSync(path.join(ROOT,"migrations")).filter(name=>name.endsWith(".sql")).sort())database.exec(readFileSync(path.join(ROOT,"migrations",name),"utf8"));return database}

test("Exhibitions & Appearances opens only its About branch and corresponding published dossier",async()=>{
  const database={
    prepare(){
      return {bind(slug){
        return {async first(){return slug==="made-in-public"?{entity_id:"appearance-made-in-public"}:null}};
      }};
    },
  };
  for(const route of ["/about/exhibitions-appearances/","/about/exhibitions-appearances/made-in-public/","/archive/records/made-in-public/"]){
    const response=await worker.fetch(new Request(`https://example.test${route}`),{ASSETS:assets,SUBMISSIONS_DB:database},{});
    assert.equal(response.status,200,route);
  }
  for(const route of ["/about/founder/","/archive/records/lostmarbles/"]){
    const response=await worker.fetch(new Request(`https://example.test${route}`),{ASSETS:assets,SUBMISSIONS_DB:database},{});
    assert.equal(response.status,302,route);
  }
});

test("Made in Public seeds participation, venue, flyer, archive, and merch without falsely exhibiting the source painting",async()=>{
  const migration=await source("migrations/0118_about_exhibitions_appearances.sql");
  for(const value of ["appearance-made-in-public","Purple Fish Studios","Fourth House","SIX.WELL CLOTHING","person-saiel-dauhn-solehman","org-thoughtpuppet","merch-lostmarbles-hoodie","rel-featured-at","archive_event_identifiers","made-in-public-2026-flyer.jpg"]){
    assert.match(migration,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),value);
  }
  assert.doesNotMatch(migration,/art-marbles','appearance-made-in-public','rel-exhibited-at/);
  assert.match(migration,/132 Mitchell St SW, Atlanta, GA 30303/);
  assert.match(migration,/https:\/\/www\.pfstudios\.co\//);
});

test("Studio corrects participation, dossier roles, and exhibited works without an editorial migration",async()=>{
  const database=migratedDatabase(),token="appearance-test-token",headers={authorization:`Bearer ${token}`,"content-type":"application/json"},env={SUBMISSIONS_DB:new LocalD1(database),SUBMISSIONS_ADMIN_TOKEN:token};
  database.prepare("UPDATE artist_appearances SET summary=?,participation_roles_json=? WHERE id='appearance-made-in-public'").run("Incorrect panelist credit",'["Exhibiting artist","Panelist","Merchandise vendor"]');
  database.prepare("UPDATE archive_dossier_subjects SET role='exhibiting artist and panelist' WHERE dossier_entity_id='appearance-made-in-public' AND subject_entity_id='person-saiel-dauhn-solehman'").run();
  const appearanceResponse=await handleConstructApi(new Request("https://example.test/api/admin/appearances/appearance-made-in-public",{method:"PATCH",headers,body:JSON.stringify({summary:"Saiel + ThoughtPuppet participate as exhibiting artist and merchandise vendor.",participation_roles_json:["Exhibiting artist","Merchandise vendor"]})}),env);
  assert.equal(appearanceResponse.status,200);
  const dossierResponse=await handleConstructApi(new Request("https://example.test/api/admin/archive-dossiers/appearance-made-in-public",{headers:{authorization:`Bearer ${token}`}}),env),dossier=await dossierResponse.json(),context=dossier.record.context_assignments.map(item=>({...item,role:item.entity_id==="person-saiel-dauhn-solehman"?"exhibiting artist":item.role}));
  const contextResponse=await handleConstructApi(new Request("https://example.test/api/admin/archive-dossiers/appearance-made-in-public",{method:"PATCH",headers,body:JSON.stringify({context_assignments:context})}),env);
  assert.equal(contextResponse.status,200);
  const relationshipResponse=await handleConstructApi(new Request("https://example.test/api/admin/relationships",{method:"POST",headers,body:JSON.stringify({source_entity_id:"art-marbles",target_entity_id:"appearance-made-in-public",relationship_type_id:"rel-exhibited-at",public_visible:true,sort_order:1})}),env);
  assert.equal(relationshipResponse.status,201);
  const publicAppearance=await (await handleConstructApi(new Request("https://example.test/api/appearances/made-in-public"),env)).json(),publicConnections=await (await handleConstructApi(new Request("https://example.test/api/connections/appearance-made-in-public"),env)).json();
  assert.deepEqual(JSON.parse(publicAppearance.record.participation_roles_json),["Exhibiting artist","Merchandise vendor"]);
  assert.equal(publicAppearance.record.subjects.find(item=>item.subject_entity_id==="person-saiel-dauhn-solehman").role,"exhibiting artist");
  assert.equal(publicConnections.records.find(item=>item.related.id==="art-marbles").label,"Exhibited");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM entity_revisions WHERE entity_id='appearance-made-in-public' AND action IN ('update','archive-dossier-update','relationship-create')").get().count>=3,true);
});

test("public and Studio APIs return the seeded appearance, contextual identities, dossier, and hoodie connection",async()=>{
  const database=migratedDatabase(),env={SUBMISSIONS_DB:new LocalD1(database),SUBMISSIONS_ADMIN_TOKEN:"appearance-test-token"};
  const publicResponse=await handleConstructApi(new Request("https://example.test/api/appearances/made-in-public"),env);
  assert.equal(publicResponse.status,200);
  const appearance=(await publicResponse.json()).record;
  assert.equal(appearance.title,"Made in Public");
  assert.equal(appearance.subjects.length,6);
  assert.equal(appearance.subjects.find(item=>item.name==="Purple Fish Studios"&&item.entity_type==="organization").website_url,"https://www.pfstudios.co/");
  assert.equal(appearance.media[0].url,"/assets/events/made-in-public-2026-flyer.jpg");

  const adminResponse=await handleConstructApi(new Request("https://example.test/api/admin/appearances",{headers:{authorization:"Bearer appearance-test-token"}}),env);
  assert.equal(adminResponse.status,200);
  assert.equal((await adminResponse.json()).records[0].title,"Made in Public");

  const connectionsResponse=await handleConstructApi(new Request("https://example.test/api/connections/appearance-made-in-public"),env);
  assert.equal(connectionsResponse.status,200);
  const connections=(await connectionsResponse.json()).records;
  assert.equal(connections.find(item=>item.related.id==="merch-lostmarbles-hoodie").label,"Featured merchandise");

  const dossierResponse=await handleConstructApi(new Request("https://example.test/api/archive/items/made-in-public"),env);
  assert.equal(dossierResponse.status,200);
  const dossier=(await dossierResponse.json()).item;
  assert.equal(dossier.event_id.startsWith("EVT-"),true);
  assert.equal(dossier.catalogue_id,"");
});

test("public appearance pages preserve the About shell and expose future painting plus reverse-merch connections",async()=>{
  const [index,detail,script,css]=await Promise.all([source("about/exhibitions-appearances/index.html"),source("about/exhibitions-appearances/detail/index.html"),source("about/exhibitions-appearances/appearances.js"),source("about/exhibitions-appearances/appearances.css")]);
  for(const html of [index,detail]){
    assert.match(html,/\/css\/tokens\.css/);
    assert.match(html,/\/about\/section-page\.css/);
    assert.match(html,/\/css\/site-typography\.css/);
  }
  assert.match(index,/hero-descriptor/);
  assert.match(script,/Works involved or exhibited/);
  assert.doesNotMatch(script,/<h2>Paintings shown<\/h2>|<h2>Related<\/h2>/);
  assert.doesNotMatch(script,/const fallback=/);
  assert.match(script,/archive\/records/);
  assert.match(css,/border[^;]*:\s*5px/);
  assert.match(css,/@media\(max-width:390px\)/);
});

test("Studio owns appearances, context, connected works, and reusable organizations",async()=>{
  const [studio,manager,shared,apiSource]=await Promise.all([source("studio/submissions/index.html"),source("studio/construct-manager.js"),source("functions/api/_shared/construct.js"),source("functions/api/construct/_lib.js")]);
  assert.match(studio,/data-tab="about">About/);
  assert.match(studio,/Exhibitions &amp; Appearances/);
  assert.match(studio,/\["organizations","Organizations"\]/);
  assert.match(manager,/about:new Set\(\["appearances"\]\)/);
  assert.match(manager,/Hosts, participants &amp; venue/);
  assert.match(manager,/Works involved or exhibited/);
  assert.match(manager,/context_assignments:contextAssignments/);
  assert.match(manager,/relationship_type_id:item\.relationship_type_id/);
  assert.match(apiSource,/"relationship-create"/);
  assert.match(shared,/appearances:\s*\{ table: "artist_appearances"/);
  assert.match(shared,/organizations:\s*\{ table: "organizations"/);
});
