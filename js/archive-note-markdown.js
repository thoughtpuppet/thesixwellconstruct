(function(global){
  "use strict";
  const escape=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
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
    const mime=String(asset.mime_type||asset.mimeType||""),url=safeHref(asset.url),alt=asset.alt_text||asset.altText||"",caption=asset.caption||"";
    if(!url)return'<p class="archive-note-missing-asset" role="note">An attached asset is unavailable.</p>';
    const media=mime.startsWith("image/")?`<img src="${escape(url)}" alt="${escape(alt)}" loading="lazy" decoding="async">`:`<a class="archive-button" href="${escape(url)}">Open ${escape(asset.original_filename||asset.originalFilename||"attachment")}</a>`;
    return `<figure class="archive-note-asset" data-note-asset="${escape(asset.token||asset.asset_token||"")}">${media}${caption?`<figcaption>${escape(caption)}</figcaption>`:""}</figure>`;
  }
  function render(markdown,assets=[]){
    const byToken=new Map(assets.map(asset=>[String(asset.token||asset.asset_token||"").toLowerCase(),asset])),lines=String(markdown||"").replace(/\r\n?/g,"\n").split("\n"),blocks=[];
    for(let index=0;index<lines.length;){const line=lines[index],trimmed=line.trim();if(!trimmed){index+=1;continue}
      const token=trimmed.match(/^\{\{asset:([a-z0-9-]+)\}\}$/i);if(token){blocks.push(assetFigure(byToken.get(token[1].toLowerCase())));index+=1;continue}
      const heading=trimmed.match(/^(#{1,4})\s+(.+)$/);if(heading){const level=Math.min(4,heading[1].length+1);blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);index+=1;continue}
      if(/^[-*+]\s+/.test(trimmed)){const items=[];while(index<lines.length&&/^[-*+]\s+/.test(lines[index].trim())){items.push(`<li>${inline(lines[index].trim().replace(/^[-*+]\s+/,""))}</li>`);index+=1}blocks.push(`<ul>${items.join("")}</ul>`);continue}
      if(/^>\s?/.test(trimmed)){const quotes=[];while(index<lines.length&&/^>\s?/.test(lines[index].trim())){quotes.push(lines[index].trim().replace(/^>\s?/,""));index+=1}blocks.push(`<blockquote>${quotes.map(inline).join("<br>")}</blockquote>`);continue}
      const paragraph=[];while(index<lines.length){const candidate=lines[index].trim();if(!candidate||/^\{\{asset:[a-z0-9-]+\}\}$/i.test(candidate)||/^(#{1,4})\s+/.test(candidate)||/^[-*+]\s+/.test(candidate)||/^>\s?/.test(candidate))break;paragraph.push(candidate);index+=1}blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    }
    return blocks.join("");
  }
  function stripFrontmatter(markdown){return String(markdown||"").replace(/^---\s*\n[\s\S]*?\n---\s*\n?/,"")}
  global.ArchiveNoteMarkdown={render,stripFrontmatter,escape,safeHref};
})(window);
