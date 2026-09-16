const conversation=document.querySelector("[data-writing-conversation]");

if(conversation){
  const form=conversation.querySelector("[data-writing-response-form]");
  const fileInput=form.elements.attachments;
  const preview=form.querySelector("[data-writing-upload-preview]");
  const status=form.querySelector("[data-writing-response-status]");
  const thread=conversation.querySelector("[data-writing-response-thread]");
  const linkFields=form.querySelector("[data-writing-link-fields]");
  const slug=conversation.dataset.entrySlug;
  let files=[];
  let turnstileId=null;
  let idempotencyKey=crypto.randomUUID();

  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const youtubeId=value=>{try{const url=new URL(value),host=url.hostname.replace(/^www\./,"").toLowerCase();let id="";if(host==="youtu.be")id=url.pathname.split("/").filter(Boolean)[0]||"";else if(["youtube.com","m.youtube.com","music.youtube.com"].includes(host))id=url.pathname==="/watch"?url.searchParams.get("v")||"":url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]||"";return /^[a-zA-Z0-9_-]{11}$/.test(id)?id:""}catch{return ""}};

  function syncInput(){const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));fileInput.files=transfer.files}
  function renderFiles(){
    preview.innerHTML=files.map((file,index)=>file.type.startsWith("image/")?`<figure><img src="${URL.createObjectURL(file)}" alt=""><figcaption>${esc(file.name)}<button type="button" data-file-remove="${index}">Remove</button></figcaption></figure>`:`<div class="writing-file-card"><span aria-hidden="true">↧</span><span><strong>${esc(file.name)}</strong><small>${esc(file.type||"file")} · ${file.size.toLocaleString()} bytes</small></span><button type="button" data-file-remove="${index}">Remove</button></div>`).join("");
  }
  function refreshLinkPreviews(){
    for(const row of linkFields.querySelectorAll(".writing-link-input")){
      row.querySelector(".writing-link-preview")?.remove();const value=row.querySelector("input").value.trim();if(!value)continue;let url;try{url=new URL(value)}catch{continue}const videoId=youtubeId(url.href),card=document.createElement("div");card.className="writing-link-preview";card.innerHTML=videoId?`<span>YouTube preview</span><strong>youtube.com / ${esc(videoId)}</strong>`:`<span>External link</span><strong>${esc(url.hostname.replace(/^www\./,""))}</strong>`;row.append(card);
    }
  }
  function linkRow(){return '<div class="writing-link-input"><input name="links" type="url" placeholder="https://…" aria-label="External or YouTube link"><button type="button" data-writing-link-remove aria-label="Remove link">Remove</button></div>'}

  fileInput.addEventListener("change",()=>{const next=[...fileInput.files];if(files.length+next.length>4){status.textContent="Upload no more than 4 files.";fileInput.value="";return}files.push(...next);syncInput();renderFiles();status.textContent=`${files.length} file${files.length===1?"":"s"} ready.`});
  preview.addEventListener("click",event=>{const button=event.target.closest("[data-file-remove]");if(!button)return;files.splice(Number(button.dataset.fileRemove),1);syncInput();renderFiles();status.textContent=files.length?`${files.length} file${files.length===1?"":"s"} ready.`:"Attachment removed."});
  form.querySelector("[data-writing-link-add]").addEventListener("click",()=>{if(linkFields.children.length>=5){status.textContent="Add no more than 5 links.";return}linkFields.insertAdjacentHTML("beforeend",linkRow());linkFields.lastElementChild.querySelector("input").focus()});
  linkFields.addEventListener("click",event=>{const button=event.target.closest("[data-writing-link-remove]");if(!button)return;const row=button.closest(".writing-link-input");if(linkFields.children.length===1){row.querySelector("input").value="";refreshLinkPreviews()}else row.remove()});
  linkFields.addEventListener("input",refreshLinkPreviews);

  async function setupTurnstile(){
    const wrap=form.querySelector("[data-writing-turnstile]");
    try{const response=await fetch(`/api/writings/entries/${encodeURIComponent(slug)}/responses/config`,{headers:{accept:"application/json"}}),config=await response.json();if(!response.ok||!config.configured)throw new Error("Verification is not configured.");const render=()=>{if(!window.turnstile)return setTimeout(render,80);turnstileId=window.turnstile.render(wrap,{sitekey:config.siteKey,action:config.action,theme:"dark"})};render()}catch(error){wrap.innerHTML=`<p>${esc(error.message)} Responses remain closed until verification is available.</p>`}
  }

  form.addEventListener("submit",async event=>{
    event.preventDefault();const submit=form.querySelector('[type="submit"]');const body=form.elements.body.value.trim();const links=[...linkFields.querySelectorAll('[name="links"]')].map(input=>input.value.trim()).filter(Boolean);
    if(!form.elements.authorName.value.trim()){status.textContent="Add your name or alias.";form.elements.authorName.focus();return}
    if(!body&&!files.length&&!links.length){status.textContent="Write a response, add a link, or attach a file.";form.elements.body.focus();return}
    submit.disabled=true;status.textContent="Publishing your response…";
    const data=new FormData(form);data.delete("attachments");files.forEach(file=>data.append("attachments",file,file.name));data.set("idempotencyKey",idempotencyKey);
    try{const response=await fetch(`/api/writings/entries/${encodeURIComponent(slug)}/responses`,{method:"POST",headers:{"Idempotency-Key":idempotencyKey},body:data}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"The response could not be published.");thread.querySelector("[data-writing-response-empty]")?.remove();thread.insertAdjacentHTML("beforeend",result.html);form.reset();files=[];renderFiles();while(linkFields.children.length>1)linkFields.lastElementChild.remove();refreshLinkPreviews();idempotencyKey=crypto.randomUUID();status.textContent=result.repeated?"This response was already published.":"Your response is now part of the thread.";if(window.turnstile&&turnstileId!==null)window.turnstile.reset(turnstileId);thread.lastElementChild?.scrollIntoView({behavior:"smooth",block:"start"})}catch(error){status.textContent=error.message;if(window.turnstile&&turnstileId!==null)window.turnstile.reset(turnstileId)}finally{submit.disabled=false}
  });

  setupTurnstile();
}
