import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {handleConstructApi} from '../../functions/api/construct/_lib.js';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
class Statement{
  constructor(db,sql,values=[]){this.db=db;this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.db,this.sql,values);}
  async first(){return this.db.prepare(this.sql).get(...this.values)||null;}
  async all(){return {results:this.db.prepare(this.sql).all(...this.values)};}
  async run(){const s=this.db.prepare(this.sql);if(s.sourceSQL.trimStart().toUpperCase().startsWith('SELECT'))return {results:s.all(...this.values)};return {success:true,meta:{changes:Number(s.run(...this.values).changes)}};}
}
export class LocalD1{
  constructor(db){this.database=db;}
  prepare(sql){return new Statement(this.database,sql);}
  async batch(statements){this.database.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());this.database.exec('COMMIT');return results;}catch(e){this.database.exec('ROLLBACK');throw e;}}
}
export function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync(`${ROOT}/migrations`).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(`${ROOT}/migrations/${f}`,'utf8'));
  const env={SUBMISSIONS_DB:new LocalD1(sql),SUBMISSIONS_ADMIN_TOKEN:'local-retrospective-test'};
  async function call(path,method='GET',body,admin=true){const response=await handleConstructApi(new Request(`http://localhost${path}`,{method,headers:{...(admin?{authorization:`Bearer ${env.SUBMISSIONS_ADMIN_TOKEN}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);return {status:response.status,body:await response.json()};}
  async function note(slug='retrospective-fixture',body='Repeated passage. Original source. Repeated passage.'){
    const r=await call('/api/admin/archive-notes','POST',{title:'Retrospective fixture',slug,body_markdown:body,state:'published',public_visible:true,source_created_at:'2022-12-23T19:54:00-05:00',source_modified_at:'2023-11-26'});if(r.status!==201)throw Error(JSON.stringify(r));return r.body;
  }
  function media(owner,id,mime='image/png',options={}){
    sql.prepare("INSERT INTO media_assets(id,source_url,original_filename,mime_type,byte_size,privacy,state,public_presentation,duration_seconds,created_by,created_at,updated_at) VALUES(?,?,?,?,1,?,'active','inline',?,'test',datetime('now'),datetime('now'))").run(id,options.url||`/fixture/${id}`,`${id}.file`,mime,options.privacy||'public',mime.startsWith('image/')?null:60);
    sql.prepare("INSERT INTO archive_note_assets(id,note_entity_id,media_id,asset_token,role,public_visible,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,1,0,datetime('now'),datetime('now'))").run(`asset-${id}`,owner,id,id,options.role|| (mime.startsWith('image/')?'inline-image':'inline-document'));
  }
  return {sql,env,call,note,media};
}
