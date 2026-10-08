import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const MIGRATION='0238_kinmarking_grief_and_studio_editions.sql';
class Statement {
  constructor(db,sql,values=[]){Object.assign(this,{db,sql,values});}
  bind(...values){return new Statement(this.db,this.sql,values);}
  async first(){return this.db.prepare(this.sql).get(...this.values)||null;}
  async all(){return {results:this.db.prepare(this.sql).all(...this.values)};}
  async run(){const r=this.db.prepare(this.sql).run(...this.values);return {success:true,meta:{changes:Number(r.changes)}};}
}
export function fixture({migrate=true}={}){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(join(ROOT,'migrations')).filter(n=>n.endsWith('.sql')&&n<MIGRATION).sort()) db.exec(readFileSync(join(ROOT,'migrations',name),'utf8'));
  db.prepare(`INSERT INTO events(id,slug,title,description,location,status,publication_state,is_recurring,created_at,updated_at)
    VALUES('kinmarking-qa','kinmarking','KINMARKING','KINMARKING inquiry','Atlanta','closed','announced',1,datetime('now'),datetime('now'))`).run();
  const rows=[['01','Oral Histories & Tattooing','2026-11-21T19:00:00Z'],['02','Color & Tattooing','2027-01-16T19:00:00Z'],['03','Iconography & Tattooing','2027-03-20T18:00:00Z'],['04','Symbolism, Composition & Tattooing','2027-05-15T18:00:00Z']];
  for(const [i,title,date] of rows) db.prepare(`INSERT INTO event_occurrences(id,event_id,session_number,title,starts_at,status,sort_order,created_at,updated_at)
    VALUES(?,'kinmarking-qa',?,?,?,'closed',?,datetime('now'),datetime('now'))`).run(`kinmarking-qa-${i}`,i,title,date,Number(i)-1);
  db.prepare(`INSERT INTO event_admission_options(id,event_id,occurrence_id,slug,title,starts_at,created_at,updated_at)
    VALUES('edition-admission-qa','kinmarking-qa','kinmarking-qa-03','qa','QA reservation link','2027-03-20T18:00:00Z',datetime('now'),datetime('now'))`).run();
  const applyMigration=()=>{db.exec('BEGIN');try{db.exec(readFileSync(join(ROOT,'migrations',MIGRATION),'utf8'));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}};
  if(migrate) applyMigration();
  const binding={prepare:sql=>new Statement(db,sql),async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
  const env={SUBMISSIONS_DB:binding,SUBMISSIONS_ADMIN_TOKEN:'kinmarking-isolated-qa',PUBLIC_SITE_URL:'https://thesixwellconstruct.com'};
  return {db,env,applyMigration};
}
