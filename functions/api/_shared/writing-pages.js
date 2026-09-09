import {escapeWriting as esc, renderWritingEntry, writingBreadcrumb, WRITING_ROOT} from "../../../shared/writing-content.js";
export function writingPageSlug(pathname) {
  if (!pathname.startsWith(WRITING_ROOT)) return null;
  const tail = pathname.slice(WRITING_ROOT.length).replace(/\/$/, "");
  if (!tail || tail === "index.html") return null;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tail) && tail.length <= 160 && tail !== "detail" ? tail : "";
}
export function renderWritingPageTemplate(template, entry, origin) {
  const canonical = `${origin}${WRITING_ROOT}${entry.slug}/`;
  return template.replace(/<title>[^<]*<\/title>/,`<title>${esc(entry.snapshot.title)} · WRKNG* · the six.well construct</title>`)
    .replace(/<meta name="description" content="[^"]*">/,`<meta name="description" content="${esc(entry.snapshot.excerpt)}"><link rel="canonical" href="${esc(canonical)}"><meta property="og:title" content="${esc(entry.snapshot.title)}"><meta property="og:description" content="${esc(entry.snapshot.excerpt)}"><meta property="og:type" content="article"><meta property="og:url" content="${esc(canonical)}">`)
    .replace("<!--writing-breadcrumb-->",writingBreadcrumb(entry.snapshot.title)).replace("<!--writing-entry-->",renderWritingEntry(entry));
}
