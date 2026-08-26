(function(){
  "use strict";
  const app=document.querySelector("[data-blackboards-app]");
  if(!app)return;
  const dialog=document.querySelector("[data-blackboard-zoom]");
  const zoomImage=dialog?.querySelector("[data-blackboard-zoom-image]");
  const zoomTitle=dialog?.querySelector("[data-blackboard-zoom-title]");
  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  const safeUrl=value=>{try{const url=new URL(String(value||""),location.origin);return url.origin===location.origin?`${url.pathname}${url.search}${url.hash}`:""}catch{return""}};
  const pathParts=location.pathname.split("/").filter(Boolean);
  const detailSlug=pathParts.length===3&&pathParts[0]==="archive"&&pathParts[1]==="blackboards"?pathParts[2]:"";

  function openZoom(button){
    if(!dialog||!zoomImage)return;
    zoomImage.src=button.dataset.src||"";zoomImage.alt=button.dataset.alt||"Blackboard scan";
    if(zoomTitle)zoomTitle.textContent=button.dataset.title||"Blackboard scan";
    dialog.showModal();
  }

  function zoomButton(image,title,className="blackboard-scan-button",loading="lazy"){
    if(!image?.url)return"";
    return `<button class="${className}" type="button" data-blackboard-open data-src="${escapeHtml(safeUrl(image.url))}" data-alt="${escapeHtml(image.alt_text)}" data-title="${escapeHtml(title)}" aria-label="Zoom ${escapeHtml(title)}">
      <img src="${escapeHtml(safeUrl(image.url))}" alt="${escapeHtml(image.alt_text)}" loading="${loading}">
    </button>`;
  }

  function stateCard(state,{timeline=false,recordTitle=""}={}){
    const title=recordTitle?`${recordTitle} · ${state.title}`:state.title;
    return `<article class="blackboard-card${timeline?" blackboard-timeline-card":""}" id="state-${escapeHtml(state.id)}">
      ${zoomButton(state.scan,title)}
      <div class="blackboard-card-copy">
        <p class="blackboard-card-meta">${escapeHtml(state.catalogue_label)}${state.date_label?` · ${escapeHtml(state.date_label)}`:""}</p>
        <h3>${escapeHtml(state.title)}</h3>
        ${state.description?`<p>${escapeHtml(state.description)}</p>`:""}
      </div>
    </article>`;
  }

  function recordCard(record){
    const latest=record.latestState||record.latest_state||record.latestCapture||record.latest_capture;
    return `<article class="blackboard-surface-card">
      ${latest?zoomButton(latest.scan,`${record.title} · ${latest.title}`):""}
      <div class="blackboard-card-copy">
        <p class="blackboard-card-meta">${escapeHtml(record.catalogueLabel||record.catalogue_label)} · ${escapeHtml(record.studioLocation||record.studio_location)} · ${escapeHtml(record.wallDesignation||record.wall_designation)}</p>
        <h2><a href="${escapeHtml(safeUrl(record.route))}">${escapeHtml(record.title)}</a></h2>
        ${record.summary?`<p>${escapeHtml(record.summary)}</p>`:""}
        <p>${Number(record.stateCount||record.state_count)} documented states · ${Number(record.fragmentCount||record.fragment_count)} fragments</p>
        <a href="${escapeHtml(safeUrl(record.route))}">Open Blackboard record</a>
      </div>
    </article>`;
  }

  function manifestationList(items){
    return items.length?`<div class="blackboard-fragment-links"><h4>Manifestations</h4><ul>${items.map(item=>`<li><span>${escapeHtml(item.relationship)}</span> <a href="${escapeHtml(safeUrl(item.target?.route)||"/archive/")}">${escapeHtml(item.target?.title)}</a></li>`).join("")}</ul></div>`:"";
  }

  function fragmentCard(fragment){
    const visible=fragment.visibleIn||fragment.visible_in||[],threads=fragment.originThreads||fragment.origin_threads||[];
    return `<article class="blackboard-fragment" id="fragment-${escapeHtml(fragment.slug)}">
      ${zoomButton(fragment.image,fragment.title)}
      <div class="blackboard-fragment-copy">
        <p class="blackboard-fragment-board">${fragment.date?escapeHtml(fragment.date):"Date not fixed to a board state"}</p>
        <h3>${escapeHtml(fragment.title)}</h3>
        ${fragment.caption?`<p>${escapeHtml(fragment.caption)}</p>`:""}
        ${manifestationList(Array.isArray(fragment.manifestations)?fragment.manifestations:[])}
        ${visible.length?`<div class="blackboard-fragment-links"><h4>Visible in</h4><ul>${visible.map(state=>`<li><a href="#state-${escapeHtml(state.id)}">${escapeHtml(state.catalogue_label)} · ${escapeHtml(state.date_label||state.title)}</a></li>`).join("")}</ul></div>`:""}
        ${threads.length?`<div class="blackboard-fragment-links"><h4>Origin threads</h4><ul>${threads.map(thread=>`<li>${escapeHtml(thread.title)}</li>`).join("")}</ul></div>`:""}
      </div>
    </article>`;
  }

  function notebookCard(item){
    return `<article class="blackboard-fragment">${zoomButton(item.image,item.title)}<div class="blackboard-fragment-copy">
      <p class="blackboard-fragment-board">${escapeHtml(item.date||"Undated notebook entry")}</p><h3>${escapeHtml(item.title)}</h3>
      ${item.caption?`<p>${escapeHtml(item.caption)}</p>`:""}${item.body?`<p>${escapeHtml(item.body)}</p>`:""}</div></article>`;
  }

  function historyMarkup(item){
    return `<article class="blackboard-history-entry"><p class="blackboard-card-meta">${escapeHtml(item.date_label||item.occurred_at||"Undated")}</p><h3>${escapeHtml(item.title)}</h3>${item.summary?`<p>${escapeHtml(item.summary)}</p>`:""}${item.body?`<p>${escapeHtml(item.body)}</p>`:""}</article>`;
  }

  function timeline(states,recordTitle){
    return states.map((state,index)=>`${index&&Number.isFinite(Number(state.elapsed_days))?`<div class="blackboard-interval" aria-label="${Number(state.elapsed_days)} days elapsed"><span>${Number(state.elapsed_days)} days later</span></div>`:""}${stateCard(state,{timeline:true,recordTitle})}`).join("");
  }

  function renderDetail(data){
    const record=data.record||data.surface,latest=data.latestState||data.latest_state||data.latestCapture||data.latest_capture,states=Array.isArray(data.states)?data.states:(Array.isArray(data.captures)?data.captures:[]),notebook=Array.isArray(data.notebook)?data.notebook:(data.contextMedia||data.context_media||[]),fragments=Array.isArray(data.fragments)?data.fragments:[],history=data.itemHistory||data.item_history||data.activities||[];
    document.title=`${record.title} · the six.well construct`;
    const title=document.querySelector(".hero-title"),descriptor=document.querySelector(".hero-descriptor"),current=document.querySelector(".construct-breadcrumb-current");
    if(title)title.textContent=record.title;if(current)current.textContent=record.title;
    if(descriptor)descriptor.textContent=record.summary||"One evolving Blackboard record documented through dated states and notebook fragments.";
    app.innerHTML=`<section class="blackboard-surface-intro" aria-label="Blackboard record identity">
        <dl><div><dt>Record</dt><dd>${escapeHtml(record.catalogueLabel||record.catalogue_label)}</dd></div><div><dt>Location</dt><dd>${escapeHtml(record.studioLocation||record.studio_location)}</dd></div><div><dt>Wall</dt><dd>${escapeHtml(record.wallDesignation||record.wall_designation)}</dd></div><div><dt>Orientation</dt><dd>${escapeHtml(record.orientationNote||record.orientation_note)}</dd></div></dl>
      </section>
      <section class="blackboards-section blackboard-latest" aria-labelledby="latest-capture">
        <div class="blackboards-section-heading"><h2 id="latest-capture">Current documented state</h2><p>The newest scan leads while remaining part of this single catalogued Blackboard record.</p></div>
        ${latest?stateCard(latest,{recordTitle:record.title}):`<p class="blackboards-empty">No public state is available.</p>`}
      </section>
      <section class="blackboards-section" aria-labelledby="capture-timeline">
        <div class="blackboards-section-heading"><h2 id="capture-timeline">Version 1 · States</h2><p>State I through the current state, oldest to newest. Intervals report elapsed calendar days between scans.</p></div>
        ${states.length?`<div class="blackboard-timeline">${timeline(states,record.title)}</div>`:`<p class="blackboards-empty">No public states are available.</p>`}
      </section>
      <section class="blackboards-section" aria-labelledby="open-notebook"><div class="blackboards-section-heading"><h2 id="open-notebook">Open notebook</h2><p>Studio context and sporadic close-up fragments. An entry does not belong to a dated state unless “Visible in” is manually confirmed.</p></div>
        ${notebook.length?`<div class="blackboard-context-grid">${notebook.map(notebookCard).join("")}</div>`:""}
        ${fragments.length?`<div class="blackboard-fragment-grid">${fragments.map(fragmentCard).join("")}</div>`:""}
        ${!notebook.length&&!fragments.length?`<p class="blackboards-empty">No Notebook entries are public yet.</p>`:""}
      </section>
      ${history.length?`<section class="blackboards-section" aria-labelledby="item-history"><div class="blackboards-section-heading"><h2 id="item-history">Item history</h2><p>Documented lifecycle events for the physical Blackboard—not its routine captured states.</p></div><div class="blackboard-history">${history.map(historyMarkup).join("")}</div></section>`:""}`;
  }

  function renderIndex(data){
    const records=Array.isArray(data.records)?data.records:(Array.isArray(data.surfaces)?data.surfaces:[]);
    app.innerHTML=`<section class="blackboards-section" aria-labelledby="blackboard-records">
      <div class="blackboards-section-heading"><h2 id="blackboard-records">Blackboard records</h2><p>Each physical Blackboard keeps one catalogue identity while its dated states and Notebook evidence accumulate.</p></div>
      ${records.length?`<div class="blackboard-grid">${records.map(recordCard).join("")}</div>`:`<p class="blackboards-empty">No Blackboard records are public yet.</p>`}
    </section>`;
  }

  async function load(){
    try{
      const endpoint=detailSlug?`/api/archive/blackboards/${encodeURIComponent(detailSlug)}`:"/api/archive/blackboards";
      const response=await fetch(endpoint,{headers:{accept:"application/json"},cache:"no-store"}),data=await response.json();
      if(!response.ok)throw new Error(data.error||"The Blackboard archive could not be opened.");
      if(detailSlug)renderDetail(data);else renderIndex(data);
      app.querySelectorAll("[data-blackboard-open]").forEach(button=>button.addEventListener("click",()=>openZoom(button)));
    }catch(error){app.innerHTML=`<p class="blackboards-error" role="alert">${escapeHtml(error.message)} <button type="button" data-blackboards-retry>Try again</button></p>`;app.querySelector("[data-blackboards-retry]")?.addEventListener("click",load)}
  }
  dialog?.querySelector("[data-blackboard-zoom-close]")?.addEventListener("click",()=>dialog.close());
  dialog?.addEventListener("click",event=>{if(event.target===dialog)dialog.close()});
  dialog?.addEventListener("close",()=>{if(zoomImage){zoomImage.removeAttribute("src");zoomImage.alt=""}});
  load();
})();
