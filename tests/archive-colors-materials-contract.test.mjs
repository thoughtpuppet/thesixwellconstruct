import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { ciede2000 } from "../functions/api/construct/_colors-materials.js";
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

test("CIEDE2000 uses the published reference calculation",()=>{
  const distance=ciede2000([50,2.6772,-79.7751],[50,0,-82.7485]);
  assert.ok(Math.abs(distance-2.0425)<0.0001);
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

test("products, formulations, recipes, and nested components preserve authored provenance",async()=>{
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
  const publishedFormulation=await admin(runtime,`/api/admin/archive-color-materials/formulations/${formulation.body.record.id}`,{
    publication_state:"published",public_visible:true,
  },"PATCH");
  assert.equal(publishedFormulation.status,200,publishedFormulation.body.error);
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
  const publishedVersion=await admin(runtime,`/api/admin/archive-color-materials/recipe-versions/${version.body.record.id}`,{
    publication_state:"published",public_visible:true,
  },"PATCH");
  assert.equal(publishedVersion.status,200,publishedVersion.body.error);
  const frozenComponent=await handleConstructApi(request(`/api/admin/archive-color-materials/recipe-components/${paintComponent.body.record.id}`,{method:"DELETE",admin:true}),runtime);
  assert.equal(frozenComponent.status,409);

  const color=await payload(await handleConstructApi(request("/api/archive/colors/night-window-blue"),runtime));
  assert.equal(color.status,200,color.body.error);
  assert.equal(color.body.color.versions[0].components.length,2);
  const material=await payload(await handleConstructApi(request("/api/archive/materials/heavy-body-ultramarine"),runtime));
  assert.equal(material.status,200,material.body.error);
  assert.equal(material.body.material.formulations[0].declared_pigments[0].provenance,"manufacturer-declared");
  assert.equal(material.body.material.formulations[0].declared_pigments[0].bottle_wording,"Pigment: PB29");
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
    material_id:paint.body.record.id,normalized_finish:"unspecified",publication_state:"published",public_visible:true,
  });
  assert.equal(formulation.status,201,formulation.body.error);
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
  const formulation=await admin(runtime,"/api/admin/archive-color-materials/formulations",{material_id:paint.body.record.id,publication_state:"published",public_visible:true});
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
    geometry:{points:"10,10 120,15 90,140 12,100"},layer_order:2,
  });
  assert.equal(region.status,201,region.body.error);
  const publicMap=await payload(await handleConstructApi(request(`/api/archive/palette-maps/${map.body.record.id}`),runtime));
  assert.equal(publicMap.status,200,publicMap.body.error);
  assert.equal(publicMap.body.map.regions[0].usage.label,"Mapped blue");
  const svg=await handleConstructApi(request(`/api/archive/palette-maps/${map.body.record.id}.svg`),runtime);
  assert.equal(svg.status,200);
  const markup=await svg.text();
  assert.match(markup,/role="img"/);
  assert.match(markup,/1\. Mapped blue/);
  assert.equal(markup.includes("<script"),false);
  assert.equal(svg.headers.get("content-security-policy"),"default-src 'none'; style-src 'none'; sandbox");
});
