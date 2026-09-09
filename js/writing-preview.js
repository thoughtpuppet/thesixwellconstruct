import {renderWritingEntry, writingBreadcrumb, escapeWriting as esc} from "/shared/writing-content.js";
const mount = document.querySelector("[data-writing-preview]"), urls = [];
async function open() {
  const id = new URL(location.href).searchParams.get("entry"), token = localStorage.getItem("swc_submissions_admin_token");
  if (!token || !id) { mount.innerHTML = '<p class="writing-empty">Open a saved draft from <a href="/studio/submissions/">Studio</a> to preview it.</p>'; return; }
  try {
    const headers = {authorization:`Bearer ${token}`};
    const response = await fetch(`/api/admin/writing-entries/${encodeURIComponent(id)}/preview`, {headers,cache:"no-store"});
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The draft could not be opened.");
    const record = payload.entry;
    for (const asset of record.media) {
      const result = await fetch(asset.url, {headers,cache:"no-store"});
      if (!result.ok) { asset.url = ""; continue; }
      asset.url = URL.createObjectURL(await result.blob()); urls.push(asset.url);
    }
    document.title = `${record.snapshot.title} · Draft preview · WRKNG*`;
    const breadcrumb=document.querySelector(".construct-breadcrumb"),template=document.createElement("template");
    template.innerHTML=writingBreadcrumb(record.snapshot.title);
    if(breadcrumb)breadcrumb.innerHTML=template.content.firstElementChild.innerHTML;
    else mount.before(template.content);
    mount.innerHTML = renderWritingEntry(record, {preview:true});
  } catch (error) { mount.innerHTML = `<p class="writing-empty" role="alert">${esc(error.message)}</p><a href="/studio/submissions/">Return to Studio</a>`; }
}
window.addEventListener("pagehide", () => urls.forEach(URL.revokeObjectURL));
open();
