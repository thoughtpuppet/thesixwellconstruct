(function(){
  "use strict";
  const app=document.querySelector("[data-maze-archive]");
  if(!app)return;
  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  const safePath=value=>{try{const url=new URL(String(value||""),location.origin);return url.origin===location.origin?`${url.pathname}${url.search}${url.hash}`:""}catch{return""}};
  const records=payload=>Array.isArray(payload?.items)?payload.items:Array.isArray(payload?.records)?payload.records:[];
  const recordRoute=item=>safePath(item.archive_route||item.archiveRoute)||`/archive/records/${encodeURIComponent(item.archive_slug||item.slug)}/`;
  const imageUrl=item=>safePath(item.primary_image||item.primaryImage||item.image_url||item.primary_media?.url);
  const card=item=>{const image=imageUrl(item),credit=item.public_credit||item.publicCredit||"";return `<article class="maze-record-card">${image?`<img src="${escapeHtml(image)}" alt="${escapeHtml(item.primary_media?.alt_text||item.primary_image_alt||item.primaryImageAlt||item.title||"Published Maze")}" loading="lazy">`:""}<div class="maze-record-copy"><p class="maze-record-meta">${escapeHtml([item.catalogue_label||item.record_identifier||"Maze Pattern",credit].filter(Boolean).join(" · "))}</p><h3>${escapeHtml(item.title||"Untitled Maze")}</h3>${item.summary?`<p>${escapeHtml(item.summary)}</p>`:""}<a href="${escapeHtml(recordRoute(item))}">Open complete Archive record</a></div></article>`};
  const empty=message=>`<div class="maze-room-state"><p>${escapeHtml(message)}</p><a href="/tattoos/build/maze/">Build your own maze</a></div>`;
  const section=(id,title,description,items,emptyMessage)=>`<section class="maze-room" aria-labelledby="${id}"><div class="maze-room-heading"><h2 id="${id}">${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>${items.length?`<div class="maze-record-grid">${items.map(card).join("")}</div>`:empty(emptyMessage)}</section>`;
  async function getJson(path,allowMissing=false){const response=await fetch(path,{headers:{accept:"application/json"},cache:"no-store"});const payload=await response.json().catch(()=>({}));if(allowMissing&&response.status===404)return null;if(!response.ok)throw new Error(payload.error||"This Archive room is temporarily unavailable.");return payload}
  async function load(){
    try{
      const [history,artpill,community]=await Promise.all([
        getJson("/api/archive/items?q=The%20Maze%20Pattern&limit=100"),
        getJson("/api/archive/items?collection=maze-built-by-artpill&limit=100"),
        getJson("/api/archive/items?collection=maze-built-by-others&limit=100"),
      ]);
      const historyItem=records(history).find(item=>(item.archive_slug||item.slug)==="maze-pattern")||null;
      app.innerHTML=`<section class="maze-room" aria-labelledby="maze-pattern-history"><div class="maze-room-heading"><h2 id="maze-pattern-history">The Maze Pattern</h2><p>The authored history, versions, states, materials, and milestones of the pattern itself.</p></div>${historyItem?`<article class="maze-history-card">${imageUrl(historyItem)?`<img src="${escapeHtml(imageUrl(historyItem))}" alt="${escapeHtml(historyItem.title||"The Maze Pattern")}">`:""}<div class="maze-record-copy"><p class="maze-record-meta">Living pattern record</p><h3>${escapeHtml(historyItem.title||"The Maze Pattern")}</h3>${historyItem.summary?`<p>${escapeHtml(historyItem.summary)}</p>`:""}<a href="${escapeHtml(recordRoute(historyItem))}">Follow the pattern history</a></div></article>`:empty("The Maze Pattern history is being documented. No placeholder history has been published.")}</section>${section("built-by-artpill","Built by Art.Pill","Published canonical Maze work from Art.Pill.",records(artpill),"No Art.Pill Maze records have been assigned and published here yet.")}${section("built-by-others","Built by Others","Selected visitor arrangements shown only after explicit permission and Studio review.",records(community),"No community mazes are public yet. Opting in makes a finished submission eligible for consideration, not automatic publication.")}`;
    }catch(error){app.innerHTML=`<div class="maze-room-state" role="alert"><p>${escapeHtml(error.message)}</p><button type="button" data-maze-retry>Try again</button> · <a href="/tattoos/build/maze/">Open the Maze Builder</a></div>`;app.querySelector("[data-maze-retry]")?.addEventListener("click",load)}
  }
  load();
})();
