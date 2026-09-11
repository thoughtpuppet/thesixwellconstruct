// Isolated development/test data. This module never reads production secrets.
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
const migrationRoot = fileURLToPath(new URL("../migrations/",import.meta.url));
class LocalStatement {
  constructor(database,sql,values=[]) { this.database=database;this.sql=sql;this.values=values; }
  bind(...values) { return new LocalStatement(this.database,this.sql,values); }
  async first(column) { const row=this.database.prepare(this.sql).get(...this.values)||null;return column?row?.[column]??null:row; }
  async all() { return {results:this.database.prepare(this.sql).all(...this.values)}; }
  async run() { const prepared=this.database.prepare(this.sql);if(prepared.columns().length)return {results:prepared.all(...this.values)};const result=prepared.run(...this.values);return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}; }
}
class LocalD1 {
  constructor(database) {this.database=database;}
  prepare(sql) {return new LocalStatement(this.database,sql);}
  async batch(statements) {this.database.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.exec("COMMIT");return results;}catch(error){this.database.exec("ROLLBACK");throw error;}}
}
class MemoryR2 {
  constructor() {this.items=new Map();}
  async put(key,value,options={}) {const bytes=new Uint8Array(value);this.items.set(key,{bytes,options});return {key};}
  async head(key) {const item=this.items.get(key);return item?{size:item.bytes.length,httpEtag:'"local-writing-image"',writeHttpMetadata:headers=>headers.set("content-type",item.options.httpMetadata?.contentType||"application/octet-stream")}:null;}
  async get(key,options={}) {const item=this.items.get(key);if(!item)return null;const bytes=options.range?item.bytes.slice(options.range.offset,options.range.offset+options.range.length):item.bytes;return {...await this.head(key),body:new Blob([bytes]).stream()};}
  async delete(key) {this.items.delete(key);}
}
export function createWritingRuntime({throughMigration = ""} = {}) {
  const database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON");
  for(const file of readdirSync(migrationRoot).filter(name=>name.endsWith(".sql") && (!throughMigration || name<=throughMigration)).sort())database.exec(readFileSync(`${migrationRoot}/${file}`,"utf8"));
  return {database,env:{SUBMISSIONS_DB:new LocalD1(database),SUBMISSIONS_ADMIN_TOKEN:"writing-local-preview",SUBMISSION_FILES:new MemoryR2(),PUBLIC_SITE_URL:"http://127.0.0.1:4173"}};
}
