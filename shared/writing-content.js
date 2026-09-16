// The editor, server, and preview share this deliberately small document format.
export const WRITING_ROOT = "/writings/mindful-darkness/wrkng/";
export const WRITING_AUTHOR = "Saiel Dauhn Solehman";
export const escapeWriting = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
export function writingHref(value) {
  let url = String(value || "").trim();
  if (!url || /[\u0000-\u001f\u007f\\]/.test(url)) return "";
  if (/^(?:\/(?!\/)|[?#])/.test(url)) return url.replaceAll(" ", "%20");
  if (url.startsWith("//")) url = `https:${url}`;
  if (/^[^\s@/:?#]+@[^\s@/:?#]+\.[^\s@/:?#]+(?:\?[^#]*)?$/.test(url)) url = `mailto:${url}`;
  // A pasted domain is a website address; the author need not supply its protocol.
  const hasProtocol = /^[a-z][a-z\d+.-]*:/i.test(url) && !/^[^/?#@:]+:\d+(?:[/?#]|$)/.test(url);
  try {
    const parsed = new URL(hasProtocol ? url : `https://${url}`);
    if (!["https:","http:","mailto:"].includes(parsed.protocol)) return "";
    if (!hasProtocol && (parsed.username || parsed.password || !(parsed.hostname.includes(".") || parsed.hostname === "localhost" || parsed.hostname.startsWith("[")))) return "";
    return parsed.href;
  } catch { return ""; }
}
function string(value, label, max) {
  if (typeof value !== "string" || value.length > max) throw new Error(`${label} must be text of ${max} characters or fewer.`);
  return value;
}
function keys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("The entry contains unsupported formatting.");
}
export function normalizeWritingSnapshot(input) {
  keys(input, ["schemaVersion","title","author","excerpt","body","sources","relatedIds","connections"]);
  if (input.schemaVersion !== 1) throw new Error("Unsupported writing document version.");
  let count = 0;
  function node(item, parent = "", depth = 0) {
    if (++count > 12000 || depth > 16) throw new Error("This entry is too complex. Split it into smaller pieces.");
    keys(item, ["type","attrs","content","text","marks"]);
    const type = item.type;
    const blocks=["paragraph","heading","blockquote","bulletList","orderedList","writingImage"];
    const children = {doc:blocks,paragraph:["text","hardBreak"],heading:["text","hardBreak"],blockquote:blocks,bulletList:["listItem"],orderedList:["listItem"],listItem:blocks};
    if (parent ? !children[parent]?.includes(type) : type !== "doc") throw new Error("The entry contains an unsupported block.");
    const output = {type};
    if (type === "text") {
      output.text = string(item.text, "Paragraph text", 100000);
      if (!output.text) throw new Error("Empty text nodes are not supported.");
      if (item.marks) {
        if (!Array.isArray(item.marks) || item.marks.length > 3) throw new Error("Invalid text formatting.");
        output.marks = item.marks.map(mark => {
          keys(mark, ["type","attrs"]);
          if (["bold","italic"].includes(mark.type)) { if (mark.attrs && Object.keys(mark.attrs).length) throw new Error("Unsupported formatting attributes."); return {type:mark.type}; }
          if (mark.type !== "link") throw new Error("Unsupported text formatting.");
          keys(mark.attrs, ["href","target","rel","class","title"]);
          const href = writingHref(mark.attrs.href);
          if (!href) throw new Error("Use a valid website, email, or site link.");
          return {type:"link",attrs:{href}};
        });
      }
    } else if (item.text !== undefined || (item.marks !== undefined && type!=="hardBreak")) throw new Error("Text formatting belongs inside paragraphs.");
    // Tiptap carries inline marks across a soft line break; the break needs no wrapper.
    if(type==="hardBreak" && item.marks) node({type:"text",text:" ",marks:item.marks},"paragraph",depth);
    if (type === "heading") {
      keys(item.attrs, ["level"]);
      if (![2,3].includes(item.attrs.level)) throw new Error("Use Heading 2 or Heading 3.");
      output.attrs = {level:item.attrs.level};
    } else if (type === "orderedList") {
      keys(item.attrs || {}, ["start","type"]);
      const start = item.attrs?.start ?? 1;
      if (!Number.isSafeInteger(start) || start < 1 || start > 10000) throw new Error("Invalid list start.");
      output.attrs = {start};
    } else if (type === "writingImage") {
      keys(item.attrs, ["mediaId","alt","caption"]);
      const mediaId = string(item.attrs.mediaId, "Image identifier", 200);
      if (!/^[a-zA-Z0-9_-]+$/.test(mediaId)) throw new Error("Choose an image from the media library.");
      output.attrs = {mediaId,alt:string(item.attrs.alt || "", "Alt text", 1000),caption:string(item.attrs.caption || "", "Caption", 2000)};
    } else if (item.attrs && Object.keys(item.attrs).length) throw new Error("Unsupported block attributes.");
    if (children[type]) {
      if (item.content !== undefined && !Array.isArray(item.content)) throw new Error("Invalid entry content.");
      output.content = (item.content || []).map(child => node(child, type, depth + 1));
      if (["bulletList","orderedList","listItem"].includes(type) && !output.content.length) throw new Error("Lists must contain an item.");
      if (type === "listItem" && output.content[0].type !== "paragraph") throw new Error("A list item must start with a paragraph.");
    } else if (item.content !== undefined) throw new Error("Invalid nested content.");
    return output;
  }
  const legacyRelated = input.relatedIds ?? [];
  if (!Array.isArray(input.sources) || input.sources.length > 50 || !Array.isArray(legacyRelated) || legacyRelated.length > 30) throw new Error("Use up to 50 sources and 30 related records.");
  const rawConnections = input.connections === undefined
    ? legacyRelated.map(targetId => ({targetId,relationshipTypeId:"rel-related-to",note:""}))
    : input.connections;
  if (!Array.isArray(rawConnections) || rawConnections.length > 30) throw new Error("Use up to 30 Construct connections.");
  const connectionKeys = new Set();
  const connections = rawConnections.map(connection => {
    keys(connection,["targetId","relationshipTypeId","note"]);
    const targetId=string(connection.targetId,"Connected record",200).trim();
    const relationshipTypeId=string(connection.relationshipTypeId || "rel-related-to","Relationship type",200).trim();
    const note=string(connection.note || "","Connection note",1000).trim();
    if(!targetId || !relationshipTypeId || !/^[a-zA-Z0-9_-]+$/.test(targetId) || !/^[a-zA-Z0-9_-]+$/.test(relationshipTypeId)) throw new Error("Choose a valid Construct record and relationship type.");
    const key=`${targetId}\u0000${relationshipTypeId}`;
    if(connectionKeys.has(key)) throw new Error("Each Construct record and relationship type may be connected once.");
    connectionKeys.add(key);
    return {targetId,relationshipTypeId,note};
  });
  const snapshot = {
    schemaVersion:1,
    title:string(input.title, "Title", 240).trim(),
    author:string(input.author || WRITING_AUTHOR, "Author", 160).trim() || WRITING_AUTHOR,
    excerpt:string(input.excerpt || "", "Excerpt", 1000).trim(),
    body:node(input.body),
    sources:input.sources.map(source => {
      keys(source, ["label","url"]);
      const label = string(source.label, "Source label", 240).trim(), url = writingHref(source.url);
      if (!label || !url) throw new Error("Each source needs a label and a valid link.");
      return {label,url};
    }),
    connections,
    relatedIds:[...new Set(connections.map(connection => connection.targetId))],
  };
  if (JSON.stringify(snapshot).length > 200000) throw new Error("Keep the entry below 200,000 characters.");
  return snapshot;
}
export function writingImages(snapshot) {
  const images = [];
  function visit(node) { if (node.type === "writingImage") images.push(node.attrs); (node.content || []).forEach(visit); }
  visit(snapshot.body);
  return images;
}
export function writingPlainText(snapshot) {
  const parts = [];
  function visit(node) { if (node.text) parts.push(node.text); if (node.type === "writingImage") parts.push(node.attrs.caption); (node.content || []).forEach(visit); }
  visit(snapshot.body);
  return parts.filter(Boolean).join(" ");
}
export function renderWritingBody(snapshot, media = []) {
  const assets = new Map(media.map(item => [item.id,item]));
  const esc = escapeWriting;
  function render(node) {
    const content = (node.content || []).map(render).join("");
    if (node.type === "text") return (node.marks || []).reduce((html, mark) => mark.type === "bold" ? `<strong>${html}</strong>` : mark.type === "italic" ? `<em>${html}</em>` : `<a href="${esc(writingHref(mark.attrs.href))}" rel="noopener">${html}</a>`, esc(node.text));
    if (node.type === "hardBreak") return "<br>";
    if (node.type === "doc") return content;
    if (node.type === "writingImage") {
      const asset = assets.get(node.attrs.mediaId);
      // Blob URLs are supplied only by the authenticated preview after fetching media.
      const url = asset?.url?.startsWith("blob:") ? asset.url : writingHref(asset?.url);
      if (!url) return '<p class="writing-image-unavailable">Image unavailable.</p>';
      return `<figure class="writing-image"><img src="${esc(url)}" alt="${esc(node.attrs.alt)}"${asset.width && asset.height ? ` width="${Number(asset.width)}" height="${Number(asset.height)}"` : ""} loading="lazy" decoding="async">${node.attrs.caption ? `<figcaption>${esc(node.attrs.caption)}</figcaption>` : ""}</figure>`;
    }
    const tag = {paragraph:"p",heading:`h${node.attrs?.level}`,blockquote:"blockquote",bulletList:"ul",orderedList:"ol",listItem:"li"}[node.type];
    return tag ? `<${tag}${node.type === "orderedList" ? ` start="${node.attrs.start}"` : ""}>${content}</${tag}>` : "";
  }
  return render(snapshot.body);
}
export function writingDate(value, {includeTime = false} = {}) {
  if (!value) return "";
  // SQLite's legacy datetime('now') strings are UTC, even without a suffix.
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ","T")}Z` : value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", {month:"long",day:"numeric",year:"numeric",timeZone:"America/New_York",...(includeTime ? {hour:"numeric",minute:"2-digit",timeZoneName:"short"} : {})}).format(date);
}
export function renderWritingDates(record, {studio = false} = {}) {
  const esc = escapeWriting;
  const time = (value,includeTime = true) => `<time datetime="${esc(/^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(" ","T")}Z` : value)}">${writingDate(value,{includeTime})}</time>`;
  const dates = [[record.startedAt ? "Created" : "First saved",record.startedAt || record.firstSavedAt]];
  if (studio) dates.push(["Last draft saved",record.draftSavedAt]);
  dates.push(["Published",record.firstPublishedAt]);
  if (record.publishedUpdatedAt && record.publishedUpdatedAt !== record.firstPublishedAt) dates.push(["Publication updated",record.publishedUpdatedAt]);
  const details = dates.filter(([,value])=>writingDate(value)).map(([label,value])=>`<div><dt>${label}</dt><dd>${time(value)}</dd></div>`).join("");
  return `<span class="writing-published">${record.firstPublishedAt ? `Published ${time(record.firstPublishedAt,false)}` : "Unpublished draft"}</span>${details ? `<details class="writing-date-info" data-writing-dates><summary aria-label="Creation and publication dates" title="Writing dates"><span aria-hidden="true">ⓘ</span></summary><div class="writing-date-panel"><dl>${details}</dl></div></details>` : ""}`;
}
export function renderWritingEntry(record, {preview = false} = {}) {
  const esc = escapeWriting, snapshot = record.snapshot;
  return `${preview ? '<p class="writing-preview-notice" role="status">Draft preview · visible only in Studio</p>' : ""}
    <section class="venture-hero site-hero site-hero--supporting writing-entry-hero" aria-labelledby="page-title">
      <div><span class="venture-kicker">Mindful Darkness / WRKNG*</span><h1 class="venture-title hero-title" id="page-title">${esc(snapshot.title)}</h1></div>
      <div class="hero-copy"><p class="hero-descriptor">${esc(snapshot.excerpt || "Notes on things I’m still figuring out.")}</p></div>
    </section>
    <article class="writing-reader" aria-labelledby="page-title">
      <div class="writing-meta"><p class="writing-byline">${esc(snapshot.author)}${record.firstPublishedAt ? "" : " · Draft"}</p><div class="writing-dates">${renderWritingDates(record,{studio:preview})}</div></div>
      <div class="writing-body">${renderWritingBody(snapshot, record.media)}</div>
      ${snapshot.sources.length ? `<section class="writing-sources" aria-labelledby="writing-sources-title"><h2 id="writing-sources-title">Sources</h2><ol>${snapshot.sources.map(source => `<li><a href="${esc(source.url)}" rel="noopener">${esc(source.label)}</a></li>`).join("")}</ol></section>` : ""}
      ${renderWritingConnections(record.related || [],{title:"Connections from this writing",className:"writing-related"})}
      <p class="writing-footnote">*working. subject to change.</p>
      <a class="venture-link" href="${WRITING_ROOT}">All WRKNG* entries</a>
    </article>
    ${preview ? "" : renderWritingConversation(record)}`;
}

function youtubeEmbed(value) {
  const videoId=String(value || "");
  return /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? `https://www.youtube-nocookie.com/embed/${videoId}` : "";
}

export function renderWritingConnections(connections = [], {title="Official connections",className="writing-connections"} = {}) {
  if(!connections.length)return "";
  const esc=escapeWriting;
  return `<section class="${esc(className)} writing-connections" aria-label="${esc(title)}"><h2>${esc(title)}</h2><div class="writing-connection-grid">${connections.map(item=>`<a class="writing-connection-card" href="${esc(item.route)}"><span class="writing-connection-label">${esc(item.relationshipLabel || "Related to")}</span><strong>${esc(item.title)}</strong>${item.kindLabel?`<span>${esc(item.kindLabel)}</span>`:""}${item.note?`<p>${esc(item.note)}</p>`:""}</a>`).join("")}</div></section>`;
}

export function renderWritingResponse(response) {
  const esc=escapeWriting,author=response.authorKind==="author";
  const attachments=(response.attachments||[]).map(item=>item.kind==="image"
    ? `<figure class="writing-response-image"><a href="${esc(item.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(item.filename)}"><img src="${esc(item.url)}" alt="" loading="lazy" decoding="async"></a><figcaption>${esc(item.filename)}</figcaption></figure>`
    : `<a class="writing-file-card" href="${esc(item.url)}" download><span aria-hidden="true">↧</span><span><strong>${esc(item.filename)}</strong><small>${esc(item.mimeType)} · ${Number(item.byteSize||0).toLocaleString("en-US")} bytes</small></span></a>`).join("");
  const links=(response.links||[]).map(link=>{
    const embed=link.kind==="youtube"?youtubeEmbed(link.youtubeId):"";
    return embed?`<div class="writing-youtube"><iframe src="${esc(embed)}" title="YouTube material shared by ${esc(response.authorName)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe><a href="${esc(link.url)}" target="_blank" rel="noopener">Open on YouTube</a></div>`:`<a class="writing-link-card" href="${esc(link.url)}" target="_blank" rel="noopener"><span>External link</span><strong>${esc(link.label || link.url)}</strong></a>`;
  }).join("");
  const responseConnections=renderWritingConnections(response.connections||[],{title:"Connections from this response",className:"writing-response-connections"});
  const replies=(response.replies||[]).map(renderWritingResponse).join("");
  return `<article class="writing-response${author?" writing-response--author":""}" data-response-id="${esc(response.id)}"><header><div><strong>${esc(response.authorName)}</strong>${author?'<span class="writing-author-badge">Author response</span>':""}</div><time datetime="${esc(response.createdAt)}">${esc(writingDate(response.createdAt,{includeTime:true}))}</time></header>${response.body?`<div class="writing-response-body">${esc(response.body).replace(/\r?\n/g,"<br>")}</div>`:""}${attachments?`<div class="writing-response-attachments">${attachments}</div>`:""}${links?`<div class="writing-response-links">${links}</div>`:""}${responseConnections}${replies?`<div class="writing-author-replies">${replies}</div>`:""}</article>`;
}

export function renderWritingConversation(record) {
  const esc=escapeWriting,responses=record.responses||[];
  return `<section class="writing-conversation" aria-labelledby="writing-response-title" data-writing-conversation data-entry-slug="${esc(record.slug)}"><div class="writing-conversation-head"><p class="venture-kicker">Conversation as continuation</p><h2 id="writing-response-title">Respond / Extend</h2><p>React to the writing, carry an idea further, or place another material beside it.</p></div><form class="writing-response-form" data-writing-response-form enctype="multipart/form-data"><div class="writing-response-fields"><label>Name or alias<input name="authorName" maxlength="160" autocomplete="name" required></label><label class="writing-response-wide">Written response<textarea name="body" rows="7" maxlength="12000" placeholder="Respond to the writing, extend it, or do both."></textarea></label><label class="writing-response-wide">Images or files<input name="attachments" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"><span>Up to 4 files, 10 MB each. Images, PDF, text, DOC, or DOCX.</span></label><div class="writing-upload-preview writing-response-wide" data-writing-upload-preview></div><fieldset class="writing-response-wide"><legend>External or YouTube links</legend><div data-writing-link-fields><div class="writing-link-input"><input name="links" type="url" placeholder="https://…" aria-label="External or YouTube link"><button type="button" data-writing-link-remove aria-label="Remove link">Remove</button></div></div><button type="button" class="venture-link" data-writing-link-add>Add another link</button></fieldset><label class="writing-response-honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><div class="writing-response-wide writing-turnstile" data-writing-turnstile><p>Loading verification…</p></div></div><div class="writing-response-actions"><button type="submit" class="venture-link">Publish response</button><p role="status" aria-live="polite" data-writing-response-status></p></div></form><div class="writing-response-thread" data-writing-response-thread>${responses.length?responses.map(renderWritingResponse).join(""):'<p class="writing-response-empty" data-writing-response-empty>No responses yet. You can begin the thread.</p>'}</div></section>`;
}
export function writingBreadcrumb(title = "") {
  const esc = escapeWriting;
  return `<nav class="construct-breadcrumb" aria-label="Breadcrumb"><a href="/home/">Construct</a><span class="construct-breadcrumb-sep" aria-hidden="true">:</span><a href="/writings/">Writings</a><span class="construct-breadcrumb-sep" aria-hidden="true">:</span><a href="/writings/mindful-darkness/">Mindful Darkness</a><span class="construct-breadcrumb-sep" aria-hidden="true">:</span>${title ? `<a href="${WRITING_ROOT}">WRKNG*</a><span class="construct-breadcrumb-sep" aria-hidden="true">:</span><span class="construct-breadcrumb-current" aria-current="page">${esc(title)}</span>` : '<span class="construct-breadcrumb-current" aria-current="page">WRKNG*</span>'}</nav>`;
}
