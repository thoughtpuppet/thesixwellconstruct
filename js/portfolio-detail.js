(function (global) {
  const STYLE_LABELS = { symbolic:"symbolic", surreal:"surreal", mythic:"mythic", "special-project":"special projects" };
  const DEFAULT_ALT = "Tattoo portfolio work by Saiel Dauhn Solehman";
  let portfolioOptions = { styles: [], collections: [] };

  function optionLabel(kind, value) {
    const options = kind === "style" ? portfolioOptions.styles : portfolioOptions.collections;
    return options.find((option) => option.value === value)?.label || (kind === "style" ? STYLE_LABELS[value] : value) || "";
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function start() {
    const grid = document.getElementById("gridTattoo");
    const typeRow = document.getElementById("typeRow");
    const collectionRow = document.getElementById("modeRow");
    const introDesc = document.getElementById("introDesc");
    const detail = document.getElementById("work-overlay");
    if (!grid || !typeRow || !collectionRow || !introDesc || !detail) return;
    detail.removeAttribute("aria-modal");
    detail.setAttribute("role", "region");
    detail.setAttribute("aria-label", "Selected tattoo work");
    let items = [];
    let failedIds = new Set();
    let activeStyle = "";
    let activeCollection = "";
    let returnFocus = null;
    let openedFromGallery = false;
    let requestSequence = 0;

    function renderedItems() { return items.filter((item) => !failedIds.has(item.id)); }
    function visibleItems() { return renderedItems().filter((item) => (!activeStyle || item.primaryStyle === activeStyle) && (!activeCollection || item.collection === activeCollection)); }
    function itemInfo(item) { return [item.year, item.placement].filter(Boolean).join(" · "); }
    function chip(label, count, active, onClick) {
      const button = node("button", `chip${active ? " active" : ""}`);
      button.type = "button";
      button.setAttribute("aria-pressed", String(active));
      button.append(node("span", "chip-label", label), node("span", "chip-count", count));
      button.addEventListener("click", onClick);
      return button;
    }
    function renderFilters() {
      const available = renderedItems();
      const styles = [...new Set(available.map((item) => item.primaryStyle).filter((style) => optionLabel("style", style)))];
      const collections = [...new Set(available.map((item) => item.collection).filter(Boolean))].sort((a,b) => a.localeCompare(b));
      typeRow.replaceChildren(chip("all", available.length, !activeStyle && !activeCollection, () => { activeStyle=""; activeCollection=""; render(); }));
      styles.forEach((style) => typeRow.append(chip(optionLabel("style", style), available.filter((item) => item.primaryStyle === style).length, activeStyle === style, () => { activeStyle = activeStyle === style ? "" : style; render(); })));
      collectionRow.replaceChildren();
      collections.forEach((collection) => {
        const count = available.filter((item) => item.collection === collection && (!activeStyle || item.primaryStyle === activeStyle)).length;
        if (count) collectionRow.append(chip(optionLabel("collection", collection), count, activeCollection === collection, () => { activeCollection = activeCollection === collection ? "" : collection; render(); }));
      });
    }
    function renderCards() {
      grid.replaceChildren();
      const visible = visibleItems();
      if (!visible.length) { grid.append(node("div", "catalog-state", renderedItems().length ? "No work is available in this filter." : "Portfolio images are temporarily unavailable.")); return; }
      visible.forEach((item) => {
        const card = node("button", "work-card");
        card.type = "button";
        card.dataset.portfolioId = item.id;
        card.setAttribute("aria-label", `View ${item.title || "tattoo portfolio work"}`);
        const image = node("img"); image.src=item.imageUrl; image.alt=item.altText||DEFAULT_ALT; image.loading="lazy";
        image.addEventListener("error", () => { failedIds.add(item.id); render(); });
        const badge=node("span","work-badge","art.pill"),meta=node("span","work-meta"),title=node("span","work-title",item.title||"Tattoo work");
        meta.append(title); const info=itemInfo(item); if(info)meta.append(node("span","work-info",info));
        if(item.hasFreshAndHealed)meta.append(node("span","work-info portfolio-documentation-badge","fresh + healed documentation"));
        card.append(image,badge,meta); card.addEventListener("click",()=>openDetail(item,card,"push")); grid.append(card);
      });
    }
    function render() {
      renderFilters(); renderCards();
      const selection=activeCollection?optionLabel("collection",activeCollection):(activeStyle?optionLabel("style",activeStyle):"");
      introDesc.textContent=selection?`${selection} / tattoo work by Saiel Dauhn Solehman`:"tattoo work by Saiel Dauhn Solehman";
    }
    function block(label, copy, className="") {
      if (!copy) return null;
      const section=node("section","portfolio-detail-block");
      section.append(node("p","portfolio-detail-label",label),node("div",`portfolio-detail-copy ${className}`.trim(),copy));
      return section;
    }
    function ensureConnections() {
      if (global.ConstructConnections) return Promise.resolve();
      return new Promise((resolve) => { const script=document.createElement("script"); script.src="/js/construct-connections.js?v=3"; script.onload=resolve; script.onerror=resolve; document.head.append(script); });
    }
    function healingLabel(state) {
      return {fresh:"Fresh",healed:"Healed","in-progress":"In progress",unspecified:"Documentation"}[state]||"Documentation";
    }
    function imageNote(image) {
      return [healingLabel(image.healingState),image.timingNote,image.documentationCaption].filter(Boolean).join(" \u00b7 ");
    }
    function documentedFigure(image) {
      const figure=node("figure","portfolio-documented-image"),photo=node("img");photo.src=image.imageUrl;photo.alt=image.altText||DEFAULT_ALT;photo.loading="lazy";figure.append(photo);
      const note=imageNote(image);if(note)figure.append(node("figcaption","portfolio-image-note",note));return figure;
    }
    function standardMedia(item,images,media) {
      const imageWrap=node("div","overlay-image-wrap"),mainImage=node("img"),note=node("div","portfolio-image-note");
      const cover=images.find((image)=>image.isCover)||images[0];let selectedRef=cover.imageRef;
      function selectImage(image){selectedRef=image.imageRef;mainImage.style.opacity="0";mainImage.src=image.imageUrl;mainImage.alt=image.altText||item.altText||DEFAULT_ALT;note.textContent=imageNote(image);note.hidden=!note.textContent;requestAnimationFrame(()=>{mainImage.style.opacity="1"});media.querySelectorAll(".portfolio-angle-button").forEach((entry)=>entry.setAttribute("aria-pressed",String(entry.dataset.imageRef===image.imageRef)))}
      mainImage.src=cover.imageUrl;mainImage.alt=cover.altText||item.altText||DEFAULT_ALT;imageWrap.append(mainImage);media.append(imageWrap,note);note.textContent=imageNote(cover);note.hidden=!note.textContent;
      if(images.length>1){let active="all";const states=[...new Set(images.map((image)=>image.healingState).filter((state)=>state!=="unspecified"))];const strip=node("div","portfolio-angle-strip");strip.setAttribute("aria-label","Tattoo photographs");function paintStrip(){strip.replaceChildren();const visible=active==="all"?images:images.filter((image)=>image.healingState===active);if(visible.length&&!visible.some((image)=>image.imageRef===selectedRef))selectedRef=visible[0].imageRef;visible.forEach((image)=>{const button=node("button","portfolio-angle-button");button.type="button";button.dataset.imageRef=image.imageRef;button.setAttribute("aria-pressed",String(image.imageRef===selectedRef));button.setAttribute("aria-label",`${healingLabel(image.healingState)} tattoo photograph${image.timingNote?`, ${image.timingNote}`:""}`);const thumb=node("img");thumb.src=image.imageUrl;thumb.alt="";button.append(thumb,node("span","portfolio-thumb-state",healingLabel(image.healingState)));button.addEventListener("click",()=>selectImage(image));strip.append(button)});const selected=visible.find((image)=>image.imageRef===selectedRef);if(selected)selectImage(selected)}if(states.includes("fresh")&&states.includes("healed")){const filters=node("div","portfolio-documentation-filters");[["all","All"],["fresh","Fresh"],["healed","Healed"]].forEach(([value,label])=>{const button=node("button",value==="all"?"active":"",label);button.type="button";button.setAttribute("aria-pressed",String(value==="all"));button.addEventListener("click",()=>{active=value;filters.querySelectorAll("button").forEach((entry)=>{const pressed=entry===button;entry.classList.toggle("active",pressed);entry.setAttribute("aria-pressed",String(pressed))});paintStrip()});filters.append(button)});media.append(filters)}paintStrip();media.append(strip)}
    }
    function compareMedia(images,media) {
      const fresh=images.find((image)=>image.healingState==="fresh"),healed=images.find((image)=>image.healingState==="healed");
      const heading=node("div","portfolio-documentation-heading");heading.append(node("span","portfolio-detail-label","Fresh + healed comparison"),node("p","","The same tattoo documented at different stages."));const comparison=node("div","portfolio-image-comparison");comparison.append(documentedFigure(fresh),documentedFigure(healed));media.append(heading,comparison);
    }
    function viewerControlledMedia(item,images,media) {
      const gallery=node("div","portfolio-media-view"),fresh=images.find((image)=>image.healingState==="fresh"),healed=images.find((image)=>image.healingState==="healed");
      standardMedia(item,images,gallery);
      if(!fresh||!healed){media.append(gallery);return}
      const comparison=node("div","portfolio-media-view");comparison.hidden=true;comparison.setAttribute("aria-label","Fresh and healed comparison");compareMedia(images,comparison);
      const controls=node("div","portfolio-view-switch"),galleryButton=node("button","","Gallery"),compareButton=node("button","","Compare");controls.setAttribute("role","group");controls.setAttribute("aria-label","Tattoo image view");galleryButton.type=compareButton.type="button";galleryButton.setAttribute("aria-pressed","true");compareButton.setAttribute("aria-pressed","false");
      function setView(view){const comparing=view==="compare";gallery.hidden=comparing;comparison.hidden=!comparing;galleryButton.setAttribute("aria-pressed",String(!comparing));compareButton.setAttribute("aria-pressed",String(comparing))}
      galleryButton.addEventListener("click",()=>setView("gallery"));compareButton.addEventListener("click",()=>setView("compare"));controls.append(node("span","portfolio-detail-label","View"),galleryButton,compareButton);media.append(controls,gallery,comparison);
    }
    function paintDetail(item) {
      detail.replaceChildren();
      const back=node("button","overlay-close","Back to portfolio"); back.type="button"; back.addEventListener("click",()=>closeDetail());
      const inner=node("div","overlay-inner"),media=node("div","portfolio-detail-media");
      const images=[item.primaryImage||{id:"primary",imageRef:"primary",imageUrl:item.imageUrl,altText:item.altText||DEFAULT_ALT,healingState:"unspecified",isCover:true},...(item.angles||[])];
      viewerControlledMedia(item,images,media);
      const copy=node("div","overlay-details"),head=node("header"),detailTitle=node("h1","overlay-title",item.title||"Tattoo work");detailTitle.tabIndex=-1;head.append(node("p","portfolio-detail-kicker","Tattoo work"),detailTitle);
      const info=itemInfo(item);if(info)head.append(node("p","overlay-subtitle",info));
      const tags=node("div","overlay-tags");[optionLabel("style",item.primaryStyle),optionLabel("collection",item.collection)].filter(Boolean).forEach((value)=>tags.append(node("span","overlay-tag",value)));if(tags.childElementCount)head.append(tags);copy.append(head);
      [block("About this tattoo",item.caption),block("Statement / story",item.statement,"statement")].filter(Boolean).forEach((section)=>copy.append(section));
      if(item.sessionCount||item.sessionNote){const session=node("section","portfolio-detail-block"),grid=node("div","portfolio-session-grid");session.append(node("p","portfolio-detail-label","Sessions"));if(item.sessionCount){const cell=node("div");cell.append(node("span","portfolio-detail-label","Completed in"),node("span","portfolio-session-value",`${item.sessionCount} session${item.sessionCount===1?"":"s"}`));grid.append(cell)}if(item.sessionNote){const cell=node("div");cell.append(node("span","portfolio-detail-label","Session notes"),node("span","portfolio-session-value",item.sessionNote));grid.append(cell)}session.append(grid);copy.append(session)}
      [block("Process",item.processNotes),block("Techniques",item.techniques)].filter(Boolean).forEach((section)=>copy.append(section));
      if(item.similarInquiriesEnabled){const similar=node("section","portfolio-similar");similar.append(node("p","portfolio-detail-label","Book something in this direction"));if(item.similarInquiryNote)similar.append(node("p","",item.similarInquiryNote));similar.append(node("p","disclaimer","This completed tattoo will not be copied. It may serve as a reference for visual direction, process, technique, or atmosphere in a new original project."));const link=node("a","","Start a custom inquiry");link.href=`/tattoos/inquire/custom/?reference=${encodeURIComponent(item.id)}`;similar.append(link);copy.append(similar)}
      inner.append(media,copy);const connections=node("section","portfolio-detail-connections");connections.hidden=true;inner.append(connections);detail.append(back,inner);document.body.classList.add("is-portfolio-detail");detail.classList.add("open");document.title=`${item.title||"Tattoo work"} · Art.Pill Tattoo House`;window.scrollTo({top:0,behavior:"auto"});
      ensureConnections().then(()=>global.ConstructConnections?.mount({entityId:item.id,host:connections,embedded:true}));
      requestAnimationFrame(()=>document.querySelector("#work-overlay .overlay-title")?.focus?.());
    }
    async function openDetail(summary,trigger,historyMode="push") {
      const sequence=++requestSequence;returnFocus=trigger||returnFocus;openedFromGallery=historyMode==="push";
      if(historyMode==="push"){history.replaceState({portfolioGallery:{activeStyle,activeCollection,scrollY:window.scrollY,focusId:summary.id}},"",location.href);const url=new URL(location.href);url.searchParams.set("work",summary.id);history.pushState({portfolioWork:summary.id},"",url)}
      detail.replaceChildren(node("div","portfolio-detail-state","Loading tattoo details…"));detail.classList.add("open");document.body.classList.add("is-portfolio-detail");
      try{const response=await fetch(`/api/portfolio/${encodeURIComponent(summary.id)}`,{headers:{accept:"application/json"},cache:"no-store"});if(!response.ok)throw new Error();const payload=await response.json();if(sequence!==requestSequence)return;paintDetail(payload.item)}catch{if(sequence!==requestSequence)return;detail.replaceChildren();const state=node("div","portfolio-detail-state");state.append(node("h1","overlay-title","This tattoo is not available."),node("p","","It may be unpublished, archived, or temporarily unavailable."));const link=node("a","","Return to the portfolio");link.href="/tattoos/portfolio/";state.append(link);detail.append(state);document.body.classList.add("is-portfolio-detail");detail.classList.add("open")}
    }
    function showGallery(state=null){++requestSequence;detail.classList.remove("open");detail.replaceChildren();document.body.classList.remove("is-portfolio-detail");document.title="Portfolio · Art.Pill Tattoo House";if(state?.portfolioGallery){activeStyle=state.portfolioGallery.activeStyle||"";activeCollection=state.portfolioGallery.activeCollection||"";render();requestAnimationFrame(()=>{window.scrollTo({top:Number(state.portfolioGallery.scrollY)||0,behavior:"auto"});document.querySelector(`[data-portfolio-id="${CSS.escape(state.portfolioGallery.focusId||"")}"]`)?.focus()})}else{render();window.scrollTo({top:0,behavior:"auto"})}}
    function closeDetail(){const url=new URL(location.href);if(openedFromGallery&&url.searchParams.has("work")){history.back();return}url.searchParams.delete("work");history.replaceState({},"",url);showGallery();returnFocus?.focus();returnFocus=null}
    window.addEventListener("popstate",(event)=>{const requested=new URL(location.href).searchParams.get("work");const item=items.find((candidate)=>candidate.id===requested);if(item)openDetail(item,null,"none");else showGallery(event.state)});
    document.addEventListener("keydown",(event)=>{if(event.key==="Escape"&&detail.classList.contains("open"))closeDetail()});
    fetch("/api/portfolio",{headers:{accept:"application/json"},cache:"no-store"}).then(async(response)=>{if(!response.ok)throw new Error();const payload=await response.json();items=Array.isArray(payload.items)?payload.items:[];portfolioOptions=payload.options||portfolioOptions;render();const requested=new URL(location.href).searchParams.get("work");const item=items.find((candidate)=>candidate.id===requested);if(item)openDetail(item,null,"none");else if(requested)openDetail({id:requested},null,"none")}).catch(()=>{typeRow.replaceChildren();collectionRow.replaceChildren();grid.innerHTML='<div class="catalog-state" role="alert">The portfolio is temporarily unavailable. <a href="/tattoos/inquire/">Send an inquiry</a>.</div>'});
  }

  global.PortfolioDetailExperience={start};
})(window);
