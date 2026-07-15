(function(){
  const tokenKey="swc_submissions_admin_token";
  const managed={tattoo:new Set(["flash"]),art:new Set(["works"]),merch:new Set(["products"]),legend:new Set(["symbols","categories","themes","examples","usage","drafts"]),events:new Set(["event-archive"]),archive:new Set(["records","collections","timeline","people","places","media-artifacts","drafts","settings"]),site:new Set(["pathways","nodes","navigation","search","visibility","settings"]),shared:new Set(["media","relationships","taxonomy","revisions","search-index"])};
  const configs={
    flash:{endpoint:"flash",title:"Flash",description:"Availability, claims, experimental process, session structure, series placement, metadata, and ordering.",fields:["title","slug","description","state","series_id","size_bucket","price_label","item_type","process_category","claimable","sheet_code","design_code","session_category","split_policy","estimated_sessions_min","estimated_sessions_max","estimated_total_minutes_min","estimated_total_minutes_max","session_plan_note","legacy_path","sort_order"]},
    symbols:{endpoint:"legend",title:"Legend Symbols",description:"One canonical identity with inherited, lived, and reoriented meanings; visual translations; documented appearances; and relationships that supply other Construct systems.",symbolEditor:true,fields:["name","slug","meaning","category_id","state","themes_json","context_json","applications_json","variants_json","examples_json","svg_markup","sort_order"]},
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
  function notice(message,kind="info"){return `<div class="cm-notice" data-kind="${kind}" role="${kind==="error"?"alert":"status"}">${esc(message)}</div>`}
  function image(record){const media=record.media?.[0],url=media?.url||record.image_url,alt=media?.alt||record.alt_text||record.title||record.name||"";return url?`<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" onerror="this.hidden=true">`:""}
  function state(record){return record.state||record.privacy||record.availability||"record"}
  function parseList(value){if(Array.isArray(value))return value;try{const parsed=JSON.parse(value||"[]");return Array.isArray(parsed)?parsed:[]}catch{return[]}}
  function parseObject(value){if(value&&typeof value==="object"&&!Array.isArray(value))return value;try{const parsed=JSON.parse(value||"{}");return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{}}catch{return{}}}

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

  function safeLegendUrl(value){const url=String(value||"").trim();if(url.startsWith("/")&&!url.startsWith("//"))return url;try{const parsed=new URL(url);return["http:","https:"].includes(parsed.protocol)?url:""}catch{return""}}

  function card(record,index,total,sortable){
    const title=record.title||record.name||record.slug||record.id;
    let symbol="";
    if(record.svg_markup){try{symbol=`<div class="cm-symbol-preview" aria-hidden="true">${safeSvgMarkup(record.svg_markup)}</div>`}catch{symbol=""}}
    return `<article class="cm-card ${state(record)==="draft"?"is-draft":""}" data-record="${esc(record.id)}">${symbol||image(record)}<div class="cm-card-head"><h3>${esc(title)}</h3><span class="cm-pill">${esc(state(record))}</span></div><div class="cm-meta">${esc(record.id)}${sortable?` · ${Number(record.sort_order)||0} / ${total}`:""}</div><div class="cm-actions"><button class="button" data-edit="${esc(record.id)}">Edit</button>${sortable?`<button class="button" data-move="up" data-id="${esc(record.id)}" ${index===0?"disabled":""}>Move up</button><button class="button" data-move="down" data-id="${esc(record.id)}" ${index===total-1?"disabled":""}>Move down</button>`:""}<button class="button danger-button" data-archive="${esc(record.id)}">Archive</button></div></article>`
  }

  function field(name,value){
    const choices={process_category:[["standard","Standard"],["experimental","Experimental"]],session_category:[["artist_review","Artist review"],["one_session","One session"],["multiple_sessions","Multiple sessions"]],split_policy:[["artist_review","Artist review"],["required","Splitting required"],["client_choice","Client choice after estimate"],["not_available","Splitting unavailable"]]};
    const long=/description|statement|meaning|body|notes|note|svg|json|bio/.test(name),numeric=/sort_order|claimable|eligible|enabled|estimated_sessions|estimated_total_minutes/.test(name),label=esc(name.replace(/_/g," "));
    if(choices[name])return `<label>${label}<select name="${name}">${choices[name].map(([option,labelText])=>`<option value="${option}" ${String(value)===option?"selected":""}>${labelText}</option>`).join("")}</select></label>`;
    return `<label class="${long?"wide":""}">${label}${long?`<textarea name="${name}">${esc(value)}</textarea>`:`<input name="${name}" ${numeric?'type="number" min="0" step="1" inputmode="numeric"':''} value="${esc(value)}">`}</label>`
  }

  function applicationRow(entry={}){
    let preview="";try{preview=entry.svg_markup?safeSvgMarkup(entry.svg_markup):""}catch{}
    return `<article class="cm-layer-row" data-layer-row="application"><div class="cm-layer-preview" data-svg-preview aria-hidden="true">${preview}</div><div class="cm-layer-fields"><label>Application name<input data-field="title" value="${esc(entry.title)}" placeholder="Mirrored, paired, enclosed…"></label><label>Meaning in this form<textarea data-field="meaning" placeholder="How this application changes or sharpens the reading">${esc(entry.meaning)}</textarea></label><label>Context note<textarea data-field="note" placeholder="Placement, direction, neighboring symbols, or other conditions">${esc(entry.note)}</textarea></label><label>Optional application diagram<input type="file" accept=".svg,image/svg+xml" data-svg-file="application" data-recolor="true"></label><textarea class="cm-visually-hidden" data-field="svg_markup" tabindex="-1" aria-hidden="true">${esc(entry.svg_markup)}</textarea></div><button class="button danger-button cm-remove-layer" type="button" data-remove-layer>Remove</button></article>`
  }

  function variantRow(entry={}){
    let preview="";try{preview=entry.svg_markup?safeSvgMarkup(entry.svg_markup):""}catch{}
    return `<article class="cm-layer-row" data-layer-row="variant"><div class="cm-layer-preview cm-layer-preview--variant" data-svg-preview aria-hidden="true">${preview||entry.image_url?preview||`<img src="${esc(entry.image_url)}" alt="">`:""}</div><div class="cm-layer-fields"><label>Variant name<input data-field="name" value="${esc(entry.name)}" placeholder="Maze version, chrome form…"></label><label>Style family<input data-field="style" value="${esc(entry.style)}" placeholder="Flat, 3D, color, maze, carved…"></label><label>Variant note<textarea data-field="note" placeholder="What changes formally while the identity stays recognizable">${esc(entry.note)}</textarea></label><label>Upload SVG<input type="file" accept=".svg,image/svg+xml" data-svg-file="variant"></label><label>Or image URL<input data-field="image_url" value="${esc(entry.image_url)}" placeholder="/assets/… or https://…"></label><textarea class="cm-visually-hidden" data-field="svg_markup" tabindex="-1" aria-hidden="true">${esc(entry.svg_markup)}</textarea></div><button class="button danger-button cm-remove-layer" type="button" data-remove-layer>Remove</button></article>`
  }

  function appearanceRow(entry={}){
    return `<article class="cm-layer-row cm-layer-row--appearance" data-layer-row="appearance"><div class="cm-layer-fields"><label>Work or appearance title<input data-field="title" value="${esc(entry.title)}" placeholder="Painting, tattoo, garment, room…"></label><label>Medium<input data-field="medium" value="${esc(entry.medium)}" placeholder="Tattooing, art, merch, film…"></label><label>Caption<textarea data-field="caption" placeholder="How the symbol appears here">${esc(entry.caption)}</textarea></label><label>Image URL<input data-field="src" value="${esc(entry.src)}" placeholder="/assets/… or https://…"></label><label>Page URL<input data-field="href" value="${esc(entry.href)}" placeholder="/art/… or another public route"></label></div><button class="button danger-button cm-remove-layer" type="button" data-remove-layer>Remove</button></article>`
  }

  function sourceRow(entry={}){
    return `<article class="cm-layer-row cm-layer-row--source" data-layer-row="source"><div class="cm-layer-fields"><label>Source title<input data-field="title" value="${esc(entry.title)}" placeholder="Article, book, collection, or catalog" required></label><label>Creator or institution<input data-field="creator" value="${esc(entry.creator)}" placeholder="Author, museum, archive…"></label><label class="wide">Public or site URL<input data-field="url" inputmode="url" value="${esc(entry.url)}" placeholder="https://… or /archive/…" required></label><label class="wide">Why this source matters<textarea data-field="note" placeholder="What context this source contributes without treating it as the only reading">${esc(entry.note)}</textarea></label></div><button class="button danger-button cm-remove-layer" type="button" data-remove-layer>Remove</button></article>`
  }

  function symbolEditor(record={},categories=[]){
    const applications=parseList(record.applications_json),variants=parseList(record.variants_json),appearances=parseList(record.examples_json),themes=parseList(record.themes_json),context=parseObject(record.context_json),contextModes=new Set(Array.isArray(context.modes)?context.modes:[]),sources=Array.isArray(context.sources)?context.sources:[],reorientation=context.reorientation||{};
    let canonical="";try{canonical=record.svg_markup?safeSvgMarkup(record.svg_markup):""}catch{}
    const categoryOptions=categories.filter(category=>category.state!=="archived").map(category=>`<option value="${esc(category.id)}" ${record.category_id===category.id?"selected":""}>${esc(category.name)}${category.state==="published"?"":` · ${esc(category.state)}`}</option>`).join("");
    return `<section class="cm-editor cm-symbol-editor" aria-label="${record.id?"Edit":"Create"} Legend symbol"><div class="cm-row"><h3>${record.id?"Edit":"New"} Legend Symbol</h3><button class="button" type="button" data-cancel>Close</button></div><div class="cm-legend-model"><strong>Stable identity, living context</strong><p>The category describes what kind of mark this is. Influence describes where its meaning comes from. Applications explain meaning shifts in use. Variants show style changes. Appearances and connections document where the symbol has lived.</p></div><form class="cm-form" data-editor data-symbol-editor data-id="${esc(record.id||"")}"><div class="cm-form-grid"><label>Name<input name="name" value="${esc(record.name)}" required></label><label>Slug<input name="slug" value="${esc(record.slug)}" placeholder="Generated from name when blank"></label><label>Category<select name="category_id" required><option value="">Choose a category</option>${categoryOptions}</select></label><label>Publishing state<select name="state">${["draft","published","retired","archived"].map(value=>`<option value="${value}" ${(record.state||"draft")===value?"selected":""}>${value}</option>`).join("")}</select></label><label class="wide">Core meaning<textarea name="meaning" required placeholder="The stable center of the symbol—before context changes it">${esc(record.meaning)}</textarea></label><label class="wide">Themes<input name="themes_input" value="${esc(themes.join(", "))}" placeholder="protection, return, memory"></label><label>Sort order<input name="sort_order" type="number" min="0" step="1" inputmode="numeric" value="${esc(record.sort_order||0)}"></label>
      <section class="cm-symbol-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">01 · Identity</span><h4>Canonical mark</h4><p>Upload the simplest flat SVG. The importer converts its visible fills and strokes to the About color so it stays legible everywhere it is reused. A draft may remain without artwork, but it cannot be published.</p></div><div class="cm-canonical-preview" data-svg-preview aria-hidden="true">${canonical}</div></div><label class="cm-svg-drop">Upload Illustrator SVG<input type="file" accept=".svg,image/svg+xml" data-svg-file="canonical" data-recolor="true"></label><span class="cm-upload-status" data-svg-status aria-live="polite">Illustrator export: SVG 1.1, Responsive on, CSS Properties set to Presentation Attributes.</span><details><summary>Inspect or paste cleaned SVG source</summary><textarea name="svg_markup" data-canonical-source>${esc(record.svg_markup)}</textarea></details></section>
      <section class="cm-symbol-section cm-context-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">02 · Influence</span><h4>Influence &amp; relationship</h4><p>Name what was inherited, what comes from lived experience, and what has been deliberately reoriented. These lenses may overlap and do not change the category.</p></div></div><fieldset class="cm-context-modes"><legend>Meaning sources</legend>${[["cultural","Cultural or inherited"],["personal","Personal or lived"],["reoriented","Reoriented"]].map(([value,label])=>`<label><input type="checkbox" data-context-mode value="${value}" ${contextModes.has(value)?"checked":""}>${label}</label>`).join("")}</fieldset><div class="cm-context-fields"><label>Inherited or shared associations<textarea name="context_cultural_context" placeholder="What associations did I receive through religion, culture, politics, family, or common use?">${esc(context.cultural_context)}</textarea></label><label>My relationship<textarea name="context_personal_relationship" placeholder="How does this symbol live in my own experience, relationships, or understanding?">${esc(context.personal_relationship)}</textarea></label><label>Reorientation mode<select name="context_reorientation_mode"><option value="">No named reorientation</option>${[["expanded","Expanded — broaden without rejecting"],["inverted","Inverted — turn the inherited relationship around"],["contested","Contested — challenge a conventional reading"],["detached","Detached — loosen the form from its inherited frame"],["combined","Combined — hold inherited and personal readings together"]].map(([value,label])=>`<option value="${value}" ${reorientation.mode===value?"selected":""}>${label}</option>`).join("")}</select></label><label>First-person reorientation<textarea name="context_reorientation_statement" placeholder="How do I expand, invert, contest, detach, or combine the inherited meaning?">${esc(reorientation.statement)}</textarea></label><label>Where meanings meet or resist<textarea name="context_overlap_or_tension" placeholder="Where do the inherited and personal readings overlap, diverge, or remain in tension?">${esc(context.overlap_or_tension)}</textarea></label><label>What remains open<textarea name="context_viewer_opening" placeholder="What room remains for the viewer's own experience or interpretation?">${esc(context.viewer_opening)}</textarea></label></div><div class="cm-symbol-section-head cm-source-head"><div><h4>Curated sources</h4><p>Add sources that locate an inherited association or broaden its context. A source supports the record; it does not become the only valid reading.</p></div><button class="button" type="button" data-add-layer="source">Add source</button></div><div class="cm-layer-list" data-layer-list="source">${sources.map(sourceRow).join("")}</div></section>
      <section class="cm-symbol-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">03 · Application</span><h4>Applications and meaning shifts</h4><p>Record operations that change the reading: direction, repetition, inversion, pairing, enclosure, placement, scale, or combination.</p></div><button class="button" type="button" data-add-layer="application">Add application</button></div><div class="cm-layer-list" data-layer-list="application">${applications.map(applicationRow).join("")}</div></section>
      <section class="cm-symbol-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">04 · Form</span><h4>Visual variants</h4><p>Show recognizable translations—flat, dimensional, colored, carved, inside the maze, animated, or material-specific.</p></div><button class="button" type="button" data-add-layer="variant">Add variant</button></div><div class="cm-layer-list" data-layer-list="variant">${variants.map(variantRow).join("")}</div></section>
      <section class="cm-symbol-section wide"><div class="cm-symbol-section-head"><div><span class="cm-section-index">05 · Trace</span><h4>Documented appearances</h4><p>Add image-led evidence here. Use Connections below for works already managed by the site so their titles, routes, and status stay live.</p></div><button class="button" type="button" data-add-layer="appearance">Add appearance</button></div><div class="cm-layer-list" data-layer-list="appearance">${appearances.map(appearanceRow).join("")}</div></section>
      </div><div class="cm-actions"><button class="button" type="submit">Save symbol</button><span class="cm-upload-status" data-symbol-status aria-live="polite"></span></div></form></section>`
  }

  function editor(config,record={},categories=[]){
    if(config.symbolEditor)return symbolEditor(record,categories);
    const existingMedia=(record.media||[]).map(media=>`<figure><img src="${esc(media.url)}" alt="${esc(media.alt||record.title||"")}"><figcaption>${esc(media.alt||"Attached artwork image")}</figcaption></figure>`).join("");
    const mediaFields=config.mediaUpload?`<div class="cm-artwork-media wide"><strong>Artwork images</strong>${existingMedia?`<div class="cm-artwork-previews">${existingMedia}</div>`:"<p>No images attached yet.</p>"}<label>Upload JPEG, PNG, or WebP<input type="file" name="artwork_files" accept="image/jpeg,image/png,image/webp" multiple></label><label>Image alt text<input name="artwork_alt" value="${esc(record.title||"")}" placeholder="Describe the artwork for screen readers"></label><span class="cm-upload-status" data-artwork-upload-status aria-live="polite"></span></div>`:"";
    return `<section class="cm-editor" aria-label="${record.id?"Edit":"Create"} record"><div class="cm-row"><h3>${record.id?"Edit":"New"} ${esc(config.title)}</h3><button class="button" type="button" data-cancel>Close</button></div><form class="cm-form" data-editor data-id="${esc(record.id||"")}" data-media-count="${record.media?.length||0}"><div class="cm-form-grid">${config.fields.map(name=>field(name,record[name]??(name==="state"?"draft":""))).join("")}${mediaFields}</div><div class="cm-actions"><button class="button" type="submit">${config.mediaUpload?"Save artwork":"Save draft"}</button></div></form></section>`
  }

  function bindSymbolEditor(form){
    form.addEventListener("click",event=>{
      const add=event.target.closest("[data-add-layer]");
      if(add){const type=add.dataset.addLayer,list=form.querySelector(`[data-layer-list="${type}"]`),rows={application:applicationRow,variant:variantRow,appearance:appearanceRow,source:sourceRow};if(list&&rows[type])list.insertAdjacentHTML("beforeend",rows[type]());return}
      const remove=event.target.closest("[data-remove-layer]");if(remove)remove.closest("[data-layer-row]")?.remove();
    });
    form.addEventListener("change",async event=>{
      const input=event.target.closest("[data-svg-file]");
      if(!input)return;
      const output=form.querySelector("[data-svg-status]")||form.querySelector("[data-symbol-status]");
      try{
        if(output)output.textContent=`Preparing ${input.files[0]?.name||"SVG"}…`;
        const markup=await readSvgFile(input.files[0],input.dataset.recolor==="true");
        const row=input.closest("[data-layer-row]");
        const destination=row?row.querySelector('[data-field="svg_markup"]'):form.querySelector("[data-canonical-source]");
        const preview=row?row.querySelector("[data-svg-preview]"):input.closest(".cm-symbol-section")?.querySelector("[data-svg-preview]");
        if(destination)destination.value=markup;if(preview)preview.innerHTML=markup;
        if(output)output.textContent=`${input.files[0].name} is cleaned and ready to save.`;
      }catch(error){input.value="";if(output)output.textContent=error.message;status(error.message)}
    });
    form.querySelector("[data-canonical-source]")?.addEventListener("change",event=>{const preview=form.querySelector(".cm-canonical-preview"),output=form.querySelector("[data-svg-status]");try{const markup=safeSvgMarkup(event.target.value,{recolor:true});event.target.value=markup;if(preview)preview.innerHTML=markup;if(output)output.textContent="SVG source is valid and will use the About color."}catch(error){if(output)output.textContent=error.message}});
  }

  function layerValues(form,type,fields){
    return [...form.querySelectorAll(`[data-layer-row="${type}"]`)].map(row=>Object.fromEntries(fields.map(fieldName=>[fieldName,String(row.querySelector(`[data-field="${fieldName}"]`)?.value||"").trim()])))
  }

  function serializeSymbol(form){
    const values=Object.fromEntries(new FormData(form));
    const canonical=safeSvgMarkup(values.svg_markup,{recolor:true});
    if(values.state==="published"&&!canonical)throw new Error("Upload the final canonical SVG before publishing the symbol.");
    values.svg_markup=canonical;
    values.sort_order=Number(values.sort_order)||0;
    values.themes_json=JSON.stringify(String(values.themes_input||"").split(",").map(value=>value.trim()).filter(Boolean));
    delete values.themes_input;
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
    const variants=layerValues(form,"variant",["name","style","note","svg_markup","image_url"]);
    for(const item of variants){if(Object.values(item).some(Boolean)&&(!item.name||(!item.svg_markup&&!item.image_url)))throw new Error("Every variant needs a name and either an SVG or image URL.");if(item.svg_markup)item.svg_markup=safeSvgMarkup(item.svg_markup)}
    values.variants_json=JSON.stringify(variants.filter(item=>item.name&&(item.svg_markup||item.image_url)));
    const appearances=layerValues(form,"appearance",["title","medium","caption","src","href"]);
    for(const item of appearances){if(Object.values(item).some(Boolean)&&(!item.title||(!item.src&&!item.href)))throw new Error("Every appearance needs a title and an image or page URL.")}
    values.examples_json=JSON.stringify(appearances.filter(item=>item.title&&(item.src||item.href)));
    return values;
  }

  async function renderResource(view,filter){
    const config=configs[view];root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>${esc(config.title)}</h2><p class="cm-summary">${esc(config.description)}</p></div><button class="button" data-new>New record</button></div>${notice("Loading…")}</section>`;
    try{
      const [payload,categoryPayload]=await Promise.all([api(`/api/admin/${config.endpoint}`),config.symbolEditor?api("/api/admin/legend/categories"):Promise.resolve({records:[]})]);
      const allRecords=payload.records||[],records=filter?allRecords.filter(filter):allRecords,categories=categoryPayload.records||[],sortable=config.fields.includes("sort_order"),shell=root().querySelector(".construct-manager");
      shell.innerHTML=`<div class="cm-head"><div><h2>${esc(config.title)}</h2><p class="cm-summary">${esc(config.description)}</p></div><button class="button" data-new>New record</button></div><div id="cm-editor"></div><div class="cm-grid">${records.length?records.map((record,index)=>card(record,index,records.length,sortable)).join(""):"<div class='cm-empty'>No matching records.</div>"}</div>`;
      bindResource(shell,config,records,allRecords,categories);
    }catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}
  }

  function validateArtworkImages(files){const allowed=new Set(["image/jpeg","image/png","image/webp"]);for(const file of files){if(!allowed.has(file.type))throw new Error(`${file.name}: use JPEG, PNG, or WebP`);if(file.size>15*1024*1024)throw new Error(`${file.name}: exceeds 15 MB`)}}
  async function uploadEntityImages(entityId,files,altText,existingCount,output){validateArtworkImages(files);for(let index=0;index<files.length;index++){const file=files[index];output.textContent=`Uploading ${index+1} of ${files.length}: ${file.name}`;const upload=new FormData();upload.append("file",file);upload.append("alt_text",altText);upload.append("privacy","public");upload.append("consent_status","approved");const uploaded=await api("/api/admin/media",{method:"POST",body:upload});await api(`/api/admin/entities/${encodeURIComponent(entityId)}/media`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media_id:uploaded.record.id,role:existingCount+index===0?"primary":"gallery",sort_order:existingCount+index+1,public_visible:true,alt_text_override:altText})})}output.textContent=files.length?`${files.length} image${files.length===1?"":"s"} attached.`:""}

  function bindResource(shell,config,records,allRecords=records,categories=[]){
    const mount=shell.querySelector("#cm-editor");
    shell.addEventListener("click",async event=>{
      const edit=event.target.closest("[data-edit]"),fresh=event.target.closest("[data-new]");
      if(edit||fresh){
        const selected=edit?records.find(record=>record.id===edit.dataset.edit):{};
        mount.innerHTML=editor(config,selected,categories);
        const form=mount.querySelector("[data-editor]");if(config.symbolEditor&&form)bindSymbolEditor(form);
        if(selected?.id){
        if(config.symbolEditor)mount.insertAdjacentHTML("beforeend",'<section class="cm-connections-intro"><span class="cm-section-index">06 · System</span><h3>Connected work</h3><p>Use a public <strong>Uses symbol</strong> relationship for works already managed in Studio. Those connections update the Legend and the related work without duplicating their titles or routes.</p></section>');
          const connections=document.createElement("div");connections.className="cm-entity-connections";mount.appendChild(connections);window.ConnectionsManager?.mount(connections,{entityId:selected.id});
        }
        mount.querySelector("input,textarea")?.focus();return;
      }
      if(event.target.closest("[data-cancel]")){mount.innerHTML="";return}
      const archive=event.target.closest("[data-archive]");if(archive&&confirm("Archive this record? It remains recoverable.")){await api(`/api/admin/${config.endpoint}/${encodeURIComponent(archive.dataset.archive)}`,{method:"DELETE"});status("Record archived");return renderResource(Object.keys(configs).find(key=>configs[key]===config))}
      const move=event.target.closest("[data-move]");if(move){const visibleIds=records.map(record=>record.id),from=visibleIds.indexOf(move.dataset.id),to=move.dataset.move==="up"?from-1:from+1;if(to<0||to>=visibleIds.length)return;const ids=allRecords.map(record=>record.id),first=ids.indexOf(visibleIds[from]),second=ids.indexOf(visibleIds[to]);[ids[first],ids[second]]=[ids[second],ids[first]];await api(`/api/admin/${config.endpoint}/reorder`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids,expected_updated_at:allRecords.reduce((value,record)=>record.updated_at>value?record.updated_at:value,"")})});status("Order published");return renderResource(Object.keys(configs).find(key=>configs[key]===config))}
    });
    shell.addEventListener("submit",async event=>{
      const form=event.target.closest("[data-editor]");if(!form)return;event.preventDefault();
      const formData=new FormData(form),files=[...(form.querySelector('[name="artwork_files"]')?.files||[])],altText=String(formData.get("artwork_alt")||formData.get("title")||"").trim();formData.delete("artwork_files");formData.delete("artwork_alt");
      let values;try{values=config.symbolEditor?serializeSymbol(form):Object.fromEntries(formData)}catch(error){form.querySelector("[data-symbol-status]").textContent=error.message;status(error.message);return}
      if("state" in values&&!values.state)values.state="draft";for(const key of ["sort_order","claimable","acquisition_eligible","homepage_enabled"])if(key in values)values[key]=Number(values[key])||0;
      const recordId=form.dataset.id,submit=form.querySelector('[type="submit"]'),output=form.querySelector("[data-artwork-upload-status]")||form.querySelector("[data-symbol-status]");submit.disabled=true;
      try{
        validateArtworkImages(files);
        const saved=await api(`/api/admin/${config.endpoint}${recordId?`/${encodeURIComponent(recordId)}`:""}`,{method:recordId?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(values)}),entityId=recordId||saved.record?.id;
        if(files.length){if(!entityId)throw new Error("Artwork saved, but its media could not be attached.");await uploadEntityImages(entityId,files,altText||values.title||"Artwork",Number(form.dataset.mediaCount)||0,output)}
        status(config.symbolEditor?"Legend symbol saved":files.length?"Artwork and images saved":recordId?"Record saved":"Draft created");renderResource(Object.keys(configs).find(key=>configs[key]===config));
      }catch(error){if(output)output.textContent=error.message;status(error.message);submit.disabled=false}
    });
  }

  async function renderMedia(){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>Media Library</h2><p class="cm-summary">Shared R2 and static media. Removal archives or detaches; permanent deletion is disabled.</p></div></div><form class="cm-media-drop" id="cm-media-form"><input type="file" name="file" required><input name="alt_text" placeholder="Alt text"><select name="privacy"><option value="internal">Internal</option><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select><button class="button">Upload media</button><span aria-live="polite" id="cm-upload-status"></span></form><div id="cm-media-list">${notice("Loading…")}</div></section>`;const list=root().querySelector("#cm-media-list");try{const payload=await api("/api/admin/media");list.innerHTML=`<div class="cm-grid">${payload.records.map(record=>`<article class="cm-card"><h3>${esc(record.original_filename||record.id)}</h3><div class="cm-meta">${esc(record.mime_type)} · ${Math.round((record.byte_size||0)/1024)} KB · ${esc(record.privacy)}</div><p>${esc(record.alt_text)}</p></article>`).join("")||"<div class='cm-empty'>No media.</div>"}</div>`}catch(error){list.innerHTML=notice(error.message,"error")}root().querySelector("#cm-media-form").addEventListener("submit",async event=>{event.preventDefault();const output=event.target.querySelector("#cm-upload-status"),file=event.target.file.files[0],max=(file.type.startsWith("audio/")||file.type.startsWith("video/"))?50:15;if(file.size>max*1024*1024){output.textContent=`File exceeds ${max} MB.`;return}output.textContent="Uploading…";await api("/api/admin/media",{method:"POST",body:new FormData(event.target)});status("Media uploaded");renderMedia()})}
  async function renderRelationships(){root().innerHTML='<section class="construct-manager"><div id="cm-connections-global"></div></section>';window.ConnectionsManager?.mount(root().querySelector("#cm-connections-global"))}
  async function renderSimple(title,endpoint,body){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>${esc(title)}</h2><p class="cm-summary">${esc(body)}</p></div></div><div id="cm-simple">${notice("Loading…")}</div></section>`;try{const payload=await api(endpoint);root().querySelector("#cm-simple").innerHTML=`<pre class="cm-json">${esc(JSON.stringify(payload,null,2))}</pre>`}catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}}
  async function renderLegendFacet(kind){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>Legend ${esc(kind)}</h2><p class="cm-summary">Derived from the managed symbols. Edit a symbol to curate its ${esc(kind.toLowerCase())}.</p></div></div>${notice("Loading…")}</section>`;try{const payload=await api("/api/admin/legend"),counts=new Map();for(const symbol of payload.records||[]){const values=parseList(symbol[kind==="Themes"?"themes_json":"examples_json"]);for(const value of values){const label=typeof value==="string"?value:(value.title||value.src||"Untitled example");counts.set(label,(counts.get(label)||0)+1)}}const shell=root().querySelector(".construct-manager");shell.innerHTML=`<div class="cm-head"><div><h2>Legend ${esc(kind)}</h2><p class="cm-summary">Derived from published and draft symbol records.</p></div></div><div class="cm-grid">${[...counts].sort((a,b)=>a[0].localeCompare(b[0])).map(([label,count])=>`<article class="cm-card"><h3>${esc(label)}</h3><div class="cm-meta">${count} symbol${count===1?"":"s"}</div></article>`).join("")||"<div class='cm-empty'>No entries yet.</div>"}</div>`}catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}}
  async function renderLegendUsage(){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>Legend Usage and Relationships</h2><p class="cm-summary">Track where each symbol appears across tattoos, art, archive records, events, and other Construct entities.</p></div></div>${notice("Loading…")}</section>`;try{const [symbols,relationships]=await Promise.all([api("/api/admin/legend"),api("/api/admin/relationships")]),ids=new Set((symbols.records||[]).map(record=>record.id)),rows=(relationships.records||[]).filter(record=>ids.has(record.source_entity_id)||ids.has(record.target_entity_id));root().querySelector(".construct-manager").innerHTML=`<div class="cm-head"><div><h2>Legend Usage and Relationships</h2><p class="cm-summary">${rows.length} explicit relationship${rows.length===1?"":"s"} currently reference Legend symbols.</p></div></div>${rows.length?`<table class="cm-table"><thead><tr><th>Source</th><th>Relationship</th><th>Target</th><th>Public</th></tr></thead><tbody>${rows.map(record=>`<tr><td>${esc(record.source_entity_id)}</td><td>${esc(record.forward_label)}</td><td>${esc(record.target_entity_id)}</td><td>${record.public_visible?"Yes":"No"}</td></tr>`).join("")}</tbody></table>`:"<div class='cm-empty'>No explicit Legend relationships yet.</div>"}`}catch(error){root().querySelector(".construct-manager").innerHTML=notice(error.message,"error")}}
  function renderPreviews(title){root().innerHTML=`<section class="construct-manager"><div class="cm-head"><div><h2>${esc(title)}</h2><p class="cm-summary">These noindex QA mirrors read the same live managed APIs as the public surfaces.</p></div></div><div class="cm-preview-links">${[["Legend","/about/legend/managed-preview/"],["Legend Categories","/about/legend/categories-managed-preview/"],["Flash","/tattoos/flash-managed-preview/"],["Tattoo Build","/tattoos/build-managed-preview/"],["Art","/art/managed-preview.html"],["Archive","/archive/managed-preview/"],["Archive Collections","/archive/collections-managed-preview/"],["Home","/home/managed-preview.html"],["Search","/search/"],["All states","/studio/managed-previews/"]].map(([label,url])=>`<a class="button" href="${url}" target="_blank" rel="noopener">${label}</a>`).join("")}</div><iframe class="cm-preview-frame" title="Managed preview" src="/studio/managed-previews/"></iframe></section>`}
  async function render(tab,view){if(tab==="tattoo"&&configs[view])return renderResource(view);if(tab==="art"&&view==="works")return renderResource("works");if(tab==="legend"){if(view==="symbols")return renderResource("symbols");if(view==="categories")return renderResource("categories");if(view==="themes")return renderLegendFacet("Themes");if(view==="examples")return renderLegendFacet("Examples");if(view==="usage")return renderLegendUsage();return renderResource("symbols",record=>record.state==="draft")}if(tab==="events"&&view==="event-archive")return renderResource("records",record=>record.record_type==="event");if(tab==="archive"){if(["records","collections","people","places"].includes(view))return renderResource(view);if(view==="media-artifacts")return renderMedia();if(view==="timeline")return renderResource("records");if(view==="drafts")return renderResource("records",record=>record.state==="draft");return renderSimple("Archive Settings","/api/admin/archive","Archive visibility and source-of-truth status.")}if(tab==="site"){if(view==="nodes"||view==="pathways")return renderResource(view);if(view==="navigation")return renderPreviews("Navigation Preview and Rollback");if(view==="search")return renderPreviews("Search Preview");if(view==="visibility")return renderSimple("Public Visibility","/api/admin/nodes","Only published, permitted entities enter public APIs and search.");return renderPreviews("Site Settings and Preview Hub")}if(tab==="shared"){if(view==="media")return renderMedia();if(view==="relationships")return renderRelationships();if(view==="revisions")return renderSimple("Revision History","/api/admin/revisions","Immutable snapshots for audit, comparison, and restore-as-new-draft.");if(view==="search-index")return renderSimple("Search Index Status","/api/admin/search/status","Published records and unresolved indexing failures.");return renderSimple("Tags and Themes","/api/admin/taxonomy","Controlled terms used across entities.")}}
  window.ConstructManager={isManagedView:(tab,view)=>managed[tab]?.has(view)||false,render:(tab,view)=>tab==="merch"&&view==="products"?renderResource("products"):render(tab,view)};
})();
