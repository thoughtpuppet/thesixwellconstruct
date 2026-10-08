// Isolated Studio/public QA. The database is in memory; no production proxy.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fixture,ROOT} from '../tests/helpers/kinmarking-editions-fixture.mjs';
import {handleAdminEventsApi,handleEventsApi} from '../functions/api/events/_lib.js';
import worker from '../_worker.js';
const f=fixture();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
async function asset(url){
  const p=decodeURIComponent(new URL(url).pathname);
  let file=resolve(ROOT,'.'+p);
  if(!file.startsWith(ROOT+sep)) return new Response('Not found',{status:404});
  try{if((await stat(file)).isDirectory()) file=resolve(file,'index.html');return new Response(await readFile(file),{headers:{'content-type':mime[extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
}
const env={...f.env,PUBLIC_SITE_URL:'http://127.0.0.1:4179',ASSETS:{fetch:req=>asset(req.url)}};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:4179');
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    let response;
    if(url.pathname.startsWith('/api/admin/events')) response=await handleAdminEventsApi(request,env);
    else if(url.pathname.startsWith('/api/events')) response=await handleEventsApi(request,env);
    else if(url.pathname.startsWith('/api/')) response=Response.json({submissions:[],appointments:[],records:[],items:[],symbols:[]});
    else if(/^\/events\/kinmarking-(?:\d{2,}|01-oral-histories-and-tattooing)\/$/.test(url.pathname)) response=await worker.fetch(request,env,{});
    else response=await asset(url);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(error.stack);}
});
server.listen(4179,'127.0.0.1',()=>console.log('Isolated editions QA: http://127.0.0.1:4179/events/kinmarking/'));
