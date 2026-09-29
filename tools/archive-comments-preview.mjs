// Isolated QA only: all APIs run against memory, never a production proxy.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fixture,ROOT} from '../tests/helpers/archive-comments-fixture.mjs';
import {handleConstructApi} from '../functions/api/construct/_lib.js';
import {textAnchor} from '../shared/archive-comment-targets.js';
const f=fixture();
const created=await f.call('/api/admin/archive-notes','POST',{title:'Retrospective comment verification',slug:'retrospective-fixture',body_markdown:'Original source. Repeated passage. Repeated passage.\n\n{{asset:qa-image}}\n\n{{asset:qa-video}}\n\n{{asset:qa-audio}}',state:'draft',public_visible:false,source_created_at:'2022-12-23T19:54:00-05:00',source_modified_at:'2023-11-26',links:[{target_entity_id:'art-marbles',relationship_role:'inception',public_visible:true,is_primary:true}]});
if(created.status!==201)throw Error(JSON.stringify(created));
const owner=created.body.note.id;
f.media(owner,'qa-image','image/jpeg',{url:'/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg?retro-qa=1'});
f.media(owner,'qa-video','video/mp4',{url:'/assets/video/current-works/current-works-center-loop.mp4?retro-qa=1'});
f.media(owner,'qa-audio','audio/wav',{url:'/assets/audio/wind-soft.wav?retro-qa=1'});
await f.call(`/api/admin/archive-notes/${owner}`,'PATCH',{state:'published',public_visible:true});
for(const [id,type] of [['qa-image','process-photo'],['qa-video','video'],['qa-audio','voice-memo']]){
  const result=await f.call('/api/admin/archive-materials','POST',{dossier_entity_id:'art-marbles',material_type:type,media_id:id,title:`QA ${type}`,caption:`Managed ${type} comment target`,state:'published',visibility:'public',state_id:'archive-state-art-marbles-1-I',version_id:'archive-version-art-marbles-1'});
  if(result.status!==201)throw Error(JSON.stringify(result));
}
if(process.argv.includes('--seed-comments')){
  const {body:{targets}}=await f.call(`/api/admin/archive-comments?owner_entity_id=${owner}`);
  for(const target of targets){const result=await f.call('/api/admin/archive-comments','POST',{owner_entity_id:owner,target_kind:target.target_kind,target_id:target.target_id,field_key:target.field_key,source_fingerprint:target.source_fingerprint,anchor:target.target_kind==='note'?textAnchor(target.text,0,15):target.mime_type.startsWith('image/')?{}:{start_seconds:2,end_seconds:4},body:'A later thought, kept separate from the original source.',state:'published'});if(result.status!==201)throw Error(JSON.stringify(result));}
}
const studio=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated retrospective Studio QA</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=block" rel="stylesheet"><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/archive-public.css"><link rel="stylesheet" href="/css/archive-notes.css"><link rel="stylesheet" href="/studio/archive-notes-manager.css"><style>body{background:var(--color-bg);padding:24px}main{max-width:1200px;margin:auto}input,textarea,select{background:#161616;color:#FBD19D;padding:10px}button{cursor:pointer}nav{display:flex;gap:20px;margin-bottom:24px}</style></head><body><main><h1>Isolated Studio QA</h1><nav><a href="/archive/notes/retrospective-fixture/">Public Note</a><a href="/archive/records/lostmarbles/">Nested Archive viewers</a></nav><p id="status" role="status"></p><div id="editor"></div></main><script src="/js/archive-note-markdown.js"></script><script type="module">import {mountArchiveNotes} from '/studio/archive-notes-manager.js';const api=async(path,options={})=>{const response=await fetch(path,{...options,headers:{...options.headers,authorization:'Bearer local-retrospective-test'}});const payload=await response.json();if(!response.ok)throw Error(payload.error);return payload;};await mountArchiveNotes(document.querySelector('#editor'),api,message=>document.querySelector('#status').textContent=message,{initialNoteId:${JSON.stringify(owner)}});</script></body></html>`;
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.wav':'audio/wav','.mp4':'video/mp4','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);const response=await handleConstructApi(new Request(url,{method:req.method,headers:req.headers,...(body.length?{body}:{})}),f.env);if(!response){res.writeHead(404);res.end('{}');return;}res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  if(url.pathname==='/'||url.pathname==='/studio-qa/'){res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(studio);return;}
  let pathname=decodeURIComponent(url.pathname);if(pathname.startsWith('/archive/notes/'))pathname='/archive/notes/index.html';if(pathname.startsWith('/archive/records/'))pathname='/archive/records/index.html';
  let file=resolve(ROOT,'.'+pathname);if(!file.startsWith(resolve(ROOT)+sep)){res.writeHead(403);res.end();return;}if((await stat(file)).isDirectory())file=resolve(file,'index.html');
  const bytes=await readFile(file),headers={'content-type':types[extname(file)]||'application/octet-stream','cache-control':'no-store','accept-ranges':'bytes'};
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;if(start> end){res.writeHead(416);res.end();return;}res.writeHead(206,{...headers,'content-range':`bytes ${start}-${end}/${bytes.length}`,'content-length':end-start+1});res.end(bytes.subarray(start,end+1));}else{res.writeHead(200,headers);res.end(bytes);}
}catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
server.listen(4191,'127.0.0.1',()=>console.log('Isolated retrospective QA: http://127.0.0.1:4191/ (in-memory only)'));
