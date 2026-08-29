(function(){
  const tokenKey="swc_submissions_admin_token";
  const base="/api/admin/archive-failed-experiments";
  const kindOptions=[["concept","Concept"],["material-test","Material test"],["process-test","Process test"],["prototype","Prototype"],["other","Other"]];
  const resultOptions=[["failed","Failed"],["abandoned","Abandoned"],["inconclusive","Inconclusive"],["superseded","Superseded"]];
  const afterlifeOptions=[["none","None"],["recovered","Recovered"],["reused","Reused"]];
  const stateOptions=[["draft","Draft / internal"],["published","Published"],["archived","Archived"]];
  const precisionOptions=[["exact","Exact date"],["approximate","Approximate date"],["range","Date range"],["year","Year only"],["undated","Undated"]];
  const mediumOptions=[["art","Art"],["merch","Merch"],["tattoos","Tattoos"],["film","Film"],["music","Music"],["writings","Writings"],["legend","Legend"],["other","Other"]];
  const phaseSuggestions=["Research","Sketching","Material testing","Color testing","Fabrication","Prototype","Revision","Finishing","Documentation"];
  const imageTypes=new Set(["image/jpeg","image/png","image/webp"]);
  const acceptedTypes=new Set([...imageTypes,"video/mp4","video/webm","application/pdf","text/plain","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
  const workspace={host:null,api:null,status:()=>{},records:[],record:null,media:[],library:[],entities:[],relationships:[],relationshipTypes:[],states:[],stateLinks:[],previewUrls:[],bindings:null,uploadController:null,uploadSession:""};

  const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  const value=(record,...keys)=>{for(const key of keys)if(record?.[key]!==undefined&&record[key]!==null)return record[key];return""};
  const truthy=input=>input===true||input===1||input==="1"||input==="true";
  const recordsFrom=(payload,...keys)=>{if(Array.isArray(payload))return payload;for(const key of ["records",...keys,"items"])if(Array.isArray(payload?.[key]))return payload[key];return[]};
  const recordFrom=(payload,...keys)=>{for(const key of ["record",...keys,"experiment","item"])if(payload?.[key]&&typeof payload[key]==="object"&&!Array.isArray(payload[key]))return payload[key];return payload&&typeof payload==="object"&&!Array.isArray(payload)?payload:{}};
  const recordId=record=>String(value(record,"entity_id","entityId","id")||"");
  const titleCase=input=>String(input||"").replace(/[-_]+/g," ").replace(/\b\w/g,char=>char.toUpperCase());
  const selected=(current,candidate)=>String(current)===String(candidate)?" selected":"";
  const checked=input=>truthy(input)?" checked":"";
  const options=(items,current)=>items.map(([id,label])=>`<option value="${esc(id)}"${selected(current,id)}>${esc(label)}</option>`).join("");
  const dateOnly=input=>String(input||"").slice(0,10);
  const notice=(message,kind="")=>`<div class="cm-notice"${kind?` data-kind="${esc(kind)}"`:""}>${esc(message)}</div>`;
  const mediaId=record=>String(value(record,"media_id","mediaId","id")||"");
  const mediaMime=record=>String(value(record,"mime_type","mimeType")||"");
  const stateLinkRelationshipId=link=>String(value(link,"relationship_id","relationshipId")||"");
  const stateLinkStateId=link=>String(value(link,"state_id","stateId")||"");

  function beginView(){
    workspace.bindings?.abort();
    workspace.bindings=new AbortController();
    clearPreviews();
  }

  function bind(target,type,handler){target?.addEventListener(type,handler,{signal:workspace.bindings.signal})}

  function clearPreviews(){
    for(const url of workspace.previewUrls)URL.revokeObjectURL(url);
    workspace.previewUrls=[];
  }

  function setStatus(message){workspace.status(message);}

  function setFormBusy(form,busy){
    for(const control of form.querySelectorAll("button, input, select, textarea"))control.disabled=busy;
  }

  function slugify(input){return String(input||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,160)}

  function recordDate(record){return value(record,"date_label","dateLabel")||dateOnly(value(record,"occurred_at","occurredAt"))||"Undated"}

  function recordMedium(record){
    const current=String(value(record,"node_id","nodeId","medium")||"other").replace(/^node-/,"");
    return mediumOptions.find(([id])=>id===current)?.[1]||titleCase(current);
  }

  function listCard(record){
    const id=recordId(record),state=String(value(record,"state")||"draft"),mediaCount=Number(value(record,"media_count","mediaCount","attachment_count","attachmentCount","evidence_count","evidenceCount")||0);
    return `<article class="fe-card${state==="draft"?" is-draft":""}" data-fe-card data-search="${esc(`${value(record,"title")} ${value(record,"public_note","publicNote")} ${value(record,"process_phase","processPhase")} ${recordMedium(record)} ${value(record,"experiment_kind","experimentKind")} ${value(record,"result")}`.toLowerCase())}" data-state="${esc(state)}">
      <div class="fe-card-media">${value(record,"image_url","imageUrl","lead_media_url","leadMediaUrl","cover_url","coverUrl")?`<img src="${esc(value(record,"image_url","imageUrl","lead_media_url","leadMediaUrl","cover_url","coverUrl"))}" alt="" loading="lazy">`:`<span>${esc(String(value(record,"result")||"experiment").slice(0,1).toUpperCase())}</span>`}</div>
      <div class="fe-card-copy"><div class="cm-card-head"><div><span class="cm-section-index">${esc(recordMedium(record))} · ${esc(recordDate(record))}</span><h3>${esc(value(record,"title")||"Untitled experiment")}</h3></div><span class="cm-pill">${esc(state)}</span></div>
      <div class="fe-facts"><span>${esc(titleCase(value(record,"experiment_kind","experimentKind")||"other"))}</span><span>${esc(titleCase(value(record,"result")||"failed"))}</span><span>${mediaCount} attachment${mediaCount===1?"":"s"}</span></div>
      ${value(record,"public_note","publicNote")?`<p>${esc(value(record,"public_note","publicNote"))}</p>`:""}
      <button class="button" type="button" data-fe-open="${esc(id)}">Open experiment</button></div>
    </article>`;
  }

  function paintList(){
    beginView();
    const host=workspace.host;
    host.innerHTML=`<section class="construct-manager fe-manager">
      <div class="cm-head"><div><span class="cm-section-index">Archive evidence</span><h2>Failed Experiments</h2><p class="cm-summary">Preserve abandoned concepts, flawed tests, and unresolved attempts without turning them into catalogue works. Every new record begins as an internal draft.</p></div><a class="button" href="/archive/failed-experiments/" target="_blank" rel="noopener">Open public room</a></div>
      <form class="fe-quick-create" data-fe-quick-create>
        <div><strong>Quick capture</strong><p>Start with the smallest truthful record. Add evidence, context, and connections after saving.</p></div>
        <label>Title<input name="title" required maxlength="300" autocomplete="off" placeholder="What did you try?"></label>
        <label>Original result<select name="result">${options(resultOptions,"failed")}</select></label>
        <button class="button" type="submit">Create internal draft</button>
        <span class="cm-upload-status" data-fe-quick-status aria-live="polite"></span>
      </form>
      <div class="fe-list-tools">
        <label>Search records<input type="search" data-fe-search placeholder="Title, phase, medium, result…"></label>
        <label>Publication<select data-fe-state-filter><option value="">All states</option>${options(stateOptions,"")}</select></label>
        <span class="cm-meta" data-fe-count>${workspace.records.length} record${workspace.records.length===1?"":"s"}</span>
      </div>
      <div class="fe-list" data-fe-list>${workspace.records.length?workspace.records.map(listCard).join(""):`<div class="cm-empty">No failed experiments have been captured yet.</div>`}</div>
    </section>`;

    const filter=()=>{
      const query=host.querySelector("[data-fe-search]").value.trim().toLowerCase(),state=host.querySelector("[data-fe-state-filter]").value;
      let visible=0;
      for(const card of host.querySelectorAll("[data-fe-card]")){
        const show=(!query||card.dataset.search.includes(query))&&(!state||card.dataset.state===state);
        card.hidden=!show;if(show)visible+=1;
      }
      host.querySelector("[data-fe-count]").textContent=`${visible} record${visible===1?"":"s"}`;
    };
    bind(host.querySelector("[data-fe-search]"),"input",filter);
    bind(host.querySelector("[data-fe-state-filter]"),"change",filter);
    bind(host,"click",event=>{const open=event.target.closest("[data-fe-open]");if(open)openExperiment(open.dataset.feOpen)});
    bind(host.querySelector("[data-fe-quick-create]"),"submit",async event=>{
      event.preventDefault();
      const form=event.currentTarget,output=form.querySelector("[data-fe-quick-status]"),data=new FormData(form),title=String(data.get("title")||"").trim();
      setFormBusy(form,true);output.textContent="Creating internal draft…";
      try{
        const payload=await workspace.api(base,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title,slug:slugify(title),result:String(data.get("result")||"failed"),experiment_kind:"other",afterlife:"none",node_id:"other",date_precision:"undated",state:"draft"})});
        const record=recordFrom(payload),id=recordId(record);
        setStatus("Failed experiment created as an internal draft");
        if(!id)throw new Error("The draft was created without an entity ID. Refresh the list and open it manually.");
        await openExperiment(id);
      }catch(error){output.textContent=error.message;setStatus(error.message);setFormBusy(form,false)}
    });
  }

  async function renderList(){
    beginView();
    workspace.host.innerHTML=`<section class="construct-manager fe-manager">${notice("Loading failed experiments…")}</section>`;
    try{
      const payload=await workspace.api(base);
      workspace.records=recordsFrom(payload,"experiments");
      paintList();
    }catch(error){workspace.host.innerHTML=`<section class="construct-manager fe-manager">${notice(error.message,"error")}</section>`;setStatus(error.message)}
  }

  function editForm(record){
    const currentNode=String(value(record,"node_id","nodeId","medium")||"other").replace(/^node-/,""),currentState=String(value(record,"state")||"draft");
    return `<form class="cm-form fe-record-form" data-fe-record-form>
      <div class="cm-form-grid">
        <label class="wide">Title<input name="title" value="${esc(value(record,"title"))}" required maxlength="300"></label>
        <label>Slug<input name="slug" value="${esc(value(record,"slug"))}" maxlength="180" required></label>
        <label>Archive medium<select name="node_id">${options(mediumOptions,currentNode)}</select></label>
        <label>Experiment kind<select name="experiment_kind">${options(kindOptions,value(record,"experiment_kind","experimentKind")||"other")}</select></label>
        <label>Original result<select name="result">${options(resultOptions,value(record,"result")||"failed")}</select></label>
        <label>Later afterlife<select name="afterlife">${options(afterlifeOptions,value(record,"afterlife")||"none")}</select></label>
        <label>Process phase<input name="process_phase" list="fe-process-phases" value="${esc(value(record,"process_phase","processPhase"))}" maxlength="160" placeholder="Material testing, prototype…"><datalist id="fe-process-phases">${phaseSuggestions.map(phase=>`<option value="${esc(phase)}"></option>`).join("")}</datalist></label>
        <label>Publication<select name="state">${options(stateOptions,currentState)}</select><span class="cm-field-note">Publishing is enforced by the server: the record needs a note or eligible public evidence.</span></label>
        <label class="wide">Short public note<textarea name="public_note" maxlength="3000" placeholder="What was attempted, and what made it unsuccessful?">${esc(value(record,"public_note","publicNote"))}</textarea></label>
        <label class="wide">Expanded context<textarea class="fe-long-note" name="expanded_context" maxlength="50000" placeholder="Materials, constraints, sequence, or observations that need more room.">${esc(value(record,"expanded_context","expandedContext"))}</textarea></label>
        <label class="wide">Learning<textarea name="learning" maxlength="12000" placeholder="What changed in the work because this attempt failed?">${esc(value(record,"learning"))}</textarea></label>
        <label>Date precision<select name="date_precision">${options(precisionOptions,value(record,"date_precision","datePrecision")||"undated")}</select></label>
        <label>Visitor-facing date<input name="date_label" value="${esc(value(record,"date_label","dateLabel"))}" maxlength="160" placeholder="Late 2024"></label>
        <label>Start / sort date<input type="date" name="occurred_at" value="${esc(dateOnly(value(record,"occurred_at","occurredAt")))}"></label>
        <label>End date<input type="date" name="ended_at" value="${esc(dateOnly(value(record,"ended_at","endedAt")))}"></label>
      </div>
      <div class="cm-actions"><button class="button" type="submit">Save experiment</button><button class="button danger-button" type="button" data-fe-archive>Archive record</button><span class="cm-upload-status" data-fe-record-status aria-live="polite"></span></div>
    </form>`;
  }

  function attachmentPreview(record){
    const id=mediaId(record),mime=mediaMime(record),alt=value(record,"alt_text","altText","alt_text_override","altTextOverride")||value(workspace.record,"title")||"Experiment evidence";
    if(!id)return`<div class="cm-empty">Digital asset unavailable.</div>`;
    if(mime.startsWith("image/"))return`<div class="fe-secure-preview" data-fe-secure-image="${esc(id)}" data-alt="${esc(alt)}"><span class="cm-meta">Loading secure image…</span></div>`;
    const label=mime.startsWith("audio/")?"Load secure audio":mime.startsWith("video/")?"Load secure video":"Open secure file";
    return`<div class="fe-secure-preview" data-fe-secure-container="${esc(id)}" data-mime="${esc(mime)}" data-alt="${esc(alt)}"><button class="button" type="button" data-fe-load-secure="${esc(id)}">${esc(label)}</button></div>`;
  }

  function attachmentCard(record,index,total){
    const id=mediaId(record),role=String(value(record,"role")||"evidence"),order=Number(value(record,"sort_order","sortOrder")||index+1),publicVisible=truthy(value(record,"public_visible","publicVisible"));
    return `<article class="fe-attachment" data-fe-attachment data-media-id="${esc(id)}">
      <div class="fe-attachment-preview">${attachmentPreview(record)}</div>
      <form class="cm-form fe-attachment-form" data-fe-attachment-form data-media-id="${esc(id)}">
        <div class="cm-card-head"><div><span class="cm-section-index">Evidence ${index+1}</span><h4>${esc(value(record,"original_filename","originalFilename")||id)}</h4></div><span class="cm-pill">${esc(mediaMime(record)||"file")}</span></div>
        <div class="cm-form-grid">
          <label>Role<select name="role">${options([["primary","Primary evidence"],["evidence","Evidence"],["document","Document"],["audio-note","Audio note"],["process-video","Process video"]],role)}</select></label>
          <label>Order<input name="sort_order" type="number" min="1" step="1" value="${esc(order)}"></label>
          <label class="wide">Alt text<input name="alt_text_override" value="${esc(value(record,"alt_text_override","altTextOverride","alt_text","altText"))}" placeholder="Describe visual evidence"></label>
          <label class="wide">Caption<textarea name="caption_override" placeholder="What should a visitor notice in this evidence?">${esc(value(record,"caption_override","captionOverride","caption"))}</textarea></label>
          <label class="cm-check-field wide"><input type="checkbox" name="public_visible"${checked(publicVisible)}>Eligible for the public experiment page</label>
        </div>
        <div class="cm-actions"><button class="button" type="submit">Save attachment</button><button class="button" type="button" data-fe-media-move="up"${index===0?" disabled":""}>Move up</button><button class="button" type="button" data-fe-media-move="down"${index===total-1?" disabled":""}>Move down</button><button class="button danger-button" type="button" data-fe-media-remove>Detach</button><span class="cm-upload-status" data-fe-attachment-status aria-live="polite"></span></div>
      </form>
    </article>`;
  }

  function libraryOptions(){
    return workspace.library.filter(item=>String(value(item,"state")||"active")==="active").map(item=>`<option value="${esc(mediaId(item))}">${esc(value(item,"original_filename","originalFilename")||mediaId(item))} · ${esc(value(item,"privacy")||"internal")} · ${esc(mediaMime(item)||"file")}</option>`).join("");
  }

  function attachmentsSection(){
    const count=workspace.media.length;
    return `<section class="cm-workspace-section fe-evidence-section" id="fe-evidence">
      <div class="cm-workspace-section-head"><div><span class="cm-section-index">02 · Evidence</span><h3>Ordered attempts and observations</h3><p>Images retain an internal original and receive a compressed WebP display derivative. Audio, video, and documents reuse the shared Digital Asset system.</p></div></div>
      <div class="fe-attachment-list">${count?workspace.media.map((item,index)=>attachmentCard(item,index,count)).join(""):`<div class="cm-empty">No evidence attached. A public note can stand alone, or attach reviewed evidence below.</div>`}</div>
      <form class="cm-form fe-upload-form" data-fe-upload-form>
        <div class="cm-form-grid">
          <label class="wide">Upload evidence<input type="file" name="files" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/*,application/pdf,text/plain,.doc,.docx" required><span class="cm-field-note">JPEG, PNG, and WebP images are paired automatically. MP4/WebM video uses resumable upload. Other files are limited by the shared media service.</span></label>
          <label class="wide">Alt text<input name="alt_text" value="${esc(value(workspace.record,"title"))}" placeholder="Describe visual evidence"></label>
          <label class="wide">Shared caption<textarea name="caption" placeholder="Applied to each uploaded attachment; refine individually afterward."></textarea></label>
          <label class="cm-check-field"><input type="checkbox" name="public_visible">Mark new evidence public</label>
        </div>
        <div class="cm-actions"><button class="button" type="submit">Upload and attach</button><button class="button danger-button" type="button" data-fe-upload-cancel hidden>Cancel upload</button><span class="cm-upload-status" data-fe-upload-status aria-live="polite"></span></div>
      </form>
      <details class="fe-existing-media"><summary>Attach an existing Digital Asset</summary>
        <form class="cm-form" data-fe-existing-media-form><div class="cm-form-grid">
          <label class="wide">Digital Asset<select name="media_id" required><option value="">Choose an existing asset</option>${libraryOptions()}</select></label>
          <label>Role<select name="role">${options([["evidence","Evidence"],["primary","Primary evidence"],["document","Document"],["audio-note","Audio note"],["process-video","Process video"]],"evidence")}</select></label>
          <label>Order<input type="number" name="sort_order" min="1" step="1" value="${count+1}"></label>
          <label class="wide">Alt text override<input name="alt_text_override" value="${esc(value(workspace.record,"title"))}"></label>
          <label class="cm-check-field wide"><input type="checkbox" name="public_visible">Eligible for public display</label>
        </div><div class="cm-actions"><button class="button" type="submit">Attach existing asset</button><span class="cm-upload-status" data-fe-existing-status aria-live="polite"></span></div></form>
      </details>
    </section>`;
  }

  function relationshipLabel(relationship,entityId){
    const outgoing=String(value(relationship,"source_entity_id","sourceEntityId"))===entityId;
    const other=outgoing?relationship.target:relationship.source;
    const label=outgoing?value(relationship,"forward_label","forwardLabel"):value(relationship,"reverse_label","reverseLabel");
    return `${value(other,"title")||value(other,"id")||"Unknown entity"} · ${label||"Related"}`;
  }

  function relationshipOtherId(relationship,entityId){
    return String(value(relationship,"source_entity_id","sourceEntityId"))===entityId?String(value(relationship,"target_entity_id","targetEntityId")):String(value(relationship,"source_entity_id","sourceEntityId"));
  }

  function stateLabel(state){
    const version=value(state,"version_number","versionNumber"),roman=value(state,"state_roman","stateRoman")||"I",variant=value(state,"variant_label","variantLabel"),title=value(state,"title");
    return `${version?`Version ${version} / `:""}State ${roman}${variant?`, ${variant}`:""}${title?` · ${title}`:""}`;
  }

  function stateLinksMarkup(entityId){
    if(!workspace.relationships.length)return`<div class="cm-empty">Create a connection first. State links decorate an existing connection; they do not create another network.</div>`;
    return `<form class="cm-form" data-fe-state-links-form><div class="fe-state-link-list">${workspace.relationships.map(relationship=>{
      const relationId=String(value(relationship,"id")),otherId=relationshipOtherId(relationship,entityId),available=workspace.states.filter(state=>String(value(state,"entity_id","entityId"))===otherId),current=workspace.stateLinks.find(link=>stateLinkRelationshipId(link)===relationId),currentState=stateLinkStateId(current);
      return `<label>${esc(relationshipLabel(relationship,entityId))}<select data-fe-state-select data-relationship-id="${esc(relationId)}"><option value="">No documented artwork state</option>${available.map(state=>`<option value="${esc(value(state,"id"))}"${selected(currentState,value(state,"id"))}>${esc(stateLabel(state))}</option>`).join("")}</select><span class="cm-field-note">${available.length?"Choose a published or internal documented state from the connected work.":"This connected entity has no Archive states."}</span></label>`}).join("")}</div><div class="cm-actions"><button class="button" type="submit">Save state links</button><button class="button" type="button" data-fe-refresh-connections>Refresh after connection changes</button><span class="cm-upload-status" data-fe-state-links-status aria-live="polite"></span></div></form>`;
  }

  function connectionsSection(entityId){
    return `<section class="cm-workspace-section fe-connections-section" id="fe-connections">
      <div class="cm-workspace-section-head"><div><span class="cm-section-index">03 · Connections</span><h3>Existing Construct relationships</h3><p>The shared Connections workbench remains the only network editor. New links start private and default to “Predecessor of.”</p></div></div>
      <div data-fe-connections></div>
      <div class="fe-state-links"><div class="cm-workspace-section-head"><div><span class="cm-section-index">Optional state detail</span><h3>Documented artwork state</h3><p>When a connection points to a catalogued work, identify the exact state this experiment informed.</p></div></div>${stateLinksMarkup(entityId)}</div>
    </section>`;
  }

  function readinessMarkup(record){
    const published=String(value(record,"state")||"draft")==="published",hasNote=Boolean(String(value(record,"public_note","publicNote")||"").trim()),publicEvidence=workspace.media.filter(item=>truthy(value(item,"public_visible","publicVisible"))).length;
    return `<div class="fe-readiness${published?" is-ready":""}"><strong>${published?"Published":"Internal draft"}</strong><span>${hasNote?"Public note ready":"No public note"} · ${publicEvidence} public attachment${publicEvidence===1?"":"s"}. Media privacy, presentation, and state are checked again by the server.</span></div>`;
  }

  function paintDetail(){
    beginView();
    const record=workspace.record,entityId=recordId(record),slug=value(record,"slug"),published=String(value(record,"state")||"draft")==="published";
    workspace.host.innerHTML=`<section class="construct-manager fe-manager fe-workspace" data-fe-entity-id="${esc(entityId)}">
      <div class="cm-head"><div><button class="button cm-back-button" type="button" data-fe-back>← All failed experiments</button><span class="cm-section-index">Failed experiment · ${esc(recordMedium(record))}</span><h2>${esc(value(record,"title")||"Untitled experiment")}</h2><p class="cm-summary">This evidence record can stand alone and connect to finished work without receiving a cultural-object catalogue identity.</p></div>${published&&slug?`<a class="button" href="/archive/failed-experiments/${encodeURIComponent(slug)}/" target="_blank" rel="noopener">Open public page</a>`:""}</div>
      ${readinessMarkup(record)}
      <nav class="cm-workspace-nav" aria-label="Failed experiment sections"><a href="#fe-record">Record</a><a href="#fe-evidence">Evidence</a><a href="#fe-connections">Connections</a></nav>
      <section class="cm-workspace-section" id="fe-record"><div class="cm-workspace-section-head"><div><span class="cm-section-index">01 · Record</span><h3>Attempt, outcome, and learning</h3><p>Original result and later afterlife remain separate so a failed attempt can be reused without rewriting its history.</p></div></div>${editForm(record)}</section>
      ${attachmentsSection()}
      ${connectionsSection(entityId)}
    </section>`;
    bindDetail(entityId);
    hydrateImagePreviews();
    mountConnections(entityId);
  }

  async function openExperiment(id){
    beginView();
    workspace.host.innerHTML=`<section class="construct-manager fe-manager">${notice("Loading failed experiment…")}</section>`;
    try{
      const detailPayload=await workspace.api(`${base}/${encodeURIComponent(id)}`),record=recordFrom(detailPayload),entityId=recordId(record)||String(id);
      if(!recordId(record))record.entity_id=entityId;
      const [mediaPayload,libraryPayload,entityPayload,relationshipPayload,typePayload,statePayload]=await Promise.all([
        workspace.api(`/api/admin/entities/${encodeURIComponent(entityId)}/media`),workspace.api("/api/admin/media"),workspace.api("/api/admin/entities"),workspace.api(`/api/admin/relationships?entity_id=${encodeURIComponent(entityId)}`),workspace.api("/api/admin/relationship-types"),workspace.api("/api/admin/archive-states"),
      ]);
      workspace.record=record;
      workspace.media=recordsFrom(mediaPayload,"media");
      workspace.library=recordsFrom(libraryPayload,"media");
      workspace.entities=recordsFrom(entityPayload,"entities");
      workspace.relationships=recordsFrom(relationshipPayload,"relationships");
      workspace.relationshipTypes=recordsFrom(typePayload,"relationshipTypes");
      workspace.states=recordsFrom(statePayload,"states");
      workspace.stateLinks=recordsFrom(detailPayload,"state_links","stateLinks");
      paintDetail();
    }catch(error){workspace.host.innerHTML=`<section class="construct-manager fe-manager"><button class="button" type="button" data-fe-list-retry>← Failed experiments</button>${notice(error.message,"error")}</section>`;workspace.host.querySelector("[data-fe-list-retry]")?.addEventListener("click",renderList,{once:true});setStatus(error.message)}
  }

  function serializeRecord(form){
    const data=new FormData(form);
    return {title:String(data.get("title")||"").trim(),slug:slugify(data.get("slug")),node_id:String(data.get("node_id")||"other"),experiment_kind:String(data.get("experiment_kind")||"other"),result:String(data.get("result")||"failed"),afterlife:String(data.get("afterlife")||"none"),process_phase:String(data.get("process_phase")||"").trim(),public_note:String(data.get("public_note")||"").trim(),expanded_context:String(data.get("expanded_context")||"").trim(),learning:String(data.get("learning")||"").trim(),date_precision:String(data.get("date_precision")||"undated"),date_label:String(data.get("date_label")||"").trim(),occurred_at:String(data.get("occurred_at")||"")||null,ended_at:String(data.get("ended_at")||"")||null,state:String(data.get("state")||"draft")};
  }

  function bindDetail(entityId){
    const host=workspace.host;
    bind(host,"click",async event=>{
      if(event.target.closest("[data-fe-back]")){await cancelActiveUpload();return renderList()}
      const archive=event.target.closest("[data-fe-archive]");
      if(archive&&confirm("Archive this failed experiment? Its evidence, connections, and revision history will be retained, but it will leave public results and search.")){
        try{await workspace.api(`${base}/${encodeURIComponent(entityId)}`,{method:"DELETE"});setStatus("Failed experiment archived");await renderList()}catch(error){setStatus(error.message)}return;
      }
      const remove=event.target.closest("[data-fe-media-remove]");
      if(remove&&confirm("Detach this Digital Asset from the experiment? The shared asset itself will be retained.")){
        const form=remove.closest("[data-fe-attachment-form]"),id=form.dataset.mediaId;
        try{await workspace.api(`/api/admin/entities/${encodeURIComponent(entityId)}/media/${encodeURIComponent(id)}`,{method:"DELETE"});setStatus("Evidence detached");await openExperiment(entityId)}catch(error){form.querySelector("[data-fe-attachment-status]").textContent=error.message;setStatus(error.message)}return;
      }
      const move=event.target.closest("[data-fe-media-move]");
      if(move){await moveAttachment(entityId,move.closest("[data-fe-attachment-form]").dataset.mediaId,move.dataset.feMediaMove);return}
      const secure=event.target.closest("[data-fe-load-secure]");
      if(secure){await loadSecurePreview(secure.closest("[data-fe-secure-container]"));return}
      if(event.target.closest("[data-fe-upload-cancel]")){await cancelActiveUpload();return}
      if(event.target.closest("[data-fe-refresh-connections]")){return openExperiment(entityId)}
    });
    bind(host,"submit",async event=>{
      const recordForm=event.target.closest("[data-fe-record-form]");if(recordForm){event.preventDefault();return saveRecord(recordForm,entityId)}
      const attachmentForm=event.target.closest("[data-fe-attachment-form]");if(attachmentForm){event.preventDefault();return saveAttachment(attachmentForm,entityId)}
      const uploadForm=event.target.closest("[data-fe-upload-form]");if(uploadForm){event.preventDefault();return uploadEvidence(uploadForm,entityId)}
      const existingForm=event.target.closest("[data-fe-existing-media-form]");if(existingForm){event.preventDefault();return attachExisting(existingForm,entityId)}
      const stateForm=event.target.closest("[data-fe-state-links-form]");if(stateForm){event.preventDefault();return saveStateLinks(stateForm,entityId)}
    });
  }

  async function saveRecord(form,entityId){
    const output=form.querySelector("[data-fe-record-status]");setFormBusy(form,true);output.textContent="Saving experiment…";
    try{await workspace.api(`${base}/${encodeURIComponent(entityId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(serializeRecord(form))});setStatus("Failed experiment saved");await openExperiment(entityId)}catch(error){output.textContent=error.message;setStatus(error.message);setFormBusy(form,false)}
  }

  async function saveAttachment(form,entityId){
    const output=form.querySelector("[data-fe-attachment-status]"),data=new FormData(form),id=form.dataset.mediaId;setFormBusy(form,true);output.textContent="Saving attachment…";
    try{await workspace.api(`/api/admin/entities/${encodeURIComponent(entityId)}/media/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({role:String(data.get("role")||"evidence"),sort_order:Number(data.get("sort_order"))||0,public_visible:data.has("public_visible"),alt_text_override:String(data.get("alt_text_override")||"").trim(),caption_override:String(data.get("caption_override")||"").trim()})});setStatus("Evidence attachment saved");await openExperiment(entityId)}catch(error){output.textContent=error.message;setStatus(error.message);setFormBusy(form,false)}
  }

  async function moveAttachment(entityId,id,direction){
    const index=workspace.media.findIndex(item=>mediaId(item)===id),target=direction==="up"?index-1:index+1;if(index<0||target<0||target>=workspace.media.length)return;
    const ordered=[...workspace.media];[ordered[index],ordered[target]]=[ordered[target],ordered[index]];
    try{await Promise.all(ordered.map((item,order)=>workspace.api(`/api/admin/entities/${encodeURIComponent(entityId)}/media/${encodeURIComponent(mediaId(item))}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({sort_order:order+1})})));setStatus("Evidence order saved");await openExperiment(entityId)}catch(error){setStatus(error.message)}
  }

  async function attachExisting(form,entityId){
    const output=form.querySelector("[data-fe-existing-status]"),data=new FormData(form),id=String(data.get("media_id")||"");setFormBusy(form,true);output.textContent="Attaching Digital Asset…";
    try{await workspace.api(`/api/admin/entities/${encodeURIComponent(entityId)}/media`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media_id:id,role:String(data.get("role")||"evidence"),sort_order:Number(data.get("sort_order"))||workspace.media.length+1,public_visible:data.has("public_visible"),alt_text_override:String(data.get("alt_text_override")||"").trim()})});setStatus("Existing Digital Asset attached");await openExperiment(entityId)}catch(error){output.textContent=error.message;setStatus(error.message);setFormBusy(form,false)}
  }

  async function saveStateLinks(form,entityId){
    const output=form.querySelector("[data-fe-state-links-status]"),links=[...form.querySelectorAll("[data-fe-state-select]")].filter(select=>select.value).map(select=>({relationship_id:select.dataset.relationshipId,state_id:select.value}));setFormBusy(form,true);output.textContent="Saving state links…";
    try{await workspace.api(`${base}/${encodeURIComponent(entityId)}/state-links`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({links})});setStatus("Documented state links saved");await openExperiment(entityId)}catch(error){output.textContent=error.message;setStatus(error.message);setFormBusy(form,false)}
  }

  function mediaForm(file,metadata){
    const form=new FormData();form.append("file",file);form.append("alt_text",metadata.altText);form.append("caption",metadata.caption);form.append("privacy",metadata.privacy);form.append("public_presentation",metadata.publicPresentation);form.append("public_title",metadata.publicTitle);form.append("public_description",metadata.caption);return form;
  }

  async function uploadSimple(file,metadata){
    const payload=await workspace.api("/api/admin/media",{method:"POST",body:mediaForm(file,metadata)}),record=recordFrom(payload);
    if(!mediaId(record))throw new Error(`${file.name} uploaded without a Digital Asset ID.`);
    return record;
  }

  async function uploadResumable(file,metadata,output,uploadKind="video"){
    if(!window.StudioResumableMedia){if(file.size<=15*1024*1024)return uploadSimple(file,metadata);throw new Error("The resumable uploader is unavailable. Refresh Studio and try again.")}
    workspace.uploadController=new AbortController();workspace.uploadSession="";
    return window.StudioResumableMedia.upload(file,{token:localStorage.getItem(tokenKey)||"",uploadKind,signal:workspace.uploadController.signal,altText:metadata.altText,caption:metadata.caption,privacy:metadata.privacy,publicTitle:metadata.publicTitle,publicDescription:metadata.caption,publicPresentation:metadata.publicPresentation,onSession:session=>{workspace.uploadSession=session.id},onStatus:message=>{output.textContent=message},onProgress:progress=>{output.textContent=`${progress.resumed?"Resuming":"Uploading"} ${file.name}: ${progress.percent}%`}});
  }

  async function imageSource(file){
    if(window.createImageBitmap){try{return await createImageBitmap(file,{imageOrientation:"from-image"})}catch{return createImageBitmap(file)}}
    const url=URL.createObjectURL(file);
    try{return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error(`${file.name} could not be decoded in this browser.`));image.src=url})}finally{URL.revokeObjectURL(url)}
  }

  async function webpDerivative(file){
    const source=await imageSource(file),width=source.width||source.naturalWidth,height=source.height||source.naturalHeight,maxDimension=2400,scale=Math.min(1,maxDimension/Math.max(width,height)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));const context=canvas.getContext("2d",{alpha:true});if(!context)throw new Error("This browser could not prepare an image derivative.");context.drawImage(source,0,0,canvas.width,canvas.height);source.close?.();const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",.84));if(!blob)throw new Error("This browser could not encode a WebP display derivative.");return new File([blob],`${file.name.replace(/\.[^.]+$/,"")||"experiment"}-display.webp`,{type:"image/webp",lastModified:Date.now()})
  }

  async function uploadImagePair(file,metadata,entityId,role,sortOrder,publicVisible,output){
    output.textContent=`Preparing ${file.name} display derivative…`;
    const derivativeFile=await webpDerivative(file),masterMetadata={...metadata,privacy:"internal",publicPresentation:"hidden"},master=await uploadResumable(file,masterMetadata,output,"archive-master");
    output.textContent=`Uploading ${file.name} WebP derivative…`;
    const derivative=await uploadSimple(derivativeFile,{...metadata,privacy:"public",publicPresentation:"inline"});
    await workspace.api(`${base}/${encodeURIComponent(entityId)}/media-pair`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({master_media_id:mediaId(master),derivative_media_id:mediaId(derivative),role,sort_order:sortOrder,public_visible:publicVisible,alt_text_override:metadata.altText,caption_override:metadata.caption})});
  }

  async function uploadEvidence(form,entityId){
    const output=form.querySelector("[data-fe-upload-status]"),cancel=form.querySelector("[data-fe-upload-cancel]"),data=new FormData(form),files=[...form.elements.files.files],publicVisible=data.has("public_visible"),metadata={altText:String(data.get("alt_text")||value(workspace.record,"title")||"").trim(),caption:String(data.get("caption")||"").trim(),privacy:publicVisible?"public":"internal",publicPresentation:"inline",publicTitle:String(value(workspace.record,"title")||"")};
    if(!files.length)return;
    setFormBusy(form,true);cancel.disabled=false;cancel.hidden=false;
    try{
      let sortOrder=workspace.media.length+1;
      for(let index=0;index<files.length;index+=1){
        const file=files[index],mime=String(file.type||"").toLowerCase();output.textContent=`Preparing ${index+1} of ${files.length}: ${file.name}`;
        if(imageTypes.has(mime))await uploadImagePair(file,metadata,entityId,sortOrder===1?"primary":"evidence",sortOrder,publicVisible,output);
        else{
          if(!acceptedTypes.has(mime)&&!mime.startsWith("audio/"))throw new Error(`${file.name}: unsupported evidence type.`);
          const record=mime.startsWith("video/")?await uploadResumable(file,metadata,output,"video"):await uploadSimple(file,metadata),id=mediaId(record),role=mime.startsWith("audio/")?"audio-note":mime.startsWith("video/")?"process-video":mime==="application/pdf"?"document":sortOrder===1?"primary":"evidence";
          await workspace.api(`/api/admin/entities/${encodeURIComponent(entityId)}/media`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media_id:id,role,sort_order:sortOrder,public_visible:publicVisible,alt_text_override:metadata.altText,caption_override:metadata.caption})});
        }
        sortOrder+=1;
      }
      workspace.uploadController=null;workspace.uploadSession="";setStatus(`${files.length} evidence attachment${files.length===1?"":"s"} added`);await openExperiment(entityId);
    }catch(error){output.textContent=error.name==="AbortError"?"Upload cancelled.":error.message;setStatus(output.textContent);setFormBusy(form,false);cancel.hidden=true;workspace.uploadController=null;workspace.uploadSession=""}
  }

  async function cancelActiveUpload(){
    workspace.uploadController?.abort();
    if(workspace.uploadSession&&window.StudioResumableMedia)try{await window.StudioResumableMedia.cancel(workspace.uploadSession,localStorage.getItem(tokenKey)||"")}catch{}
    workspace.uploadController=null;workspace.uploadSession="";
    const output=workspace.host?.querySelector("[data-fe-upload-status]");if(output)output.textContent="Upload cancelled.";
    const cancel=workspace.host?.querySelector("[data-fe-upload-cancel]");if(cancel)cancel.hidden=true;
  }

  async function secureBlob(media){
    const response=await fetch(`/api/admin/media/${encodeURIComponent(media)}/file`,{headers:{authorization:`Bearer ${localStorage.getItem(tokenKey)||""}`},cache:"no-store"});if(!response.ok)throw new Error(`Preview unavailable (${response.status}).`);return response.blob();
  }

  async function loadSecurePreview(container){
    const id=container?.dataset.feSecureContainer,mime=container?.dataset.mime||"",alt=container?.dataset.alt||"Experiment evidence";if(!id)return;
    container.innerHTML='<span class="cm-meta">Loading secure preview…</span>';
    try{const url=URL.createObjectURL(await secureBlob(id));workspace.previewUrls.push(url);if(mime.startsWith("audio/"))container.innerHTML=`<audio controls preload="metadata" src="${url}"></audio>`;else if(mime.startsWith("video/"))container.innerHTML=`<video controls playsinline preload="metadata" src="${url}"></video>`;else container.innerHTML=`<a class="button" href="${url}" target="_blank" rel="noopener">Open secure file</a><span class="cm-field-note">${esc(alt)}</span>`}catch(error){container.innerHTML=`<span class="cm-meta">${esc(error.message)}</span>`}
  }

  async function hydrateImagePreviews(){
    await Promise.all([...workspace.host.querySelectorAll("[data-fe-secure-image]")].map(async container=>{try{const url=URL.createObjectURL(await secureBlob(container.dataset.feSecureImage));workspace.previewUrls.push(url);container.innerHTML=`<img src="${url}" alt="${esc(container.dataset.alt||"Experiment evidence")}" loading="lazy">`}catch(error){container.innerHTML=`<span class="cm-meta">${esc(error.message)}</span>`}}));
  }

  async function mountConnections(entityId){
    const target=workspace.host.querySelector("[data-fe-connections]");if(!target)return;
    if(!window.ConnectionsManager){target.innerHTML=notice("The shared Connections workbench is unavailable. Refresh Studio and try again.","error");return}
    await window.ConnectionsManager.mount(target,{entityId});
    const type=target.querySelector('[name="relationship_type_id"]');if(type&&!type.value){const predecessor=workspace.relationshipTypes.find(item=>String(value(item,"slug"))==="predecessor-of")||workspace.relationshipTypes.find(item=>String(value(item,"id"))==="rel-predecessor-of");if(predecessor){type.value=String(value(predecessor,"id"));type.dispatchEvent(new Event("input",{bubbles:true}))}}
  }

  async function mount(host,api,status){
    if(!host||typeof api!=="function")return;
    await cancelActiveUpload();clearPreviews();workspace.bindings?.abort();workspace.host=host;workspace.api=api;workspace.status=typeof status==="function"?status:()=>{};workspace.record=null;workspace.records=[];await renderList();
  }

  window.ArchiveFailedExperimentsStudio={mount};
})();
