(function(){
  const storageKey="swc_resumable_media_uploads_v1";
  const allowedByKind={
    video:new Set(["video/mp4","video/webm"]),
    "archive-master":new Set(["image/tiff","image/jpeg","image/png","image/webp"]),
  };
  const maxBytes=2*1024*1024*1024;
  const wait=(milliseconds)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
  const saved=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||"{}")}catch{return{}}};
  const persist=(records)=>localStorage.setItem(storageKey,JSON.stringify(records));
  const fingerprint=(file,uploadKind="video")=>[uploadKind,file.name,file.type,file.size,file.lastModified].join(":");

  async function request(path,token,options={}){
    const response=await fetch(path,{...options,headers:{authorization:`Bearer ${token}`,...(options.headers||{})},cache:"no-store"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`Upload request failed (${response.status}).`);
    return data;
  }

  async function retryPart(path,token,blob,signal){
    let lastError;
    for(let attempt=0;attempt<4;attempt+=1){
      if(signal?.aborted)throw new DOMException("Upload cancelled.","AbortError");
      try{return await request(path,token,{method:"PUT",headers:{"content-type":"application/octet-stream"},body:blob,signal})}
      catch(error){lastError=error;if(attempt<3)await wait(500*(2**attempt))}
    }
    throw lastError;
  }

  async function matchingSession(file,token,uploadKind){
    const records=saved(),key=fingerprint(file,uploadKind),sessionId=records[key];
    if(!sessionId)return null;
    try{
      const payload=await request(`/api/admin/media/uploads/${encodeURIComponent(sessionId)}`,token);
      const upload=payload.upload;
      if(upload?.state==="pending"&&upload.uploadKind===uploadKind&&upload.filename===file.name&&upload.mimeType===file.type&&upload.byteSize===file.size)return upload;
    }catch{}
    delete records[key];persist(records);return null;
  }

  async function upload(file,options={}){
    const token=options.token||"";
    const uploadKind=options.uploadKind||"video",allowed=allowedByKind[uploadKind];
    if(!token)throw new Error("Unlock Studio before uploading media.");
    if(!allowed)throw new Error("Unknown resumable upload kind.");
    if(!allowed.has(file.type))throw new Error(uploadKind==="archive-master"?"Use a TIFF, JPEG, PNG, or WebP archival master.":"Use an MP4 or WebM video. MP4 with H.264/AAC is recommended.");
    if(file.size<=0||file.size>maxBytes)throw new Error("Resumable media must be 2 GiB or smaller.");
    const key=fingerprint(file,uploadKind),records=saved();
    let session=await matchingSession(file,token,uploadKind);
    if(!session){
      const created=await request("/api/admin/media/uploads",token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        uploadKind,filename:file.name,mimeType:file.type,byteSize:file.size,
        altText:options.altText||"",caption:options.caption||"",privacy:options.privacy||"internal",
        consentStatus:options.consentStatus||"unknown",transcript:options.transcript||"",
        transcriptStatus:options.transcriptStatus||"not-requested",transcriptLanguage:options.transcriptLanguage||"en",
        publicTitle:options.publicTitle||"",publicDescription:options.publicDescription||"",
        publicPresentation:options.publicPresentation||"inline",
      })});
      session=created.upload;records[key]=session.id;persist(records);
    }
    options.onSession?.(session);
    const completed=new Map((session.parts||[]).map(part=>[Number(part.partNumber),part]));
    let uploadedBytes=[...completed.values()].reduce((sum,part)=>sum+Number(part.byteSize||0),0);
    options.onProgress?.({uploadedBytes,totalBytes:file.size,percent:Math.round(uploadedBytes/file.size*100),sessionId:session.id,resumed:completed.size>0});
    for(let partNumber=1;partNumber<=session.partCount;partNumber+=1){
      if(completed.has(partNumber))continue;
      const start=(partNumber-1)*session.partSize,end=Math.min(start+session.partSize,file.size),blob=file.slice(start,end);
      options.onStatus?.(`Uploading part ${partNumber} of ${session.partCount}…`);
      await retryPart(`/api/admin/media/uploads/${encodeURIComponent(session.id)}/parts/${partNumber}`,token,blob,options.signal);
      uploadedBytes+=blob.size;
      options.onProgress?.({uploadedBytes,totalBytes:file.size,percent:Math.round(uploadedBytes/file.size*100),sessionId:session.id,resumed:completed.size>0});
    }
    options.onStatus?.(uploadKind==="archive-master"?"Finalizing archival master…":"Finalizing video…");
    const completedPayload=await request(`/api/admin/media/uploads/${encodeURIComponent(session.id)}/complete`,token,{method:"POST"});
    const latest=saved();delete latest[key];persist(latest);
    options.onProgress?.({uploadedBytes:file.size,totalBytes:file.size,percent:100,sessionId:session.id,resumed:completed.size>0});
    return completedPayload.record;
  }

  async function cancel(sessionId,token){
    if(!sessionId)return;
    await request(`/api/admin/media/uploads/${encodeURIComponent(sessionId)}`,token,{method:"DELETE"});
    const records=saved();for(const [key,value] of Object.entries(records))if(value===sessionId)delete records[key];persist(records);
  }

  window.StudioResumableMedia={upload,cancel,maxBytes,allowedTypes:[...allowedByKind.video],allowedTypesByKind:Object.fromEntries(Object.entries(allowedByKind).map(([kind,types])=>[kind,[...types]]))};
})();
