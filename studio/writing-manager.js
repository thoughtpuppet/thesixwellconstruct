import {createWritingEditor,prepareWritingImage} from "/studio/vendor/writing-editor/editor.js";
import {escapeWriting as esc, normalizeWritingSnapshot, renderWritingDates, WRITING_AUTHOR, WRITING_ROOT, writingHref} from "/shared/writing-content.js";
import "/js/writing-dates.js";

export async function mountWriting(root, api, setStatus) {
  if (root.querySelector("[data-writing-manager]") && window.WritingManager?.mounted) return;
  window.WritingManager?.unmount?.();
  let current = null, editor = null, startedAt = null, dirty = false, busy = false, destroyed = false, entities = [], media = [], requestNumber = 0;
  const controller = new AbortController(), previews = new Map(), previewsPending = new Map();
  const request = (url,method,body) => api(url,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const output = () => root.querySelector("[data-writing-status]");
  const say = message => { if (output()) output().textContent = message; setStatus(message); };
  function showDates() { const target=root.querySelector("[data-writing-entry-dates]");if(target)target.innerHTML=renderWritingDates(current || {startedAt},{studio:true}); }
  function changed() { if(!current && !startedAt){startedAt=new Date().toISOString();showDates();}dirty = true; if (output()) output().textContent = "Unsaved changes"; }
  function canLeave() { if(busy){say("Wait for this save to finish before leaving the entry.");return false;}return !dirty || confirm("Leave this entry without saving your changes?"); }
  function destroyEditor() { editor?.destroy(); editor = null; }
  function unmount() { destroyed = true; destroyEditor(); controller.abort(); previews.forEach(URL.revokeObjectURL); previews.clear(); window.WritingManager.mounted = false; }
  window.WritingManager = {mounted:true,canLeave,unmount};
  window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}},{signal:controller.signal});
  async function imageUrl(mediaId) {
    if (previews.has(mediaId)) return previews.get(mediaId);
    if (previewsPending.has(mediaId)) return previewsPending.get(mediaId);
    const pending = (async()=>{
      const url = mediaId === "writing-layout-sample-image" ? "/api/admin/writing-entries/sample-image" : `/api/admin/media/${encodeURIComponent(mediaId)}/file`;
      const response = await fetch(url,{headers:{authorization:`Bearer ${localStorage.getItem("swc_submissions_admin_token") || ""}`},cache:"no-store",signal:controller.signal});
      if (!response.ok) return "";
      const blob = await response.blob(); if (destroyed) return "";
      const value = URL.createObjectURL(blob); previews.set(mediaId,value); return value;
    })().finally(()=>previewsPending.delete(mediaId));
    previewsPending.set(mediaId,pending); return pending;
  }
  function shell(body) { root.innerHTML = `<section class="construct-manager writing-manager" data-writing-manager><header class="writing-manager-head"><div><h2>Writings · WRKNG*</h2><p>A section of Mindful Darkness.</p></div><a class="button" href="${WRITING_ROOT}" target="_blank" rel="noopener">Open WRKNG*</a></header>${body}</section>`; }
  async function list() {
    const sequence = ++requestNumber; destroyEditor(); current = null; dirty = false; shell('<p role="status">Loading entries…</p>');
    try {
      const payload = await api("/api/admin/writing-entries");
      if (destroyed || sequence !== requestNumber) return;
      shell(`<button class="button" type="button" data-writing-new>New entry</button><ul class="writing-manager-list">${payload.entries.map(entry=>`<li class="writing-manager-card"><h3>${esc(entry.title || "Untitled entry")}</h3><p>${entry.isSample ? "Layout sample · preview only" : esc(entry.state) + (entry.state === "published" && entry.hasUnpublishedChanges ? " · unpublished changes" : "")}</p><div class="writing-dates">${renderWritingDates(entry,{studio:true})}</div><p>${esc(entry.excerpt)}</p><button class="button" type="button" data-writing-open="${esc(entry.id)}">Edit entry</button></li>`).join("")}</ul><p data-writing-status role="status"></p>`);
    } catch(error) { if(!destroyed) shell(`<p role="alert">${esc(error.message)}</p><button class="button" data-writing-list>Try again</button>`); }
  }
  function sourceRow(source = {}) { return `<div class="writing-reference-row" data-source-row><input aria-label="Source label" data-source-label value="${esc(source.label)}" placeholder="Source label" maxlength="240"><input aria-label="Source URL" data-source-url value="${esc(source.url)}" placeholder="Website, email, or /site-path/"><button class="button" type="button" data-source-remove>Remove source</button></div>`; }
  function relatedRow(entityId = "") {
    if(entityId && !entities.some(entity=>entity.id===entityId)) entities.push({id:entityId,title:entityId,route:"/",visibility:"public"});
    return `<div class="writing-reference-row" data-related-row><select aria-label="Related Construct record" data-related-id><option value="">Choose a record</option>${entities.filter(entity=>entity.id!==current?.id && entity.route).map(entity=>`<option value="${esc(entity.id)}" ${entity.id===entityId?"selected":""}>${esc(entity.title)} · ${esc(entity.node?.name || entity.entityType || "")}${entity.visibility!=="public"?" · internal":""}</option>`).join("")}</select><button class="button" type="button" data-related-remove>Remove record</button></div>`;
  }
  function selectedStyle() {
    if (!editor || destroyed) return;
    for (const button of root.querySelectorAll("[data-format]")) {
      const key=button.dataset.format;
      const active=key==="h2"||key==="h3"?editor.isActive("heading",{level:Number(key.slice(1))}):editor.isActive(key);
      button.setAttribute("aria-pressed",String(active));
    }
  }
  function edit(entry = null) {
    destroyEditor(); current=entry; startedAt=entry?.startedAt || null; dirty=false;
    const value=entry?.snapshot || {schemaVersion:1,title:"",author:WRITING_AUTHOR,excerpt:"",body:{type:"doc",content:[{type:"paragraph",content:[]}]},sources:[],relatedIds:[]};
    shell(`<button class="button" type="button" data-writing-list>All entries</button>${entry?.isSample?'<p class="writing-preview-notice">Layout sample · this entry stays private. Create a new entry when you’re ready to publish.</p>':""}
      <div class="writing-dates" data-writing-entry-dates>${renderWritingDates(entry || {},{studio:true})}</div>
      <form data-writing-form><div class="writing-editor-fields"><label class="wide">Title<input name="title" maxlength="240" value="${esc(value.title)}"></label><label>URL name<input name="slug" maxlength="160" pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${esc(entry?.slug)}" ${entry?.firstPublishedAt?"readonly":""}>${entry?.firstPublishedAt?'<span class="cm-field-note">Locked after first publication.</span>':'<span class="cm-field-note">Clear this field and save to regenerate it from the current title.</span>'}</label><label>Author<input name="author" maxlength="160" value="${esc(value.author)}"></label><label class="wide">Excerpt<textarea name="excerpt" maxlength="1000" rows="3">${esc(value.excerpt)}</textarea></label></div>
      <div class="writing-toolbar" role="toolbar" aria-label="Text formatting">${[["paragraph","Paragraph"],["h2","Heading 2"],["h3","Heading 3"],["bold","Bold"],["italic","Italic"],["blockquote","Quote"],["bulletList","Bullet list"],["orderedList","Numbered list"]].map(([key,label])=>`<button class="button" type="button" data-format="${key}" aria-pressed="false">${label}</button>`).join("")}<button class="button" type="button" data-writing-link>Link</button><button class="button" type="button" data-writing-image>Image</button><button class="button" type="button" data-writing-undo>Undo</button><button class="button" type="button" data-writing-redo>Redo</button></div>
      <div data-writing-editor></div>
      <div class="writing-editor-fields"><section class="wide"><h3>Sources</h3><div data-writing-sources>${value.sources.map(sourceRow).join("")}</div><button class="button" type="button" data-source-add>Add source</button></section><section class="wide"><h3>Connected work</h3><div data-writing-related>${value.relatedIds.map(relatedRow).join("")}</div><button class="button" type="button" data-related-add>Add record</button></section></div>
      <div class="writing-editor-actions"><button class="button" type="submit">Save draft</button><button class="button" type="button" data-writing-preview>Preview</button>${!entry?.isSample && entry?.state!=="archived"?`<button class="button" type="button" data-writing-action="publish">${entry?.firstPublishedAt?"Publish updates":"Publish"}</button>`:""}${entry?.state==="published"?'<button class="button" type="button" data-writing-action="unpublish">Unpublish</button>':""}${entry?.state==="archived"?'<button class="button" type="button" data-writing-action="restore">Restore draft</button>':entry&&!entry.isSample?'<button class="button" type="button" data-writing-action="archive">Archive</button>':""}<span class="writing-editor-status" data-writing-status role="status">${entry?"Saved draft":"New entry"}</span></div></form>`);
    editor=createWritingEditor(root.querySelector("[data-writing-editor]"),{content:value.body,imageUrl,onUpdate:changed,onSelection:selectedStyle});
    selectedStyle();
  }
  async function openEntry(entryId) {
    if (!canLeave()) return;
    const sequence=++requestNumber;
    try {
      const [payload,directory]=await Promise.all([api(`/api/admin/writing-entries/${encodeURIComponent(entryId)}`),api("/api/admin/entities")]);
      if(destroyed||sequence!==requestNumber)return;
      entities=directory.entities||directory.records||[]; edit(payload.entry);
    } catch(error) {say(error.message);}
  }
  function serialize() {
    const form=root.querySelector("[data-writing-form]");
    const snapshot=normalizeWritingSnapshot({schemaVersion:1,title:form.elements.title.value,author:form.elements.author.value,excerpt:form.elements.excerpt.value,body:editor.getJSON(),sources:[...root.querySelectorAll("[data-source-row]")].map(row=>({label:row.querySelector("[data-source-label]").value,url:row.querySelector("[data-source-url]").value})).filter(row=>row.label||row.url),relatedIds:[...root.querySelectorAll("[data-related-id]")].map(input=>input.value).filter(Boolean)});
    return {snapshot,slug:form.elements.slug.value,version:current?.version,...(!current && startedAt ? {startedAt} : {})};
  }
  async function save() {
    if (current && !dirty) return current;
    const creating=!current;
    const value=serialize(),payload=await request(`/api/admin/writing-entries${current?`/${encodeURIComponent(current.id)}`:""}`,current?"PATCH":"POST",value);
    current=payload.entry; startedAt=current.startedAt || null; dirty=false;showDates();
    const form=root.querySelector("[data-writing-form]");form.elements.slug.value=current.slug;
    if(creating)root.querySelector(".writing-editor-actions").insertAdjacentHTML("beforeend",'<button class="button" type="button" data-writing-action="archive">Archive</button>');
    say("Draft saved"); return current;
  }
  async function run(action) {
    if(busy)return;busy=true;root.querySelectorAll("button").forEach(button=>button.disabled=true);
    root.querySelectorAll("input,textarea,select").forEach(input=>input.disabled=true);editor?.setEditable(false,false);
    let previewWindow=null;
    // Open synchronously so browser popup protection does not discard a saved preview.
    if(action==="preview")previewWindow=window.open("about:blank","_blank");
    try {
      if(action==="save"||action==="preview"||action==="publish")await save();
      if(action==="preview") { const url=`/studio/writings-preview/?entry=${encodeURIComponent(current.id)}`;if(previewWindow){previewWindow.opener=null;previewWindow.location.href=url;}else say("Preview was blocked by your browser. Allow popups for Studio and try again."); }
      if(["publish","unpublish","archive","restore"].includes(action)) {
        if(dirty)throw new Error("Save your changes before changing publication.");
        const payload=await request(`/api/admin/writing-entries/${encodeURIComponent(current.id)}/${action}`,"POST",{version:current.version});
        edit(payload.entry);say(action==="publish"?"Published. Readers can see this version.":action==="unpublish"?"Unpublished. The entry is now private.":action==="archive"?"Entry archived.":"Restored as a draft.");
      }
    } catch(error) {previewWindow?.close();say(error.message);}
    finally {busy=false;root.querySelectorAll("button,input,textarea,select").forEach(input=>input.disabled=false);editor?.setEditable(true,false);}
  }
  function linkDialog() {
    const existing=editor.getAttributes("link").href||"",dialog=document.createElement("dialog");
    dialog.innerHTML=`<form method="dialog"><h3>Link</h3><label>URL<input name="url" value="${esc(existing)}" placeholder="Website, email, or /site-path/"></label><p data-dialog-status role="status"></p><button class="button" value="cancel">Cancel</button><button class="button" value="remove">Remove link</button><button class="button" value="apply">Apply link</button></form>`;
    root.querySelector("[data-writing-manager]").append(dialog);
    dialog.querySelector("form").addEventListener("submit",event=>{const action=event.submitter.value;if(action==="apply"){const href=writingHref(event.currentTarget.elements.url.value);if(!href){event.preventDefault();dialog.querySelector("[data-dialog-status]").textContent="Enter a valid website, email, or site link.";return;}editor.chain().focus().extendMarkRange("link").setLink({href}).run();}if(action==="remove")editor.chain().focus().unsetLink().run();});
    dialog.addEventListener("close",()=>dialog.remove(),{once:true});dialog.showModal();
  }
  async function prepareManagedImage(file,source,alt,caption) {
    if(source?.privacy==="private")throw new Error("This source image is private. Choose an image cleared for public use.");
    const prepared=await prepareWritingImage(file);
    async function upload(value) {const form=new FormData();form.append("file",value);form.append("alt_text",alt);form.append("caption",caption);form.append("privacy","internal");form.append("public_presentation","hidden");form.append("archive_catalogue_eligible","false");return (await api("/api/admin/media",{method:"POST",body:form})).record;}
    if(!source)source=await upload(file);
    const provenance=(await api(`/api/admin/media-catalogue/${encodeURIComponent(source.id)}`)).record;
    const evidence=Object.fromEntries(Object.entries(prepared.original).filter(([key,value])=>key!=="raw_metadata"&&value));
    await request(`/api/admin/media-catalogue/${encodeURIComponent(source.id)}`,"PATCH",{...evidence,raw_metadata:{...provenance.raw_metadata,writing_source:prepared.original.raw_metadata}});
    const display=await upload(prepared.display);
    if(display.id!==source.id){
      const existing=(await api(`/api/admin/media-catalogue/${encodeURIComponent(display.id)}`)).record;
      await request(`/api/admin/media-catalogue/${encodeURIComponent(display.id)}`,"PATCH",{asset_role:"technical_derivative",metadata_review_state:"redacted",raw_metadata:{...existing.raw_metadata,writing_display:{source_media_id:source.id,width:prepared.width,height:prepared.height,transformation:file.type==="image/gif"?"Animation preserved; textual metadata removed":"Browser-decoded pixels; embedded metadata removed"}}});
    }
    return display;
  }
  async function imageDialog() {
    const selected=editor.isActive("writingImage")?editor.getAttributes("writingImage"):null;
    const dialog=document.createElement("dialog");dialog.innerHTML='<p role="status">Loading the media library…</p>';root.querySelector("[data-writing-manager]").append(dialog);dialog.showModal();
    try {
      const payload=await api("/api/admin/media");media=(payload.records||[]).filter(item=>item.state==="active"&&["image/jpeg","image/png","image/webp","image/gif"].includes(item.mime_type||item.mimeType));
      dialog.innerHTML=`<form><h3>${selected?"Edit image":"Insert image"}</h3><label>Choose an existing image<select name="mediaId"><option value="">Choose an image</option>${selected&&!media.some(item=>item.id===selected.mediaId)?`<option value="${esc(selected.mediaId)}" selected>Current sample image</option>`:""}${media.map(item=>`<option value="${esc(item.id)}" ${selected?.mediaId===item.id?"selected":""}>${esc(item.original_filename||item.originalFilename||item.id)} · ${esc(item.privacy)}</option>`).join("")}</select></label><label>Or upload an image<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><label>Alt text<input name="alt" maxlength="1000" required value="${esc(selected?.alt)}"></label><label>Caption<textarea name="caption" maxlength="2000">${esc(selected?.caption)}</textarea></label><p data-dialog-status role="status"></p><button class="button" type="button" data-image-cancel>Cancel</button>${selected?'<button class="button" type="button" data-image-remove>Remove image</button>':""}<button class="button" type="submit">${selected?"Update image":"Insert image"}</button></form>`;
      const form=dialog.querySelector("form");
      form.querySelector("[data-image-cancel]").onclick=()=>dialog.close();
      form.querySelector("[data-image-remove]")?.addEventListener("click",()=>{editor.chain().focus().deleteSelection().run();dialog.close();});
      form.addEventListener("submit",async event=>{
        event.preventDefault();const button=form.querySelector('[type="submit"]'),status=form.querySelector("[data-dialog-status]");button.disabled=true;
        try {
          let mediaId=form.elements.mediaId.value;const file=form.elements.file.files[0];
          if(file){status.textContent="Preparing image and preserving its original…";const result=await prepareManagedImage(file,null,form.elements.alt.value,form.elements.caption.value);mediaId=result.id;form.elements.file.value="";form.elements.mediaId.add(new Option(result.original_filename,mediaId,true,true));}
          if(!mediaId)throw new Error("Choose or upload an image.");
          if(!file && mediaId!==selected?.mediaId && mediaId!=="writing-layout-sample-image") {
            status.textContent="Preparing image for the reading layout…";
            const source=media.find(item=>item.id===mediaId),blob=await(await fetch(await imageUrl(mediaId))).blob();
            const result=await prepareManagedImage(new File([blob],source.original_filename,{type:source.mime_type}),source,form.elements.alt.value,form.elements.caption.value);mediaId=result.id;
          }
          const attrs={mediaId,alt:form.elements.alt.value,caption:form.elements.caption.value};
          if(selected)editor.chain().focus().updateAttributes("writingImage",attrs).run();else editor.chain().focus().insertContent({type:"writingImage",attrs}).run();
          dialog.close();
        }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
      });
    }catch(error){dialog.innerHTML=`<p role="alert">${esc(error.message)}</p><button class="button" data-image-close>Close</button>`;dialog.querySelector("button").onclick=()=>dialog.close();}
    dialog.addEventListener("close",()=>dialog.remove(),{once:true});
  }
  root.addEventListener("input",event=>{if(event.target.closest("[data-writing-form]")&&!event.target.closest("[data-writing-editor]"))changed();},{signal:controller.signal});
  root.addEventListener("change",event=>{if(event.target.matches("[data-related-id]"))changed();},{signal:controller.signal});
  root.addEventListener("mousedown",event=>{if(event.target.closest("[data-format],[data-writing-undo],[data-writing-redo]"))event.preventDefault();},{signal:controller.signal});
  root.addEventListener("submit",event=>{if(event.target.matches("[data-writing-form]")){event.preventDefault();run("save");}},{signal:controller.signal});
  root.addEventListener("click",async event=>{
    const button=event.target.closest("button");if(!button||busy)return;
    if(button.hasAttribute("data-writing-new")){if(!canLeave())return;try{const directory=await api("/api/admin/entities");entities=directory.entities||directory.records||[];edit();}catch(error){say(error.message);}return;}
    if(button.hasAttribute("data-writing-list")){if(canLeave())list();return;}
    if(button.dataset.writingOpen){openEntry(button.dataset.writingOpen);return;}
    if(button.hasAttribute("data-writing-preview")){run("preview");return;}
    if(button.dataset.writingAction){run(button.dataset.writingAction);return;}
    if(button.hasAttribute("data-source-add")){root.querySelector("[data-writing-sources]").insertAdjacentHTML("beforeend",sourceRow());changed();}
    if(button.hasAttribute("data-source-remove")){button.closest("[data-source-row]").remove();changed();}
    if(button.hasAttribute("data-related-add")){root.querySelector("[data-writing-related]").insertAdjacentHTML("beforeend",relatedRow());changed();}
    if(button.hasAttribute("data-related-remove")){button.closest("[data-related-row]").remove();changed();}
    if(button.hasAttribute("data-writing-link")){linkDialog();return;}
    if(button.hasAttribute("data-writing-image")){imageDialog();return;}
    if(button.hasAttribute("data-writing-undo"))editor.chain().focus().undo().run();
    if(button.hasAttribute("data-writing-redo"))editor.chain().focus().redo().run();
    const format=button.dataset.format;if(!format)return;const chain=editor.chain().focus();
    if(format==="paragraph")chain.setParagraph().run();
    else if(format==="h2"||format==="h3")chain.toggleHeading({level:Number(format.slice(1))}).run();
    else ({bold:()=>chain.toggleBold().run(),italic:()=>chain.toggleItalic().run(),blockquote:()=>chain.toggleBlockquote().run(),bulletList:()=>chain.toggleBulletList().run(),orderedList:()=>chain.toggleOrderedList().run()})[format]?.();
  },{signal:controller.signal});
  await list();
}
