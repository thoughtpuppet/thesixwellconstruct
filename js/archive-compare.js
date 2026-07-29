(function () {
  "use strict";

  const app = document.querySelector("[data-archive-compare-app]");
  if (!app) return;

  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
  const text = (...values) => String(values.find((value) => value !== undefined && value !== null && value !== "") || "").trim();
  const list = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const titleCase = (value) => text(value).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  function safeUrl(value) {
    if (!value) return "";
    try {
      const parsed = new URL(String(value), location.origin);
      if (!/^https?:$/.test(parsed.protocol)) return "";
      return parsed.origin === location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
    } catch {
      return "";
    }
  }

  function valueMarkup(value) {
    const values = list(value).map((item) => typeof item === "object" ? text(item.title, item.name, item.label) : text(item)).filter(Boolean);
    return values.length ? escapeHtml(values.join(" · ")) : '<span aria-label="Undocumented">—</span>';
  }

  function mediaMarkup(subject) {
    const media = subject.media || {};
    const url = safeUrl(media.url);
    if (!url) return '<div class="archive-compare-media-empty"><span>No public lead media</span></div>';
    const mime = text(media.mime_type, media.mimeType);
    const alt = text(media.alt_text, media.altText, media.title, subject.subject_title, subject.title);
    if (mime.startsWith("video/")) return `<video controls playsinline preload="metadata" src="${escapeHtml(url)}" aria-label="${escapeHtml(alt)}"></video>`;
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`;
  }

  function subjectHeader(subject, side) {
    return `<article class="archive-compare-subject archive-compare-subject--${side}"><div class="archive-compare-media">${mediaMarkup(subject)}</div><div class="archive-compare-subject-copy"><span class="archive-kicker">${escapeHtml(subject.kind === "state" ? "Documented state" : "Cultural object")}</span><strong class="archive-catalogue-identifier">${escapeHtml(text(subject.catalogue_label, subject.catalogue_id, "Archive record"))}</strong><h2>${escapeHtml(text(subject.subject_title, subject.title, "Untitled subject"))}</h2>${subject.state ? `<p>${escapeHtml(text(subject.state.description, subject.summary))}</p>` : ""}<a class="archive-button" href="${escapeHtml(safeUrl(subject.route) || "/archive/")}">Open canonical dossier</a></div></article>`;
  }

  function stateValue(subject) {
    if (!subject.state) return "";
    return [
      text(subject.state.catalogue_label, subject.state.catalogueLabel),
      text(subject.state.title),
      text(subject.state.date_label, subject.state.dateLabel),
      Number(subject.state.material_count || subject.state.materialCount || 0)
        ? `${Number(subject.state.material_count || subject.state.materialCount)} public ${Number(subject.state.material_count || subject.state.materialCount) === 1 ? "material" : "materials"}`
        : "",
    ].filter(Boolean).join(" · ");
  }

  function relationshipValue(subject) {
    return list(subject.relationships).map((relationship) => [text(relationship.label), text(relationship.title), text(relationship.catalogue_label)].filter(Boolean).join(": ")).filter(Boolean);
  }

  function comparisonRows(left, right) {
    const rows = [
      ["Catalogue identity", left.catalogue_label, right.catalogue_label],
      ["Title", left.subject_title || left.title, right.subject_title || right.title],
      ["Date", left.date_label, right.date_label],
      ["Medium", left.medium || left.catalogue_medium, right.medium || right.catalogue_medium],
      ["Object type", left.cultural_object_type, right.cultural_object_type],
      ["Description", left.summary, right.summary],
      ["Technique", left.technique, right.technique],
      ["Support", left.support, right.support],
      ["Dimensions", left.dimensions, right.dimensions],
      ["Inscriptions", left.inscriptions, right.inscriptions],
      ["Edition", left.edition, right.edition],
      ["Credit line", left.credit_line, right.credit_line],
      ["State information", stateValue(left), stateValue(right)],
      ["Themes", left.themes, right.themes],
      ["Relationships", relationshipValue(left), relationshipValue(right)],
    ];
    return rows.filter(([, leftValue, rightValue]) => list(leftValue).some(Boolean) || list(rightValue).some(Boolean));
  }

  function render(payload) {
    const left = payload.left || payload.subjects && payload.subjects[0];
    const right = payload.right || payload.subjects && payload.subjects[1];
    const rows = comparisonRows(left, right);
    document.title = `${text(left.subject_title, left.title)} and ${text(right.subject_title, right.title)} · Archive comparison`;
    app.innerHTML = `<header class="archive-compare-hero site-hero site-hero--supporting"><div><span class="archive-kicker">Two-subject catalogue view</span><h1 class="hero-title">Compare.</h1></div><div><p class="hero-descriptor">A direct reading of two public cultural objects or documented states. Undocumented values remain visible as an em dash.</p><a class="archive-button" href="/archive/">Choose different records</a></div></header><section class="archive-compare-subjects" aria-label="Compared subjects">${subjectHeader(left, "left")}${subjectHeader(right, "right")}</section><section class="archive-compare-table" aria-label="Catalogue comparison">${rows.map(([label, leftValue, rightValue]) => `<div class="archive-compare-row"><h3>${escapeHtml(label)}</h3><div>${valueMarkup(leftValue)}</div><div>${valueMarkup(rightValue)}</div></div>`).join("")}</section>`;
  }

  async function load() {
    const params = new URL(location.href).searchParams;
    if (!params.get("left") || !params.get("right")) {
      app.innerHTML = '<section class="archive-error" role="alert"><span class="archive-kicker">Two subjects required</span><h2>Choose a left and right subject.</h2><p>The compare tray on public Archive cards builds the shareable URL for you.</p><p><a class="archive-button" href="/archive/">Return to the Archive</a></p></section>';
      return;
    }
    try {
      const apiParams = new URLSearchParams();
      ["left", "left_state", "right", "right_state"].forEach((key) => {
        const value = params.get(key);
        if (value) apiParams.set(key, value);
      });
      const response = await fetch(`/api/archive/compare?${apiParams}`, { cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      render(await response.json());
    } catch {
      app.innerHTML = '<section class="archive-error" role="alert"><span class="archive-kicker">Comparison unavailable</span><h2>One or both subjects are not public.</h2><p>A private, archived, invalid, or unpublished state cannot appear in a public comparison.</p><p><a class="archive-button" href="/archive/">Return to the Archive</a></p></section>';
    }
  }

  load();
})();
