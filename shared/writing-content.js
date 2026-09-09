// The editor, server, and preview share this deliberately small document format.
export const WRITING_ROOT = "/writings/mindful-darkness/wrkng/";
export const WRITING_AUTHOR = "Saiel Dauhn Solehman";
export const escapeWriting = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
export function writingHref(value) {
  const url = String(value || "").trim();
  if (/[\u0000-\u0020\\]/.test(url)) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try { return ["https:","http:","mailto:"].includes(new URL(url).protocol) ? url : ""; } catch { return ""; }
}
function string(value, label, max) {
  if (typeof value !== "string" || value.length > max) throw new Error(`${label} must be text of ${max} characters or fewer.`);
  return value;
}
function keys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("The entry contains unsupported formatting.");
}
export function normalizeWritingSnapshot(input) {
  keys(input, ["schemaVersion","title","author","excerpt","body","sources","relatedIds"]);
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
  if (!Array.isArray(input.sources) || input.sources.length > 50 || !Array.isArray(input.relatedIds) || input.relatedIds.length > 30) throw new Error("Use up to 50 sources and 30 related records.");
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
    relatedIds:[...new Set(input.relatedIds.map(value => string(value, "Related record", 200)))],
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
export function writingDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", {month:"long",day:"numeric",year:"numeric",timeZone:"America/New_York"}).format(date);
}
export function renderWritingEntry(record, {preview = false} = {}) {
  const esc = escapeWriting, snapshot = record.snapshot;
  const updated = record.publishedUpdatedAt && record.publishedUpdatedAt !== record.firstPublishedAt;
  return `${preview ? '<p class="writing-preview-notice" role="status">Draft preview · visible only in Studio</p>' : ""}
    <section class="venture-hero site-hero site-hero--supporting writing-entry-hero" aria-labelledby="page-title">
      <div><span class="venture-kicker">Mindful Darkness / WRKNG*</span><h1 class="venture-title hero-title" id="page-title">${esc(snapshot.title)}</h1></div>
      <div class="hero-copy"><p class="hero-descriptor">${esc(snapshot.excerpt || "Notes on things I’m still figuring out.")}</p></div>
    </section>
    <article class="writing-reader" aria-labelledby="page-title">
      <p class="writing-meta">${esc(snapshot.author)}${record.firstPublishedAt ? ` · <time datetime="${esc(record.firstPublishedAt)}">${writingDate(record.firstPublishedAt)}</time>` : " · Draft"}${updated ? `<br>Updated <time datetime="${esc(record.publishedUpdatedAt)}">${writingDate(record.publishedUpdatedAt)}</time>` : ""}</p>
      <div class="writing-body">${renderWritingBody(snapshot, record.media)}</div>
      ${snapshot.sources.length ? `<section class="writing-sources" aria-labelledby="writing-sources-title"><h2 id="writing-sources-title">Sources</h2><ol>${snapshot.sources.map(source => `<li><a href="${esc(source.url)}" rel="noopener">${esc(source.label)}</a></li>`).join("")}</ol></section>` : ""}
      ${record.related?.length ? `<section class="writing-related"><h2>Connected work</h2><ul>${record.related.map(item => `<li><a href="${esc(item.route)}">${esc(item.title)}</a></li>`).join("")}</ul></section>` : ""}
      <p class="writing-footnote">*working. subject to change.</p>
      <a class="venture-link" href="${WRITING_ROOT}">All WRKNG* entries</a>
    </article>`;
}
export function writingBreadcrumb(title = "") {
  const esc = escapeWriting;
  return `<nav class="construct-breadcrumb" aria-label="Breadcrumb"><a href="/home/">Construct</a><span class="construct-breadcrumb-sep" aria-hidden="true">/</span><a href="/writings/">Writings</a><span class="construct-breadcrumb-sep" aria-hidden="true">/</span><a href="/writings/mindful-darkness/">Mindful Darkness</a><span class="construct-breadcrumb-sep" aria-hidden="true">/</span>${title ? `<a href="${WRITING_ROOT}">WRKNG*</a><span class="construct-breadcrumb-sep" aria-hidden="true">/</span><span class="construct-breadcrumb-current" aria-current="page">${esc(title)}</span>` : '<span class="construct-breadcrumb-current" aria-current="page">WRKNG*</span>'}</nav>`;
}
