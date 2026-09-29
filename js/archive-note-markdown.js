(function(global){
  "use strict";
  const escape=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  // Verified Apple Notes drawing export: presentation only, never alter the source asset.
  const adaptiveDrawings=new Set(['media-72ee85ed-4c78-4571-b742-5e0c3533cdd2']);
  const themeKey='archive-note-reader-theme';
  function preferredTheme(){try{return localStorage.getItem(themeKey)==='light'?'light':'dark'}catch{return 'dark'}}
  function setReaderTheme(theme){
    theme=theme==='light'?'light':'dark';try{localStorage.setItem(themeKey,theme)}catch{}
    document.querySelectorAll('[data-note-theme]').forEach(reader=>{reader.dataset.noteTheme=theme;reader.querySelectorAll('[data-note-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.noteThemeChoice===theme)));});
  }
  function bindReaders(root){
    const readers=[...(root.matches?.('.archive-note-reader')?[root]:[]),...root.querySelectorAll('.archive-note-reader')];
    for(const reader of readers){
      if(reader.querySelector(':scope > .archive-note-reader-toolbar'))continue;
      reader.dataset.noteTheme=reader.dataset.noteTheme||preferredTheme();
      const toolbar=document.createElement('div');toolbar.className='archive-note-reader-toolbar';toolbar.dataset.retroIgnore='';
      toolbar.innerHTML='<div class="archive-note-appearance" role="group" aria-label="Note appearance"><button type="button" data-note-theme-choice="light" aria-label="Light note appearance">Light</button><button type="button" data-note-theme-choice="dark" aria-label="Dark note appearance">Dark</button></div>';
      toolbar.querySelectorAll('button').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.noteThemeChoice===reader.dataset.noteTheme));button.addEventListener('click',()=>setReaderTheme(button.dataset.noteThemeChoice));});
      reader.prepend(toolbar);
    }
  }
  function safeHref(value){
    const href=String(value||"").trim();
    if(href.startsWith("/")&&!href.startsWith("//"))return href;
    try{const parsed=new URL(href,location.origin);return["http:","https:","mailto:"].includes(parsed.protocol)?href:""}catch{return""}
  }
  function inline(value){
    let source=String(value||""),output="",cursor=0;
    const pattern=/\[([^\]]+)\]\(([^)]+)\)/g;let match;
    while((match=pattern.exec(source))){output+=escape(source.slice(cursor,match.index));const href=safeHref(match[2]);output+=href?`<a href="${escape(href)}"${/^https?:/i.test(href)?' rel="noopener"':""}>${escape(match[1])}</a>`:escape(match[0]);cursor=pattern.lastIndex}
    output+=escape(source.slice(cursor));
    return output.replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/__([^_]+)__/g,"<strong>$1</strong>").replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g,"$1<em>$2</em>");
  }
  function assetFigure(asset){
    if(!asset)return'<p class="archive-note-missing-asset" role="note">An attached asset is unavailable.</p>';
    const mime=String(asset.mime_type||asset.mimeType||""),url=String(asset.url||'').startsWith('blob:')?String(asset.url):safeHref(asset.url),alt=asset.alt_text||asset.altText||"";
    if(!url)return'<p class="archive-note-missing-asset" role="note">An attached asset is unavailable.</p>';
    const drawing=adaptiveDrawings.has(asset.media_id||asset.mediaId),media=mime.startsWith("image/")?`<button class="archive-note-asset-trigger" type="button" data-note-image-trigger data-note-image-media="${escape(asset.media_id||asset.mediaId||'')}" data-note-image-src="${escape(url)}" data-note-image-alt="${escape(alt)}" data-note-drawing="${drawing}" aria-label="Open full-size image${alt?`: ${escape(alt)}`:""}"><img src="${escape(url)}" alt="${escape(alt)}" loading="lazy" decoding="async"></button>`:`<a class="archive-button" href="${escape(url)}">Open ${escape(asset.original_filename||asset.originalFilename||"attachment")}</a>`;
    const recording=/^(audio|video)\//.test(mime)?`<${mime.split('/')[0]} controls preload="metadata" src="${escape(url)}"></${mime.split('/')[0]}>`:media;
    return `<figure class="archive-note-asset" data-retro-media="${escape(asset.media_id||asset.mediaId||'')}" data-note-asset="${escape(asset.token||asset.asset_token||"")}">${recording}<span class="archive-note-image-comments" data-retro-label></span></figure>`;
  }
  function drawingDarkFilter(){
    if(document.getElementById('archive-note-drawing-dark'))return;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width','0');svg.setAttribute('height','0');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.style.position='absolute';svg.style.pointerEvents='none';
    // Reference PNG is Display P3: its dominant blue converts to sRGB #297fff.
    // Keep the established black paper/red ink, then tint only blue-dominant
    // pixels. The source PNG, light appearance and photographs stay untouched.
    svg.innerHTML='<defs><filter id="archive-note-drawing-dark" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feComponentTransfer in="SourceGraphic" result="inverted"><feFuncR type="table" tableValues="1 0"/><feFuncG type="table" tableValues="1 0"/><feFuncB type="table" tableValues="1 0"/></feComponentTransfer><feColorMatrix in="inverted" type="hueRotate" values="180" result="dark"/><feColorMatrix in="dark" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.687 0 0.687 0 0" result="blue-mask"/><feFlood flood-color="#0056ff" result="blue-ink"/><feComposite in="blue-ink" in2="blue-mask" operator="in" result="blue-tint"/><feComposite in="blue-tint" in2="dark" operator="over"/></filter></defs>';
    document.body.append(svg);
  }
  function imageDialog(){
    let dialog=document.querySelector("#archive-note-image-dialog");
    if(dialog)return dialog;
    dialog=document.createElement("dialog");dialog.id="archive-note-image-dialog";dialog.className="archive-note-image-dialog";dialog.setAttribute("aria-labelledby","archive-note-image-dialog-title");
    dialog.innerHTML='<div class="archive-note-image-dialog-shell"><header><span class="archive-note-sr-only" id="archive-note-image-dialog-title">Full-size Note image</span><div class="archive-note-zoom-tools" role="group" aria-label="Image zoom"><button type="button" data-note-zoom-out aria-label="Zoom out">−</button><button type="button" data-note-zoom-reset aria-label="Fit image">Fit</button><button type="button" data-note-zoom-in aria-label="Zoom in">+</button><output data-note-zoom-status aria-live="polite">100%</output></div><span class="archive-note-image-comments" data-retro-label></span><button type="button" data-note-image-close>Close</button></header><div class="archive-note-image-dialog-media" tabindex="0" role="region" aria-label="Zoomable image. Use plus and minus to zoom, arrow keys to pan, or pinch and drag."><div class="archive-note-zoom-stage"><img data-note-image-full alt="" draggable="false"></div></div></div>';
    document.body.append(dialog);let lastTrigger=null,zoom=1,baseWidth=0,baseHeight=0,opening=0;
    const close=dialog.querySelector('[data-note-image-close]'),image=dialog.querySelector('[data-note-image-full]'),viewport=dialog.querySelector('.archive-note-image-dialog-media'),stage=dialog.querySelector('.archive-note-zoom-stage'),commentSlot=dialog.querySelector('[data-retro-label]'),status=dialog.querySelector('[data-note-zoom-status]'),minus=dialog.querySelector('[data-note-zoom-out]'),plus=dialog.querySelector('[data-note-zoom-in]');
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
    function draw(){
      const width=baseWidth*zoom,height=baseHeight*zoom,left=Math.max(0,(viewport.clientWidth-width)/2),top=Math.max(0,(viewport.clientHeight-height)/2);
      stage.style.width=`${Math.max(viewport.clientWidth,width)}px`;stage.style.height=`${Math.max(viewport.clientHeight,height)}px`;
      image.style.width=`${width}px`;image.style.height=`${height}px`;image.style.left=`${left}px`;image.style.top=`${top}px`;
      status.textContent=`${Math.round(zoom*100)}%`;minus.disabled=zoom<=1;plus.disabled=zoom>=8;viewport.dataset.zoomed=String(zoom>1);
      return {left,top};
    }
    function changeZoom(next,x=viewport.clientWidth/2,y=viewport.clientHeight/2){
      if(!baseWidth)return;
      const oldLeft=Math.max(0,(viewport.clientWidth-baseWidth*zoom)/2),oldTop=Math.max(0,(viewport.clientHeight-baseHeight*zoom)/2),ix=(viewport.scrollLeft+x-oldLeft)/zoom,iy=(viewport.scrollTop+y-oldTop)/zoom;
      zoom=clamp(next,1,8);const offset=draw();viewport.scrollLeft=ix*zoom+offset.left-x;viewport.scrollTop=iy*zoom+offset.top-y;
    }
    function fit(){if(!dialog.open||!image.naturalWidth)return;const scale=Math.min(viewport.clientWidth/image.naturalWidth,viewport.clientHeight/image.naturalHeight,1);baseWidth=image.naturalWidth*scale;baseHeight=image.naturalHeight*scale;zoom=1;draw();viewport.scrollTo(0,0);}
    image.addEventListener('load',fit);image.addEventListener('error',()=>{status.textContent='Image unavailable';});
    minus.addEventListener('click',()=>changeZoom(zoom/1.5));plus.addEventListener('click',()=>changeZoom(zoom*1.5));dialog.querySelector('[data-note-zoom-reset]').addEventListener('click',fit);
    viewport.addEventListener('dblclick',event=>{const r=viewport.getBoundingClientRect();changeZoom(zoom>1?1:2,event.clientX-r.left,event.clientY-r.top);});
    viewport.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();const r=viewport.getBoundingClientRect();changeZoom(zoom*Math.exp(-event.deltaY*.01),event.clientX-r.left,event.clientY-r.top);}},{passive:false});
    viewport.addEventListener('keydown',event=>{if(['+','=','-','0','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();if(event.key==='0')fit();else if(['+','=','-'].includes(event.key))changeZoom(zoom*(event.key==='-'?1/1.5:1.5));else viewport.scrollBy(event.key==='ArrowLeft'?-60:event.key==='ArrowRight'?60:0,event.key==='ArrowUp'?-60:event.key==='ArrowDown'?60:0);}});
    const pointers=new Map();let gesture=null;
    function resetGesture(){const points=[...pointers.values()];gesture=points.length===2?{distance:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),zoom}:null;}
    viewport.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});viewport.setPointerCapture(event.pointerId);resetGesture();});
    viewport.addEventListener('pointermove',event=>{const previous=pointers.get(event.pointerId);if(!previous)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const points=[...pointers.values()];if(points.length===2&&gesture?.distance){const r=viewport.getBoundingClientRect();changeZoom(gesture.zoom*Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)/gesture.distance,(points[0].x+points[1].x)/2-r.left,(points[0].y+points[1].y)/2-r.top);}else if(zoom>1){viewport.scrollLeft-=event.clientX-previous.x;viewport.scrollTop-=event.clientY-previous.y;}});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(name,event=>{pointers.delete(event.pointerId);resetGesture();});
    let viewportSize='';
    new ResizeObserver(()=>{const r=viewport.getBoundingClientRect(),size=`${r.width}:${r.height}`;if(size!==viewportSize){viewportSize=size;if(dialog.open)fit();}}).observe(viewport);
    dialog.openImage=trigger=>{
      const ticket=++opening;lastTrigger=trigger;zoom=1;baseWidth=0;baseHeight=0;pointers.clear();gesture=null;image.removeAttribute('style');stage.removeAttribute('style');commentSlot.replaceChildren();
      dialog.dataset.noteTheme=trigger.closest('[data-note-theme]')?.dataset.noteTheme||preferredTheme();image.dataset.noteDrawing=trigger.dataset.noteDrawing||'false';
      image.alt=trigger.dataset.noteImageAlt||'';dialog.dataset.retroMedia=trigger.dataset.noteImageMedia||'';status.textContent='Loading image';
      image.src=trigger.dataset.noteImageSrc||'';dialog.showModal();document.body.classList.add('archive-note-image-open');if(image.complete)fit();close.focus();
      import('/js/archive-comments.js').then(({mountComments})=>{if(dialog.open&&ticket===opening)mountComments(dialog,trigger.retrospectiveComments||[]);});
    };
    close.addEventListener("click",()=>dialog.close());dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close()});dialog.addEventListener("close",()=>{opening++;pointers.clear();document.body.classList.remove("archive-note-image-open");image.removeAttribute("src");lastTrigger?.focus()});
    return dialog;
  }
  function bindImageLightboxes(root=document){
    bindReaders(root);
    drawingDarkFilter();
    const dialog=imageDialog();root.querySelectorAll("[data-note-image-trigger]:not([data-note-image-bound])").forEach(trigger=>{trigger.dataset.noteImageBound="true";trigger.addEventListener("click",()=>dialog.openImage(trigger))});
  }
  function render(markdown,assets=[],noteId=''){
    const byToken=new Map(assets.map(asset=>[String(asset.token||asset.asset_token||"").toLowerCase(),asset])),lines=String(markdown||"").replace(/\r\n?/g,"\n").split("\n"),blocks=[];
    for(let index=0;index<lines.length;){const line=lines[index],trimmed=line.trim();if(!trimmed){index+=1;continue}
      const token=trimmed.match(/^\{\{asset:([a-z0-9-]+)\}\}$/i);if(token){blocks.push(assetFigure(byToken.get(token[1].toLowerCase())));index+=1;continue}
      const heading=trimmed.match(/^(#{1,4})\s+(.+)$/);if(heading){const level=Math.min(4,heading[1].length+1);blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);index+=1;continue}
      if(/^[-*+]\s+/.test(trimmed)){const items=[];while(index<lines.length&&/^[-*+]\s+/.test(lines[index].trim())){items.push(`<li>${inline(lines[index].trim().replace(/^[-*+]\s+/,""))}</li>`);index+=1}blocks.push(`<ul>${items.join("")}</ul>`);continue}
      if(/^>\s?/.test(trimmed)){const quotes=[];while(index<lines.length&&/^>\s?/.test(lines[index].trim())){quotes.push(lines[index].trim().replace(/^>\s?/,""));index+=1}blocks.push(`<blockquote>${quotes.map(inline).join("<br>")}</blockquote>`);continue}
      const paragraph=[];while(index<lines.length){const candidate=lines[index].trim();if(!candidate||/^\{\{asset:[a-z0-9-]+\}\}$/i.test(candidate)||/^(#{1,4})\s+/.test(candidate)||/^[-*+]\s+/.test(candidate)||/^>\s?/.test(candidate))break;paragraph.push(candidate);index+=1}blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    }
    return `<div class="archive-note-content"${noteId?` data-retro-kind="note" data-retro-id="${escape(noteId)}" data-retro-field="body_markdown"`:''}>${blocks.join('')}</div>`;
  }
  function stripFrontmatter(markdown){return String(markdown||"").replace(/^---\s*\n[\s\S]*?\n---\s*\n?/,"")}
  async function bindRetrospectiveComments(root,payload){const {mountComments}=await import('/js/archive-comments.js');const comments=payload.retrospective_comments||[];root.querySelectorAll('[data-note-image-trigger]').forEach(trigger=>{trigger.retrospectiveComments=comments.filter(c=>c.target_kind==='media'&&c.target_id===trigger.dataset.noteImageMedia);});mountComments(root,comments);}
  global.ArchiveNoteMarkdown={render,stripFrontmatter,escape,safeHref,bindImageLightboxes,bindRetrospectiveComments};
})(window);
