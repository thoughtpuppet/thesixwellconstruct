import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const TEST_TOKEN='sny00-isolated-fixture-only'; // Test constant, never a deployed credential.
class Statement {
  constructor(db,sql,values=[]){Object.assign(this,{db,sql,values});}
  bind(...values){return new Statement(this.db,this.sql,values);}
  async first(){return this.db.prepare(this.sql).get(...this.values)||null;}
  async all(){return {results:this.db.prepare(this.sql).all(...this.values)};}
  async run(){const result=this.db.prepare(this.sql).run(...this.values);return {success:true,meta:{changes:Number(result.changes)}};}
}
export function fixture({open=false,capacity=6,maxParty=4,beforeDraft=false}={}) {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort()) {
    if(beforeDraft && name.startsWith('0245_')) continue;
    db.exec(readFileSync(join(ROOT,'migrations',name),'utf8'));
  }
  if(open) {
    db.prepare("UPDATE site_visibility_rules SET visibility='public' WHERE path='/events/sny-00'").run();
    db.prepare("UPDATE events SET publication_state='published',status='open' WHERE slug='sny-00'").run();
    db.prepare("UPDATE event_occurrences SET status='open',capacity=?,max_seats_per_order=? WHERE event_id='evt_sny_00'").run(capacity,maxParty);
  }
  const binding={prepare:sql=>new Statement(db,sql),async batch(statements){db.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  return {db,env:{SUBMISSIONS_DB:binding,SUBMISSIONS_ADMIN_TOKEN:TEST_TOKEN,PUBLIC_SITE_URL:'http://127.0.0.1:4185'}};
}
export function request(path,{method='GET',body,admin=false}={}) {
  return new Request('http://127.0.0.1:4185'+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(admin?{authorization:'Bearer '+TEST_TOKEN}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
