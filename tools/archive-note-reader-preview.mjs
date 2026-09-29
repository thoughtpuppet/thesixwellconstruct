// Read-only public-data preview. No credentials, admin routes, database, or writes.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
const root=fileURLToPath(new URL('../',import.meta.url));
// Optional, explicitly supplied public DTO snapshot for reviewing a saved comment
// system when the live API has not loaded it. Never shipped or written upstream.
const snapshotArg=process.argv.find(value=>value.startsWith('--comments-snapshot='));
const snapshot=snapshotArg?JSON.parse(await readFile(resolve(root,snapshotArg.split('=').slice(1).join('=')),'utf8')):null;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const url=new URL(req.url,'http://127.0.0.1:4192');
    if(url.pathname.startsWith('/api/')){
      if(!/^\/api\/(archive\/(notes|items|navigation|origin-threads)(\/|$)|construct\/(media\/|navigation|public)|site\/)/.test(url.pathname)){res.writeHead(404);res.end('{}');return;}
      const upstream=await fetch(new URL(url.pathname+url.search,'https://thesixwellconstruct.com'),{method:req.method,headers:req.headers.range?{range:req.headers.range}:{},redirect:'error'});
      const headers=Object.fromEntries(upstream.headers);delete headers['content-encoding'];delete headers['content-length'];headers['cache-control']='no-store';
      if(snapshot&&req.method==='GET'&&url.pathname.replace(/\/$/,'')==='/api/archive/notes/lost-marbles-inception-note'&&upstream.ok){
        const payload=await upstream.json();
        if(payload.note?.body_markdown===snapshot.source&&snapshot.comments.every(c=>c.target_kind==='note'?c.target_id===payload.note.id:payload.assets.some(a=>(a.media_id||a.mediaId)===c.target_id))){payload.retrospective_comments=snapshot.comments;payload.local_preview_comment_snapshot=snapshot.checked_at;}
        res.writeHead(upstream.status,headers);res.end(JSON.stringify(payload));return;
      }
      res.writeHead(upstream.status,headers);if(upstream.body)Readable.fromWeb(upstream.body).pipe(res);else res.end();return;
    }
    let pathname=decodeURIComponent(url.pathname);
    if(pathname.startsWith('/archive/notes/'))pathname='/archive/notes/index.html';
    if(pathname.startsWith('/archive/records/'))pathname='/archive/records/index.html';
    if(!/^\/(archive|css|js|assets|shared)\//.test(pathname)){res.writeHead(404);res.end();return;}
    let file=resolve(root,'.'+pathname);if(!file.startsWith(resolve(root)+sep)){res.writeHead(403);res.end();return;}
    if((await stat(file)).isDirectory())file=resolve(file,'index.html');
    res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:await readFile(file));
  }catch(error){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
}).listen(4192,'127.0.0.1',()=>console.log('Local Note appearance preview (read-only live public content): http://127.0.0.1:4192/archive/notes/lost-marbles-inception-note/'));
