// Local-only review server. No production proxy, secrets, persisted records,
// outgoing emails, or remote bindings. All registrations are in-memory fixtures.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fixture,ROOT,TEST_TOKEN} from '../tests/helpers/sny00-fixture.mjs';
import {handleEventsApi,handleAdminEventsApi} from '../functions/api/events/_lib.js';
import worker from '../_worker.js';
const port=Number(process.env.PORT || 4185),origin=`http://127.0.0.1:${port}`;
const f=fixture({open:true,capacity:20,maxParty:4});
const draft=fixture();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
async function asset(url){
  const pathname=decodeURIComponent(new URL(url).pathname);
  if(/^\/(?:functions|migrations|tests|docs|\.git|\.dev|\.env)(?:[/.]|$)/.test(pathname))return new Response('Not found',{status:404});
  let file=resolve(ROOT,'.'+pathname);
  if(!file.startsWith(ROOT+sep))return new Response('Not found',{status:404});
  try {if((await stat(file)).isDirectory())file=resolve(file,'index.html');return new Response(await readFile(file),{headers:{'content-type':mime[extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
}
const env={...f.env,PUBLIC_SITE_URL:origin,ASSETS:{fetch:req=>asset(req.url)}};
const draftEnv={...draft.env,PUBLIC_SITE_URL:origin,ASSETS:env.ASSETS};
const banner='<aside class="sny-review" aria-label="Local review">Private local review · simulated RSVP is open with a sample capacity of 20 and party allowance of 4. These are test settings, not event decisions. The saved draft remains closed. <a href="/review/">Review questions + Studio test session</a></aside>';
const hub=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SNY 00 private review</title><style>body{font:18px/1.7 Georgia,serif;max-width:800px;margin:40px auto;padding:20px;background:#0e0e0e;color:#ffe7ca}a,button{color:#ffe7ca}button{font:inherit;background:transparent;border:5px solid #397f34;padding:12px;cursor:pointer}li{margin:12px 0}</style><h1>SNY 00 · private review</h1><p>All writes stay in an in-memory local database. Restarting clears test registrations and transcriptions. No production API proxy or messaging is configured.</p><p><a href="/events/sny-00/">Open the event + RSVP demo</a> · <a href="/review/draft">Verify the actual draft returns 404</a> · <a href="/tools/ui-guide.html">Existing UI guide</a></p><button id="session">Open Studio with the isolated fixture session</button><script>document.getElementById('session').onclick=()=>{localStorage.setItem('swc_submissions_admin_token',${JSON.stringify(TEST_TOKEN)});location.href='/studio/event-attendance/?event=sny-00';};</script><h2>Private launch questions</h2><ol><li>Approve purpose/flow wording from the separate planning work; “focus group” is an open descriptor question.</li><li>Choose capacity, guest allowance, RSVP deadline, and cancellation/change contact. Draft capacity is unset and closed.</li><li>Decide location disclosure and arrival/access details. No address has been copied into SNY 00.</li><li>Review whether recording acknowledgement needs stored evidence or a notice version. Decide any separate likeness, quote, and archive publication permissions.</li><li>Approve food-note handling, retention/deletion period, and attendee-record retention. Keep food notes off the paper sheet and public archive.</li><li>Decide whether any confirmation/reminder emails are wanted. The current draft confirms on page only.</li></ol><h2>Distinct event-prep design deliverables</h2><ul><li>Flyer, aligned with existing SNY/site language.</li><li>Paper door sign-in sheet, with sheet/row references for reconciliation and no printed email/food roster.</li><li>Printed reflective takeaway, with content developed in the separate purpose/flow work.</li><li>Digital equivalent of that reflective takeaway.</li></ul><p>These remain separate design work. This event page is not a substitute.</p></html>`;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,origin),chunks=[];
    for await(const chunk of req) {chunks.push(chunk);if(chunks.reduce((sum,c)=>sum+c.length,0)>16384){res.writeHead(413);res.end();return;}}
    const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    let response;
    if(url.pathname==='/review/')response=new Response(hub,{headers:{'content-type':'text/html; charset=utf-8'}});
    else if(url.pathname==='/js/live-text-editor.js')response=new Response('// Local RSVP review: live copy editor is not enabled.',{headers:{'content-type':'text/javascript'}});
    else if(url.pathname==='/review/draft')response=await worker.fetch(new Request(origin+'/events/sny-00/'),draftEnv,{});
    else if(url.pathname.startsWith('/api/admin/events'))response=await handleAdminEventsApi(request,env);
    else if(url.pathname.startsWith('/api/events'))response=await handleEventsApi(request,env);
    else if(url.pathname.startsWith('/api/'))response=Response.json({items:[],records:[],events:[],rules:[]});
    else if(url.pathname.startsWith('/events/sny-00')){
      response=await worker.fetch(request,env,{});
      if(response.headers.get('content-type')?.includes('text/html') && response.status===200){let html=await response.text();html=html.replace('</section>','</section>'+banner);response=new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});}
    }else response=await asset(url);
    res.writeHead(response.status,{...Object.fromEntries(response.headers),'cache-control':'no-store','x-sny00-isolated-review':'1'});res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(error.stack);}
});
server.listen(port,'127.0.0.1',()=>console.log(`SNY 00 isolated review: ${origin}/review/`));
