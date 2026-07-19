(function(){
  const tokenKey="swc_submissions_admin_token";
  const managed={tattoo:new Set(["flash"]),art:new Set(["works"]),merch:new Set(["products"]),legend:new Set(["symbols","categories","composition-rules","themes","examples","usage","drafts"]),events:new Set(["event-archive"]),archive:new Set(["dossiers","origin-threads","records","collections","timeline","people","places","media-artifacts","drafts","settings"]),site:new Set(["pathways","nodes","navigation","search","visibility","settings"]),shared:new Set(["media","relationships","taxonomy","revisions","search-index"])};
  const archiveEndpoints={
    dossiers:"/api/admin/archive-dossiers",
    dossier:entityId=>`/api/admin/archive-dossiers/${encodeURIComponent(entityId)}`,
    materials:"/api/admin/archive-materials",
    material:materialId=>`/api/admin/archive-materials/${encodeURIComponent(materialId)}`,
    materialOrder:"/api/admin/archive-materials/reorder",
    activities:"/api/admin/archive-activities",
    activity:activityId=>`/api/admin/archive-activities/${encodeURIComponent(activityId)}`,
    originThreads:"/api/admin/archive-origin-threads",
    originThread:threadId=>`/api/admin/archive-origin-threads/${encodeURIComponent(threadId)}`,
    timelines:"/api/admin/archive-timelines",
    timeline:timelineId=>`/api/admin/archive-timelines/${encodeURIComponent(timelineId)}`,
    chapters:timelineId=>`/api/admin/archive-timelines/${encodeURIComponent(timelineId)}/chapters`,
    chapter:(timelineId,chapterId)=>`/api/admin/archive-timelines/${encodeURIComponent(timelineId)}/chapters/${encodeURIComponent(chapterId)}`,
    media:"/api/admin/media",
    mediaItem:mediaId=>`/api/admin/media/${encodeURIComponent(mediaId)}`
  };
  const adminPreviewUrls=new Set(),flashBulkJobs=new Map();
  const configs={
    flash:{endpoint:"flash",title:"Flash",description:"Upload individual designs or batches as safe drafts, then manage artwork, galleries, availability, claims, styles, session structure, metadata, and ordering.",flashEditor:true,fields:["title","slug","description","state","series_id","size_bucket","price_label","item_type","process_category","claimable","sheet_code","design_code","session_category","split_policy","estimated_sessions_min","estimated_sessions_max","estimated_total_minutes_min","estimated_total_minutes_max","session_plan_note","legacy_path","sort_order"]},
    symbols:{endpoint:"legend",title:"Legend Symbols",description:"One canonical identity with inherited, lived, and reoriented meanings; visual translations; documented appearances; and relationships that supply other Construct systems.",symbolEditor:true,fields:["name","slug","meaning","category_id","state","themes_json","context_json","applications_json","variants_json","examples_json","build_guidance_json","svg_markup","sort_order"]},
    categories:{endpoint:"legend/categories",title:"Legend Categories",description:"Ordered groupings that organize symbols without limiting where they may be used.",fields:["name","slug","description","state","sort_order"]},
    works:{endpoint:"art",title:"Art Works",description:"Upload artwork, manage its metadata, and control public acquisition eligibility.",mediaUpload:"artwork",fields:["title","slug","statement","year","medium","dimensions","availability","acquisition_eligible","state","legacy_path","sort_order"]},
    products:{endpoint:"merch",title:"Merch Products",description:"Construct identities for Shopify-owned products. Pricing, inventory, variants, and checkout remain in Shopify.",fields:["shopify_handle","title","product_type","state","route","image_url","alt_text","sort_order"]},
    records:{endpoint:"archive",title:"Archive Records",description:"One record layer for public rooms and private drafts.",fields:["title","slug","node_label","record_type","room","date_or_period","timeline_period","summary","body","record_status","state","why_it_matters","sort_order"]},
    collections:{endpoint:"archive-collections",title:"Archive Collections",description:"Named, ordered groupings of archive records.",fields:["name","slug","description","state","sort_order"]},
    people:{endpoint:"people",title:"People",description:"Privacy-aware identities linked to public records only when approved.",fields:["name","slug","bio","privacy","state"]},
    places:{endpoint:"places",title:"Places",description:"Public labels remain separate from private location data.",fields:["name","slug","public_location","private_location","privacy","state"]},
    nodes:{endpoint:"nodes",title:"Construct Nodes",description:"Maximum nine published homepage nodes.",fields:["name","slug","route","color","state","homepage_enabled","sort_order"]},
    pathways:{endpoint:"pathways",title:"Homepage Pathways",description:"Maximum nine published pathways per node, with route validation and revision history.",fields:["node_id","name","route","color","state","homepage_enabled","sort_order"]}
  };

  function root(){return document.getElementById("detailPane")}
  function status(message){const el=document.getElementById("status");if(el)el.textContent=message}
  function esc(value){return String(value??"").replace(/[&<>'"]/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[character]))}
  async function api(path,options={}){const headers=new Headers(options.headers||{});headers.set("authorization",`Bearer ${localStorage.getItem(tokenKey)||""}`);const response=await fetch(path,{...options,headers});let payload={};try{payload=await response.json()}catch{}if(!response.ok)throw new Error(payload.error||`Request failed (${response.status})`);return payload}
  function clearAdminPreviewUrls(){adminPreviewUrls.forEach(url=>URL.revokeObjectURL(url));adminPreviewUrls.clear()}
  async function hydrateAdminMediaPreviews(scope=root()){
    const images=[...scope.querySelectorAll("[data-admin-media-preview]")];
    await Promise.all(images.map(async image=>{
      if(image.dataset.previewLoading==="true")return;image.dataset.previewLoading="true";
      try{
        const response=await fetch(`/api/admin/media/${encodeURIComponent(image.dataset.adminMediaPreview)}/file`,{headers:{authorization:`Bearer ${localStorage.getItem(tokenKey)||""}`},cache:"no-store"});
        if(!response.ok)throw new Error("Preview unavailable");
        const objectUrl=URL.createObjectURL(await response.blob());adminPreviewUrls.add(objectUrl);image.src=objectUrl;
      }catch{image.hidden=true}finally{delete image.dataset.previewLoading}
    }))
  }
  function notice(message,kind="info"){return `<div class="cm-notice" data-kind="${kind}" role="${kind==="error"?"alert":"status"}">${esc(message)}</div>`}
  function image(record){const media=record.media?.[0],url=media?.url||record.image_url,alt=media?.alt||record.alt_text||record.title||record.name||"";if(media?.adminUrl||media?.id)return `<img data-admin-media-preview="${esc(media.id)}" alt="${esc(alt)}" loading="lazy">`;return url?`<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" onerror="this.hidden=true">`:""}
  function state(record){return record.state||record.privacy||record.availability||"record"}
  function parseList(value){if(Array.isArray(value))return value;try{const parsed=JSON.parse(value||"[]");return Array.isArray(parsed)?parsed:[]}catch{return[]}}
  function parseObject(value){if(value&&typeof value==="object"&&!Array.isArray(value))return value;try{const parsed=JSON.parse(value||"{}");return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{}}catch{return{}}}
  function recordsFrom(payload,...keys){if(Array.isArray(payload))return payload;for(const key of ["records",...keys,"items"]){if(Array.isArray(payload?.[key]))return payload[key]}return[]}
  function recordFrom(payload,...keys){for(const key of ["record",...keys,"item"]){if(payload?.[key]&&typeof payload[key]==="object"&&!Array.isArray(payload[key]))return payload[key]}return payload&&typeof payload==="object"&&!Array.isArray(payload)?payload:{}}
  function firstValue(record,...keys){for(const key of keys){if(record?.[key]!==undefined&&record[key]!==null)return record[key]}return""}
  function checked(value){return value===true||value===1||value==="1"||value==="true"}
  function archiveEntityId(record){return String(firstValue(record,"entity_id","entityId","content_entity_id","contentEntityId")||record?.entity?.id||record?.id||"")}
  function archiveTitle(record){return firstValue(record,"entity_title","entityTitle","title","name")||record?.entity?.title||record?.entity?.name||archiveEntityId(record)}
  function archiveSlug(record){return firstValue(record,"archive_slug","archiveSlug","slug","entity_slug","entitySlug")||record?.entity?.slug||""}
  function archiveType(record){return firstValue(record,"entity_type","entityType","record_type","recordType")||record?.entity?.type||"record"}
  function archiveState(record){return firstValue(record,"state","publication_state","publicationState")||"draft"}
  function option(value,label,current){return `<option value="${esc(value)}" ${String(current)===String(value)?"selected":""}>${esc(label)}</option>`}
  function datePrecisionOptions(current){return [["exact","Exact date"],["approximate","Approximate date"],["range","Date range"],["year","Year only"],["undated","Undated"]].map(([value,label])=>option(value,label,current||"exact")).join("")}
  function archiveJson(path,method,body){return api(path,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)})}
  function queryEndpoint(path,values={}){const query=new URLSearchParams();Object.entries(values).forEach(([key,value])=>{if(value!==undefined&&value!==null&&value!=="")query.set(key,value)});return `${path}${query.size?`?${query}`:""}`}

  function safeSvgMarkup(markup,{recolor=false}={}){
    const source=String(markup||"").trim();
    if(!source)return"";
    if(source.length>500000)throw new Error("SVG file is too large. Simplify the Illustrator export and try again.");
    if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error("SVG files with document type or entity declarations are not supported.");
    const documentNode=new DOMParser().parseFromString(source,"image/svg+xml");
    if(documentNode.querySelector("parsererror")||documentNode.documentElement.localName!=="svg")throw new Error("Choose a valid SVG file.");
    const svg=documentNode.documentElement;
    const allowed=new Set(["svg","g","path","rect","circle","ellipse","line","polyline","polygon","defs","symbol","use","clipPath","mask","linearGradient","radialGradient","stop","title","desc"]);
    const paintProperties=new Set(["fill","stroke","stroke-width","stroke-linecap","stroke-linejoin","stroke-miterlimit","fill-rule","clip-rule","opacity","fill-opacity","stroke-opacity","stop-color","stop-opacity"]);
    const classRules=new Map();
    documentNode.querySelectorAll("style").forEach(style=>{
      const rulePattern=/\.([a-zA-Z][\w-]*)\s*\{([^}]*)\}/g;
      let match;
      while((match=rulePattern.exec(style.textContent||""))){
        const declarations={};
        match[2].split(";").forEach(declaration=>{const [rawName,...rawValue]=declaration.split(":");const name=rawName?.trim(),value=rawValue.join(":").trim();if(paintProperties.has(name)&&value)declarations[name]=value});
        classRules.set(match[1],declarations);
      }
    });
    [...svg.querySelectorAll("*")].forEach(element=>{
      if(!allowed.has(element.localName)){element.remove();return}
      String(element.getAttribute("class")||"").split(/\s+/).filter(Boolean).forEach(className=>{const declarations=classRules.get(className)||{};Object.entries(declarations).forEach(([name,value])=>{if(!element.hasAttribute(name))element.setAttribute(name,value)})});
      [...element.attributes].forEach(attribute=>{
        const name=attribute.name.toLowerCase(),value=attribute.value;
        const urls=[...value.matchAll(/url\s*\(\s*([^)]*)\)/gi)];
        const unsafeUrl=urls.some(match=>!/^['"]?#[a-zA-Z][\w:.-]*['"]?$/.test(match[1].trim()));
        const unsafeHref=["href","xlink:href"].includes(name)&&!/^#[a-zA-Z][\w:.-]*$/.test(value.trim());
        if(name==="class"||name==="style"||name.startsWith("on")||name==="src"||unsafeHref||/javascript:|data:text\/html|expression\s*\(|@import/i.test(value)||unsafeUrl)element.removeAttribute(attribute.name);
      });
    });
    documentNode.querySelectorAll("style,script,foreignObject,iframe,object,embed,link,a,image,animate,set,metadata").forEach(element=>element.remove());
    if(!svg.getAttribute("viewBox")){
      const width=parseFloat(svg.getAttribute("width")),height=parseFloat(svg.getAttribute("height"));
      if(width>0&&height>0)svg.setAttribute("viewBox",`0 0 ${width} ${height}`);
    }
    if(!svg.getAttribute("viewBox"))throw new Error("SVG needs a viewBox. In Illustrator, export with Responsive enabled.");
    svg.removeAttribute("width");svg.removeAttribute("height");svg.removeAttribute("style");svg.setAttribute("xmlns","http://www.w3.org/2000/svg");
    if(recolor){
      svg.setAttribute("fill","currentColor");
      svg.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon,g").forEach(element=>{
        for(const paint of ["fill","stroke"]){const value=element.getAttribute(paint);if(value&&value!=="none")element.setAttribute(paint,"currentColor")}
      });
    }
    const cleaned=new XMLSerializer().serializeToString(svg);
    if(cleaned.length>80000)throw new Error("Cleaned SVG is still too large. Reduce anchor points or decimal precision in Illustrator.");
    return cleaned;
  }

  async function readSvgFile(file,recolor){if(!file||(!file.name.toLowerCase().endsWith(".svg")&&file.type!=="image/svg+xml"))throw new Error("Choose an SVG file exported from Illustrator.");return safeSvgMarkup(await file.text(),{recolor})}

  const legendVariantImageTypes=new Set(["image/jpeg","image/png","image/webp","image/gif"]);
  function isSvgFile(file){return Boolean(file)&&(file.type==="image/svg+xml"||file.name.toLowerCase().endsWith(".svg"))}
  function validateLegendVariantImage(file){if(!file||!legendVariantImageTypes.has(file.type))throw new Error(`${file?.name||"Variant image"}: use SVG, JPEG, PNG, WebP, or GIF`);if(file.size>15*1024*1024)throw new Error(`${file.name}: exceeds 15 MB`)}
  function pendingLegendVariantImages(form){return [...form.querySelectorAll('[data-layer-row="variant"]')].map((row,index)=>{const input=row.querySelector('[data-svg-file="variant"]'),file=input?.files?.[0];return{row,input,file,index}}).filter(item=>item.file&&!isSvgFile(item.file))}
  function clearLegendVariantPreviewUrl(row){const url=row?.dataset.variantPreviewUrl;if(url){URL.revokeObjectURL(url);delete row.dataset.variantPreviewUrl}}

  function safeLegendUrl(value){const url=String(value||"").trim();if(url.startsWith("/")&&!url.startsWith("//"))return url;try{const parsed=new URL(url);return["http:","https:"].includes(parsed.protocol)?url:""}catch{return""}}

  function styleValues(record={}){
    const explicit=Array.isArray(record.styles)?record.styles:[],source=explicit.length?explicit:[firstValue(record,"primaryStyle","primary_style")||"unclassified"],values=source.map(value=>String(value||"").trim()).filter(Boolean);
    return [...new Set(values.length?values:["unclassified"])]
  }

  function styleOptionsFor(record={},styleOptions=[]){
    const assigned=styleValues(record),byValue=new Map(styleOptions.map(option=>[option.value,option])),assignedSet=new Set(assigned);
    return [...assigned.map(value=>byValue.get(value)||{value,label:value,enabled:false}),...styleOptions.filter(option=>option.enabled&&!assignedSet.has(option.value))]
  }

  function styleLabelsFor(record={},styleOptions=[]){
    const values=styleValues(record),supplied=Array.isArray(record.styleLabels)?record.styleLabels:[],byValue=new Map(styleOptions.map(option=>[option.value,option.label]));
    return values.map((value,index)=>supplied[index]||byValue.get(value)||value)
  }

  function styleSelector(record={},styleOptions=[]){
    const values=styleValues(record),primary=values[0],options=styleOptionsFor(record,styleOptions);
    return `<section class="cm-style-selector wide" data-style-selector><div class="cm-style-selector-head"><strong>Styles / classifications</strong><p>Shared with the tattoo Portfolio. The primary style stays first for legacy surfaces.</p></div><label>Primary style<select data-style-primary>${options.map(option=>`<option value="${esc(option.value)}" ${option.value===primary?"selected":""}>${esc(option.label)}${option.enabled?"":" (disabled)"}</option>`).join("")}</select></label><fieldset class="cm-style-options"><legend>Assigned styles</legend><div class="cm-style-option-list">${options.map(option=>`<label class="cm-style-option${option.enabled?"":" is-disabled"}"><input type="checkbox" name="styles" value="${esc(option.value)}" data-style-option ${values.includes(option.value)?"checked":""}><span>${esc(option.label)}${option.enabled?"":" (disabled)"}</span></label>`).join("")}</div><p>Choose every style that applies. Disabled assigned styles remain available so saving other fields does not remove them.</p></fieldset></section>`
  }

  function selectedStyles(form){
    const selector=form.querySelector("[data-style-selector]");if(!selector)return[];
    const primary=String(selector.querySelector("[data-style-primary]")?.value||"").trim(),checkedValues=[...selector.querySelectorAll("[data-style-option]:checked")].map(input=>String(input.value||"").trim()).filter(Boolean);let values=[...new Set([primary,...checkedValues].filter(Boolean))];
    if(values.length>1)values=values.filter(value=>value!=="unclassified");return values.length?values:["unclassified"]
  }

  function syncStyleSelector(selector,changed){
    if(!selector||!changed)return;const primary=selector.querySelector("[data-style-primary]"),options=[...selector.querySelectorAll("[data-style-option]")];if(!primary||!options.length)return;
    if(changed.matches("[data-style-primary]")){const selected=changed.value;options.forEach(input=>{if(selected==="unclassified")input.checked=input.value==="unclassified";else if(input.value===selected)input.checked=true;else if(input.value==="unclassified")input.checked=false});return}
    if(!changed.matches("[data-style-option]"))return;
    if(changed.checked&&changed.value==="unclassified"){options.forEach(input=>{input.checked=input===changed});primary.value="unclassified";return}
    if(changed.checked){const unclassified=options.find(input=>input.value==="unclassified");if(unclassified)unclassified.checked=false;const primaryOption=options.find(input=>input.value===primary.value);if(primary.value==="unclassified"||!primaryOption?.checked)primary.value=changed.value;return}
    if(changed.value!==primary.value)return;const next=options.find(input=>input.checked);if(next){primary.value=next.value;return}const fallback=options.find(input=>input.value==="unclassified")||changed;fallback.checked=true;primary.value=fallback.value
  }

  function bindStyleSelector(form){form?.addEventListener("change",event=>{const changed=event.target.closest("[data-style-primary], [data-style-option]");if(changed)syncStyleSelector(changed.closest("[data-style-selector]"),changed)})}

  function card(record,index,total,sortable,styleOptions=[]){
    const title=record.title||record.name||record.slug||record.id;
    const hasStyleData=styleOptions.length||Array.isArray(record.styles)||Array.isArray(record.styleLabels)||Boolean(firstValue(record,"primaryStyle","primary_style")),styles=hasStyleData?styleLabelsFor(record,styleOptions):[],meta=[record.id,sortable?`${Number(record.sort_order)||0} / ${total}`:"",styles.join(" + ")].filter(Boolean).join(" / ");
    let symbol="";
    if(record.svg_markup){try{symbol=`<div class="cm-symbol-preview" aria-hidden="true">${safeSvgMarkup(record.svg_markup)}</div>`}catch{symbol=""}}
    return `<article class="cm-card ${state(record)==="draft"?"is-draft":""}" data-record="${esc(record.id)}">${symbol||image(record)}<div class="cm-card-head"><h3>${esc(title)}</h3><span class="cm-pill">${esc(state(record))}</span></div><div class="cm-meta">${esc(meta)}</div><div class="cm-actions"><button class="button" data-edit="${esc(record.id)}">Edit</button>${sortable?`<button class="button" data-move="up" data-id="${esc(record.id)}" ${index===0?"disabled":""}>Move up</button><button class="button" data-move="down" data-id="${esc(record.id)}" ${index===total-1?"disabled":""}>Move down</button>`:""}<button class="button danger-button" data-archive="${esc(record.id)}">Archive</button></div></article>`
  }

  function field(name,value){
    const choices={process_category:[["standard","Standard"],["experimental","Experimental"]],session_category:[["artist_review","Artist review"],["one_session","One session"],["multiple_sessions","Multiple sessions"]],split_policy:[["artist_review","Artist review"],["required","Splitting required"],["client_choice","Client choice after estimate"],["not_available","Splitting unavailable"]]};
    const long=/description|statement|meaning|body|notes|note|svg|json|bio/.test(name),numeric=/sort_order|claimable|eligible|enabled|estimated_sessions|estimated_total_minutes/.test(name),label=esc(name.replace(/_/g," "));
    if(choices[name])return `<label>${label}<select name="${name}">${choices[name].map(([option,labelText])=>`<option value="${option}" ${String(value)===option?"selected":""}>${labelText}</option>`).join("")}</select></label>`;
    return `<label class="${long?"wide":""}">${label}${long?`<textarea name="${name}">${esc(value)}</textarea>`:`<input name="${name}" ${numeric?'type="number" min="0" step="1" inputmode="numeric"':''} value="${esc(value)}">`}</label>`
  }

  function flashField(name,value,isNew,record={}){
    if(name==="state"){
      if(isNew)return `<label>Publishing state<input value="Draft" disabled><input type="hidden" name="state" value="draft"><span class="cm-field-note">New Flash always begins as a private draft. Reopen it after the artwork is attached to publish.</span></label>`;
      return `<label>Publishing state<select name="state">${["draft","available","reserved","placed","retired","archived"].map(stateValue=>`<option value="${stateValue}" ${String(value||"draft")===stateValue?"selected":""}>${stateValue}</option>`).join("")}</select></label>`
    }
    if(name==="item_type"){
      const locked=record.sheetDesigns?.length>0;
      return `<label>Item type<select name="item_type" data-flash-item-type ${locked?"disabled":""}>${[["individual","Individual"],["sheet","Sheet"]].map(([option,label])=>`<option value="${option}" ${String(value||"individual")===option?"selected":""}>${label}</option>`).join("")}</select>${locked?'<input type="hidden" name="item_type" value="sheet"><span class="cm-field-note">A managed sheet keeps its sheet identity so letter assignments remain stable.</span>':""}</label>`
    }
    if(name==="claimable")return `<label data-flash-claimable-field ${record.item_type==="sheet"?"hidden":""}>claimable<input name="claimable" type="number" min="0" max="1" step="1" inputmode="numeric" value="${esc(value)}"></label>`;
    return field(name,value)
  }

  function flashSheetDesignRow(entry={},index=0){
    const code=entry.code||String.fromCharCode(65+index),state=entry.state||"draft",locked=["reserved","placed"].includes(state);
    return `<div class="cm-sheet-design-row" data-sheet-design-row data-code="${esc(code)}" data-id="${esc(entry.id||"")}">
      <strong>${esc(code)} is</strong>
      <label><span class="cm-visually-hidden">Design ${esc(code)} label</span><input data-sheet-design-label value="${esc(entry.label||"")}" placeholder="Name or describe design ${esc(code)}"></label>
      <label>State<select data-sheet-design-state ${locked?"disabled":""}>${["draft","available","retired"].map(value=>`<option value="${value}" ${state===value?"selected":""}>${value}</option>`).join("")}${locked?`<option value="${esc(state)}" selected>${esc(state)}</option>`:""}</select></label>
      ${locked?`<input type="hidden" data-sheet-design-locked-state value="${esc(state)}">`:""}
      ${entry.reservedSubmissionId?`<span class="cm-field-note">Submission ${esc(entry.reservedSubmissionId)}</span>`:""}
    </div>`
  }

  function flashSheetPanel(record={}){
    const designs=Array.isArray(record.sheetDesigns)?record.sheetDesigns:[],count=designs.length||1,isSheet=record.item_type==="sheet";
    return `<section class="cm-flash-sheet wide" data-flash-sheet-panel ${isSheet?"":"hidden"}>
      <div class="cm-flash-media-head"><div><strong>Sheet designs</strong><p>Choose 1–26 designs. Studio assigns A–Z permanently; each label becomes a client-selectable one-time design.</p></div><span class="cm-pill" data-sheet-design-count-label>${count} design${count===1?"":"s"}</span></div>
      <label>Design count<input type="number" min="1" max="26" step="1" inputmode="numeric" value="${count}" data-sheet-design-count></label>
      <div class="cm-sheet-design-list" data-sheet-design-list>${designs.length?designs.map(flashSheetDesignRow).join(""):flashSheetDesignRow({},0)}</div>
      <span class="cm-field-note">Draft sheets may keep blank labels. Every letter needs a label before the sheet can be published.</span>
    </section>`
  }

  function flashMediaItem(media,index,total){
    const primary=media.role==="primary",alt=media.alt||media.alt_text_override||"",caption=media.caption||media.caption_override||"";
    return `<figure class="cm-flash-media-item" data-flash-media="${esc(media.id)}">
      <div class="cm-flash-media-preview"><img data-admin-media-preview="${esc(media.id)}" alt="${esc(alt)}"></div>
      <figcaption><span class="cm-pill">${primary?"Primary":"Gallery"}</span><span>${esc(media.originalFilename||media.id)}</span></figcaption>
      <label>Alt text<input data-flash-media-alt value="${esc(alt)}" placeholder="Describe the Flash artwork"></label>
      <label>Caption<textarea data-flash-media-caption placeholder="Optional public gallery caption">${esc(caption)}</textarea></label>
      <div class="cm-flash-media-actions">
        <button class="button" type="button" data-flash-media-action="save">Save text</button>
        ${primary?"":`<button class="button" type="button" data-flash-media-action="primary">Make primary</button>`}
        ${primary?"":`<button class="button" type="button" data-flash-media-action="up" ${index<=1?"disabled":""}>Up</button><button class="button" type="button" data-flash-media-action="down" ${index>=total-1?"disabled":""}>Down</button>`}
        <button class="button danger-button" type="button" data-flash-media-action="remove">Remove</button>
      </div>
    </figure>`
  }

  function flashMediaPanel(record={}){
    const media=Array.isArray(record.media)?record.media:[],existing=media.map((item,index)=>flashMediaItem(item,index,media.length)).join("");
    return `<section class="cm-flash-media wide">
      <div class="cm-flash-media-head"><div><strong>Flash artwork</strong><p>The first image becomes the primary catalog image. Additional files become the ordered detail gallery.</p></div><span class="cm-pill">${media.length} image${media.length===1?"":"s"}</span></div>
      ${existing?`<div class="cm-flash-media-grid" data-flash-media-list>${existing}</div>`:`<p class="cm-flash-media-empty">No artwork attached yet. This draft cannot be published until it has a primary image.</p>`}
      <label class="cm-flash-upload">Add JPEG, PNG, WebP, or GIF files<input type="file" name="flash_files" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>
      <label>Default alt text for new images<input name="flash_alt" value="${esc(record.title||"")}" placeholder="Describe the Flash artwork"></label>
      <div class="cm-flash-pending" data-flash-pending hidden></div>
      <span class="cm-upload-status" data-flash-upload-status aria-live="polite"></span>
    </section>`
  }

  function applicationRow(entry={}){
    let preview="";try{preview=entry.svg_markup?safeSvgMarkup(entry.svg_markup):""}catch{}
    return `<article class="cm-layer-row" data-layer-row="application"><div class="cm-layer-preview" data-svg-preview aria-hidden="true">${preview}</div><div class="cm-layer-fields"><label>Application name<input data-field="title" value="${esc(entry.title)}" placeholder="Mirrored, paired, enclosed…"></label><label>Meaning in this form<textarea data-field="meaning" placeholder="How this application changes or sharpens the reading">${esc(entry.meaning)}</textarea></label><label>Context note<textarea data-field="note" placeholder="Placement, direction, neighboring symbols, or other conditions">${esc(entry.note)}</textarea></label><label>Optional application diagram<input type="file" accept=".svg,image/svg+xml" data-svg-file="application" data-recolor="true"></label><textarea class="cm-visually-hidden" data-field="svg_markup" tabindex="-1" aria-hidden="true">${esc(entry.svg_markup)}</textarea></div><button class="button danger-button cm-remove-layer" type="button" data-remove-layer>Remove</button></article>`
  }

  function variantRow(entry={}){
    let preview="";try{preview=entry.svg_markup?safeSvgMarkup(entry.svg_markup):""}catch{}
    return `<article class="cm-layer-row" data-layer-row="variant"><div class="cm-layer-preview cm-layer-preview--variant" data-svg-preview aria-hidden="true">${preview||entry.image_url?preview||`<img src="${esc(entry.image_url)}" alt="">`:""}</div><div class="cm-layer-fields"><label>Upload variant image<input type="file" accept=".svg,image/svg+xml,image/jpeg,image/png,image/webp,image/gif" data-svg-file="variant"></label><label>Variant name<input data-field="name" value="${esc(entry.name)}" placeholder="Maze version, chrome form…"></label><label>Style family<input data-field="style" value="${esc(entry.style)}" placeholder="Flat, 3D, color, maze, carved…"></label><label>Variant note<textarea data-field="note" placeholder="What changes formally while the identity stays recognizable">${esc(entry.note)}</textarea></label><label>Or image URL<input data-field="image_url" value="${esc(entry.image_url)}" placeholder="/assets/… or https://…"></label><textarea class="cm-visually-hidden" data-field="svg_markup" tabindex="-1" aria-hidden="true">${esc(entry.svg_markup)}</textarea></div><button class="button danger-button cm-remove-layer" type="button" data-remove-layer>Remove</button></article>`
  }

  function appearanceRow(entry={}){
    return `<article class="cm-layer-row cm-layer-row--appearance" data-layer-row="appearance"><div class="cm-layer-fields"><label>Work or appearance title<input data-field="title" value="${esc(entry.title)}" placeholder="Painting, tattoo, garment, room…"></label><label>Medium<input data-field="medium" value="${esc(entry.medium)}" placeholder="Tattooing, art, merch, film…"></label><label>Caption<textarea data-field="caption" placeholder="How the symbol appears here">${esc(entry.caption)}</textarea></label><label>Image URL<input data-field="src" value="${esc(entry.src)}" placeholder="/assets/… or https://…"></label><label>Page URL<input data-field="href" value="${esc(entry.href)}" placeholder="/art/… or another public route"></label></div><button class="button danger-button cm-remove-layer" type="button" data-remove-layer>Remove</button></article>`
  }

  function sourceRow(entry={}){
    return `<article class="cm-layer-row cm-layer-row--source" data-layer-row="source"><div class="cm-layer-fields"><label>Source title<input data-field="title" value="${esc(entry.title)}" placeholder="Article, book, collection, or catalog" required></label><label>Creator or institution<input data-field="creator" value="${esc(entry.creator)}" placeholder="Author, museum, archive…"></label><label class="wide">Public or site URL<input data-field="url" inputmode="url" value="${esc(entry.url)}" placeholder="https://… or /archive/…" required></label><label class="wide">Why this source matters<textarea data-field="note" placeholder="What context this source contributes without treating it as the only reading">${esc(entry.note)}</textarea></label></div><button class="button danger-button cm-remove-layer" type="button" data-remove-layer>Remove</button></article>`
  }

  function guidanceQuestionRow(value=""){
    return `<article class="cm-layer-row cm-layer-row--appearance" data-layer-row="guidance-question"><div class="cm-layer-fields"><label>Reflection question<input data-field="question" value="${esc(value)}" maxlength="500" placeholder="What are you carrying, protecting, releasing, or becoming?"></label></div><button class="button danger-button cm-remove-layer" type="button" data-remove-layer>Remove</button></article>`
  }

  function symbolEditor(record={},categories=[]){
    const applications=parseList(record.applications_json),variants=parseList(record.variants_json),appearances=parseList(record.examples_json),themes=parseList(record.themes_json),context=parseObject(record.context_json),guidance=parseObject(record.build_guidance_json),contextModes=new Set(Array.isArray(context.modes)?context.modes:[]),sources=Array.isArray(context.sources)?context.sources:[],reorientation=context.reorientation||{},emotionalTones=Array.isArray(guidance.emotional_tones)?guidance.emotional_tones:[],reflectionQuestions=Array.isArray(guidance.reflection_questions)?guidance.reflection_questions:[];
    let canonical="";try{canonical=record.svg_markup?safeSvgMarkup(record.svg_markup):""}catch{}
    const categoryOptions=categories.filter(category=>category.state!=="archived").map(category=>`<option value="${esc(category.id)}" ${record.category_id===category.id?"selected":""}>${esc(category.name)}${category.state==="published"?"":` · ${esc(category.state)}`}</option>`).join("");
    return `<section class="cm-editor cm-symbol-editor" aria-label="${record.id?"Edit":"Create"} Legend symbol"><div class="cm-row"><h3>${record.id?"Edit":"New"} Legend Symbol</h3><button class="button" type="button" data-cancel>Close</button></div><div class="cm-legend-model"><strong>Stable identity, living context</strong><p>The category describes what kind of mark this is. Influence describes where its meaning comes from. Applications explain meaning shifts in use. Variants show style changes. Appearances and connections document where the symbol has lived.</p></div><form class="cm-form" data-editor data-symbol-editor data-id="${esc(record.id||"")}"><div class="cm-form-grid"><label>Name<input name="name" value="${esc(record.name)}" required></label><label>Slug<input name="slug" value="${esc(record.slug)}" placeholder="Generated from name when blank"></label><label>Category<select name="category_id" required><option value="">Choose a category</option>${categoryOptions}</select></label><label>Publishing state<select name="state">${["draft","published","retired","archived"].map(value=>`<option value="${value}" ${(record.state||"draft")===value?"selected":""}>${value}</option>`).join("")}</select></label><label class="wide">Core meaning<textarea name="meaning" required placeholder="The stable center of the symbol—before context changes it">${esc(record.meaning)}</textarea></label><label class="wide">Themes<input name="themes_input" value="${esc(themes.join(", "))}" placeholder="protection, return, memory"></label><label>Sort order<input name="sort_order" type="number" min="0" step="1" inputmode="numeric" value="${esc(record.sort_order||0)}"></label>
      <section class="cm-symbol-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">Build · Guidance</span><h4>Build Guidance</h4><p>Optional decision-focused language for Build a Brief. Empty fields stay hidden from clients.</p></div></div><label class="wide">Card essence<textarea name="build_essence" maxlength="500" placeholder="A short, specific essence for the Build card">${esc(guidance.essence)}</textarea></label><label class="wide">Emotional tones<input name="build_emotional_tones" value="${esc(emotionalTones.join(", "))}" placeholder="protective, internal, patient"></label><div class="cm-symbol-section-head"><div><h4>Reflection questions</h4><p>Up to eight questions that help a client decide what this symbol holds for them.</p></div><button class="button" type="button" data-add-layer="guidance-question">Add question</button></div><div class="cm-layer-list" data-layer-list="guidance-question">${reflectionQuestions.map(guidanceQuestionRow).join("")}</div></section>
      <section class="cm-symbol-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">01 · Identity</span><h4>Canonical mark</h4><p>Upload the simplest flat SVG. The importer converts its visible fills and strokes to the About color so it stays legible everywhere it is reused. A draft may remain without artwork, but it cannot be published.</p></div><div class="cm-canonical-preview" data-svg-preview aria-hidden="true">${canonical}</div></div><label class="cm-svg-drop">Upload Illustrator SVG<input type="file" accept=".svg,image/svg+xml" data-svg-file="canonical" data-recolor="true"></label><span class="cm-upload-status" data-svg-status aria-live="polite">Illustrator export: SVG 1.1, Responsive on, CSS Properties set to Presentation Attributes.</span><details><summary>Inspect or paste cleaned SVG source</summary><textarea name="svg_markup" data-canonical-source>${esc(record.svg_markup)}</textarea></details></section>
      <section class="cm-symbol-section cm-context-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">02 · Influence</span><h4>Influence &amp; relationship</h4><p>Name what was inherited, what comes from lived experience, and what has been deliberately reoriented. These lenses may overlap and do not change the category.</p></div></div><fieldset class="cm-context-modes"><legend>Meaning sources</legend>${[["cultural","Cultural or inherited"],["personal","Personal or lived"],["reoriented","Reoriented"]].map(([value,label])=>`<label><input type="checkbox" data-context-mode value="${value}" ${contextModes.has(value)?"checked":""}>${label}</label>`).join("")}</fieldset><div class="cm-context-fields"><label>Inherited or shared associations<textarea name="context_cultural_context" placeholder="What associations did I receive through religion, culture, politics, family, or common use?">${esc(context.cultural_context)}</textarea></label><label>My relationship<textarea name="context_personal_relationship" placeholder="How does this symbol live in my own experience, relationships, or understanding?">${esc(context.personal_relationship)}</textarea></label><label>Reorientation mode<select name="context_reorientation_mode"><option value="">No named reorientation</option>${[["expanded","Expanded — broaden without rejecting"],["inverted","Inverted — turn the inherited relationship around"],["contested","Contested — challenge a conventional reading"],["detached","Detached — loosen the form from its inherited frame"],["combined","Combined — hold inherited and personal readings together"]].map(([value,label])=>`<option value="${value}" ${reorientation.mode===value?"selected":""}>${label}</option>`).join("")}</select></label><label>First-person reorientation<textarea name="context_reorientation_statement" placeholder="How do I expand, invert, contest, detach, or combine the inherited meaning?">${esc(reorientation.statement)}</textarea></label><label>Where meanings meet or resist<textarea name="context_overlap_or_tension" placeholder="Where do the inherited and personal readings overlap, diverge, or remain in tension?">${esc(context.overlap_or_tension)}</textarea></label><label>What remains open<textarea name="context_viewer_opening" placeholder="What room remains for the viewer's own experience or interpretation?">${esc(context.viewer_opening)}</textarea></label></div><div class="cm-symbol-section-head cm-source-head"><div><h4>Curated sources</h4><p>Add sources that locate an inherited association or broaden its context. A source supports the record; it does not become the only valid reading.</p></div><button class="button" type="button" data-add-layer="source">Add source</button></div><div class="cm-layer-list" data-layer-list="source">${sources.map(sourceRow).join("")}</div></section>
      <section class="cm-symbol-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">03 · Application</span><h4>Applications and meaning shifts</h4><p>Record operations that change the reading: direction, repetition, inversion, pairing, enclosure, placement, scale, or combination.</p></div><button class="button" type="button" data-add-layer="application">Add application</button></div><div class="cm-layer-list" data-layer-list="application">${applications.map(applicationRow).join("")}</div></section>
      <section class="cm-symbol-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">04 · Form</span><h4>Visual variants</h4><p>Show recognizable translations—flat, dimensional, colored, carved, inside the maze, animated, or material-specific. Upload SVG, JPEG, PNG, WebP, or GIF.</p></div><button class="button" type="button" data-add-layer="variant">Add variant</button></div><div class="cm-layer-list" data-layer-list="variant">${variants.map(variantRow).join("")}</div></section>
      <section class="cm-symbol-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">05 · Trace</span><h4>Documented appearances</h4><p>Add image-led evidence here. Use Connections below for works already managed by the site so their titles, routes, and status stay live.</p></div><button class="button" type="button" data-add-layer="appearance">Add appearance</button></div><div class="cm-layer-list" data-layer-list="appearance">${appearances.map(appearanceRow).join("")}</div></section>
      </div><div class="cm-actions"><button class="button" type="submit">Save symbol</button><span class="cm-upload-status" data-symbol-status aria-live="polite"></span></div></form></section>`
  }

  function editor(config,record={},categories=[],styleOptions=[]){
    if(config.symbolEditor)return symbolEditor(record,categories);
    const existingMedia=(record.media||[]).map(media=>`<figure><img src="${esc(media.url)}" alt="${esc(media.alt||record.title||"")}"><figcaption>${esc(media.alt||"Attached artwork image")}</figcaption></figure>`).join("");
    const mediaFields=config.mediaUpload?`<div class="cm-artwork-media wide"><strong>Artwork images</strong>${existingMedia?`<div class="cm-artwork-previews">${existingMedia}</div>`:"<p>No images attached yet.</p>"}<label>Upload JPEG, PNG, or WebP<input type="file" name="artwork_files" accept="image/jpeg,image/png,image/webp" multiple></label><label>Image alt text<input name="artwork_alt" value="${esc(record.title||"")}" placeholder="Describe the artwork for screen readers"></label><span class="cm-upload-status" data-artwork-upload-status aria-live="polite"></span></div>`:"";
    const styleFields=config===configs.flash?styleSelector(record,styleOptions):"";
    const fields=config.fields.map(name=>config.flashEditor?flashField(name,record[name]??(name==="state"?"draft":""),!record.id,record):field(name,record[name]??(name==="state"?"draft":""))).join("");
    const flashSheet=config.flashEditor?flashSheetPanel(record):"";
    const flashMedia=config.flashEditor?flashMediaPanel(record):"";
    return `<section class="cm-editor ${config.flashEditor?"cm-flash-editor":""}" aria-label="${record.id?"Edit":"Create"} record"><div class="cm-row"><h3>${record.id?"Edit":"New"} ${esc(config.title)}</h3><button class="button" type="button" data-cancel>Close</button></div><form class="cm-form" data-editor data-id="${esc(record.id||"")}" data-original-state="${esc(record.state||"draft")}" data-original-item-type="${esc(record.item_type||"individual")}" data-media-count="${record.media?.length||0}" data-has-primary="${record.media?.some(media=>media.role==="primary")?"true":"false"}"><div class="cm-form-grid">${fields}${styleFields}${flashSheet}${flashMedia}${mediaFields}</div><div class="cm-actions"><button class="button" type="submit">${config.flashEditor?"Save Flash draft and artwork":config.mediaUpload?"Save artwork":"Save draft"}</button></div></form></section>`
  }

  function renderFlashSheetRows(form){
    const countInput=form.querySelector("[data-sheet-design-count]"),list=form.querySelector("[data-sheet-design-list]"),label=form.querySelector("[data-sheet-design-count-label]");
    if(!countInput||!list)return;
    const existing=new Map([...list.querySelectorAll("[data-sheet-design-row]")].map(row=>[row.dataset.code,{id:row.dataset.id,code:row.dataset.code,label:row.querySelector("[data-sheet-design-label]")?.value||"",state:row.querySelector("[data-sheet-design-locked-state]")?.value||row.querySelector("[data-sheet-design-state]")?.value||"draft",reservedSubmissionId:row.querySelector(".cm-field-note")?.textContent.replace(/^Submission\s+/,"")||""}]));
    const count=Math.max(1,Math.min(26,Number(countInput.value)||1));countInput.value=count;
    list.innerHTML=Array.from({length:count},(_,index)=>{const code=String.fromCharCode(65+index);return flashSheetDesignRow(existing.get(code)||{code},index)}).join("");
    if(label)label.textContent=`${count} design${count===1?"":"s"}`
  }

  function sheetDesignPayload(form){
    const rows=[...form.querySelectorAll("[data-sheet-design-row]")];
    if(!rows.length||rows.length>26)throw new Error("Choose between one and 26 sheet designs.");
    return {count:rows.length,designs:rows.map(row=>({id:row.dataset.id||undefined,code:row.dataset.code,label:String(row.querySelector("[data-sheet-design-label]")?.value||"").trim(),state:row.querySelector("[data-sheet-design-locked-state]")?.value||row.querySelector("[data-sheet-design-state]")?.value||"draft"}))}
  }

  function bindFlashEditor(form){
    form.addEventListener("change",event=>{
      const itemType=event.target.closest("[data-flash-item-type]");if(itemType){const sheet=itemType.value==="sheet",panel=form.querySelector("[data-flash-sheet-panel]"),claimable=form.querySelector("[data-flash-claimable-field]");if(panel)panel.hidden=!sheet;if(claimable)claimable.hidden=sheet;return}
      const count=event.target.closest("[data-sheet-design-count]");if(count){renderFlashSheetRows(form);return}
      const input=event.target.closest('[name="flash_files"]');if(!input)return;
      const output=form.querySelector("[data-flash-pending]"),files=[...input.files||[]];if(!output)return;
      output.innerHTML="";output.hidden=!files.length;
      files.forEach((file,index)=>{const url=URL.createObjectURL(file);adminPreviewUrls.add(url);output.insertAdjacentHTML("beforeend",`<figure><img src="${esc(url)}" alt=""><figcaption>${index===0&&!form.querySelector("[data-flash-media]")?"Primary":"Gallery"} · ${esc(file.name)}</figcaption></figure>`)});
    })
  }

  function bindSymbolEditor(form){
    form.addEventListener("click",event=>{
      const add=event.target.closest("[data-add-layer]");
      if(add){const type=add.dataset.addLayer,list=form.querySelector(`[data-layer-list="${type}"]`),rows={application:applicationRow,variant:variantRow,appearance:appearanceRow,source:sourceRow,"guidance-question":guidanceQuestionRow};if(list&&rows[type])list.insertAdjacentHTML("beforeend",rows[type]());return}
      const remove=event.target.closest("[data-remove-layer]");if(remove){const row=remove.closest("[data-layer-row]");clearLegendVariantPreviewUrl(row);row?.remove()}
    });
    form.addEventListener("change",async event=>{
      const input=event.target.closest("[data-svg-file]");
      if(!input)return;
      const output=input.closest("[data-layer-row]")?form.querySelector("[data-symbol-status]"):form.querySelector("[data-svg-status]")||form.querySelector("[data-symbol-status]");
      try{
        const file=input.files[0];if(!file)return;
        if(output)output.textContent=`Preparing ${file.name}…`;
        const row=input.closest("[data-layer-row]");
        const destination=row?row.querySelector('[data-field="svg_markup"]'):form.querySelector("[data-canonical-source]");
        const preview=row?row.querySelector("[data-svg-preview]"):input.closest(".cm-symbol-section")?.querySelector("[data-svg-preview]");
        if(input.dataset.svgFile==="variant"&&!isSvgFile(file)){
          validateLegendVariantImage(file);clearLegendVariantPreviewUrl(row);
          const imageUrl=row.querySelector('[data-field="image_url"]');if(destination)destination.value="";if(imageUrl)imageUrl.value="";
          const objectUrl=URL.createObjectURL(file);row.dataset.variantPreviewUrl=objectUrl;if(preview)preview.innerHTML=`<img src="${esc(objectUrl)}" alt="">`;
          if(output)output.textContent=`${file.name} is ready to upload when you save the symbol.`;
          return;
        }
        const markup=await readSvgFile(file,input.dataset.recolor==="true");
        clearLegendVariantPreviewUrl(row);
        if(destination)destination.value=markup;if(preview)preview.innerHTML=markup;
        if(input.dataset.svgFile==="variant"){const imageUrl=row.querySelector('[data-field="image_url"]');if(imageUrl)imageUrl.value=""}
        if(output)output.textContent=`${file.name} is cleaned and ready to save.`;
      }catch(error){input.value="";if(output)output.textContent=error.message;status(error.message)}
    });
    form.querySelector("[data-canonical-source]")?.addEventListener("change",event=>{const preview=form.querySelector(".cm-canonical-preview"),output=form.querySelector("[data-svg-status]");try{const markup=safeSvgMarkup(event.target.value,{recolor:true});event.target.value=markup;if(preview)preview.innerHTML=markup;if(output)output.textContent="SVG source is valid and will use the About color."}catch(error){if(output)output.textContent=error.message}});
  }

  function layerValues(form,type,fields){
    return [...form.querySelectorAll(`[data-layer-row="${type}"]`)].map(row=>Object.fromEntries(fields.map(fieldName=>[fieldName,String(row.querySelector(`[data-field="${fieldName}"]`)?.value||"").trim()])))
  }

  function serializeSymbol(form,{allowPendingVariantImages=false}={}){
    const values=Object.fromEntries(new FormData(form));
    const canonical=safeSvgMarkup(values.svg_markup,{recolor:true});
    if(values.state==="published"&&!canonical)throw new Error("Upload the final canonical SVG before publishing the symbol.");
    values.svg_markup=canonical;
    values.sort_order=Number(values.sort_order)||0;
    values.themes_json=JSON.stringify(String(values.themes_input||"").split(",").map(value=>value.trim()).filter(Boolean));
    delete values.themes_input;
    const emotionalTones=String(values.build_emotional_tones||"").split(",").map(value=>value.trim()).filter(Boolean);
    const reflectionQuestions=layerValues(form,"guidance-question",["question"]).map(item=>item.question).filter(Boolean);
    if(emotionalTones.length>12)throw new Error("Build Guidance supports up to 12 emotional tones.");
    if(reflectionQuestions.length>8)throw new Error("Build Guidance supports up to 8 reflection questions.");
    values.build_guidance_json=JSON.stringify({essence:String(values.build_essence||"").trim(),emotional_tones:[...new Set(emotionalTones)],reflection_questions:[...new Set(reflectionQuestions)]});
    delete values.build_essence;delete values.build_emotional_tones;
    const reorientationMode=String(values.context_reorientation_mode||"").trim(),reorientationStatement=String(values.context_reorientation_statement||"").trim();
    if(reorientationMode&&!reorientationStatement)throw new Error("A reorientation mode needs a first-person explanation.");
    if(reorientationStatement&&!reorientationMode)throw new Error("Choose a reorientation mode for the explanation.");
    const sources=layerValues(form,"source",["title","creator","url","note"]);
    for(const source of sources){if(Object.values(source).some(Boolean)&&(!source.title||!source.url))throw new Error("Every source needs a title and URL.");if(source.url&&!safeLegendUrl(source.url))throw new Error(`${source.title||"A source"} needs a valid public or site URL.`)}
    values.context_json=JSON.stringify({modes:[...form.querySelectorAll("[data-context-mode]:checked")].map(input=>input.value),cultural_context:String(values.context_cultural_context||"").trim(),personal_relationship:String(values.context_personal_relationship||"").trim(),reorientation:{mode:reorientationMode,statement:reorientationStatement},overlap_or_tension:String(values.context_overlap_or_tension||"").trim(),viewer_opening:String(values.context_viewer_opening||"").trim(),sources:sources.filter(source=>source.title&&source.url)});
    for(const key of ["context_cultural_context","context_personal_relationship","context_reorientation_mode","context_reorientation_statement","context_overlap_or_tension","context_viewer_opening"])delete values[key];
    const applications=layerValues(form,"application",["title","meaning","note","svg_markup"]);
    for(const item of applications){if(Object.values(item).some(Boolean)&&(!item.title||!item.meaning))throw new Error("Every application needs a name and its changed meaning.");if(item.svg_markup)item.svg_markup=safeSvgMarkup(item.svg_markup,{recolor:true})}
    values.applications_json=JSON.stringify(applications.filter(item=>item.title&&item.meaning));
    const variantRows=[...form.querySelectorAll('[data-layer-row="variant"]')],variants=layerValues(form,"variant",["name","style","note","svg_markup","image_url"]);
    for(const [index,item] of variants.entries()){const pendingFile=variantRows[index]?.querySelector('[data-svg-file="variant"]')?.files?.[0],hasPendingImage=allowPendingVariantImages&&pendingFile&&!isSvgFile(pendingFile);if(Object.values(item).some(Boolean)||hasPendingImage){if(!item.name||(!item.svg_markup&&!item.image_url&&!hasPendingImage))throw new Error("Every variant needs a name and an SVG or image.");if(item.image_url&&!safeLegendUrl(item.image_url))throw new Error(`${item.name||"A variant"} needs a valid public or site image URL.`)}if(item.svg_markup)item.svg_markup=safeSvgMarkup(item.svg_markup)}
    values.variants_json=JSON.stringify(variants.filter(item=>item.name&&(item.svg_markup||item.image_url)));
    const appearances=layerValues(form,"appearance",["title","medium","caption","src","href"]);
    for(const item of appearances){if(Object.values(item).some(Boolean)&&(!item.title||(!item.src&&!item.href)))throw new Error("Every appearance needs a title and an image or page URL.")}
    values.examples_json=JSON.stringify(appearances.filter(item=>item.title&&(item.src||item.href)));
    return values;
  }

  function resourceHeader(config){
    const flash=config.flashEditor;
    return `<div class="cm-head"><div><h2>${esc(config.title)}</h2><p class="cm-summary">${esc(config.description)}</p></div><div class="cm-head-actions"><button class="button" data-new>${flash?"New Flash":"New record"}</button>${flash?'<button class="button" type="button" data-bulk-toggle>Bulk Upload Drafts</button>':""}</div></div>`
  }

  function flashBulkPanel(){
    return `<form class="cm-flash-bulk" data-flash-bulk hidden>
      <div><strong>Bulk upload Flash drafts</strong><p>Each raster file becomes one private draft with an Unclassified style. Finish metadata and publishing in the normal editor.</p></div>
      <label>Choose JPEG, PNG, WebP, or GIF files<input type="file" name="bulk_flash_files" accept="image/jpeg,image/png,image/webp,image/gif" multiple required></label>
      <div class="cm-actions"><button class="button" type="submit">Create draft records</button><button class="button" type="button" data-bulk-refresh>Refresh Flash list</button></div>
      <div class="cm-flash-bulk-status" data-flash-bulk-status aria-live="polite"></div>
    </form>`
  }

  function humanizeFlashFilename(filename){
    const base=String(filename||"Flash design").replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
    return (base||"Flash design").replace(/\b\w/g,letter=>letter.toUpperCase())
  }

  function flashSlug(value){
    return String(value||"flash-design").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"flash-design"
  }

  function uniqueFlashSlug(base,used){
    let candidate=base,index=2;while(used.has(candidate)){candidate=`${base}-${index}`;index++}used.add(candidate);return candidate
  }

  function validateFlashImages(files){
    const allowed=new Set(["image/jpeg","image/png","image/webp","image/gif"]);
    for(const file of files){if(!allowed.has(file.type))throw new Error(`${file.name}: use JPEG, PNG, WebP, or GIF`);if(file.size>15*1024*1024)throw new Error(`${file.name}: exceeds 15 MB`)}
  }

  async function uploadFlashImages(entityId,files,altText,existingCount=0,hasPrimary=false,output){
    validateFlashImages(files);
    for(let index=0;index<files.length;index++){
      const file=files[index],role=!hasPrimary&&index===0?"primary":"gallery",sortOrder=existingCount+index+1;
      if(output)output.textContent=`Uploading ${index+1} of ${files.length}: ${file.name}`;
      const upload=new FormData();upload.append("file",file);upload.append("alt_text",altText);upload.append("privacy","public");upload.append("consent_status","not-required");upload.append("public_presentation","inline");
      const uploaded=await api("/api/admin/media",{method:"POST",body:upload}),mediaId=uploaded.record?.id;
      if(!mediaId)throw new Error(`${file.name} uploaded without a media ID.`);
      try{
        await api(`/api/admin/entities/${encodeURIComponent(entityId)}/media`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media_id:mediaId,role,sort_order:sortOrder,public_visible:true,alt_text_override:altText})});
      }catch(error){
        try{await api(`/api/admin/media/${encodeURIComponent(mediaId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({state:"archived"})})}catch{}
        throw error
      }
    }
    if(output)output.textContent=`${files.length} Flash image${files.length===1?"":"s"} uploaded and attached.`
  }

  async function processFlashBulkJob(job,row){
    const message=row.querySelector("[data-bulk-message]"),retry=row.querySelector("[data-bulk-retry]");retry.hidden=true;row.dataset.state="working";
    try{
      validateFlashImages([job.file]);
      if(!job.entityId){
        message.textContent=`Creating draft for ${job.file.name}…`;
        const created=await api("/api/admin/flash",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:job.title,slug:job.slug,state:"draft",series_id:"",item_type:"individual",process_category:"standard",claimable:0,session_category:"artist_review",split_policy:"artist_review",styles:["unclassified"]})});
        job.entityId=created.record?.id;if(!job.entityId)throw new Error("Draft created without an entity ID.")
      }
      message.textContent=`Uploading ${job.file.name} to ${job.entityId}…`;
      await uploadFlashImages(job.entityId,[job.file],job.title,0,false);
      job.complete=true;row.dataset.state="success";message.textContent=`Draft ready: ${job.title} (${job.entityId})`
    }catch(error){
      row.dataset.state="error";message.textContent=`${job.entityId?`Draft ${job.entityId} kept. `:""}${error.message}`;retry.hidden=false
    }
  }

  async function renderResource(view,filter){
    const config=configs[view];clearAdminPreviewUrls();root().innerHTML=`<section class="construct-manager">${resourceHeader(config)}${notice("Loading…")}</section>`;
    try{
      const [payload,categoryPayload,stylePayload]=await Promise.all([api(`/api/admin/${config.endpoint}`),config.symbolEditor?api("/api/admin/legend/categories"):Promise.resolve({records:[]}),view==="flash"?api("/api/admin/portfolio/settings"):Promise.resolve({options:{styles:[]}})]);
      const allRecords=payload.records||[],records=filter?allRecords.filter(filter):allRecords,categories=categoryPayload.records||[],styleOptions=Array.isArray(stylePayload.options?.styles)?stylePayload.options.styles:[],sortable=config.fields.includes("sort_order"),shell=root().querySelector(".construct-manager");
      shell.innerHTML=`${resourceHeader(config)}<div id="cm-editor"></div>${config.flashEditor?flashBulkPanel():""}<div class="cm-grid">${records.length?records.map((record,index)=>card(record,index,records.length,sortable,styleOptions)).join(""):"<div class='cm-empty'>No matching records.</div>"}</div>`;
      bindResource(shell,config,records,allRecords,categories,styleOptions);
      hydrateAdminMediaPreviews(shell);
    }catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}
  }

  function validateArtworkImages(files){const allowed=new Set(["image/jpeg","image/png","image/webp"]);for(const file of files){if(!allowed.has(file.type))throw new Error(`${file.name}: use JPEG, PNG, or WebP`);if(file.size>15*1024*1024)throw new Error(`${file.name}: exceeds 15 MB`)}}
  async function uploadEntityImages(entityId,files,altText,existingCount,output){validateArtworkImages(files);for(let index=0;index<files.length;index++){const file=files[index];output.textContent=`Uploading ${index+1} of ${files.length}: ${file.name}`;const upload=new FormData();upload.append("file",file);upload.append("alt_text",altText);upload.append("privacy","public");upload.append("consent_status","granted");const uploaded=await api("/api/admin/media",{method:"POST",body:upload});await api(`/api/admin/entities/${encodeURIComponent(entityId)}/media`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media_id:uploaded.record.id,role:existingCount+index===0?"primary":"gallery",sort_order:existingCount+index+1,public_visible:true,alt_text_override:altText})})}output.textContent=files.length?`${files.length} image${files.length===1?"":"s"} attached.`:""}

  async function uploadLegendVariantImages(form,entityId,output){
    const pending=pendingLegendVariantImages(form);if(!pending.length)return;
    if(!entityId)throw new Error("Save the Legend symbol before attaching variant images.");
    const symbolName=String(form.elements.name?.value||"Legend symbol").trim()||"Legend symbol";
    for(const [uploadIndex,{row,input,file,index}] of pending.entries()){
      validateLegendVariantImage(file);
      const variantName=String(row.querySelector('[data-field="name"]')?.value||"Variant").trim()||"Variant",altText=`${symbolName} — ${variantName} variant`;
      if(output)output.textContent=`Uploading variant ${uploadIndex+1} of ${pending.length}: ${file.name}`;
      const upload=new FormData();upload.append("file",file);upload.append("alt_text",altText);upload.append("privacy","public");upload.append("consent_status","not-required");upload.append("public_presentation","inline");
      const uploaded=await api("/api/admin/media",{method:"POST",body:upload}),mediaId=uploaded.record?.id;
      if(!mediaId)throw new Error(`${file.name} uploaded without a media ID.`);
      await api(`/api/admin/entities/${encodeURIComponent(entityId)}/media`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media_id:mediaId,role:"legend-variant",sort_order:index+1,public_visible:true,alt_text_override:altText})});
      const imageUrl=row.querySelector('[data-field="image_url"]'),svgMarkup=row.querySelector('[data-field="svg_markup"]');if(imageUrl)imageUrl.value=`/api/construct/entity-media/${encodeURIComponent(mediaId)}`;if(svgMarkup)svgMarkup.value="";if(input)input.value="";
    }
    if(output)output.textContent=`${pending.length} variant image${pending.length===1?"":"s"} uploaded and attached.`;
  }

  async function handleFlashMediaAction(button,record){
    const item=button.closest("[data-flash-media]"),mediaId=item?.dataset.flashMedia,action=button.dataset.flashMediaAction;
    if(!mediaId||!record?.id)return false;
    const endpoint=`/api/admin/entities/${encodeURIComponent(record.id)}/media/${encodeURIComponent(mediaId)}`;
    if(action==="save"){
      await api(endpoint,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({alt_text_override:item.querySelector("[data-flash-media-alt]")?.value||"",caption_override:item.querySelector("[data-flash-media-caption]")?.value||""})})
    }else if(action==="primary"){
      await api(endpoint,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({role:"primary",sort_order:1,public_visible:true})})
    }else if(action==="remove"){
      if(!confirm("Remove this image from the Flash record? The stored media remains recoverable."))return false;
      await api(endpoint,{method:"DELETE"})
    }else if(action==="up"||action==="down"){
      const gallery=(record.media||[]).filter(media=>media.role!=="primary"),from=gallery.findIndex(media=>media.id===mediaId),to=action==="up"?from-1:from+1;
      if(from<0||to<0||to>=gallery.length)return false;
      [gallery[from],gallery[to]]=[gallery[to],gallery[from]];
      for(const [index,media] of gallery.entries())await api(`/api/admin/entities/${encodeURIComponent(record.id)}/media/${encodeURIComponent(media.id)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({sort_order:index+2})})
    }else return false;
    return true
  }

  function bindResource(shell,config,records,allRecords=records,categories=[],styleOptions=[]){
    const mount=shell.querySelector("#cm-editor");
    shell.addEventListener("click",async event=>{
      const bulkToggle=event.target.closest("[data-bulk-toggle]");if(bulkToggle){const panel=shell.querySelector("[data-flash-bulk]");if(panel){panel.hidden=!panel.hidden;if(!panel.hidden)panel.querySelector('input[type="file"]')?.focus()}return}
      if(event.target.closest("[data-bulk-refresh]"))return renderResource("flash");
      const bulkRetry=event.target.closest("[data-bulk-retry]");if(bulkRetry){const row=bulkRetry.closest("[data-bulk-job]"),job=flashBulkJobs.get(row?.dataset.bulkJob);if(job)await processFlashBulkJob(job,row);return}
      const mediaAction=event.target.closest("[data-flash-media-action]");
      if(mediaAction&&config.flashEditor){
        const form=mediaAction.closest("[data-editor]"),record=records.find(item=>item.id===form?.dataset.id);
        try{if(await handleFlashMediaAction(mediaAction,record)){status("Flash media updated");return renderResource("flash")}}catch(error){status(error.message);const output=form?.querySelector("[data-flash-upload-status]");if(output)output.textContent=error.message}
        return
      }
      const edit=event.target.closest("[data-edit]"),fresh=event.target.closest("[data-new]");
      if(edit||fresh){
        const selected=edit?records.find(record=>record.id===edit.dataset.edit):{};
        mount.innerHTML=editor(config,selected,categories,styleOptions);
        const form=mount.querySelector("[data-editor]");if(config.symbolEditor&&form)bindSymbolEditor(form);if(config===configs.flash&&form){bindStyleSelector(form);bindFlashEditor(form)}
        if(selected?.id){
        if(config.symbolEditor)mount.insertAdjacentHTML("beforeend",'<section class="cm-connections-intro"><span class="cm-section-index">06 · System</span><h3>Connected work</h3><p>Use a public <strong>Uses symbol</strong> relationship for works already managed in Studio. Those connections update the Legend and the related work without duplicating their titles or routes.</p></section>');
          const connections=document.createElement("div");connections.className="cm-entity-connections";mount.appendChild(connections);window.ConnectionsManager?.mount(connections,{entityId:selected.id});
        }
        hydrateAdminMediaPreviews(mount);
        mount.querySelector("input,textarea")?.focus();return;
      }
      if(event.target.closest("[data-cancel]")){mount.innerHTML="";return}
      const archive=event.target.closest("[data-archive]");if(archive&&confirm("Archive this record? It remains recoverable.")){await api(`/api/admin/${config.endpoint}/${encodeURIComponent(archive.dataset.archive)}`,{method:"DELETE"});status("Record archived");return renderResource(Object.keys(configs).find(key=>configs[key]===config))}
      const move=event.target.closest("[data-move]");if(move){const visibleIds=records.map(record=>record.id),from=visibleIds.indexOf(move.dataset.id),to=move.dataset.move==="up"?from-1:from+1;if(to<0||to>=visibleIds.length)return;const ids=allRecords.map(record=>record.id),first=ids.indexOf(visibleIds[from]),second=ids.indexOf(visibleIds[to]);[ids[first],ids[second]]=[ids[second],ids[first]];await api(`/api/admin/${config.endpoint}/reorder`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids,expected_updated_at:allRecords.reduce((value,record)=>record.updated_at>value?record.updated_at:value,"")})});status("Order published");return renderResource(Object.keys(configs).find(key=>configs[key]===config))}
    });
    shell.addEventListener("submit",async event=>{
      const bulkForm=event.target.closest("[data-flash-bulk]");
      if(bulkForm){
        event.preventDefault();const files=[...bulkForm.elements.bulk_flash_files.files||[]],output=bulkForm.querySelector("[data-flash-bulk-status]");
        if(!files.length){output.textContent="Choose at least one Flash image.";return}
        const used=new Set(allRecords.map(record=>record.slug).filter(Boolean));output.innerHTML="";
        for(const file of files){
          const title=humanizeFlashFilename(file.name),slugValue=uniqueFlashSlug(flashSlug(title),used),key=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`,job={file,title,slug:slugValue,entityId:"",complete:false};
          flashBulkJobs.set(key,job);output.insertAdjacentHTML("beforeend",`<article class="cm-flash-bulk-row" data-bulk-job="${esc(key)}" data-state="queued"><span data-bulk-message>Queued: ${esc(file.name)}</span><button class="button" type="button" data-bulk-retry hidden>Retry upload</button></article>`);
          await processFlashBulkJob(job,output.lastElementChild)
        }
        status("Bulk Flash draft pass complete");return
      }
      const form=event.target.closest("[data-editor]");if(!form)return;event.preventDefault();
      const formData=new FormData(form),files=[...(form.querySelector('[name="artwork_files"]')?.files||[])],flashFiles=[...(form.querySelector('[name="flash_files"]')?.files||[])],altText=String(formData.get("artwork_alt")||formData.get("flash_alt")||formData.get("title")||"").trim();formData.delete("artwork_files");formData.delete("artwork_alt");formData.delete("flash_files");formData.delete("flash_alt");
      const pendingVariantUploads=config.symbolEditor?pendingLegendVariantImages(form):[];
      let values,sheetPayload=null;try{pendingVariantUploads.forEach(item=>validateLegendVariantImage(item.file));values=config.symbolEditor?serializeSymbol(form,{allowPendingVariantImages:true}):Object.fromEntries(formData);if(config===configs.flash){values.styles=selectedStyles(form);if(values.item_type==="sheet"){sheetPayload=sheetDesignPayload(form);if((values.state||"draft")!=="draft"&&sheetPayload.designs.some(design=>!design.label))throw new Error("Every sheet design needs a label before publishing.")}}}catch(error){const output=form.querySelector("[data-symbol-status]")||form.querySelector("[data-flash-upload-status]");if(output)output.textContent=error.message;status(error.message);return}
      if("state" in values&&!values.state)values.state="draft";for(const key of ["sort_order","claimable","acquisition_eligible","homepage_enabled"])if(key in values)values[key]=Number(values[key])||0;
      const recordId=form.dataset.id,submit=form.querySelector('[type="submit"]'),output=form.querySelector("[data-flash-upload-status]")||form.querySelector("[data-artwork-upload-status]")||form.querySelector("[data-symbol-status]");submit.disabled=true;
      try{
        validateArtworkImages(files);validateFlashImages(flashFiles);
        let entityId=recordId;
        if(config.flashEditor){
          const desiredState=values.state||"draft",needsStaging=Boolean(entityId&&desiredState!=="draft"&&((flashFiles.length&&form.dataset.hasPrimary!=="true")||(sheetPayload&&(form.dataset.originalState==="draft"||form.dataset.originalItemType!=="sheet"))));
          const saved=await api(`/api/admin/flash${entityId?`/${encodeURIComponent(entityId)}`:""}`,{method:entityId?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...values,state:entityId?(needsStaging?"draft":desiredState):"draft"})});
          entityId=entityId||saved.record?.id;if(!entityId)throw new Error("Flash draft was created without an entity ID.");form.dataset.id=entityId;
          if(flashFiles.length)await uploadFlashImages(entityId,flashFiles,altText||values.title||"Flash artwork",Number(form.dataset.mediaCount)||0,form.dataset.hasPrimary==="true",output);
          if(sheetPayload)await api(`/api/admin/flash/${encodeURIComponent(entityId)}/sheet-designs`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(sheetPayload)});
          if(needsStaging)await api(`/api/admin/flash/${encodeURIComponent(entityId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(values)});
          status(flashFiles.length?"Flash draft and artwork saved":recordId?"Flash record saved":"Flash draft created");return renderResource("flash")
        }
        if(config.symbolEditor&&pendingVariantUploads.length&&!entityId){
          if(output)output.textContent="Creating a draft before uploading variant images…";
          const created=await api(`/api/admin/${config.endpoint}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...values,state:"draft"})});entityId=created.record?.id;
          if(!entityId)throw new Error("The Legend draft was created without an entity ID.");
        }
        if(config.symbolEditor&&pendingVariantUploads.length){await uploadLegendVariantImages(form,entityId,output);values=serializeSymbol(form)}
        const saved=await api(`/api/admin/${config.endpoint}${entityId?`/${encodeURIComponent(entityId)}`:""}`,{method:entityId?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(values)});entityId=entityId||saved.record?.id;
        if(files.length){if(!entityId)throw new Error("Artwork saved, but its media could not be attached.");await uploadEntityImages(entityId,files,altText||values.title||"Artwork",Number(form.dataset.mediaCount)||0,output)}
        status(config.symbolEditor?"Legend symbol saved":files.length?"Artwork and images saved":recordId?"Record saved":"Draft created");renderResource(Object.keys(configs).find(key=>configs[key]===config));
      }catch(error){if(output)output.textContent=error.message;status(error.message);submit.disabled=false}
    });
  }

  const archiveMaterialTypes=[["final-image","Final image"],["sketch","Sketch"],["process-photo","Process photo"],["note","Note"],["voice-memo","Voice memo"],["video","Video"],["document","Document"],["artifact","Artifact"]];
  const archiveWorkspace={dossiers:[],media:[],originThreads:[],selectedEntityId:"",detail:null,materials:[],activities:[],filter:"",previewUrls:[]};
  const archiveTimelineWorkspace={records:[],selected:null,chapters:[]};

  function archivePublicPath(record){const slug=archiveSlug(record);return slug?`/archive/records/${encodeURIComponent(slug)}/`:"/archive/"}

  function archiveDossierCard(record){
    const entityId=archiveEntityId(record),materialCount=Number(firstValue(record,"material_count","materialCount"))||0,activityCount=Number(firstValue(record,"activity_count","activityCount"))||0,canonicalPath=firstValue(record,"canonical_path","canonicalPath","public_path","publicPath")||record?.entity?.canonical_path||"";
    return `<article class="cm-card cm-dossier-card" data-dossier-card data-search="${esc(`${archiveTitle(record)} ${archiveSlug(record)} ${archiveType(record)}`.toLowerCase())}">${image(record)}<div class="cm-card-head"><h3>${esc(archiveTitle(record))}</h3><span class="cm-pill">${esc(archiveState(record))}</span></div><div class="cm-meta">${esc(archiveType(record))} · ${materialCount} material${materialCount===1?"":"s"} · ${activityCount} history entr${activityCount===1?"y":"ies"}</div><p>${esc(firstValue(record,"orientation","summary")||"Archive shell ready for a curated story and reviewed process materials.")}</p><div class="cm-actions"><button class="button" type="button" data-dossier-open="${esc(entityId)}">Open dossier</button>${canonicalPath?`<a class="button" href="${esc(canonicalPath)}" target="_blank" rel="noopener">Active page</a>`:""}${archiveState(record)==="published"?`<a class="button" href="${esc(archivePublicPath(record))}" target="_blank" rel="noopener">Public dossier</a>`:""}</div></article>`
  }

  function mediaOptionList(media,current){return `<option value="">No media file — inline material</option>${media.map(item=>{const id=firstValue(item,"id","media_id","mediaId"),label=firstValue(item,"original_filename","filename","title")||id,privacy=firstValue(item,"privacy")||"internal";return `<option value="${esc(id)}" ${String(current)===String(id)?"selected":""}>${esc(label)} · ${esc(privacy)}</option>`}).join("")}`}

  function originThreadChecks(selected=[]){
    const active=new Set(parseList(selected).map(item=>String(typeof item==="object"?firstValue(item,"id","thread_id","threadId"):item)));
    return archiveWorkspace.originThreads.length?`<fieldset class="cm-origin-thread-picker wide"><legend>Origin threads</legend><p>Attach this evidence to every curated inception thread it belongs to.</p><div>${archiveWorkspace.originThreads.filter(thread=>firstValue(thread,"state")!=="archived").map(thread=>{const id=firstValue(thread,"id");return `<label><input type="checkbox" name="origin_thread_ids" value="${esc(id)}" ${active.has(String(id))?"checked":""}><span>${esc(firstValue(thread,"title","slug"))}</span></label>`}).join("")}</div></fieldset>`:`<div class="cm-empty wide">Create an Origin Thread before assigning inception evidence.</div>`;
  }

  function dossierOriginFields(dossier){
    const selected=parseList(firstValue(dossier,"origin_thread_ids","originThreadIds","origin_threads","originThreads")),selectedIds=new Set(selected.map(item=>String(typeof item==="object"?firstValue(item,"id","thread_id","threadId"):item))),primary=String(firstValue(dossier,"primary_origin_thread_id","primaryOriginThreadId")||"");
    return `<form class="cm-form" data-dossier-origins><div class="cm-form-grid">${originThreadChecks([...selectedIds])}<label class="wide">Primary origin thread<select name="primary_origin_thread_id"><option value="">No public lineage action</option>${archiveWorkspace.originThreads.filter(thread=>selectedIds.has(String(firstValue(thread,"id")))&&firstValue(thread,"state")!=="archived").map(thread=>option(firstValue(thread,"id"),firstValue(thread,"title","slug"),primary)).join("")}</select></label></div><div class="cm-actions"><button class="button" type="submit">Save origin assignments</button><button class="button" type="button" data-open-origin-library>Manage thread library</button><span class="cm-upload-status" data-dossier-origins-status aria-live="polite"></span></div></form>`;
  }

  function materialPreview(material){
    const url=firstValue(material,"url","media_url","mediaUrl","public_url","publicUrl","source_url","sourceUrl")||material?.media?.url||"",mime=firstValue(material,"mime_type","mimeType")||material?.media?.mime_type||"",mediaId=firstValue(material,"media_id","mediaId")||material?.media?.id||"",inlineText=firstValue(material,"body","inline_text","inlineText"),transcript=firstValue(material,"transcript","transcript_text","transcriptText");
    let output="";
    if(url&&mime.startsWith("image/"))output=`<img src="${esc(url)}" alt="${esc(firstValue(material,"alt_text","altText")||firstValue(material,"title"))}" loading="lazy">`;
    else if(url&&mime.startsWith("audio/"))output=`<audio controls preload="metadata" src="${esc(url)}"></audio>`;
    else if(url&&mime.startsWith("video/"))output=`<video controls preload="metadata" src="${esc(url)}"></video>`;
    else if(url)output=`<a class="button" href="${esc(url)}" target="_blank" rel="noopener">Open attached file</a>`;
    else if(mediaId)output=`<div class="cm-secure-media-preview" data-secure-media-preview="${esc(mediaId)}" data-preview-mime="${esc(mime)}" data-preview-alt="${esc(firstValue(material,"alt_text","altText")||firstValue(material,"title"))}"><span class="cm-meta">Loading secure preview…</span></div>`;
    if(inlineText)output+=`<div class="cm-material-text">${esc(inlineText)}</div>`;
    if(transcript)output+=`<details class="cm-transcript"><summary>Transcript</summary><p>${esc(transcript)}</p></details>`;
    return output||`<div class="cm-empty">Metadata only. Attach a file or add inline text before publishing.</div>`
  }

  function clearArchivePreviewUrls(){archiveWorkspace.previewUrls.splice(0).forEach(url=>URL.revokeObjectURL(url))}
  async function hydrateSecureMaterialPreviews(shell){
    await Promise.all([...shell.querySelectorAll("[data-secure-media-preview]")].map(async preview=>{
      const mediaId=preview.dataset.secureMediaPreview,mime=preview.dataset.previewMime||"",alt=preview.dataset.previewAlt||"Attached Archive material";
      try{
        const response=await fetch(`/api/admin/media/${encodeURIComponent(mediaId)}/file`,{headers:{authorization:`Bearer ${localStorage.getItem(tokenKey)||""}`},cache:"no-store"});
        if(!response.ok)throw new Error(`Preview unavailable (${response.status})`);
        const objectUrl=URL.createObjectURL(await response.blob());archiveWorkspace.previewUrls.push(objectUrl);
        if(mime.startsWith("image/"))preview.innerHTML=`<img src="${objectUrl}" alt="${esc(alt)}">`;
        else if(mime.startsWith("audio/"))preview.innerHTML=`<audio controls preload="metadata" src="${objectUrl}"></audio>`;
        else if(mime.startsWith("video/"))preview.innerHTML=`<video controls preload="metadata" src="${objectUrl}"></video>`;
        else preview.innerHTML=`<a class="button" href="${objectUrl}" target="_blank" rel="noopener">Open secure preview</a>`;
      }catch(error){preview.innerHTML=`<span class="cm-meta">${esc(error.message)}</span>`}
    }))
  }

  function materialForm(material={},media=[],isNew=false){
    const id=firstValue(material,"id"),type=firstValue(material,"material_type","materialType")||"note",visibility=firstValue(material,"visibility","privacy")||"internal",publicationState=firstValue(material,"state","publication_state","publicationState")||"draft",consent=firstValue(material,"consent_status","consentStatus")||"not-required",mediaId=firstValue(material,"media_id","mediaId")||material?.media?.id||"";
    return `<form class="cm-form cm-material-form" data-material-form data-id="${esc(id)}" data-original-media-id="${esc(mediaId)}"><div class="cm-form-grid"><label>Material type<select name="material_type">${archiveMaterialTypes.map(([value,label])=>option(value,label,type)).join("")}</select></label><label>Role<input name="role" value="${esc(firstValue(material,"role")||"notebook")}" placeholder="notebook, final, reference"></label><label>Process phase<input name="process_phase" value="${esc(firstValue(material,"process_phase","processPhase"))}" placeholder="Research, sketching, fabrication…"></label><label>Order<input name="sort_order" type="number" min="0" step="1" value="${esc(firstValue(material,"sort_order","sortOrder")||0)}"></label><label class="wide">Title<input name="title" value="${esc(firstValue(material,"title"))}" required></label><label class="wide">Caption<textarea name="caption" placeholder="What is this, and what should a visitor notice?">${esc(firstValue(material,"caption"))}</textarea></label><label class="wide">Inline note or document text<textarea name="body" placeholder="Optional text material; a file is not required.">${esc(firstValue(material,"body","inline_text","inlineText"))}</textarea></label><label>Existing media<select name="media_id">${mediaOptionList(media,mediaId)}</select></label><label>${isNew?"Upload new file":"Replace with a new file"}<input type="file" name="material_file" accept="image/*,audio/*,video/*,.pdf,.doc,.docx"></label><label>Alt text<input name="alt_text" value="${esc(firstValue(material,"alt_text","altText"))}" placeholder="Describe visual material"></label><label>Public presentation<select name="public_presentation">${[["inline","Show inline"],["hidden","Hide file publicly"]].map(([value,label])=>option(value,label,firstValue(material,"public_presentation","publicPresentation")||"inline")).join("")}</select></label><label>Date precision<select name="date_precision">${datePrecisionOptions(firstValue(material,"date_precision","datePrecision"))}</select></label><label>Visitor-facing date<input name="date_label" value="${esc(firstValue(material,"date_label","dateLabel"))}" placeholder="Around spring 2023"></label><label>Start / sort date<input name="occurred_at" type="date" value="${esc(firstValue(material,"occurred_at","occurredAt"))}"></label><label>End date<input name="ended_at" type="date" value="${esc(firstValue(material,"ended_at","endedAt"))}"></label><label>Visibility<select name="visibility">${[["internal","Internal"],["public","Public"],["unlisted","Unlisted"],["private","Private"]].map(([value,label])=>option(value,label,visibility)).join("")}</select></label><label>Consent<select name="consent_status">${[["not-required","Not required"],["required","Required"],["granted","Granted"],["denied","Denied"],["unknown","Unknown"]].map(([value,label])=>option(value,label,consent)).join("")}</select></label><label>Publication<select name="state">${[["draft","Draft"],["published","Published"],["archived","Archived"]].map(([value,label])=>option(value,label,publicationState)).join("")}</select></label><label>Transcript status<select name="transcript_status">${[["not-requested","Not requested"],["pending","Pending"],["ready","Ready"],["failed","Failed"]].map(([value,label])=>option(value,label,firstValue(material,"transcript_status","transcriptStatus")||"not-requested")).join("")}</select></label><label>Transcript language<input name="transcript_language" value="${esc(firstValue(material,"transcript_language","transcriptLanguage")||"en")}"></label><label class="wide">Transcript<textarea name="transcript" placeholder="Review the transcript before setting it to Ready.">${esc(firstValue(material,"transcript","transcript_text","transcriptText"))}</textarea></label>${originThreadChecks(firstValue(material,"origin_thread_ids","originThreadIds"))}</div><div class="cm-actions"><button class="button" type="submit">${isNew?"Add material":"Save material"}</button>${id?`<button class="button danger-button" type="button" data-material-delete="${esc(id)}">Archive material</button>`:""}<span class="cm-upload-status" data-material-status aria-live="polite"></span></div></form>`
  }

  function materialCard(material,index,total,media){
    const id=firstValue(material,"id"),title=firstValue(material,"title")||archiveMaterialTypes.find(([value])=>value===firstValue(material,"material_type","materialType"))?.[1]||"Untitled material";
    return `<article class="cm-archive-entry" data-material-card="${esc(id)}"><div class="cm-archive-entry-preview">${materialPreview(material)}</div><div class="cm-archive-entry-main"><div class="cm-card-head"><div><span class="cm-section-index">${String(index+1).padStart(2,"0")} · ${esc(firstValue(material,"process_phase","processPhase")||"Open notebook")}</span><h4>${esc(title)}</h4></div><span class="cm-pill">${esc(firstValue(material,"state","publication_state","publicationState")||"draft")} / ${esc(firstValue(material,"visibility","privacy")||"internal")}</span></div><p>${esc(firstValue(material,"caption")||"No public caption yet.")}</p><div class="cm-actions"><button class="button" type="button" data-material-move="up" data-id="${esc(id)}" ${index===0?"disabled":""}>Move up</button><button class="button" type="button" data-material-move="down" data-id="${esc(id)}" ${index===total-1?"disabled":""}>Move down</button></div><details class="cm-entry-editor"><summary>Edit metadata</summary>${materialForm(material,media)}</details></div></article>`
  }

  function hydrateMaterialMediaControls(shell){
    shell.querySelectorAll("[data-material-form]").forEach(form=>{
      const mediaId=String(form.elements.media_id?.value||"");
      const material=archiveWorkspace.materials.find(item=>String(firstValue(item,"id"))===String(form.dataset.id))||{};
      const media=archiveWorkspace.media.find(item=>String(firstValue(item,"id"))===mediaId)||{};
      const privacy=firstValue(material,"media_privacy","mediaPrivacy")||firstValue(media,"privacy")||"internal";
      if(!form.elements.media_privacy){
        const presentation=form.elements.public_presentation?.closest("label");
        presentation?.insertAdjacentHTML("afterend",`<label>Shared media privacy<select name="media_privacy">${[["internal","Internal"],["public","Public"],["unlisted","Unlisted"],["private","Private"]].map(([value,label])=>option(value,label,privacy)).join("")}</select></label>`);
        form.querySelector(".cm-form-grid")?.insertAdjacentHTML("beforeend",'<label class="cm-check-field wide"><input type="checkbox" name="update_media_metadata">Update this shared media record (affects every attachment)</label>');
      }
    })
  }

  function activityForm(activity={},isNew=false){
    const id=firstValue(activity,"id"),subjects=parseList(firstValue(activity,"subject_ids","subjectIds","subjects_json","subjectsJson"));
    return `<form class="cm-form cm-activity-form" data-activity-form data-id="${esc(id)}"><div class="cm-form-grid"><label>Activity type<input name="activity_type" value="${esc(firstValue(activity,"activity_type","activityType")||"milestone")}" placeholder="created, exhibited, released…"></label><label>Order<input name="sort_order" type="number" min="0" step="1" value="${esc(firstValue(activity,"sort_order","sortOrder")||0)}"></label><label class="wide">Title<input name="title" value="${esc(firstValue(activity,"title"))}" required></label><label class="wide">Short summary<textarea name="summary" required placeholder="What happened, and why does it matter to this record?">${esc(firstValue(activity,"summary","description"))}</textarea></label><label class="wide">Full history note<textarea name="body" placeholder="Optional longer account, context, or recollection.">${esc(firstValue(activity,"body","notes"))}</textarea></label><label>Date precision<select name="date_precision">${datePrecisionOptions(firstValue(activity,"date_precision","datePrecision"))}</select></label><label>Visitor-facing date<input name="date_label" value="${esc(firstValue(activity,"date_label","dateLabel"))}" placeholder="Late 2023"></label><label>Start / sort date<input name="occurred_at" type="date" value="${esc(firstValue(activity,"occurred_at","occurredAt"))}"></label><label>End date<input name="ended_at" type="date" value="${esc(firstValue(activity,"ended_at","endedAt"))}"></label><label>Place entity ID<input name="place_entity_id" value="${esc(firstValue(activity,"place_entity_id","placeEntityId"))}" placeholder="Optional place record ID"></label><label>Source note<input name="source_note" value="${esc(firstValue(activity,"source_note","sourceNote"))}" placeholder="Where this history came from"></label><label class="wide">Timeline subjects<input name="subject_ids_input" value="${esc(subjects.map(subject=>typeof subject==="string"?subject:firstValue(subject,"id","slug")).filter(Boolean).join(", "))}" placeholder="art, thoughtpuppet, founder, six-well-construct"></label><label class="cm-check-field"><input type="checkbox" name="public_visible" ${checked(firstValue(activity,"public_visible","publicVisible"))?"checked":""}>Visible in published history and subject timelines</label></div><div class="cm-actions"><button class="button" type="submit">${isNew?"Add history entry":"Save history entry"}</button>${id?`<button class="button danger-button" type="button" data-activity-delete="${esc(id)}">Archive entry</button>`:""}<span class="cm-upload-status" data-activity-status aria-live="polite"></span></div></form>`
  }

  function activityCard(activity,index){
    const id=firstValue(activity,"id");return `<article class="cm-history-entry"><div class="cm-history-marker" aria-hidden="true"></div><div><span class="cm-section-index">${esc(firstValue(activity,"date_label","dateLabel")||firstValue(activity,"occurred_at","occurredAt")||"Undated")} · ${esc(firstValue(activity,"activity_type","activityType")||"history")}</span><div class="cm-card-head"><h4>${esc(firstValue(activity,"title")||"Untitled history entry")}</h4><span class="cm-pill">${checked(firstValue(activity,"public_visible","publicVisible"))?"public":"internal"}</span></div><p>${esc(firstValue(activity,"summary","description","body"))}</p><details class="cm-entry-editor"><summary>Edit entry ${index+1}</summary>${activityForm(activity)}</details></div></article>`
  }

  function dossierWorkspaceMarkup(dossier,materials,activities,media){
    const entityId=archiveEntityId(dossier),slug=archiveSlug(dossier),canonicalPath=firstValue(dossier,"canonical_path","canonicalPath","public_path","publicPath")||dossier?.entity?.canonical_path||"",entityState=firstValue(dossier,"entity_state","entityState","canonical_state","canonicalState")||dossier?.entity?.state||"unknown",dossierState=archiveState(dossier),explicitPublic=firstValue(dossier,"public_visible","publicVisible"),publicVisible=explicitPublic===""?dossierState==="published":checked(explicitPublic),featured=checked(firstValue(dossier,"featured"));
    const publishReady=entityState==="published"&&dossierState==="published"&&publicVisible;
    return `<section class="construct-manager cm-dossier-workspace" data-entity-id="${esc(entityId)}"><div class="cm-head cm-dossier-title"><div><button class="button cm-back-button" type="button" data-dossier-back>← All dossiers</button><span class="cm-section-index">${esc(archiveType(dossier))} · ${esc(entityId)}</span><h2>${esc(archiveTitle(dossier))}</h2><p class="cm-summary">A public companion to the active item—not a duplicate identity.</p></div><div class="cm-actions">${canonicalPath?`<a class="button" href="${esc(canonicalPath)}" target="_blank" rel="noopener">Open active page</a>`:""}<a class="button" href="${esc(archivePublicPath(dossier))}?preview=1" target="_blank" rel="noopener">Preview dossier</a></div></div><div class="cm-publish-gate ${publishReady?"is-ready":""}" role="status"><strong>${publishReady?"Public path is eligible":"Publication gate"}</strong><span>Canonical item: ${esc(entityState)} · dossier: ${esc(dossierState)} · public visibility: ${publicVisible?"on":"off"}. Every material is checked separately.</span></div><nav class="cm-workspace-nav" aria-label="Dossier workspace"><a href="#cm-dossier-story">Story</a><a href="#cm-dossier-origins">Origins</a><a href="#cm-dossier-materials">Materials</a><a href="#cm-dossier-history">History</a><a href="#cm-dossier-connections">Connections</a><a href="#cm-dossier-publish">Publish</a></nav>
      <section class="cm-workspace-section" id="cm-dossier-story"><div class="cm-workspace-section-head"><div><span class="cm-section-index">01 · Story</span><h3>Curated orientation</h3><p>Introduce the finished item, then give visitors the context needed to understand the notebook and history.</p></div></div><form class="cm-form" data-dossier-story><div class="cm-form-grid"><label>Archive slug<input name="archive_slug" value="${esc(slug)}" required></label><label class="wide">Short orientation<textarea name="orientation" placeholder="A concise entry point shown near the finished item.">${esc(firstValue(dossier,"orientation","summary"))}</textarea></label><label class="wide">Curated story<textarea class="cm-story-field" name="story" placeholder="The longer background, ideas, decisions, and context behind the result.">${esc(firstValue(dossier,"story","story_markdown","storyMarkdown","body"))}</textarea></label></div><div class="cm-actions"><button class="button" type="submit">Save story</button><span class="cm-upload-status" data-dossier-story-status aria-live="polite"></span></div></form></section>
      <section class="cm-workspace-section" id="cm-dossier-origins"><div class="cm-workspace-section-head"><div><span class="cm-section-index">02 · Origins</span><h3>Inception threads</h3><p>Choose every curated origin family this record belongs to, then select the primary thread used by the public “Find related records” action.</p></div></div>${dossierOriginFields(dossier)}</section>
      <section class="cm-workspace-section" id="cm-dossier-materials"><div class="cm-workspace-section-head"><div><span class="cm-section-index">02 · Materials</span><h3>Open notebook</h3><p>Attach sketches, notes, process photographs, voice memos, video, documents, and artifacts. New material stays internal until explicitly reviewed.</p></div><details class="cm-add-entry"><summary class="button">Add material</summary>${materialForm({},media,true)}</details></div><div class="cm-archive-entry-list">${materials.length?materials.map((material,index)=>materialCard(material,index,materials.length,media)).join(""):`<div class="cm-empty">No process materials are public yet. The dossier can publish truthfully with the finished work while this notebook remains empty.</div>`}</div></section>
      <section class="cm-workspace-section" id="cm-dossier-history"><div class="cm-workspace-section-head"><div><span class="cm-section-index">03 · History</span><h3>Item history</h3><p>Record dated or approximate events once, then include them in item, medium, brand, founder, and Construct timelines through subject IDs.</p></div><details class="cm-add-entry"><summary class="button">Add history entry</summary>${activityForm({},true)}</details></div><div class="cm-history-list">${activities.length?activities.map(activityCard).join(""):`<div class="cm-empty">No history entries have been added to this dossier.</div>`}</div></section>
      <section class="cm-workspace-section" id="cm-dossier-connections"><div class="cm-workspace-section-head"><div><span class="cm-section-index">04 · Connections</span><h3>Related work and context</h3><p>Connect derivatives, people, symbols, places, collections, and related items. Public dossiers show readable cards even when the graph view is not opened.</p></div></div><div class="cm-dossier-connections" data-dossier-connections></div></section>
      <section class="cm-workspace-section" id="cm-dossier-publish"><div class="cm-workspace-section-head"><div><span class="cm-section-index">05 · Publish</span><h3>Dossier visibility</h3><p>Publishing never overrides the canonical item or an individual material. All required gates are enforced again by the public API.</p></div></div><form class="cm-form" data-dossier-publish><div class="cm-form-grid"><label>Dossier state<select name="state">${[["draft","Draft"],["published","Published"],["archived","Archived"]].map(([value,label])=>option(value,label,dossierState)).join("")}</select></label><label class="cm-check-field"><input type="checkbox" name="public_visible" ${publicVisible?"checked":""}>Visible to public Archive APIs</label><label class="cm-check-field"><input type="checkbox" name="featured" ${featured?"checked":""}>Feature in Archive explorer</label></div><div class="cm-actions"><button class="button" type="submit">Save publication settings</button><a class="button" href="${esc(archivePublicPath(dossier))}?preview=1" target="_blank" rel="noopener">Preview before publishing</a><span class="cm-upload-status" data-dossier-publish-status aria-live="polite"></span></div></form></section></section>`
  }

  async function loadArchiveDossier(entityId){
    clearArchivePreviewUrls();archiveWorkspace.selectedEntityId=entityId;root().innerHTML=`<section class="construct-manager">${notice("Loading dossier workspace…")}</section>`;
    try{
      const [detailPayload,materialPayload,activityPayload,mediaPayload,threadPayload]=await Promise.all([api(archiveEndpoints.dossier(entityId)),api(queryEndpoint(archiveEndpoints.materials,{entity_id:entityId})),api(queryEndpoint(archiveEndpoints.activities,{entity_id:entityId})),api(archiveEndpoints.media),api(archiveEndpoints.originThreads)]),listRecord=archiveWorkspace.dossiers.find(item=>archiveEntityId(item)===entityId)||{},dossier={...listRecord,...recordFrom(detailPayload,"dossier")};
      archiveWorkspace.detail=dossier;archiveWorkspace.materials=recordsFrom(materialPayload,"materials");archiveWorkspace.activities=recordsFrom(activityPayload,"activities");archiveWorkspace.media=recordsFrom(mediaPayload,"media");archiveWorkspace.originThreads=recordsFrom(threadPayload,"origin_threads");
      root().innerHTML=dossierWorkspaceMarkup(dossier,archiveWorkspace.materials,archiveWorkspace.activities,archiveWorkspace.media);const shell=root().querySelector(".cm-dossier-workspace");bindDossierWorkspace(shell);hydrateSecureMaterialPreviews(shell);
      const connections=root().querySelector("[data-dossier-connections]");if(connections)window.ConnectionsManager?.mount(connections,{entityId});
    }catch(error){root().innerHTML=`<section class="construct-manager">${notice(error.message,"error")}<button class="button" type="button" data-dossier-retry>Try again</button></section>`;root().querySelector("[data-dossier-retry]")?.addEventListener("click",()=>loadArchiveDossier(entityId))}
  }

  function serializeMaterialForm(form,entityId){
    const formData=new FormData(form),payload={entity_id:entityId,dossier_entity_id:entityId,material_type:String(formData.get("material_type")||"note"),role:String(formData.get("role")||"notebook").trim()||"notebook",process_phase:String(formData.get("process_phase")||"").trim(),title:String(formData.get("title")||"").trim(),caption:String(formData.get("caption")||"").trim(),body:String(formData.get("body")||"").trim(),media_id:String(formData.get("media_id")||"").trim()||null,date_precision:String(formData.get("date_precision")||"undated"),date_label:String(formData.get("date_label")||"").trim(),occurred_at:String(formData.get("occurred_at")||"")||null,ended_at:String(formData.get("ended_at")||"")||null,visibility:String(formData.get("visibility")||"internal"),state:String(formData.get("state")||"draft"),sort_order:Number(formData.get("sort_order"))||0,origin_thread_ids:formData.getAll("origin_thread_ids").map(String)},mediaPayload={state:"active",alt_text:String(formData.get("alt_text")||"").trim(),privacy:String(formData.get("media_privacy")||"internal"),consent_status:String(formData.get("consent_status")||"not-required"),transcript_status:String(formData.get("transcript_status")||"not-requested"),transcript_language:String(formData.get("transcript_language")||"en").trim(),transcript:String(formData.get("transcript")||"").trim(),public_title:String(formData.get("title")||"").trim(),public_description:String(formData.get("caption")||"").trim(),public_presentation:String(formData.get("public_presentation")||"inline")};
    if(payload.state==="published"&&(payload.visibility!=="public"||!["not-required","granted"].includes(mediaPayload.consent_status)))throw new Error("Public material must use Public visibility and consent must be Not required or Granted.");
    const file=form.querySelector('[name="material_file"]')?.files?.[0]||null;if(!form.dataset.id&&!file&&!payload.media_id&&!payload.body)throw new Error("Attach a file, choose existing media, or add inline text.");return{payload,mediaPayload,file,updateMediaMetadata:formData.has("update_media_metadata")}
  }

  async function uploadArchiveMaterialFile(file,mediaPayload,output){
    const max=file.type.startsWith("audio/")||file.type.startsWith("video/")?50:15;if(file.size>max*1024*1024)throw new Error(`${file.name} exceeds ${max} MB.`);output.textContent=`Uploading ${file.name}…`;const upload=new FormData();upload.append("file",file);Object.entries(mediaPayload).forEach(([key,value])=>upload.append(key,value));const uploaded=await api(archiveEndpoints.media,{method:"POST",body:upload});return firstValue(uploaded?.record||uploaded,"id","media_id","mediaId")
  }

  function serializeActivityForm(form,entityId){const data=new FormData(form),subjects=String(data.get("subject_ids_input")||"").split(",").map(value=>value.trim()).filter(Boolean);return{entity_id:entityId,activity_type:String(data.get("activity_type")||"milestone").trim(),title:String(data.get("title")||"").trim(),summary:String(data.get("summary")||"").trim(),body:String(data.get("body")||"").trim(),date_precision:String(data.get("date_precision")||"undated"),date_label:String(data.get("date_label")||"").trim(),occurred_at:String(data.get("occurred_at")||"")||null,ended_at:String(data.get("ended_at")||"")||null,place_entity_id:String(data.get("place_entity_id")||"").trim()||null,source_note:String(data.get("source_note")||"").trim(),subject_ids:subjects,public_visible:data.has("public_visible"),sort_order:Number(data.get("sort_order"))||0}}

  function bindDossierWorkspace(shell){
    const entityId=shell.dataset.entityId;
    hydrateMaterialMediaControls(shell);
    shell.addEventListener("click",async event=>{
      if(event.target.closest("[data-dossier-back]")){archiveWorkspace.selectedEntityId="";return renderArchiveDossiers()}
      if(event.target.closest("[data-open-origin-library]"))return renderOriginThreads();
      const move=event.target.closest("[data-material-move]");if(move){const ids=archiveWorkspace.materials.map(item=>String(firstValue(item,"id"))),from=ids.indexOf(String(move.dataset.id)),to=move.dataset.materialMove==="up"?from-1:from+1;if(from<0||to<0||to>=ids.length)return;[ids[from],ids[to]]=[ids[to],ids[from]];try{await archiveJson(archiveEndpoints.materialOrder,"POST",{entity_id:entityId,ids});status("Material order saved");await loadArchiveDossier(entityId)}catch(error){status(error.message)}return}
      const materialDelete=event.target.closest("[data-material-delete]");if(materialDelete&&confirm("Archive this material? It will leave the public dossier and search immediately.")){try{await api(archiveEndpoints.material(materialDelete.dataset.materialDelete),{method:"DELETE"});status("Material archived");await loadArchiveDossier(entityId)}catch(error){status(error.message)}return}
      const activityDelete=event.target.closest("[data-activity-delete]");if(activityDelete&&confirm("Archive this history entry?")){try{await api(archiveEndpoints.activity(activityDelete.dataset.activityDelete),{method:"DELETE"});status("History entry archived");await loadArchiveDossier(entityId)}catch(error){status(error.message)}}
    });
    shell.addEventListener("change",event=>{
      const originToggle=event.target.closest('[data-dossier-origins] input[name="origin_thread_ids"]');if(originToggle){const form=originToggle.closest("[data-dossier-origins]"),primary=form.elements.primary_origin_thread_id,current=primary.value,selected=new Set(new FormData(form).getAll("origin_thread_ids").map(String));primary.innerHTML=`<option value="">No public lineage action</option>${archiveWorkspace.originThreads.filter(thread=>selected.has(String(firstValue(thread,"id")))&&firstValue(thread,"state")!=="archived").map(thread=>option(firstValue(thread,"id"),firstValue(thread,"title","slug"),current)).join("")}`;return}
      const select=event.target.closest('[data-material-form] select[name="media_id"]');if(!select)return;
      const form=select.closest("[data-material-form]"),media=archiveWorkspace.media.find(item=>String(firstValue(item,"id"))===String(select.value))||{};
      const values={alt_text:firstValue(media,"alt_text","altText"),media_privacy:firstValue(media,"privacy")||"internal",consent_status:firstValue(media,"consent_status","consentStatus")||"not-required",transcript_status:firstValue(media,"transcript_status","transcriptStatus")||"not-requested",transcript_language:firstValue(media,"transcript_language","transcriptLanguage")||"en",transcript:firstValue(media,"transcript"),public_presentation:firstValue(media,"public_presentation","publicPresentation")||"inline"};
      Object.entries(values).forEach(([name,value])=>{if(form.elements[name])form.elements[name].value=value});if(form.elements.update_media_metadata)form.elements.update_media_metadata.checked=false;
    });
    shell.addEventListener("submit",async event=>{
      event.preventDefault();const story=event.target.closest("[data-dossier-story]"),origins=event.target.closest("[data-dossier-origins]"),publish=event.target.closest("[data-dossier-publish]"),material=event.target.closest("[data-material-form]"),activity=event.target.closest("[data-activity-form]");
      if(story){const output=story.querySelector("[data-dossier-story-status]"),data=new FormData(story);try{output.textContent="Saving…";await archiveJson(archiveEndpoints.dossier(entityId),"PATCH",{archive_slug:String(data.get("archive_slug")||"").trim(),orientation:String(data.get("orientation")||"").trim(),story:String(data.get("story")||"").trim()});status("Dossier story saved");await loadArchiveDossier(entityId)}catch(error){output.textContent=error.message;status(error.message)}return}
      if(origins){const output=origins.querySelector("[data-dossier-origins-status]"),data=new FormData(origins),ids=data.getAll("origin_thread_ids").map(String),primary=String(data.get("primary_origin_thread_id")||"");try{if(primary&&!ids.includes(primary))throw new Error("Choose the primary thread as a dossier assignment first.");output.textContent="Saving origin threads…";await archiveJson(archiveEndpoints.dossier(entityId),"PATCH",{origin_thread_ids:ids,primary_origin_thread_id:primary});status("Dossier origin threads saved");await loadArchiveDossier(entityId)}catch(error){output.textContent=error.message;status(error.message)}return}
      if(publish){const output=publish.querySelector("[data-dossier-publish-status]"),data=new FormData(publish);try{output.textContent="Checking publication gates…";await archiveJson(archiveEndpoints.dossier(entityId),"PATCH",{state:String(data.get("state")||"draft"),public_visible:data.has("public_visible"),featured:data.has("featured")});status("Dossier publication settings saved");await loadArchiveDossier(entityId)}catch(error){output.textContent=error.message;status(error.message)}return}
      if(material){const output=material.querySelector("[data-material-status]"),submit=material.querySelector('[type="submit"]');submit.disabled=true;try{const {payload,mediaPayload,file,updateMediaMetadata}=serializeMaterialForm(material,entityId);if(file)payload.media_id=await uploadArchiveMaterialFile(file,mediaPayload,output);else if(payload.media_id&&updateMediaMetadata)await archiveJson(archiveEndpoints.mediaItem(payload.media_id),"PATCH",mediaPayload);const id=material.dataset.id;output.textContent="Saving material…";await archiveJson(id?archiveEndpoints.material(id):archiveEndpoints.materials,id?"PATCH":"POST",payload);status(id?"Material updated":"Material added as an internal draft");await loadArchiveDossier(entityId)}catch(error){output.textContent=error.message;status(error.message);submit.disabled=false}return}
      if(activity){const output=activity.querySelector("[data-activity-status]"),submit=activity.querySelector('[type="submit"]');submit.disabled=true;try{const payload=serializeActivityForm(activity,entityId),id=activity.dataset.id;output.textContent="Saving history…";await archiveJson(id?archiveEndpoints.activity(id):archiveEndpoints.activities,id?"PATCH":"POST",payload);status(id?"History entry updated":"History entry added");await loadArchiveDossier(entityId)}catch(error){output.textContent=error.message;status(error.message);submit.disabled=false}}
    })
  }

  async function renderArchiveDossiers(filterState=""){
    clearArchivePreviewUrls();archiveWorkspace.selectedEntityId="";root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>Archive Dossiers</h2><p class="cm-summary">Canonical published items receive Archive shells here. Curate the story, review materials, build history, and publish the companion dossier without replacing the active item page.</p></div></div>${notice("Loading dossier shells…")}</section>`;
    try{const payload=await api(archiveEndpoints.dossiers);archiveWorkspace.dossiers=recordsFrom(payload,"dossiers");const records=filterState?archiveWorkspace.dossiers.filter(item=>archiveState(item)===filterState):archiveWorkspace.dossiers,shell=root().querySelector(".construct-manager");shell.innerHTML=`<div class="cm-head"><div><h2>${filterState==="draft"?"Draft Archive Dossiers":"Archive Dossiers"}</h2><p class="cm-summary">${records.length} canonical Archive shell${records.length===1?"":"s"}. Nothing becomes public until its canonical item, dossier, material, media, and consent gates all pass.</p></div><a class="button" href="/archive/" target="_blank" rel="noopener">Open public Archive</a></div><label class="cm-dossier-search">Find a dossier<input type="search" data-dossier-search placeholder="Search title, slug, or item type"></label><div class="cm-grid" data-dossier-grid>${records.length?records.map(archiveDossierCard).join(""):`<div class="cm-empty">${filterState?"No draft dossiers.":"No eligible Archive shells have been created yet."}</div>`}</div>`;shell.addEventListener("click",event=>{const open=event.target.closest("[data-dossier-open]");if(open)loadArchiveDossier(open.dataset.dossierOpen)});shell.querySelector("[data-dossier-search]")?.addEventListener("input",event=>{const query=event.target.value.trim().toLowerCase();shell.querySelectorAll("[data-dossier-card]").forEach(card=>card.hidden=query&&!card.dataset.search.includes(query))})}catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}
  }

  function originThreadForm(thread={},isNew=false){const id=firstValue(thread,"id"),state=firstValue(thread,"state")||"draft";return `<form class="cm-form cm-origin-thread-form" data-origin-thread-form data-id="${esc(id)}"><div class="cm-form-grid"><label>Title<input name="title" value="${esc(firstValue(thread,"title"))}" required></label><label>Slug<input name="slug" value="${esc(firstValue(thread,"slug"))}" required></label><label class="wide">Public introduction<textarea name="summary" placeholder="Explain the shared inception and what belongs in this thread.">${esc(firstValue(thread,"summary"))}</textarea></label><label>State<select name="state">${[["draft","Draft"],["published","Published"],["archived","Archived"]].map(([value,label])=>option(value,label,state)).join("")}</select></label><label>Order<input name="sort_order" type="number" min="0" step="1" value="${esc(firstValue(thread,"sort_order","sortOrder")||0)}"></label><label class="cm-check-field"><input type="checkbox" name="public_visible" ${checked(firstValue(thread,"public_visible","publicVisible"))?"checked":""}>Visible in the public Archive</label></div><div class="cm-actions"><button class="button" type="submit">${isNew?"Create origin thread":"Save origin thread"}</button>${id&&state!=="archived"?`<button class="button danger-button" type="button" data-origin-thread-archive="${esc(id)}">Archive thread</button>`:""}<span class="cm-upload-status" data-origin-thread-status aria-live="polite"></span></div></form>`}

  async function renderOriginThreads(){root().innerHTML=`<section class="construct-manager" id="cm-origin-thread-library"><div class="cm-head"><div><h2>Archive Origin Threads</h2><p class="cm-summary">Curated inception families shared by records, notes, references, sketches, and process evidence.</p></div><details class="cm-add-entry"><summary class="button">New origin thread</summary>${originThreadForm({},true)}</details></div>${notice("Loading origin threads…")}</section>`;try{const payload=await api(archiveEndpoints.originThreads),records=recordsFrom(payload,"origin_threads");archiveWorkspace.originThreads=records;const shell=root().querySelector(".construct-manager");shell.lastElementChild.remove();shell.insertAdjacentHTML("beforeend",`<div class="cm-grid">${records.length?records.map(thread=>`<article class="cm-card"><div class="cm-card-head"><h3>${esc(firstValue(thread,"title","slug"))}</h3><span class="cm-pill">${esc(firstValue(thread,"state"))} / ${checked(firstValue(thread,"public_visible","publicVisible"))?"public":"internal"}</span></div><div class="cm-meta">${Number(firstValue(thread,"dossier_count","dossierCount"))||0} records · ${Number(firstValue(thread,"material_count","materialCount"))||0} evidence items</div><p>${esc(firstValue(thread,"summary")||"No public introduction yet.")}</p>${firstValue(thread,"state") === "published"&&checked(firstValue(thread,"public_visible","publicVisible"))?`<a class="button" href="/archive/?origin=${encodeURIComponent(firstValue(thread,"slug"))}" target="_blank" rel="noopener">Open public thread</a>`:""}<details class="cm-entry-editor"><summary>Edit thread</summary>${originThreadForm(thread)}</details></article>`).join(""):`<div class="cm-empty">No origin threads yet. Create one before tagging records or evidence.</div>`}</div>`);shell.addEventListener("submit",async event=>{const form=event.target.closest("[data-origin-thread-form]");if(!form)return;event.preventDefault();const output=form.querySelector("[data-origin-thread-status]"),data=new FormData(form),id=form.dataset.id,payload={title:String(data.get("title")||"").trim(),slug:String(data.get("slug")||"").trim(),summary:String(data.get("summary")||"").trim(),state:String(data.get("state")||"draft"),public_visible:data.has("public_visible"),sort_order:Number(data.get("sort_order"))||0};try{output.textContent="Saving…";await archiveJson(id?archiveEndpoints.originThread(id):archiveEndpoints.originThreads,id?"PATCH":"POST",payload);status(id?"Origin thread updated":"Origin thread created");await renderOriginThreads()}catch(error){output.textContent=error.message;status(error.message)}});shell.addEventListener("click",async event=>{const button=event.target.closest("[data-origin-thread-archive]");if(!button||!confirm("Archive this origin thread? Existing assignments will be preserved, but the thread will disappear from the public Archive."))return;try{await api(archiveEndpoints.originThread(button.dataset.originThreadArchive),{method:"DELETE"});status("Origin thread archived");await renderOriginThreads()}catch(error){status(error.message)}})}catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}}

  function timelineForm(timeline={},isNew=false){const id=firstValue(timeline,"id"),timelineState=firstValue(timeline,"state","publication_state","publicationState")||"draft";return `<form class="cm-form" data-timeline-form data-id="${esc(id)}"><div class="cm-form-grid"><label>Title<input name="title" value="${esc(firstValue(timeline,"title"))}" required></label><label>Slug<input name="slug" value="${esc(firstValue(timeline,"slug"))}" required></label><label class="wide">Subject entity ID<input name="subject_entity_id" value="${esc(firstValue(timeline,"subject_entity_id","subjectEntityId","subject_id","subjectId"))}" placeholder="art, thoughtpuppet, founder…" required></label><label class="wide">Introduction<textarea name="description">${esc(firstValue(timeline,"description","summary"))}</textarea></label><label>State<select name="state">${[["draft","Draft"],["published","Published"],["archived","Archived"]].map(([value,label])=>option(value,label,timelineState)).join("")}</select></label><label>Order<input type="number" name="sort_order" min="0" step="1" value="${esc(firstValue(timeline,"sort_order","sortOrder")||0)}"></label><label class="cm-check-field"><input type="checkbox" name="public_visible" ${checked(firstValue(timeline,"public_visible","publicVisible"))?"checked":""}>Visible on the public timeline route</label></div><div class="cm-actions"><button class="button" type="submit">${isNew?"Create timeline":"Save timeline"}</button><span class="cm-upload-status" data-timeline-status aria-live="polite"></span></div></form>`}

  function chapterForm(chapter={},isNew=false){const id=firstValue(chapter,"id"),chapterState=firstValue(chapter,"state","publication_state","publicationState")||"draft";return `<form class="cm-form" data-chapter-form data-id="${esc(id)}"><div class="cm-form-grid"><label class="wide">Chapter title<input name="title" value="${esc(firstValue(chapter,"title"))}" required></label><label class="wide">Short summary<textarea name="summary">${esc(firstValue(chapter,"summary"))}</textarea></label><label class="wide">Authored chapter<textarea name="body" required>${esc(firstValue(chapter,"body","description"))}</textarea></label><label>Date precision<select name="date_precision">${datePrecisionOptions(firstValue(chapter,"date_precision","datePrecision"))}</select></label><label>Visitor-facing date<input name="date_label" value="${esc(firstValue(chapter,"date_label","dateLabel"))}" placeholder="The early years"></label><label>Start / sort date<input type="date" name="occurred_at" value="${esc(firstValue(chapter,"occurred_at","occurredAt"))}"></label><label>End date<input type="date" name="ended_at" value="${esc(firstValue(chapter,"ended_at","endedAt"))}"></label><label>Anchor slug<input name="anchor_slug" value="${esc(firstValue(chapter,"anchor_slug","anchorSlug"))}" placeholder="early-years"></label><label>Dedupe key<input name="dedupe_key" value="${esc(firstValue(chapter,"dedupe_key","dedupeKey"))}" placeholder="Optional stable key"></label><label>State<select name="state">${[["draft","Draft"],["published","Published"],["archived","Archived"]].map(([value,label])=>option(value,label,chapterState)).join("")}</select></label><label>Order<input type="number" name="sort_order" min="0" step="1" value="${esc(firstValue(chapter,"sort_order","sortOrder")||0)}"></label><label class="cm-check-field"><input type="checkbox" name="public_visible" ${checked(firstValue(chapter,"public_visible","publicVisible"))?"checked":""}>Visible on the public timeline</label></div><div class="cm-actions"><button class="button" type="submit">${isNew?"Add chapter":"Save chapter"}</button>${id?`<button class="button danger-button" type="button" data-chapter-delete="${esc(id)}">Archive chapter</button>`:""}<span class="cm-upload-status" data-chapter-status aria-live="polite"></span></div></form>`}

  function serializeTimelineForm(form){const data=new FormData(form);return{title:String(data.get("title")||"").trim(),slug:String(data.get("slug")||"").trim(),subject_entity_id:String(data.get("subject_entity_id")||"").trim(),description:String(data.get("description")||"").trim(),state:String(data.get("state")||"draft"),public_visible:data.has("public_visible"),sort_order:Number(data.get("sort_order"))||0}}
  function serializeChapterForm(form){const data=new FormData(form);return{title:String(data.get("title")||"").trim(),summary:String(data.get("summary")||"").trim(),body:String(data.get("body")||"").trim(),date_precision:String(data.get("date_precision")||"undated"),date_label:String(data.get("date_label")||"").trim(),occurred_at:String(data.get("occurred_at")||"")||null,ended_at:String(data.get("ended_at")||"")||null,anchor_slug:String(data.get("anchor_slug")||"").trim(),dedupe_key:String(data.get("dedupe_key")||"").trim(),state:String(data.get("state")||"draft"),public_visible:data.has("public_visible"),sort_order:Number(data.get("sort_order"))||0}}

  async function loadArchiveTimeline(timelineId){root().innerHTML=`<section class="construct-manager">${notice("Loading timeline…")}</section>`;try{const payload=await api(archiveEndpoints.timeline(timelineId)),timeline=recordFrom(payload,"timeline"),chapters=recordsFrom(payload,"chapters");archiveTimelineWorkspace.selected=timeline;archiveTimelineWorkspace.chapters=chapters;const slug=firstValue(timeline,"slug");root().innerHTML=`<section class="construct-manager cm-timeline-workspace" data-timeline-id="${esc(timelineId)}"><div class="cm-head"><div><button class="button cm-back-button" type="button" data-timeline-back>← All timelines</button><span class="cm-section-index">Timeline · ${esc(firstValue(timeline,"subject_entity_id","subjectEntityId")||"subject")}</span><h2>${esc(firstValue(timeline,"title")||"Timeline")}</h2><p class="cm-summary">Authored chapters appear around generated public history entries attached to this subject.</p></div>${slug?`<a class="button" href="/archive/timelines/${encodeURIComponent(slug)}/?preview=1" target="_blank" rel="noopener">Preview timeline</a>`:""}</div><section class="cm-workspace-section"><span class="cm-section-index">Timeline settings</span>${timelineForm(timeline)}</section><section class="cm-workspace-section"><div class="cm-workspace-section-head"><div><span class="cm-section-index">Authored chapters</span><h3>Editorial context</h3><p>Use chapters to frame clusters of generated activity without duplicating individual events.</p></div><details class="cm-add-entry"><summary class="button">Add chapter</summary>${chapterForm({},true)}</details></div><div class="cm-archive-entry-list">${chapters.length?chapters.map((chapter,index)=>`<article class="cm-card"><div class="cm-card-head"><h3>${esc(firstValue(chapter,"title")||`Chapter ${index+1}`)}</h3><span class="cm-pill">${esc(firstValue(chapter,"state")||"draft")}</span></div><p>${esc(firstValue(chapter,"date_label","dateLabel")||"Undated")}</p><details class="cm-entry-editor"><summary>Edit chapter</summary>${chapterForm(chapter)}</details></article>`).join(""):`<div class="cm-empty">No authored chapters. Generated history can still populate this timeline.</div>`}</div></section></section>`;bindTimelineWorkspace(root().querySelector(".cm-timeline-workspace"))}catch(error){root().innerHTML=`<section class="construct-manager">${notice(error.message,"error")}</section>`}}

  function bindTimelineWorkspace(shell){const timelineId=shell.dataset.timelineId;shell.addEventListener("click",async event=>{if(event.target.closest("[data-timeline-back]"))return renderArchiveTimelines();const remove=event.target.closest("[data-chapter-delete]");if(remove&&confirm("Archive this timeline chapter?")){try{await api(archiveEndpoints.chapter(timelineId,remove.dataset.chapterDelete),{method:"DELETE"});status("Timeline chapter archived");await loadArchiveTimeline(timelineId)}catch(error){status(error.message)}}});shell.addEventListener("submit",async event=>{event.preventDefault();const timeline=event.target.closest("[data-timeline-form]"),chapter=event.target.closest("[data-chapter-form]");if(timeline){const output=timeline.querySelector("[data-timeline-status]");try{output.textContent="Saving…";await archiveJson(archiveEndpoints.timeline(timelineId),"PATCH",serializeTimelineForm(timeline));status("Timeline saved");await loadArchiveTimeline(timelineId)}catch(error){output.textContent=error.message;status(error.message)}return}if(chapter){const output=chapter.querySelector("[data-chapter-status]"),id=chapter.dataset.id;try{output.textContent="Saving…";await archiveJson(id?archiveEndpoints.chapter(timelineId,id):archiveEndpoints.chapters(timelineId),id?"PATCH":"POST",serializeChapterForm(chapter));status(id?"Chapter saved":"Chapter added");await loadArchiveTimeline(timelineId)}catch(error){output.textContent=error.message;status(error.message)}}})}

  async function renderArchiveTimelines(){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>Archive Timelines</h2><p class="cm-summary">Curate medium, brand, founder, and Construct histories from shared activity plus authored chapters.</p></div></div>${notice("Loading timelines…")}</section>`;try{const payload=await api(archiveEndpoints.timelines),records=recordsFrom(payload,"timelines");archiveTimelineWorkspace.records=records;const shell=root().querySelector(".construct-manager");shell.innerHTML=`<div class="cm-head"><div><h2>Archive Timelines</h2><p class="cm-summary">${records.length} timeline${records.length===1?"":"s"}. Events stay reusable across multiple subjects; chapters add editorial framing.</p></div><details class="cm-add-entry"><summary class="button">New timeline</summary>${timelineForm({},true)}</details></div><div class="cm-grid">${records.length?records.map(record=>`<article class="cm-card"><div class="cm-card-head"><h3>${esc(firstValue(record,"title")||firstValue(record,"slug"))}</h3><span class="cm-pill">${esc(firstValue(record,"state")||"draft")}</span></div><div class="cm-meta">Subject · ${esc(firstValue(record,"subject_entity_id","subjectEntityId","subject_id","subjectId"))}</div><p>${esc(firstValue(record,"description","summary"))}</p><button class="button" type="button" data-timeline-open="${esc(firstValue(record,"id","slug"))}">Edit timeline</button></article>`).join(""):`<div class="cm-empty">No timelines yet.</div>`}</div>`;shell.addEventListener("click",event=>{const open=event.target.closest("[data-timeline-open]");if(open)loadArchiveTimeline(open.dataset.timelineOpen)});shell.addEventListener("submit",async event=>{const form=event.target.closest("[data-timeline-form]");if(!form)return;event.preventDefault();const output=form.querySelector("[data-timeline-status]");try{output.textContent="Creating…";const saved=await archiveJson(archiveEndpoints.timelines,"POST",serializeTimelineForm(form)),timeline=recordFrom(saved,"timeline"),id=firstValue(timeline,"id","slug");status("Timeline created");if(id)await loadArchiveTimeline(id);else await renderArchiveTimelines()}catch(error){output.textContent=error.message;status(error.message)}})}catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}}

  async function renderMedia(){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>Media Library</h2><p class="cm-summary">Shared R2 and static media. Removal archives or detaches; permanent deletion is disabled.</p></div></div><form class="cm-media-drop" id="cm-media-form"><input type="file" name="file" required><input name="alt_text" placeholder="Alt text"><select name="privacy"><option value="internal">Internal</option><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select><select name="consent_status"><option value="not-required">Consent not required</option><option value="required">Consent required</option><option value="granted">Consent granted</option><option value="denied">Consent denied</option><option value="unknown">Consent unknown</option></select><button class="button">Upload media</button><span aria-live="polite" id="cm-upload-status"></span></form><div id="cm-media-list">${notice("Loading…")}</div></section>`;const list=root().querySelector("#cm-media-list");try{const payload=await api("/api/admin/media"),records=recordsFrom(payload,"media");list.innerHTML=`<div class="cm-grid">${records.map(record=>`<article class="cm-card"><h3>${esc(record.original_filename||record.id)}</h3><div class="cm-meta">${esc(record.mime_type)} · ${Math.round((record.byte_size||0)/1024)} KB · ${esc(record.privacy)} · ${esc(record.consent_status||"not-required")}</div><p>${esc(record.alt_text)}</p></article>`).join("")||"<div class='cm-empty'>No media.</div>"}</div>`}catch(error){list.innerHTML=notice(error.message,"error")}root().querySelector("#cm-media-form").addEventListener("submit",async event=>{event.preventDefault();const output=event.target.querySelector("#cm-upload-status"),file=event.target.file.files[0],max=(file.type.startsWith("audio/")||file.type.startsWith("video/"))?50:15;if(file.size>max*1024*1024){output.textContent=`File exceeds ${max} MB.`;return}output.textContent="Uploading…";await api("/api/admin/media",{method:"POST",body:new FormData(event.target)});status("Media uploaded");renderMedia()})}
  async function renderRelationships(){root().innerHTML='<section class="construct-manager"><div id="cm-connections-global"></div></section>';window.ConnectionsManager?.mount(root().querySelector("#cm-connections-global"))}
  async function renderSimple(title,endpoint,body){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>${esc(title)}</h2><p class="cm-summary">${esc(body)}</p></div></div><div id="cm-simple">${notice("Loading…")}</div></section>`;try{const payload=await api(endpoint);root().querySelector("#cm-simple").innerHTML=`<pre class="cm-json">${esc(JSON.stringify(payload,null,2))}</pre>`}catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}}
  async function renderLegendFacet(kind){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>Legend ${esc(kind)}</h2><p class="cm-summary">Derived from the managed symbols. Edit a symbol to curate its ${esc(kind.toLowerCase())}.</p></div></div>${notice("Loading…")}</section>`;try{const payload=await api("/api/admin/legend"),counts=new Map();for(const symbol of payload.records||[]){const values=parseList(symbol[kind==="Themes"?"themes_json":"examples_json"]);for(const value of values){const label=typeof value==="string"?value:(value.title||value.src||"Untitled example");counts.set(label,(counts.get(label)||0)+1)}}const shell=root().querySelector(".construct-manager");shell.innerHTML=`<div class="cm-head"><div><h2>Legend ${esc(kind)}</h2><p class="cm-summary">Derived from published and draft symbol records.</p></div></div><div class="cm-grid">${[...counts].sort((a,b)=>a[0].localeCompare(b[0])).map(([label,count])=>`<article class="cm-card"><h3>${esc(label)}</h3><div class="cm-meta">${count} symbol${count===1?"":"s"}</div></article>`).join("")||"<div class='cm-empty'>No entries yet.</div>"}</div>`}catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}}
  async function renderCompositionRules(){
    root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>Legend Composition Rules</h2><p class="cm-summary">Curated readings and tensions used by Build a Brief. Rules only reach clients when published and every member symbol is published.</p></div></div>${notice("Loading…")}</section>`;
    try{
      const [symbolPayload,rulePayload]=await Promise.all([api("/api/admin/legend"),api("/api/admin/legend/composition-rules")]),symbols=recordsFrom(symbolPayload),rules=recordsFrom(rulePayload);
      const formMarkup=(rule={})=>{const chosen=new Set(rule.symbolIds||[]),memberOrder=new Map((rule.symbolIds||[]).map((symbolId,index)=>[symbolId,index+1]));return `<form class="cm-editor cm-form" data-composition-rule-form data-id="${esc(rule.id||"")}"><div class="cm-row"><h3>${rule.id?"Edit":"New"} composition rule</h3>${rule.id?'<button class="button" type="button" data-rule-cancel>Cancel</button>':""}</div><div class="cm-form-grid"><label>Rule type<select name="type">${["reading","tension"].map(value=>`<option value="${value}" ${rule.type===value?"selected":""}>${value}</option>`).join("")}</select></label><label>State<select name="state">${["draft","published","retired"].map(value=>`<option value="${value}" ${(rule.state||"draft")===value?"selected":""}>${value}</option>`).join("")}</select></label><label>Sort order<input name="sort_order" type="number" min="0" step="1" value="${esc(rule.sortOrder||0)}"></label><label class="wide">Approved interpretation<textarea name="interpretation" required maxlength="5000" placeholder="Use cautious, authored language that can be shown directly to a client.">${esc(rule.interpretation||"")}</textarea></label><fieldset class="wide"><legend>Participating symbols · choose 2–12 and set their member order</legend><div class="cm-grid">${symbols.map((symbol,index)=>`<label class="cm-card"><span><input type="checkbox" name="symbol_id" value="${esc(symbol.id)}" ${chosen.has(symbol.id)?"checked":""}> <strong>${esc(symbol.name)}</strong></span><span class="cm-meta">${esc(symbol.state)}</span><span>Member order<input data-symbol-order="${esc(symbol.id)}" type="number" min="1" max="12" step="1" value="${memberOrder.get(symbol.id)||index+1}"></span></label>`).join("")}</div></fieldset></div><div class="cm-actions"><button class="button" type="submit">${rule.id?"Save rule":"Create rule"}</button><span class="cm-upload-status" data-rule-status aria-live="polite"></span></div></form>`};
      const paint=(editing=null)=>{const shell=root().querySelector(".construct-manager");shell.innerHTML=`<div class="cm-head"><div><h2>Legend Composition Rules</h2><p class="cm-summary">${rules.length} managed rule${rules.length===1?"":"s"}. Published rules are the only source for Build related-symbol recommendations.</p></div></div>${formMarkup(editing||{})}<div class="cm-grid">${rules.map(rule=>`<article class="cm-card"><div class="cm-card-head"><h3>${esc(rule.type)}</h3><span class="cm-pill">${esc(rule.state)}</span></div><p>${esc(rule.interpretation)}</p><div class="cm-meta">${rule.symbols.map(symbol=>esc(symbol.name)).join(" → ")}</div><div class="cm-actions"><button class="button" type="button" data-rule-edit="${esc(rule.id)}">Edit</button>${rule.state!=="retired"?`<button class="button danger-button" type="button" data-rule-retire="${esc(rule.id)}">Retire</button>`:""}</div></article>`).join("")||"<div class='cm-empty'>No composition rules yet.</div>"}</div>`};
      paint();
      const shell=root().querySelector(".construct-manager");
      shell.addEventListener("click",async event=>{const edit=event.target.closest("[data-rule-edit]"),retire=event.target.closest("[data-rule-retire]");if(edit){paint(rules.find(rule=>rule.id===edit.dataset.ruleEdit));root().querySelector("[data-composition-rule-form]")?.scrollIntoView({block:"start"});return}if(event.target.closest("[data-rule-cancel]")){paint();return}if(retire&&confirm("Retire this composition rule? It will stop appearing in Build a Brief.")){await api(`/api/admin/legend/composition-rules/${encodeURIComponent(retire.dataset.ruleRetire)}`,{method:"DELETE"});status("Composition rule retired");return renderCompositionRules()}});
      shell.addEventListener("submit",async event=>{const form=event.target.closest("[data-composition-rule-form]");if(!form)return;event.preventDefault();const members=[...form.querySelectorAll('[name="symbol_id"]:checked')].map(input=>({id:input.value,order:Number(form.querySelector(`[data-symbol-order="${CSS.escape(input.value)}"]`)?.value)||99})).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)),symbolIds=members.map(member=>member.id),output=form.querySelector("[data-rule-status]");try{if(symbolIds.length<2||symbolIds.length>12)throw new Error("Choose between 2 and 12 symbols.");if(new Set(members.map(member=>member.order)).size!==members.length)throw new Error("Each selected symbol needs a unique member order.");const body={type:form.elements.type.value,state:form.elements.state.value,sort_order:Number(form.elements.sort_order.value)||0,interpretation:form.elements.interpretation.value,symbolIds},ruleId=form.dataset.id;await api(`/api/admin/legend/composition-rules${ruleId?`/${encodeURIComponent(ruleId)}`:""}`,{method:ruleId?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});status(ruleId?"Composition rule saved":"Composition rule created");renderCompositionRules()}catch(error){if(output)output.textContent=error.message;status(error.message)}});
    }catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}
  }
  async function renderLegendUsage(){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>Legend Usage and Relationships</h2><p class="cm-summary">Track where each symbol appears across tattoos, art, archive records, events, and other Construct entities.</p></div></div>${notice("Loading…")}</section>`;try{const [symbols,relationships]=await Promise.all([api("/api/admin/legend"),api("/api/admin/relationships")]),ids=new Set((symbols.records||[]).map(record=>record.id)),rows=(relationships.records||[]).filter(record=>ids.has(record.source_entity_id)||ids.has(record.target_entity_id));root().querySelector(".construct-manager").innerHTML=`<div class="cm-head"><div><h2>Legend Usage and Relationships</h2><p class="cm-summary">${rows.length} explicit relationship${rows.length===1?"":"s"} currently reference Legend symbols.</p></div></div>${rows.length?`<table class="cm-table"><thead><tr><th>Source</th><th>Relationship</th><th>Target</th><th>Public</th></tr></thead><tbody>${rows.map(record=>`<tr><td>${esc(record.source_entity_id)}</td><td>${esc(record.forward_label)}</td><td>${esc(record.target_entity_id)}</td><td>${record.public_visible?"Yes":"No"}</td></tr>`).join("")}</tbody></table>`:"<div class='cm-empty'>No explicit Legend relationships yet.</div>"}`}catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}}
  function renderPreviews(title){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>${esc(title)}</h2><p class="cm-summary">These noindex QA mirrors read the same live managed APIs as the public surfaces.</p></div></div><div class="cm-preview-links">${[["Legend","/about/legend/managed-preview/"],["Legend Categories","/about/legend/categories-managed-preview/"],["Flash","/tattoos/flash-managed-preview/"],["Tattoo Build","/tattoos/build-managed-preview/"],["Art","/art/managed-preview.html"],["Archive","/archive/managed-preview/"],["Archive Collections","/archive/collections-managed-preview/"],["Home","/home/managed-preview.html"],["Search","/search/"],["All states","/studio/managed-previews/"]].map(([label,url])=>`<a class="button" href="${url}" target="_blank" rel="noopener">${label}</a>`).join("")}</div><iframe class="cm-preview-frame" title="Managed preview" src="/studio/managed-previews/"></iframe></section>`}
  async function render(tab,view){if(tab==="tattoo"&&configs[view])return renderResource(view);if(tab==="art"&&view==="works")return renderResource("works");if(tab==="legend"){if(view==="symbols")return renderResource("symbols");if(view==="categories")return renderResource("categories");if(view==="composition-rules")return renderCompositionRules();if(view==="themes")return renderLegendFacet("Themes");if(view==="examples")return renderLegendFacet("Examples");if(view==="usage")return renderLegendUsage();return renderResource("symbols",record=>record.state==="draft")}if(tab==="events"&&view==="event-archive")return renderResource("records",record=>record.record_type==="event");if(tab==="archive"){if(view==="dossiers")return renderArchiveDossiers();if(view==="origin-threads")return renderOriginThreads();if(["records","collections","people","places"].includes(view))return renderResource(view);if(view==="media-artifacts")return renderMedia();if(view==="timeline")return renderArchiveTimelines();if(view==="drafts")return renderArchiveDossiers("draft");return renderSimple("Archive Settings","/api/admin/archive-dossiers","Canonical item shells, material privacy, consent, and publication gate status.")}if(tab==="site"){if(view==="nodes"||view==="pathways")return renderResource(view);if(view==="navigation")return renderPreviews("Navigation Preview and Rollback");if(view==="search")return renderPreviews("Search Preview");if(view==="visibility")return renderSimple("Public Visibility","/api/admin/nodes","Only published, permitted entities enter public APIs and search.");return renderPreviews("Site Settings and Preview Hub")}if(tab==="shared"){if(view==="media")return renderMedia();if(view==="relationships")return renderRelationships();if(view==="revisions")return renderSimple("Revision History","/api/admin/revisions","Immutable snapshots for audit, comparison, and restore-as-new-draft.");if(view==="search-index")return renderSimple("Search Index Status","/api/admin/search/status","Published records and unresolved indexing failures.");return renderSimple("Tags and Themes","/api/admin/taxonomy","Controlled terms used across entities.")}}
  window.ConstructManager={isManagedView:(tab,view)=>managed[tab]?.has(view)||false,render:(tab,view)=>tab==="merch"&&view==="products"?renderResource("products"):render(tab,view)};
})();
