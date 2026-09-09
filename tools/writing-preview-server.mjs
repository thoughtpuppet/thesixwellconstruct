import {createServer} from "node:http";
import {createWritingRuntime} from "./writing-local-runtime.mjs";
import {handleConstructApi} from "../functions/api/construct/_lib.js";
import {PAGE_VISIBILITY_DEFAULT_RULES} from "../shared/page-visibility.js";
import {handleListSubmissions} from "../functions/api/submissions/_lib.js";
import {handleAdminListAppointments} from "../functions/api/booking/_lib.js";
const {env}=createWritingRuntime(),port=Number(process.env.WRITING_API_PORT||4174);
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,"http://127.0.0.1");
    if(url.pathname==="/api/site/visibility"){res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify({rules:PAGE_VISIBILITY_DEFAULT_RULES}));return;}
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>16*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const request=new Request(url,{method:req.method,headers:req.headers,...(["GET","HEAD"].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    const response=url.pathname==="/api/admin/submissions"&&req.method==="GET"?await handleListSubmissions(request,env):url.pathname==="/api/admin/booking/appointments"&&req.method==="GET"?await handleAdminListAppointments(request,env):await handleConstructApi(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(500,{"content-type":"application/json"});res.end(JSON.stringify({error:error.message}));}
});
server.listen(port,"127.0.0.1",()=>console.log(`Isolated WRKNG API: http://127.0.0.1:${port} (in-memory data; no production connection)`));
process.on("SIGTERM",()=>server.close());process.on("SIGINT",()=>server.close());
