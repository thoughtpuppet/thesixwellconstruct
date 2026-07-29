(function(){
  "use strict";
  const app=document.querySelector("[data-blackboards-app]");
  if(!app)return;
  const dialog=document.querySelector("[data-blackboard-zoom]");
  const zoomImage=dialog?.querySelector("[data-blackboard-zoom-image]");
  const zoomTitle=dialog?.querySelector("[data-blackboard-zoom-title]");
  const escapeHtml=(value)=>String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  const safeUrl=(value)=>{
    try{const url=new URL(String(value||""),location.origin);return url.origin===location.origin?`${url.pathname}${url.search}${url.hash}`:""}catch{return""}
  };
  const contexts=(items)=>items.length?`<dl class="blackboard-contexts"><dt>Source for</dt>${items.map(item=>`<dd><a href="${escapeHtml(safeUrl(item.record_route)||"/archive/")}">${escapeHtml(item.title)}</a></dd>`).join("")}</dl>`:"";

  function openZoom(button){
    if(!dialog||!zoomImage)return;
    zoomImage.src=button.dataset.src||"";
    zoomImage.alt=button.dataset.alt||"Blackboard scan";
    if(zoomTitle)zoomTitle.textContent=button.dataset.title||"Blackboard scan";
    dialog.showModal();
  }

  function boardCard(board){
    const scan=board.scan||{};
    return `<article class="blackboard-card">
      <button class="blackboard-scan-button" type="button" data-blackboard-open data-src="${escapeHtml(safeUrl(scan.url))}" data-alt="${escapeHtml(scan.alt_text)}" data-title="${escapeHtml(board.title)}" aria-label="Zoom complete scan of ${escapeHtml(board.title)}">
        <img src="${escapeHtml(safeUrl(scan.url))}" alt="${escapeHtml(scan.alt_text)}" loading="lazy">
      </button>
      <div class="blackboard-card-copy">
        <p class="blackboard-card-meta">${escapeHtml(board.catalogue_label||board.catalogue_id)}${board.date_label?` · ${escapeHtml(board.date_label)}`:""} · ${Number(board.fragment_count||0)} fragment${Number(board.fragment_count||0)===1?"":"s"}</p>
        <h3>${escapeHtml(board.title)}</h3>
        ${board.summary?`<p>${escapeHtml(board.summary)}</p>`:""}
        <a href="${escapeHtml(safeUrl(board.record_route)||"/archive/")}">Open complete Archive record</a>
      </div>
    </article>`;
  }

  function fragmentCard(fragment){
    const image=fragment.image||{},board=fragment.board;
    return `<article class="blackboard-fragment">
      <button class="blackboard-scan-button" type="button" data-blackboard-open data-src="${escapeHtml(safeUrl(image.url))}" data-alt="${escapeHtml(image.alt_text)}" data-title="${escapeHtml(fragment.title)}" aria-label="Zoom blackboard detail ${escapeHtml(fragment.title)}">
        <img src="${escapeHtml(safeUrl(image.url))}" alt="${escapeHtml(image.alt_text)}" loading="lazy">
      </button>
      <div class="blackboard-fragment-copy">
        <p class="blackboard-fragment-board">${board?`From <a href="${escapeHtml(safeUrl(board.record_route)||"/archive/")}">${escapeHtml(board.catalogue_label||board.title)}</a>`:"Board not yet identified"}</p>
        <h3>${escapeHtml(fragment.title)}</h3>
        ${fragment.caption?`<p>${escapeHtml(fragment.caption)}</p>`:""}
        ${contexts(Array.isArray(fragment.contexts)?fragment.contexts:[])}
      </div>
    </article>`;
  }

  async function load(){
    try{
      const response=await fetch("/api/archive/blackboards",{headers:{accept:"application/json"},cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"The Blackboard index could not be opened.");
      const boards=Array.isArray(data.boards)?data.boards:[],fragments=Array.isArray(data.fragments)?data.fragments:[];
      app.innerHTML=`<section class="blackboards-section" aria-labelledby="complete-blackboards">
        <div class="blackboards-section-heading"><h2 id="complete-blackboards">Complete boards</h2><p>Each scan preserves one captured state of a blackboard as its own catalogued Archive object.</p></div>
        ${boards.length?`<div class="blackboard-grid">${boards.map(boardCard).join("")}</div>`:`<p class="blackboards-empty">No complete blackboard scans are public yet.</p>`}
      </section>
      <section class="blackboards-section" aria-labelledby="blackboard-fragments">
        <div class="blackboards-section-heading"><h2 id="blackboard-fragments">Fragments in context</h2><p>Close-up ideas, sketches, notes, and sources are shown once, with every public record that uses the image.</p></div>
        ${fragments.length?`<div class="blackboard-fragment-grid">${fragments.map(fragmentCard).join("")}</div>`:`<p class="blackboards-empty">No blackboard fragments are public yet.</p>`}
      </section>`;
      app.querySelectorAll("[data-blackboard-open]").forEach(button=>button.addEventListener("click",()=>openZoom(button)));
    }catch(error){
      app.innerHTML=`<p class="blackboards-error" role="alert">${escapeHtml(error.message)} <button type="button" data-blackboards-retry>Try again</button></p>`;
      app.querySelector("[data-blackboards-retry]")?.addEventListener("click",load);
    }
  }
  dialog?.querySelector("[data-blackboard-zoom-close]")?.addEventListener("click",()=>dialog.close());
  dialog?.addEventListener("click",event=>{if(event.target===dialog)dialog.close()});
  dialog?.addEventListener("close",()=>{if(zoomImage){zoomImage.removeAttribute("src");zoomImage.alt=""}});
  load();
})();
