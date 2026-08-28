import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { ciede2000 } from "../functions/api/construct/_colors-materials.js";
import {
  discoverVisualColorWorkSources,
  mergeVisualColorSuggestions,
  normalizeVisualColorResult,
  runVisualColorAnalysisPass,
  visualColorFingerprint,
} from "../functions/api/construct/_visual-colors.js";
import { handleConstructApi } from "../functions/api/construct/_lib.js";

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const TOKEN="archive-colors-test-token";

class D1Statement {
  constructor(database,sql,values=[]){this.database=database;this.sql=sql;this.values=values}
  bind(...values){return new D1Statement(this.database,this.sql,values)}
  async first(){return this.database.prepare(this.sql).get(...this.values)||null}
  async all(){return{results:this.database.prepare(this.sql).all(...this.values)}}
  async run(){const statement=this.database.prepare(this.sql);if(statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT"))return{results:statement.all(...this.values)};const result=statement.run(...this.values);return{success:true,meta:{changes:Number(result.changes||0)}}}
}
class LocalD1 {
  constructor(database){this.database=database}
  prepare(sql){return new D1Statement(this.database,sql)}
  async batch(statements){this.database.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.exec("COMMIT");return results}catch(error){this.database.exec("ROLLBACK");throw error}}
}
function database(){
  const database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON");
  for(const name of readdirSync(join(ROOT,"migrations")).filter(value=>value.endsWith(".sql")).sort())database.exec(readFileSync(join(ROOT,"migrations",name),"utf8"));
  return database;
}
function env(database){return{SUBMISSIONS_DB:new LocalD1(database),SUBMISSIONS_ADMIN_TOKEN:TOKEN}}
function request(path,{method="GET",body,admin=false}={}){
  return new Request(`https://example.test${path}`,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(admin?{authorization:`Bearer ${TOKEN}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function payload(response){const body=await response.json();return{status:response.status,body}}
async function admin(runtime,path,body,method="POST"){return payload(await handleConstructApi(request(path,{method,body,admin:true}),runtime))}
async function addProfile(runtime,sourceType,sourceId,srgbHex="#315A7A"){
  return admin(runtime,"/api/admin/archive-color-materials/profiles",{
    source_type:sourceType,source_id:sourceId,srgb_hex:srgbHex,
    lab_l:38,lab_a:2,lab_b:-24,oklch_l:.48,oklch_c:.09,oklch_h:250,
    reference_method:"manual-digital",
  });
}

test("CIEDE2000 uses the published reference calculation",()=>{
  const distance=ciede2000([50,2.6772,-79.7751],[50,0,-82.7485]);
  assert.ok(Math.abs(distance-2.0425)<0.0001);
});

test("visual color migration preserves Black, seeds atomic families, and stays idempotent",()=>{
  const sql=new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  const migrations=readdirSync(join(ROOT,"migrations")).filter(value=>value.endsWith(".sql")).sort();
  for(const name of migrations.filter(value=>value<"0181_archive_visual_color_families.sql"))sql.exec(readFileSync(join(ROOT,"migrations",name),"utf8"));
  sql.prepare(`INSERT INTO archive_color_families(
    id,slug,name,description,swatch_hex,publication_state,public_visible,sort_order,created_at,updated_at
  ) VALUES('existing-private-black','black','Black','','#111111','draft',0,99,datetime('now'),datetime('now'))`).run();
  const migration=readFileSync(join(ROOT,"migrations/0181_archive_visual_color_families.sql"),"utf8");
  sql.exec(migration);
  sql.exec(migration);
  const black=sql.prepare("SELECT * FROM archive_color_families WHERE slug='black'").get();
  assert.equal(black.id,"existing-private-black");
  assert.equal(black.swatch_hex,"#000000");
  assert.equal(black.publication_state,"published");
  assert.equal(black.public_visible,1);
  assert.equal(sql.prepare(`SELECT COUNT(*) count FROM archive_color_families WHERE slug IN (
    'black','gray','white','cream','beige','tan','brown','red','orange','yellow','gold','ochre',
    'green','teal','turquoise','cyan','blue','indigo','purple','pink','silver')`).get().count,21);
  assert.throws(()=>sql.prepare(`INSERT INTO archive_color_families(
    id,slug,name,description,swatch_hex,publication_state,public_visible,sort_order,created_at,updated_at
  ) VALUES('combined-family','gold-ochre','Gold/Ochre','','#999999','draft',0,0,datetime('now'),datetime('now'))`).run(),/singular and atomic/);
});

test("visual source discovery excludes Tattoo context images and merges only allowed atomic suggestions",async()=>{
  const sql=database(),runtime=env(sql);
  sql.exec(`INSERT INTO portfolio_items(
    id,source_url,storage_key,original_filename,content_type,title,alt_text,year,placement,
    primary_style,collection,caption,state,sort_order,created_at,updated_at,primary_consent_status,project_type
  ) VALUES(
    'visual-tattoo','https://cdn.example.test/tattoo-primary.jpg','','tattoo-primary.jpg','image/jpeg',
    'Reviewed tattoo','Reviewed tattoo','2026','arm','abstract','','','published',0,datetime('now'),datetime('now'),'granted','cover_up'
  );
  INSERT INTO content_entities(
    id,entity_type,visibility,search_visibility,featured,created_by,updated_by,created_at,updated_at
  ) VALUES('visual-tattoo','portfolio_item','public',1,0,'test','test',datetime('now'),datetime('now'));
  INSERT INTO portfolio_image_details(
    portfolio_item_id,image_ref,healing_state,timing_note,caption,created_at,updated_at,image_role
  ) VALUES
    ('visual-tattoo','primary','fresh','','',datetime('now'),datetime('now'),'result'),
    ('visual-tattoo','visual-before','unspecified','','',datetime('now'),datetime('now'),'before'),
    ('visual-tattoo','visual-detail','unspecified','','',datetime('now'),datetime('now'),'detail'),
    ('visual-tattoo','visual-result','healed','','',datetime('now'),datetime('now'),'result');
  INSERT INTO media_assets(
    id,source_url,original_filename,mime_type,alt_text,privacy,consent_status,state,created_by,created_at,updated_at,public_presentation
  ) VALUES
    ('visual-before','https://cdn.example.test/before.jpg','before.jpg','image/jpeg','Before','public','granted','active','test',datetime('now'),datetime('now'),'inline'),
    ('visual-detail','https://cdn.example.test/detail.jpg','detail.jpg','image/jpeg','Detail','public','granted','active','test',datetime('now'),datetime('now'),'inline'),
    ('visual-result','https://cdn.example.test/result.jpg','result.jpg','image/jpeg','Result','public','granted','active','test',datetime('now'),datetime('now'),'inline');
  INSERT INTO entity_media(entity_id,media_id,role,sort_order,public_visible,created_at) VALUES
    ('visual-tattoo','visual-before','gallery',1,1,datetime('now')),
    ('visual-tattoo','visual-detail','gallery',2,1,datetime('now')),
    ('visual-tattoo','visual-result','gallery',3,1,datetime('now'));`);
  const works=await discoverVisualColorWorkSources(runtime.SUBMISSIONS_DB,runtime);
  const tattoo=works.get("tattoo:visual-tattoo");
  assert.ok(tattoo);
  assert.deepEqual(tattoo.images.map(image=>image.id),["primary","visual-result"]);
  assert.deepEqual(tattoo.descriptor_suggestions.term_slugs,["tattoo","tattoo-ink"]);
  const painting=works.get("painting:art-marbles");
  assert.ok(painting);
  assert.deepEqual(painting.descriptor_suggestions.term_slugs,["painting","acrylic-paint","wood-panel"]);
  const firstFingerprint=await visualColorFingerprint(tattoo);
  sql.prepare("UPDATE portfolio_image_details SET updated_at='2030-01-01T00:00:00Z' WHERE portfolio_item_id='visual-tattoo' AND image_ref='visual-result'").run();
  const changed=(await discoverVisualColorWorkSources(runtime.SUBMISSIONS_DB,runtime)).get("tattoo:visual-tattoo");
  assert.notEqual(await visualColorFingerprint(changed),firstFingerprint);

  const families=[
    {id:"blue-id",slug:"blue",name:"Blue"},
    {id:"gold-id",slug:"gold",name:"Gold"},
    {id:"ochre-id",slug:"ochre",name:"Ochre"},
  ];
  const first=normalizeVisualColorResult({response:{colors:[
    {family:"blue",strength:"supporting"},{family:"gold",strength:"accent"},
    {family:"gold/ochre",strength:"dominant"},{family:"invented",strength:"dominant"},
  ]}},families);
  const second=normalizeVisualColorResult({colors:[{family:"blue",strength:"dominant"},{family:"ochre",strength:"accent"}]},families);
  const merged=mergeVisualColorSuggestions([first,second]);
  assert.deepEqual(merged.map(item=>[item.family_slug,item.strength]),[["blue","dominant"],["gold","accent"],["ochre","accent"]]);

  const calls=[];
  const pass=await runVisualColorAnalysisPass({
    ...runtime,
    PUBLIC_SITE_URL:"https://example.test",
    VISUAL_COLOR_WORKS_PER_PASS:"1",
    AI:{run:async(model,input)=>{calls.push({model,input});return{response:{colors:[{family:"blue",strength:"accent"}]}}}},
  });
  assert.equal(pass.processed.length,1);
  assert.equal(pass.processed[0].status,"ready");
  assert.equal(calls.length,1);
  assert.match(calls[0].input.messages[0].content,/Exclude tiny noise, skin, photographic backgrounds/);
  assert.equal(calls[0].input.response_format.type,"json_schema");
  const failingEnv={...runtime,VISUAL_COLOR_WORKS_PER_PASS:"1",VISUAL_COLOR_MAX_ATTEMPTS:"3",AI:{run:async()=>{throw new Error("vision unavailable")}}};
  await runVisualColorAnalysisPass(failingEnv);
  await runVisualColorAnalysisPass(failingEnv);
  await runVisualColorAnalysisPass(failingEnv);
  assert.equal(sql.prepare("SELECT status FROM archive_visual_color_runs WHERE work_id='art-lust'").get().status,"failed");
});

test("review approval atomically publishes visual families and descriptors without exposing model data",async()=>{
  const sql=database(),runtime=env(sql);
  const enqueued=await admin(runtime,"/api/admin/archive-color-materials/visual-review/enqueue",{});
  assert.equal(enqueued.status,200,enqueued.body.error);
  const run=sql.prepare("SELECT * FROM archive_visual_color_runs WHERE work_type='painting' AND work_id='art-marbles'").get();
  assert.ok(run);
  const blue=sql.prepare("SELECT * FROM archive_color_families WHERE slug='blue'").get();
  const terms=sql.prepare("SELECT id,slug FROM archive_work_descriptor_terms WHERE slug IN ('painting','acrylic-paint','wood-panel') ORDER BY sort_order").all();
  sql.prepare(`UPDATE archive_visual_color_runs SET status='ready',raw_result_json='{"private":"model evidence"}',
    normalized_suggestions_json=?,updated_at=datetime('now') WHERE id=?`).run(JSON.stringify([{family_id:blue.id,family_slug:"blue",family_name:"Blue",strength:"dominant",display_order:0}]),run.id);
  const approved=await admin(runtime,`/api/admin/archive-color-materials/visual-review/${run.id}/approve`,{
    colors:[{family_id:blue.id,strength:"dominant",display_order:0}],
    descriptor_term_ids:terms.map(term=>term.id),
  });
  assert.equal(approved.status,200,approved.body.error);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_visual_color_assignments WHERE work_id='art-marbles'").get().count,1);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_work_descriptor_assignments WHERE work_id='art-marbles'").get().count,3);

  const publicFamilies=await payload(await handleConstructApi(request("/api/archive/visual-color-families"),runtime));
  assert.equal(publicFamilies.status,200,publicFamilies.body.error);
  assert.equal(publicFamilies.body.families.find(family=>family.slug==="blue").painting_count,1);
  const publicWorks=await payload(await handleConstructApi(request("/api/archive/visual-color-families/blue/works?type=painting"),runtime));
  assert.equal(publicWorks.status,200,publicWorks.body.error);
  assert.equal(publicWorks.body.works[0].id,"art-marbles");
  assert.equal(publicWorks.body.works[0].strength,"dominant");
  const publicDescriptors=await payload(await handleConstructApi(request("/api/archive/work-descriptors"),runtime));
  assert.ok(publicDescriptors.body.descriptors.some(term=>term.slug==="acrylic-paint"&&term.count===1));
  const serialized=JSON.stringify({publicFamilies:publicFamilies.body,publicWorks:publicWorks.body,publicDescriptors:publicDescriptors.body});
  for(const privateField of ["model evidence","raw_result_json","source_fingerprint","prompt_version","confidence"])assert.equal(serialized.includes(privateField),false);

  sql.prepare("UPDATE media_assets SET updated_at='2030-01-01T00:00:00Z' WHERE id='media-art-marbles'").run();
  const stale=await admin(runtime,`/api/admin/archive-color-materials/visual-review/${run.id}/approve`,{
    colors:[{family_id:blue.id,strength:"supporting",display_order:0}],descriptor_term_ids:[],
  });
  assert.equal(stale.status,409);
  assert.match(stale.body.error,/changed/i);
  const stillPublic=await payload(await handleConstructApi(request("/api/archive/visual-color-families/blue/works?type=all"),runtime));
  assert.equal(stillPublic.body.works[0].strength,"dominant");

  const invalidFamily=await admin(runtime,"/api/admin/archive-color-materials/families",{name:"Gold/Ochre",swatch_hex:"#999999"});
  assert.equal(invalidFamily.status,409);
});

test("slug-capable color and material records generate stable slugs when blank or omitted",async()=>{
  const sql=database(),runtime=env(sql);
  const material=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Auto Slug Tattoo Ink",slug:"",material_kind:"tattoo-ink",medium_scope:"tattoo",
  });
  assert.equal(material.status,201,material.body.error);
  assert.equal(material.body.record.slug,"auto-slug-tattoo-ink");

  const recipe=await admin(runtime,"/api/admin/archive-color-materials/recipes",{
    name:"Soft Greywash",medium_scope:"tattoo",
  });
  assert.equal(recipe.status,201,recipe.body.error);
  assert.equal(recipe.body.record.slug,"soft-greywash");

  const family=await admin(runtime,"/api/admin/archive-color-materials/families",{
    name:"Blue Grey",slug:"",
  });
  assert.equal(family.status,201,family.body.error);
  assert.equal(family.body.record.slug,"blue-grey");

  const renamedMaterial=await admin(runtime,`/api/admin/archive-color-materials/materials/${material.body.record.id}`,{
    name:"Renamed Tattoo Ink",slug:"",
  },"PATCH");
  assert.equal(renamedMaterial.status,200,renamedMaterial.body.error);
  assert.equal(renamedMaterial.body.record.slug,"auto-slug-tattoo-ink");

  const renamedRecipe=await admin(runtime,`/api/admin/archive-color-materials/recipes/${recipe.body.record.id}`,{
    name:"Renamed Greywash",slug:"",
  },"PATCH");
  assert.equal(renamedRecipe.status,200,renamedRecipe.body.error);
  assert.equal(renamedRecipe.body.record.slug,"soft-greywash");

  const renamedFamily=await admin(runtime,`/api/admin/archive-color-materials/families/${family.body.record.id}`,{
    name:"Renamed Blue Grey",slug:"",
  },"PATCH");
  assert.equal(renamedFamily.status,200,renamedFamily.body.error);
  assert.equal(renamedFamily.body.record.slug,"blue-grey");
});

test("Realized as only connects Tattoo Designs or Flash to executed Portfolio tattoos",()=>{
  const sql=database();
  sql.exec(`INSERT INTO content_entities(
    id,entity_type,visibility,search_visibility,featured,internal_notes,
    created_by,updated_by,created_at,updated_at
  ) VALUES
    ('realized-flash','flash_item','internal',0,0,'','test','test',datetime('now'),datetime('now')),
    ('realized-execution','portfolio_item','internal',0,0,'','test','test',datetime('now'),datetime('now')),
    ('realized-artwork','art_work','internal',0,0,'','test','test',datetime('now'),datetime('now'))`);
  const relationshipType=sql.prepare("SELECT * FROM relationship_types WHERE id='rel-realized-as'").get();
  assert.equal(relationshipType?.slug,"realized-as");
  sql.prepare(`INSERT INTO entity_relationships(
    id,source_entity_id,target_entity_id,relationship_type_id,public_visible,
    internal_notes,sort_order,created_by,created_at,updated_at
  ) VALUES('realized-valid',?,?,?,1,'',0,'test',datetime('now'),datetime('now'))`)
    .run("realized-flash","realized-execution",relationshipType.id);
  assert.throws(
    ()=>sql.prepare(`INSERT INTO entity_relationships(
      id,source_entity_id,target_entity_id,relationship_type_id,public_visible,
      internal_notes,sort_order,created_by,created_at,updated_at
    ) VALUES('realized-invalid',?,?,?,1,'',0,'test',datetime('now'),datetime('now'))`)
      .run("realized-artwork","realized-execution",relationshipType.id),
    /Realized as must connect/,
  );
});

test("the practice workflow treats premade products as ingredients without exposing product versions",async()=>{
  const sql=database(),runtime=env(sql);
  const pigment=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Carbon Black",material_kind:"raw-pigment",pigment_code:"PBK7",
    cas_number:"1333-86-4",color_index_name:"77266",medium_scope:"shared",
    publication_state:"published",public_visible:true,
  });
  assert.equal(pigment.status,201,pigment.body.error);

  const ink=await admin(runtime,"/api/admin/archive-color-materials/products",{
    name:"Zuper Black",material_kind:"tattoo-ink",brand:"Intenze",
    product_name:"Zuper Black",color_name:"Black",medium_scope:"tattoo",
    normalized_finish:"matte",opacity:"opaque",srgb_hex:"#151515",
    lab_l:7.1,lab_a:0,lab_b:0,oklch_l:.19,oklch_c:0,oklch_h:null,
    pigment_material_id:pigment.body.record.id,normalized_pigment_code:"PBk7",
    bottle_wording:"Carbon Black (CI 77266)",source_type:"bottle-label",
    publication_state:"published",
  });
  assert.equal(ink.status,201,ink.body.error);
  assert.equal(ink.body.record.slug,"zuper-black");
  assert.equal(ink.body.record.material_kind,"tattoo-ink");
  assert.equal("version_number" in ink.body.record,false);

  const snapshot=await payload(await handleConstructApi(request("/api/admin/archive-color-materials",{admin:true}),runtime));
  const product=snapshot.body.products.find(record=>record.id===ink.body.record.id);
  assert.ok(product);
  assert.equal("version_number" in product,false);
  const declaration=snapshot.body.declared_pigments.find(record=>record.material_id===ink.body.record.id);
  assert.equal(declaration.pigment_material_id,pigment.body.record.id);
  assert.equal(declaration.normalized_pigment_code,"PBK7");
  const laterEvidence=await admin(runtime,"/api/admin/archive-color-materials/declared-pigments",{
    material_id:ink.body.record.id,pigment_material_id:pigment.body.record.id,
    normalized_pigment_code:"CI 77266",bottle_wording:"CI 77266",
    source_type:"safety-data-sheet",observed_at:"2026-07-31",
  });
  assert.equal(laterEvidence.status,201,laterEvidence.body.error);

  const mixed=await admin(runtime,"/api/admin/archive-color-materials/mixed-colors",{
    name:"Soft Carbon Wash",medium_scope:"tattoo",resulting_finish:"matte",
    instructions:"Mix until even.",srgb_hex:"#565656",lab_l:36,lab_a:0,lab_b:0,
    oklch_l:.45,oklch_c:0,oklch_h:null,
  });
  assert.equal(mixed.status,201,mixed.body.error);
  assert.equal(mixed.body.record.slug,"soft-carbon-wash");
  const ingredient=await admin(runtime,"/api/admin/archive-color-materials/recipe-components",{
    recipe_version_id:mixed.body.record.recipe_version_id,material_id:ink.body.record.id,
    quantity_value:1,quantity_unit:"parts",
  });
  assert.equal(ingredient.status,201,ingredient.body.error);
  const refreshed=await payload(await handleConstructApi(request("/api/admin/archive-color-materials",{admin:true}),runtime));
  const savedIngredient=refreshed.body.recipe_components.find(record=>record.id===ingredient.body.record.id);
  assert.equal(savedIngredient.material_id,ink.body.record.id);
  assert.equal(savedIngredient.material_name,"Zuper Black");

  const state=sql.prepare("SELECT id FROM archive_object_states LIMIT 1").get();
  const usage=await admin(runtime,`/api/admin/archive-dossiers/${state.id}/palette-materials/colors`,{
    material_id:ink.body.record.id,usage_status:"applied",technique:"greywash",
  });
  assert.equal(usage.status,201,usage.body.error);
  const batch=await admin(runtime,"/api/admin/archive-color-materials/batches",{
    material_id:ink.body.record.id,lot_number:"LOT-22",expiration_date:"2028-09-01",
  });
  assert.equal(batch.status,201,batch.body.error);
  assert.equal(batch.body.record.material_id,ink.body.record.id);

  const publicProduct=await payload(await handleConstructApi(request("/api/archive/materials/zuper-black"),runtime));
  assert.equal(publicProduct.status,200,publicProduct.body.error);
  assert.equal(publicProduct.body.material.declared_pigments[0].pigment.slug,"carbon-black");
  assert.equal("formulations" in publicProduct.body.material,false);
  assert.equal(JSON.stringify(publicProduct.body).includes("version_number"),false);
});

test("premade products, pigments, recipes, and nested components preserve authored provenance",async()=>{
  const sql=database(),runtime=env(sql);
  const pigment=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Ultramarine pigment",slug:"ultramarine-pigment",material_kind:"raw-pigment",pigment_code:"PB29",
    medium_scope:"shared",publication_state:"published",public_visible:true,
  });
  assert.equal(pigment.status,201,pigment.body.error);
  const paint=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Heavy Body Ultramarine",slug:"heavy-body-ultramarine",material_kind:"art-paint",
    brand:"Example Color",product_line:"Heavy Body",product_name:"Artist Acrylic",color_name:"Ultramarine Blue",
    product_code:"HB-140",medium_scope:"art",publication_state:"published",public_visible:true,
  });
  assert.equal(paint.status,201,paint.body.error);
  const duplicate=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Duplicate label",slug:"duplicate-ultramarine",material_kind:"art-paint",
    brand:"Example Color",product_line:"Heavy Body",product_name:"Artist Acrylic",color_name:"Ultramarine Blue",
    product_code:"HB-140",medium_scope:"art",
  });
  assert.equal(duplicate.status,409);
  assert.match(duplicate.body.error,/duplicate/i);

  const formulation=await admin(runtime,"/api/admin/archive-color-materials/formulations",{
    material_id:paint.body.record.id,normalized_finish:"satin",finish_label:"Low sheen",
    opacity:"transparent",optical_effects:["iridescent","not-a-real-effect"],
  });
  assert.equal(formulation.status,201,formulation.body.error);
  const declaration=await admin(runtime,"/api/admin/archive-color-materials/declared-pigments",{
    formulation_id:formulation.body.record.id,pigment_material_id:pigment.body.record.id,
    normalized_pigment_code:"PB29",bottle_wording:"Pigment: PB29",source_type:"bottle-label",
    source_url:"https://manufacturer.example/label",observed_at:"2026-07-29",
  });
  assert.equal(declaration.status,201,declaration.body.error);
  const blockedFormulation=await admin(runtime,`/api/admin/archive-color-materials/formulations/${formulation.body.record.id}`,{
    publication_state:"published",public_visible:true,
  },"PATCH");
  assert.equal(blockedFormulation.status,409);
  assert.match(blockedFormulation.body.error,/sourced color profile/i);
  const formulationProfile=await addProfile(runtime,"material-formulation",formulation.body.record.id,"#315A7A");
  assert.equal(formulationProfile.status,201,formulationProfile.body.error);
  const publishedFormulation=await admin(runtime,`/api/admin/archive-color-materials/formulations/${formulation.body.record.id}`,{
    publication_state:"published",public_visible:true,
  },"PATCH");
  assert.equal(publishedFormulation.status,200,publishedFormulation.body.error);
  const frozenFormulationProfile=await admin(runtime,`/api/admin/archive-color-materials/profiles/${formulationProfile.body.record.id}`,{
    srgb_hex:"#000000",
  },"PATCH");
  assert.equal(frozenFormulationProfile.status,409);
  const frozen=await admin(runtime,`/api/admin/archive-color-materials/formulations/${formulation.body.record.id}`,{finish_label:"Changed later"},"PATCH");
  assert.equal(frozen.status,409);

  const tool=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Palette knife",slug:"palette-knife",material_kind:"tool",medium_scope:"art",
  });
  const recipe=await admin(runtime,"/api/admin/archive-color-materials/recipes",{
    name:"Night Window Blue",slug:"night-window-blue",medium_scope:"art",publication_state:"published",public_visible:true,
  });
  const version=await admin(runtime,"/api/admin/archive-color-materials/recipe-versions",{
    recipe_id:recipe.body.record.id,resulting_finish:"satin",instructions:"Fold until uniform.",
  });
  const paintComponent=await admin(runtime,"/api/admin/archive-color-materials/recipe-components",{
    recipe_version_id:version.body.record.id,formulation_id:formulation.body.record.id,
    quantity_value:3,quantity_unit:"parts",
  });
  assert.equal(paintComponent.status,201,paintComponent.body.error);
  const pigmentComponent=await admin(runtime,"/api/admin/archive-color-materials/recipe-components",{
    recipe_version_id:version.body.record.id,raw_pigment_material_id:pigment.body.record.id,
    quantity_value:1,quantity_unit:"grams",approximate:true,quantity_note:"scant",
  });
  assert.equal(pigmentComponent.status,201,pigmentComponent.body.error);
  const rejectedTool=await admin(runtime,"/api/admin/archive-color-materials/recipe-components",{
    recipe_version_id:version.body.record.id,raw_pigment_material_id:tool.body.record.id,
    quantity_value:1,quantity_unit:"parts",
  });
  assert.equal(rejectedTool.status,409);
  const rejectedCycle=await admin(runtime,"/api/admin/archive-color-materials/recipe-components",{
    recipe_version_id:version.body.record.id,nested_recipe_version_id:version.body.record.id,
    quantity_value:1,quantity_unit:"parts",
  });
  assert.equal(rejectedCycle.status,409);
  const blockedVersion=await admin(runtime,`/api/admin/archive-color-materials/recipe-versions/${version.body.record.id}`,{
    publication_state:"published",public_visible:true,
  },"PATCH");
  assert.equal(blockedVersion.status,409);
  assert.match(blockedVersion.body.error,/sourced color profile/i);
  const recipeProfile=await addProfile(runtime,"recipe-version",version.body.record.id,"#183F78");
  assert.equal(recipeProfile.status,201,recipeProfile.body.error);
  const publishedVersion=await admin(runtime,`/api/admin/archive-color-materials/recipe-versions/${version.body.record.id}`,{
    publication_state:"published",public_visible:true,
  },"PATCH");
  assert.equal(publishedVersion.status,200,publishedVersion.body.error);
  const frozenRecipeProfile=await admin(runtime,`/api/admin/archive-color-materials/profiles/${recipeProfile.body.record.id}`,{
    srgb_hex:"#000000",
  },"PATCH");
  assert.equal(frozenRecipeProfile.status,409);
  const frozenComponent=await handleConstructApi(request(`/api/admin/archive-color-materials/recipe-components/${paintComponent.body.record.id}`,{method:"DELETE",admin:true}),runtime);
  assert.equal(frozenComponent.status,409);

  const color=await payload(await handleConstructApi(request("/api/archive/colors/night-window-blue"),runtime));
  assert.equal(color.status,200,color.body.error);
  assert.equal(color.body.color.versions[0].components.length,2);
  const material=await payload(await handleConstructApi(request("/api/archive/materials/heavy-body-ultramarine"),runtime));
  assert.equal(material.status,200,material.body.error);
  assert.equal(material.body.material.declared_pigments[0].provenance,"manufacturer-declared");
  assert.equal(material.body.material.declared_pigments[0].bottle_wording,"Pigment: PB29");
  assert.equal("formulations" in material.body.material,false);
  const publicState=sql.prepare(`SELECT aos.id state_id,aov.entity_id
    FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id
    JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id JOIN content_entities ce ON ce.id=ad.entity_id
    WHERE aos.publication_state='published' AND aos.public_visible=1
      AND aov.publication_state='published' AND aov.public_visible=1
      AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public' LIMIT 1`).get();
  const usage=await admin(runtime,`/api/admin/archive-dossiers/${publicState.state_id}/palette-materials/colors`,{
    recipe_version_id:version.body.record.id,public_label:"Night Window Blue",public_swatch_hex:"#183F78",
    publication_state:"published",public_visible:true,
  });
  assert.equal(usage.status,201,usage.body.error);
  const privateRecipe=await admin(runtime,"/api/admin/archive-color-materials/recipes",{
    name:"Internal House Formula",slug:"internal-house-formula",medium_scope:"art",
  });
  const privateVersion=await admin(runtime,"/api/admin/archive-color-materials/recipe-versions",{
    recipe_id:privateRecipe.body.record.id,resulting_finish:"matte",instructions:"Private studio formula.",
  });
  const privateUsage=await admin(runtime,`/api/admin/archive-dossiers/${publicState.state_id}/palette-materials/colors`,{
    recipe_version_id:privateVersion.body.record.id,public_label:"House blue",public_swatch_hex:"#244A72",
    publication_state:"published",public_visible:true,
  });
  assert.equal(privateUsage.status,201,privateUsage.body.error);
  const redactedDetail=await payload(await handleConstructApi(request(`/api/archive/items/${sql.prepare("SELECT archive_slug FROM archive_dossiers WHERE entity_id=?").get(publicState.entity_id).archive_slug}`),runtime));
  const publicOverride=redactedDetail.body.color_usages.find(entry=>entry.id===privateUsage.body.record.id);
  assert.equal(publicOverride.label,"House blue");
  assert.equal(publicOverride.recipe,null);
  assert.equal(publicOverride.product,null);
  assert.equal(JSON.stringify(redactedDetail.body).includes("Internal House Formula"),false);
  assert.equal(JSON.stringify(redactedDetail.body).includes("Private studio formula"),false);
  const hiddenFormulaFilter=await payload(await handleConstructApi(request("/api/archive/items?color=internal-house-formula&match=lineage"),runtime));
  assert.equal(hiddenFormulaFilter.body.count,0);
  const publicLabelSearch=await payload(await handleConstructApi(request("/api/archive/items?q=House%20blue"),runtime));
  assert.ok(publicLabelSearch.body.items.some(item=>item.entity_id===publicState.entity_id));
  const privateFragment=sql.prepare("SELECT label,body FROM archive_search_fragments WHERE fragment_type='palette-color' AND source_id=?").get(privateUsage.body.record.id);
  assert.equal(privateFragment.label,"House blue");
  assert.equal(`${privateFragment.label} ${privateFragment.body}`.includes("Internal House Formula"),false);
  const publicRecipeSearch=await payload(await handleConstructApi(request("/api/archive/items?q=Night%20Window%20Blue"),runtime));
  assert.ok(publicRecipeSearch.body.items.some(item=>item.entity_id===publicState.entity_id));
  const direct=await payload(await handleConstructApi(request("/api/archive/items?pigment=PB29&presence=direct"),runtime));
  assert.ok(direct.body.items.some(item=>item.entity_id===publicState.entity_id));
  assert.equal(direct.body.items.find(item=>item.entity_id===publicState.entity_id).matches[0].type,"direct-raw-pigment");
  const declared=await payload(await handleConstructApi(request("/api/archive/items?pigment=PB29&presence=declared"),runtime));
  assert.ok(declared.body.items.some(item=>item.entity_id===publicState.entity_id));
  assert.equal(declared.body.items.find(item=>item.entity_id===publicState.entity_id).matches[0].type,"manufacturer-declared-pigment");
});

test("state usages support public overrides while private batches and equipment identities remain redacted",async()=>{
  const sql=database(),runtime=env(sql);
  const publicState=sql.prepare(`SELECT aos.id state_id,aov.entity_id,ad.archive_slug
    FROM archive_object_states aos
    JOIN archive_object_versions aov ON aov.id=aos.version_id
    JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id
    JOIN content_entities ce ON ce.id=ad.entity_id
    WHERE aos.publication_state='published' AND aos.public_visible=1
      AND aov.publication_state='published' AND aov.public_visible=1
      AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    ORDER BY aov.entity_id LIMIT 1`).get();
  assert.ok(publicState);
  const paint=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Private formula ink",slug:"private-formula-ink",material_kind:"tattoo-ink",brand:"Example Ink",
    product_line:"Core",product_name:"Tattoo Ink",color_name:"Atlantic",product_code:"A-19",
    medium_scope:"tattoo",publication_state:"published",public_visible:true,
  });
  const formulation=await admin(runtime,"/api/admin/archive-color-materials/formulations",{
    material_id:paint.body.record.id,normalized_finish:"unspecified",
  });
  assert.equal(formulation.status,201,formulation.body.error);
  assert.equal((await addProfile(runtime,"material-formulation",formulation.body.record.id,"#174A70")).status,201);
  const publishedFormulation=await admin(runtime,`/api/admin/archive-color-materials/formulations/${formulation.body.record.id}`,{
    publication_state:"published",public_visible:true,
  },"PATCH");
  assert.equal(publishedFormulation.status,200,publishedFormulation.body.error);
  const batch=await admin(runtime,"/api/admin/archive-color-materials/batches",{
    formulation_id:formulation.body.record.id,lot_number:"LOT-PRIVATE-77",expiration_date:"2028-01-01",opened_date:"2026-07-01",private_notes:"cabinet two",
  });
  assert.equal(batch.status,201,batch.body.error);
  const usage=await admin(runtime,`/api/admin/archive-dossiers/${publicState.state_id}/palette-materials/colors`,{
    formulation_id:formulation.body.record.id,usage_status:"applied",technique:"layered wash",layer_order:2,
    public_label:"Atlantic blue",public_swatch_hex:"#174A70",publication_state:"published",public_visible:true,
  });
  assert.equal(usage.status,201,usage.body.error);
  const general=await admin(runtime,`/api/admin/archive-dossiers/${publicState.state_id}/palette-materials/materials`,{
    material_id:paint.body.record.id,formulation_id:formulation.body.record.id,batch_id:batch.body.record.id,
    usage_role:"colorant",publication_state:"published",public_visible:true,
  });
  assert.equal(general.status,201,general.body.error);

  const detail=await payload(await handleConstructApi(request(`/api/archive/items/${publicState.archive_slug}`),runtime));
  assert.equal(detail.status,200,detail.body.error);
  assert.equal(detail.body.color_usages.some(entry=>entry.label==="Atlantic blue"),true);
  const serialized=JSON.stringify(detail.body);
  assert.equal(serialized.includes("LOT-PRIVATE-77"),false);
  assert.equal(serialized.includes("cabinet two"),false);

  const filtered=await payload(await handleConstructApi(request("/api/archive/items?material=private-formula-ink"),runtime));
  assert.equal(filtered.status,200,filtered.body.error);
  assert.ok(filtered.body.items.some(entry=>entry.entity_id===publicState.entity_id));
  assert.equal(filtered.body.items.find(entry=>entry.entity_id===publicState.entity_id).matches[0].type,"material-usage");
});

test("reviewed placement maps store owned geometry and export inert accessible SVG",async()=>{
  const sql=database(),runtime=env(sql);
  const state=sql.prepare(`SELECT aos.id state_id,aov.entity_id
    FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id
    WHERE aos.publication_state='published' AND aos.public_visible=1
      AND aov.publication_state='published' AND aov.public_visible=1 LIMIT 1`).get();
  sql.exec(`INSERT INTO media_assets(
    id,source_url,original_filename,mime_type,width,height,alt_text,privacy,
    consent_status,state,public_presentation,created_by,created_at,updated_at
  ) VALUES(
    'palette-map-source','https://cdn.example.test/palette-source.jpg','palette-source.jpg','image/jpeg',
    1200,900,'Reviewed source artwork','public','not-required','active','inline','test',datetime('now'),datetime('now')
  )`);
  const media=sql.prepare(`SELECT id,width,height FROM media_assets
    WHERE state='active' AND privacy='public' AND consent_status IN ('not-required','granted')
      AND public_presentation='inline' AND mime_type LIKE 'image/%' AND width>0 AND height>0 LIMIT 1`).get();
  assert.ok(state&&media);
  const paint=await admin(runtime,"/api/admin/archive-color-materials/materials",{name:"Map paint",slug:"map-paint",material_kind:"art-paint",medium_scope:"art",publication_state:"published",public_visible:true});
  const formulation=await admin(runtime,"/api/admin/archive-color-materials/formulations",{material_id:paint.body.record.id});
  assert.equal(formulation.status,201,formulation.body.error);
  assert.equal((await addProfile(runtime,"material-formulation",formulation.body.record.id,"#194A76")).status,201);
  assert.equal((await admin(runtime,`/api/admin/archive-color-materials/formulations/${formulation.body.record.id}`,{publication_state:"published",public_visible:true},"PATCH")).status,200);
  const usage=await admin(runtime,`/api/admin/archive-dossiers/${state.state_id}/palette-materials/colors`,{
    formulation_id:formulation.body.record.id,public_label:"Mapped blue",public_swatch_hex:"#194A76",publication_state:"published",public_visible:true,
  });
  const map=await admin(runtime,`/api/admin/archive-dossiers/${state.state_id}/palette-materials/maps`,{
    source_media_id:media.id,title:"Reviewed palette",width:media.width,height:media.height,publication_state:"published",public_visible:true,
  });
  assert.equal(map.status,201,map.body.error);
  const rejected=await admin(runtime,`/api/admin/archive-dossiers/${state.state_id}/palette-materials/regions`,{
    map_id:map.body.record.id,color_usage_id:usage.body.record.id,geometry_type:"path",
    geometry:{d:"M0 0 L10 10 <script>alert(1)</script>"},
  });
  assert.equal(rejected.status,409);
  const region=await admin(runtime,`/api/admin/archive-dossiers/${state.state_id}/palette-materials/regions`,{
    map_id:map.body.record.id,color_usage_id:usage.body.record.id,label:"Upper field",geometry_type:"polygon",
    geometry:{points:"10,10 120,15 90,140 12,100",matrix:[1,0,0,1,12,18]},layer_order:2,
  });
  assert.equal(region.status,201,region.body.error);
  const publicMap=await payload(await handleConstructApi(request(`/api/archive/palette-maps/${map.body.record.id}`),runtime));
  assert.equal(publicMap.status,200,publicMap.body.error);
  assert.equal(publicMap.body.map.regions[0].usage.label,"Mapped blue");
  assert.equal(publicMap.body.map.regions[0].usage.product.slug,"map-paint");
  assert.deepEqual(publicMap.body.map.regions[0].geometry.matrix,[1,0,0,1,12,18]);
  const svg=await handleConstructApi(request(`/api/archive/palette-maps/${map.body.record.id}.svg`),runtime);
  assert.equal(svg.status,200);
  const markup=await svg.text();
  assert.match(markup,/role="img"/);
  assert.match(markup,/1\. Mapped blue/);
  assert.match(markup,/transform="matrix\(1 0 0 1 12 18\)"/);
  assert.equal(markup.includes("<script"),false);
  assert.equal(svg.headers.get("content-security-policy"),"default-src 'none'; style-src 'none'; sandbox");
});

test("finish-aware duplicate checks require an intentional formulation version",async()=>{
  const sql=database(),runtime=env(sql);
  const paint=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Duplicate finish paint",slug:"duplicate-finish-paint",material_kind:"art-paint",
    brand:"Example",product_line:"Studio",product_name:"Acrylic",color_name:"Blue",product_code:"B-1",
  });
  const first=await admin(runtime,"/api/admin/archive-color-materials/formulations",{
    material_id:paint.body.record.id,normalized_finish:"satin",finish_label:"Low sheen",
  });
  assert.equal(first.status,201,first.body.error);
  const blocked=await admin(runtime,"/api/admin/archive-color-materials/formulations",{
    material_id:paint.body.record.id,normalized_finish:"satin",finish_label:" low sheen ",
  });
  assert.equal(blocked.status,409);
  assert.equal(blocked.body.duplicate_candidate.id,first.body.record.id);
  const intentional=await admin(runtime,"/api/admin/archive-color-materials/formulations",{
    material_id:paint.body.record.id,normalized_finish:"satin",finish_label:"Low sheen",
    confirm_distinct_version:true,
  });
  assert.equal(intentional.status,201,intentional.body.error);
  assert.equal(intentional.body.record.version_number,2);
});

test("draft pigment declarations can be reviewed, edited, deduplicated, and safely removed",async()=>{
  const sql=database(),runtime=env(sql);
  const pigment=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Review Carbon Black",material_kind:"raw-pigment",pigment_code:"PBK7",
  });
  const ink=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Review Black Ink",material_kind:"tattoo-ink",brand:"Review Ink",medium_scope:"tattoo",
  });
  const formulation=await admin(runtime,"/api/admin/archive-color-materials/formulations",{
    material_id:ink.body.record.id,normalized_finish:"matte",finish_label:"Flat black",
  });
  const declarationBody={
    formulation_id:formulation.body.record.id,pigment_material_id:pigment.body.record.id,
    normalized_pigment_code:"PBk7",bottle_wording:"Carbon Black",
    source_type:"safety-data-sheet",source_url:"https://manufacturer.example/sds",
    observed_at:"2026-07-30",
  };
  const declaration=await admin(runtime,"/api/admin/archive-color-materials/declared-pigments",declarationBody);
  assert.equal(declaration.status,201,declaration.body.error);
  const duplicate=await admin(runtime,"/api/admin/archive-color-materials/declared-pigments",declarationBody);
  assert.equal(duplicate.status,409);
  assert.equal(duplicate.body.duplicate_candidate.id,declaration.body.record.id);

  const edited=await admin(runtime,`/api/admin/archive-color-materials/declared-pigments/${declaration.body.record.id}`,{
    bottle_wording:"Carbon Black (CI 77266)",
  },"PATCH");
  assert.equal(edited.status,200,edited.body.error);
  assert.equal(edited.body.record.normalized_pigment_code,"PBK7");
  assert.equal(edited.body.record.bottle_wording,"Carbon Black (CI 77266)");

  const snapshot=await payload(await handleConstructApi(request("/api/admin/archive-color-materials",{admin:true}),runtime));
  const reviewed=snapshot.body.declared_pigments.find(record=>record.id===declaration.body.record.id);
  assert.equal(reviewed.pigment_name,"Review Carbon Black");
  assert.equal(reviewed.pigment_slug,"review-carbon-black");

  const removed=await admin(runtime,`/api/admin/archive-color-materials/declared-pigments/${declaration.body.record.id}`,{},"DELETE");
  assert.equal(removed.status,200,removed.body.error);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM archive_material_declared_pigments WHERE id=?").get(declaration.body.record.id).count,0);
});

test("Tattoo session evidence is state-scoped, privately inspectable, and publicly redacted",async()=>{
  const sql=database(),runtime=env(sql);
  const states=sql.prepare(`SELECT aos.id state_id,aov.entity_id,ad.archive_slug
    FROM archive_object_states aos
    JOIN archive_object_versions aov ON aov.id=aos.version_id
    JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id
    JOIN content_entities ce ON ce.id=ad.entity_id
    WHERE aos.publication_state='published' AND aos.public_visible=1
      AND aov.publication_state='published' AND aov.public_visible=1
      AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public'
    ORDER BY aos.id LIMIT 2`).all();
  assert.equal(states.length,2);
  sql.prepare(`INSERT INTO appointments(
    id,booking_type_id,status,client_name,client_email,client_phone,start_at,end_at,
    deposit_cents,currency,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(
    "archive-session-private","tattoo_quarter","confirmed","Private Session Client",
    "private-session@example.test","555-0100","2026-08-10T14:00:00Z","2026-08-10T15:30:00Z",5000,"USD",
  );
  const linked=await admin(runtime,`/api/admin/archive-dossiers/${states[0].state_id}/palette-materials/sessions`,{
    appointment_id:"archive-session-private",session_order:1,studio_label:"Session 1 · linework",notes:"Private session note",
  });
  assert.equal(linked.status,201,linked.body.error);
  const tool=await admin(runtime,"/api/admin/archive-color-materials/materials",{
    name:"Session tool",slug:"session-tool",material_kind:"tool",publication_state:"published",public_visible:true,
  });
  const usage=await admin(runtime,`/api/admin/archive-dossiers/${states[0].state_id}/palette-materials/materials`,{
    material_id:tool.body.record.id,tattoo_session_ref_id:linked.body.record.id,
    usage_role:"linework setup",publication_state:"published",public_visible:true,
  });
  assert.equal(usage.status,201,usage.body.error);
  const wrongState=await admin(runtime,`/api/admin/archive-dossiers/${states[1].state_id}/palette-materials/materials`,{
    material_id:tool.body.record.id,tattoo_session_ref_id:linked.body.record.id,
  });
  assert.equal(wrongState.status,409);

  const adminState=await payload(await handleConstructApi(request(`/api/admin/archive-dossiers/${states[0].state_id}/palette-materials`,{admin:true}),runtime));
  assert.equal(adminState.body.tattoo_sessions[0].client_name,"Private Session Client");
  const preview=await payload(await handleConstructApi(request(`/api/admin/archive-dossiers/${states[0].state_id}/palette-materials/preview`,{admin:true}),runtime));
  assert.equal(preview.status,200,preview.body.error);
  assert.equal(preview.body.eligible,true);
  const publicDetail=await payload(await handleConstructApi(request(`/api/archive/items/${states[0].archive_slug}`),runtime));
  assert.deepEqual(
    preview.body.payload.material_usages,
    publicDetail.body.material_usages.filter(entry=>entry.state_id===states[0].state_id),
  );
  const serialized=JSON.stringify(preview.body);
  for(const privateValue of ["Private Session Client","private-session@example.test","archive-session-private","Private session note","tattoo_session_ref_id"]){
    assert.equal(serialized.includes(privateValue),false);
  }
});

test("Studio SVG import owns transforms and public map interactions use privacy-safe analytics",()=>{
  const studioSource=readFileSync(join(ROOT,"studio/archive-colors-materials.js"),"utf8");
  const publicSource=readFileSync(join(ROOT,"js/archive-public.js"),"utf8");
  const publicReferenceSource=readFileSync(join(ROOT,"js/archive-colors-materials.js"),"utf8");
  const referenceCss=readFileSync(join(ROOT,"css/archive-colors-materials.css"),"utf8");
  const archiveCss=readFileSync(join(ROOT,"css/archive-public.css"),"utf8");
  const context={window:{},console};
  runInNewContext(studioSource,context);
  const {transformMatrix,matrixMultiply,srgbHexToColorProfile}=context.window.ArchiveColorMaterialsStudio;
  assert.deepEqual(Array.from(transformMatrix("translate(10 20) scale(2)")),[2,0,0,2,10,20]);
  assert.deepEqual(Array.from(matrixMultiply([1,0,0,1,5,6],[1,0,0,1,7,8])),[1,0,0,1,12,14]);
  assert.deepEqual({...srgbHexToColorProfile("#000000")},{
    lab_l:0,lab_a:0,lab_b:0,oklch_l:0,oklch_c:0,oklch_h:"",
  });
  const red=srgbHexToColorProfile("#ff0000");
  assert.ok(Math.abs(red.lab_l-53.2408)<.0002);
  assert.ok(Math.abs(red.lab_a-80.0925)<.0002);
  assert.ok(Math.abs(red.lab_b-67.2032)<.0002);
  assert.ok(Math.abs(red.oklch_l-.627955)<.000002);
  assert.ok(Math.abs(red.oklch_c-.257683)<.000002);
  assert.ok(Math.abs(red.oklch_h-29.234)<.002);
  assert.match(studioSource,/Calculate Lab and OKLCH from sRGB/);
  assert.match(studioSource,/mount:mountSimple/);
  assert.match(studioSource,/Add premade paint or ink/);
  assert.match(studioSource,/Create mixed color/);
  assert.match(studioSource,/No second visibility control is required/);
  assert.match(studioSource,/Shared raw pigments/);
  assert.match(studioSource,/Add a color profile to unlock publication/);
  assert.match(studioSource,/required readonly/);
  assert.match(studioSource,/Review every imported region/);
  assert.match(studioSource,/preserveAspectRatio/);
  assert.match(studioSource,/Publication blocked/);
  assert.match(studioSource,/data-edit-material/);
  assert.match(studioSource,/data-edit-formulation/);
  assert.match(studioSource,/data-edit-declaration/);
  assert.match(studioSource,/data-remove-declaration/);
  assert.match(studioSource,/data-archive-material/);
  assert.match(studioSource,/Visual color review/);
  assert.match(studioSource,/data-review-run/);
  assert.match(studioSource,/Approve complete set/);
  assert.match(studioSource,/Gold and Ochre are separate families/);
  assert.match(studioSource,/querySelectorAll\("path,polygon,polyline,rect,circle,ellipse"\)/);
  assert.doesNotMatch(studioSource,/innerHTML\s*=\s*await file\.text/);
  assert.doesNotMatch(publicReferenceSource,/material\.formulations/);
  assert.doesNotMatch(publicReferenceSource,/Commercial formulation/);
  assert.match(publicReferenceSource,/Visual color families/);
  assert.match(publicReferenceSource,/Mediums &amp; supports/);
  assert.match(publicReferenceSource,/visual_color/);
  assert.match(publicReferenceSource,/work_type/);
  assert.match(publicReferenceSource,/showModal\(\)/);
  assert.match(publicReferenceSource,/popstate/);
  assert.match(publicReferenceSource,/data-dialog-filter/);
  assert.match(publicSource,/data-palette-usage=.*aria-pressed="false"/);
  assert.match(publicSource,/node\.setAttribute\("aria-pressed",String\(selected\)\)/);
  for(const action of ["palette-map-open","palette-region","palette-isolate","palette-svg-download","palette-png-download"]){
    assert.match(publicSource,new RegExp(action));
  }
  assert.doesNotMatch(referenceCss,/var\(--(?:ring-faint|muted|sans|color-text)\b/);
  const paletteCss=archiveCss.slice(archiveCss.indexOf(".archive-palette-document"));
  assert.doesNotMatch(paletteCss,/var\(--(?:ring-faint|muted|sans|color-text)\b/);
  assert.match(referenceCss,/border:5px solid var\(--archive-faint\)/);
  assert.match(referenceCss,/\.archive-color-family \{/);
  assert.match(referenceCss,/\.archive-color-dialog \{/);
  assert.match(referenceCss,/gap:16px/);
  assert.match(paletteCss,/stroke:var\(--archive-focus\)/);
});
