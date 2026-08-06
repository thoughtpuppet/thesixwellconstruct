import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  handleAdminMerchApi,
  handleLaunchAlertSignup,
  handleLaunchAlertToken,
  handleMerchCatalog,
  handleMerchItem,
} from "../functions/api/merch/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

class D1Statement {
  constructor(database, sql, values = []) { this.database=database;this.sql=sql;this.values=values }
  bind(...values){return new D1Statement(this.database,this.sql,values)}
  async first(){return this.database.prepare(this.sql).get(...this.values)||null}
  async all(){return{results:this.database.prepare(this.sql).all(...this.values)}}
  async run(){const result=this.database.prepare(this.sql).run(...this.values);return{success:true,meta:{changes:Number(result.changes||0),last_row_id:Number(result.lastInsertRowid||0)}}}
}
class LocalD1 {
  constructor(database){this.database=database;this.queue=Promise.resolve()}
  prepare(sql){return new D1Statement(this.database,sql)}
  async batch(statements){const execute=async()=>{this.database.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.exec("COMMIT");return results}catch(error){this.database.exec("ROLLBACK");throw error}};const result=this.queue.then(execute,execute);this.queue=result.then(()=>undefined,()=>undefined);return result}
}
function migratedDatabase(){const database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON");for(const name of readdirSync(join(ROOT,"migrations")).filter(name=>name.endsWith(".sql")).sort())database.exec(readFileSync(join(ROOT,"migrations",name),"utf8"));return database}
function request(path,method="GET",body,admin=false){return new Request(`https://example.test${path}`,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(admin?{authorization:"Bearer studio-secret"}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
function shopifyResponse(product){return new Response(JSON.stringify({data:{product}}),{status:200,headers:{"content-type":"application/json"}})}
function shopifyProduct(handle,title="MAZE Puffer Jacket"){return{id:`gid://shopify/Product/${handle}`,handle,title,tags:["construct-merch"],productType:"apparel",availableForSale:true,featuredImage:{url:"https://cdn.example/product.jpg",altText:title},images:{nodes:[]},options:[{name:"Size",values:["M"]}],priceRange:{minVariantPrice:{amount:"150.00",currencyCode:"USD"}},variants:{nodes:[{id:`gid://shopify/ProductVariant/${handle}`,title:"M",availableForSale:true,price:{amount:"150.00",currencyCode:"USD"},image:null,selectedOptions:[{name:"Size",value:"M"}]}]}}}

test("Merch migration makes Studio authoritative and preserves intended publication states",()=>{
  const database=migratedDatabase();
  const columns=database.prepare("PRAGMA table_info(merch_items)").all();
  assert.equal(columns.find(column=>column.name==="shopify_handle").notnull,0);
  assert.equal(columns.some(column=>column.name==="slug"),true);
  const records=database.prepare("SELECT slug,shopify_handle,state,availability_state,route FROM merch_items ORDER BY sort_order").all();
  assert.deepEqual(records.map(record=>record.slug),["six-well-clothing","lostmarbles-hoodie","marbles-print","maze-puffer-jacket"]);
  assert.equal(records.find(record=>record.slug==="six-well-clothing").shopify_handle,null);
  assert.equal(records.find(record=>record.slug==="maze-puffer-jacket").state,"published");
  assert.equal(records.find(record=>record.slug==="marbles-print").state,"draft");
  assert.equal(database.prepare("SELECT visibility FROM content_entities WHERE id='merch-marbles-print'").get().visibility,"internal");
});

test("public catalogue survives Shopify failure and hides private Merch drafts",async()=>{
  const database=migratedDatabase();
  const response=await handleMerchCatalog(request("/api/shop/catalog"),{SUBMISSIONS_DB:new LocalD1(database)});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.deepEqual(payload.products.map(product=>product.slug),["six-well-clothing","lostmarbles-hoodie","maze-puffer-jacket"]);
  assert.equal(payload.products.find(product=>product.slug==="six-well-clothing").notifyEnabled,true);
  assert.equal(payload.products.find(product=>product.slug==="maze-puffer-jacket").pagePath,"/merch/maze-puffer-jacket/");
  assert.equal(payload.commerceAvailable,false);
  assert.equal((await handleMerchItem(request("/api/shop/items/marbles-print"),{SUBMISSIONS_DB:new LocalD1(database)},"marbles-print")).status,404);
});

test("newsletter consent is separate and Beehiiv failure cannot invalidate a product alert",async()=>{
  const database=migratedDatabase();const sent=[];
  const env={SUBMISSIONS_DB:new LocalD1(database),EMAIL:{async send(message){sent.push(message);return{messageId:"confirmation-1"}}},PUBLIC_SITE_URL:"https://example.test",MERCH_ALERTS_ENABLED:"true",MERCH_EMAIL_SEND_ENABLED:"true",NOTIFICATION_FROM_EMAIL:"notifications@example.test",OUTREACH_CONSENT_SYNC_ENABLED:"true",BEEHIIV_API_KEY:"test-key",BEEHIIV_OUTREACH_PUBLICATION_ID:"pub_test"};
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({message:"temporary provider failure"}),{status:502,headers:{"content-type":"application/json"}});
  try{
    const response=await handleLaunchAlertSignup(request("/api/shop/launch-alerts","POST",{slug:"six-well-clothing",email:"newsletter@example.com",newsletterOptIn:true,disclosureVersion:"merch-alert-v1-2026-08-05"}),env);
    assert.equal(response.status,202,await response.clone().text());assert.equal(sent.length,1);
    const alert=database.prepare("SELECT status,newsletter_requested FROM merch_launch_alerts WHERE email='newsletter@example.com'").get();
    assert.equal(alert.status,"pending");assert.equal(alert.newsletter_requested,1);
    assert.equal(database.prepare("SELECT status FROM crm_consent_events WHERE normalized_value='newsletter@example.com' ORDER BY created_at DESC LIMIT 1").get().status,"pending");
  }finally{globalThis.fetch=originalFetch}
});

test("product alerts require confirmation and launch sends once with failed-only retry",async()=>{
  const database=migratedDatabase();
  const sent=[];
  let failLaunchOnce=true;
  const email={async send(message){sent.push(message);if(message.subject.includes("now available")&&failLaunchOnce){failLaunchOnce=false;throw new Error("temporary delivery failure")}return{messageId:`message-${sent.length}`}}};
  const env={SUBMISSIONS_DB:new LocalD1(database),EMAIL:email,PUBLIC_SITE_URL:"https://example.test",MERCH_ALERTS_ENABLED:"true",MERCH_EMAIL_SEND_ENABLED:"true",MERCH_LAUNCH_SEND_ENABLED:"true",NOTIFICATION_FROM_EMAIL:"notifications@example.test",NOTIFICATION_REPLY_TO:"reply@example.test",SUBMISSIONS_ADMIN_TOKEN:"studio-secret",SHOPIFY_STORE_DOMAIN:"store.example",SHOPIFY_STOREFRONT_ACCESS_TOKEN:"token",SHOPIFY_STOREFRONT_API_VERSION:"2025-07"};
  const signup=await handleLaunchAlertSignup(request("/api/shop/launch-alerts","POST",{slug:"maze-puffer-jacket",email:"Person@Example.com",newsletterOptIn:false,disclosureVersion:"merch-alert-v1-2026-08-05"}),env);
  assert.equal(signup.status,202,await signup.clone().text());
  assert.equal(sent.length,1);
  const token=decodeURIComponent(sent[0].html.match(/confirm\/\?token=([^"&]+)/)[1]);
  const stored=database.prepare("SELECT email,status,token_hash FROM merch_launch_alerts").get();
  assert.equal(stored.email,"person@example.com");assert.equal(stored.status,"pending");assert.notEqual(stored.token_hash,token);
  const confirmed=await handleLaunchAlertToken(request("/api/shop/launch-alerts/confirm","POST",{token}),env,"confirm");
  assert.equal(confirmed.status,200);assert.equal(database.prepare("SELECT status FROM merch_launch_alerts").get().status,"confirmed");
  const duplicate=await handleLaunchAlertSignup(request("/api/shop/launch-alerts","POST",{slug:"maze-puffer-jacket",email:"person@example.com",newsletterOptIn:false,disclosureVersion:"merch-alert-v1-2026-08-05"}),env);
  assert.equal(duplicate.status,202);assert.equal(sent.length,1);

  database.prepare("UPDATE merch_items SET shopify_handle='maze-puffer-jacket',updated_at='launch-version' WHERE id='merch-maze-puffer-jacket'").run();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>shopifyResponse(shopifyProduct("maze-puffer-jacket"));
  try{
    const preview=await handleAdminMerchApi(request("/api/admin/merch-workflow/merch-maze-puffer-jacket/preview","GET",undefined,true),env);
    const previewPayload=await preview.json();assert.equal(previewPayload.ready,true);assert.equal(previewPayload.audienceCount,1);
    const launch=await handleAdminMerchApi(request("/api/admin/merch-workflow/merch-maze-puffer-jacket/launch","POST",{confirmed:true,expectedUpdatedAt:"launch-version"},true),env);
    const launchPayload=await launch.json();assert.equal(launch.status,200,JSON.stringify(launchPayload));assert.equal(launchPayload.status,"partial");assert.equal(launchPayload.failed,1);
    assert.equal(database.prepare("SELECT availability_state FROM merch_items WHERE id='merch-maze-puffer-jacket'").get().availability_state,"available");
    const retry=await handleAdminMerchApi(request(`/api/admin/merch-workflow/launch-events/${launchPayload.launchEventId}/retry`,"POST",{},true),env);
    const retryPayload=await retry.json();assert.equal(retryPayload.status,"completed");assert.equal(retryPayload.sent,1);
    assert.equal(database.prepare("SELECT status FROM merch_launch_alerts").get().status,"sent");
    assert.equal(database.prepare("SELECT attempt_count FROM merch_launch_deliveries").get().attempt_count,2);
  }finally{globalThis.fetch=originalFetch}
});

test("Studio creation never requires or invents a Shopify handle",async()=>{
  const database=migratedDatabase();const env={SUBMISSIONS_DB:new LocalD1(database),SUBMISSIONS_ADMIN_TOKEN:"studio-secret"};
  const response=await handleAdminMerchApi(request("/api/admin/merch-workflow","POST",{title:"Future Object",slug:"future-object",availability_state:"coming_soon"},true),env);
  assert.equal(response.status,201,await response.clone().text());
  const record=(await response.json()).record;assert.equal(record.shopify_handle,null);assert.equal(record.state,"draft");assert.equal(record.route,"/merch/future-object/");
});

test("shared Merch routes and alert forms stay contractually connected",()=>{
  const worker=readFileSync(join(ROOT,"_worker.js"),"utf8"),catalog=readFileSync(join(ROOT,"js","shop-storefront.js"),"utf8"),detail=readFileSync(join(ROOT,"merch","detail","index.html"),"utf8"),alertsCss=readFileSync(join(ROOT,"css","merch-alerts.css"),"utf8"),merchApi=readFileSync(join(ROOT,"functions","api","merch","_lib.js"),"utf8");
  assert.match(worker,/serveMerchRecordPage/);assert.match(worker,/status: 410/);assert.match(worker,/merch\/marbles-print\.html/);
  assert.doesNotMatch(catalog,/PLACEHOLDER_PRODUCTS/);assert.match(catalog,/setupLaunchAlertForms\(grid\)/);
  assert.match(detail,/id="merch-record-data"/);assert.match(detail,/css\/merch-detail\.css/);assert.match(detail,/js\/merch-detail\.js/);
  assert.match(alertsCss,/grid-template-columns:1fr!important/);assert.match(merchApi,/AbortSignal\.timeout\(4000\)/);
});
