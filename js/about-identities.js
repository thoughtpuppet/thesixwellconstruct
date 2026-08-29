(function () {
  "use strict";

  const indexHost = document.querySelector("[data-identity-index]");
  const detailHost = document.querySelector("[data-identity-detail]");
  const dialog = document.querySelector("[data-identity-media-dialog]");
  const dialogImage = dialog?.querySelector("[data-identity-media-image]");
  const dialogCaption = dialog?.querySelector("[data-identity-media-caption]");
  const dialogTitle = dialog?.querySelector("#identity-media-dialog-title");
  let dialogReturnTarget = null;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));

  const list = (value) => {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
  const text = (...values) => String(first(...values) ?? "").trim();
  const truthy = (value) => value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";

  function safeUrl(value) {
    const url = String(value || "").trim();
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol) ? url : "";
    } catch {
      return "";
    }
  }

  function linkAttributes(url) {
    return /^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : "";
  }

  function inlineEmphasis(value) {
    return escapeHtml(value).replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  }

  function label(value) {
    return text(value)
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function safeSvg(markup) {
    const source = String(markup || "").trim();
    if (!source || /<!DOCTYPE|<!ENTITY/i.test(source)) return "";
    const documentNode = new DOMParser().parseFromString(source, "image/svg+xml");
    if (documentNode.querySelector("parsererror") || documentNode.documentElement.localName !== "svg") return "";
    const svg = documentNode.documentElement;
    documentNode.querySelectorAll("script,foreignObject,iframe,object,embed,link,style,a,image,animate,set,metadata").forEach((element) => element.remove());
    [svg, ...svg.querySelectorAll("*")].forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        const unsafePaint = [...value.matchAll(/url\s*\(\s*([^)]*)\)/gi)]
          .some((match) => !/^['"]?#[a-zA-Z][\w:.-]*['"]?$/.test(match[1].trim()));
        const unsafeHref = ["href", "xlink:href"].includes(name) && !/^#[a-zA-Z][\w:.-]*$/.test(value.trim());
        if (
          name.startsWith("on") ||
          ["src", "style"].includes(name) ||
          unsafeHref ||
          /javascript:|data:text\/html|expression\s*\(|@import/i.test(value) ||
          unsafePaint
        ) element.removeAttribute(attribute.name);
      });
    });
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return new XMLSerializer().serializeToString(svg);
  }

  function mediaFrom(value, fallback = {}) {
    if (!value && !fallback) return null;
    const media = typeof value === "string" ? { url: value } : (value || {});
    const visibility = text(media.visibility, media.access, media.publication_visibility).toLowerCase();
    if (visibility && !["public", "published"].includes(visibility)) return null;
    if (("public_visible" in media && !truthy(media.public_visible)) || ("publicVisible" in media && !truthy(media.publicVisible))) return null;
    const url = safeUrl(first(media.url, media.src, media.public_url, media.publicUrl, fallback.url, fallback.src));
    if (!url) return null;
    return {
      url,
      alt: text(media.alt_text, media.altText, media.alt, fallback.alt_text, fallback.altText, fallback.alt),
      caption: text(media.caption, fallback.caption),
      kind: text(media.kind, media.media_kind, fallback.kind),
    };
  }

  function primaryMedia(record) {
    if (!record || typeof record !== "object") return null;
    return mediaFrom(
      first(record.primary_media, record.primaryMedia, record.lead_media, record.leadMedia, list(record.media)[0]),
      {
        url: first(record.primary_image, record.primaryImage, record.image_url, record.imageUrl),
        alt: first(record.primary_image_alt, record.primaryImageAlt, record.alt_text, record.altText),
        caption: first(record.caption, record.media_caption, record.mediaCaption),
      },
    );
  }

  function identityRoute(record) {
    return safeUrl(first(record.canonical_route, record.canonicalRoute, record.route)) ||
      `/about/identities/${encodeURIComponent(text(record.slug, record.organization_slug, record.id))}/`;
  }

  function archiveRoute(record, fallbackSlug = "") {
    return safeUrl(first(record?.archive_route, record?.archiveRoute, record?.canonical_route, record?.canonicalRoute, record?.route)) ||
      (text(record?.archive_slug, record?.archiveSlug, fallbackSlug)
        ? `/archive/records/${encodeURIComponent(text(record?.archive_slug, record?.archiveSlug, fallbackSlug))}/`
        : "");
  }

  function symbolRoute(symbol) {
    return safeUrl(first(symbol?.route, symbol?.canonical_route, symbol?.canonicalRoute)) ||
      (text(symbol?.slug, symbol?.id) ? `/about/legend/${encodeURIComponent(text(symbol?.slug, symbol?.id))}/` : "");
  }

  function monogram(name) {
    const words = text(name).split(/\s+/).filter(Boolean);
    const capitals = text(name).match(/[A-Z]/g) || [];
    if (capitals.length > 1) return capitals.slice(0, 2).join("");
    return (words.length > 1 ? words.map((word) => word[0]).join("") : words[0]?.slice(0, 1) || "ID").toUpperCase();
  }

  function symbolVisual(symbol, fallbackName = "") {
    const markup = safeSvg(first(symbol?.svg_markup, symbol?.svgMarkup));
    if (markup) return markup;
    const media = primaryMedia(symbol);
    if (media) return `<img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.alt)}" loading="lazy">`;
    return `<span class="identity-card-monogram" aria-hidden="true">${escapeHtml(monogram(fallbackName || symbol?.name))}</span>`;
  }

  function indexRecords(payload) {
    return list(first(payload?.records, payload?.identities, payload?.profiles, payload?.items, []));
  }

  function indexCard(record, index) {
    const name = text(record.name, record.display_name, record.displayName, record.title, record.slug) || "Creative identity";
    const route = identityRoute(record);
    const kind = text(record.kind_label, record.kindLabel, record.public_kind_label, record.publicKindLabel) || "Creative identity";
    const lifecycle = label(first(record.lifecycle_status, record.lifecycleStatus));
    const origin = text(record.origin_date_label, record.originDateLabel);
    const descriptor = text(record.hero_descriptor, record.heroDescriptor, record.current_role, record.currentRole, record.summary);
    const meta = [kind, lifecycle, origin].filter(Boolean).join(" · ");
    const mark = first(record.current_symbol, record.currentSymbol, record.symbol, record.mark);
    return `<a class="identity-card" href="${escapeHtml(route)}" aria-labelledby="identity-card-title-${index}">
      <span class="identity-card-media">${symbolVisual(mark, name)}</span>
      <span class="identity-card-copy">
        <span class="identity-card-meta">${escapeHtml(meta)}</span>
        <h3 id="identity-card-title-${index}">${escapeHtml(name)}</h3>
        ${descriptor ? `<span class="identity-card-summary">${escapeHtml(descriptor)}</span>` : ""}
        <span class="identity-card-action">Open identity</span>
      </span>
    </a>`;
  }

  async function renderIndex() {
    if (!indexHost) return;
    try {
      const response = await fetch("/api/identities", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Creative identities unavailable.");
      const records = indexRecords(await response.json());
      indexHost.innerHTML = records.length
        ? records.map(indexCard).join("")
        : '<p class="identity-state">No creative identities are published yet.</p>';
    } catch {
      indexHost.innerHTML = '<p class="identity-state" role="alert">The published identity index is temporarily unavailable.</p>';
    } finally {
      indexHost.setAttribute("aria-busy", "false");
    }
  }

  function requestedSlug() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts.length === 3 && parts[0] === "about" && parts[1] === "identities" && parts[2] !== "detail"
      ? decodeURIComponent(parts[2])
      : "";
  }

  function normalizeDetail(payload) {
    const profile = first(payload?.profile, payload?.identity, payload?.record) || {};
    const organization = payload?.organization || profile.organization || {};
    const dossier = payload?.dossier || null;
    const timeline = payload?.timeline || null;
    const originThread = first(payload?.origin_thread, payload?.originThread) || null;
    const symbols = list(first(payload?.symbols, []));
    const currentSymbol = first(payload?.current_symbol, payload?.currentSymbol) ||
      symbols.find((symbol) => text(symbol.role).toLowerCase().includes("current")) || null;
    const featuredOriginRecord = first(payload?.featured_origin_record, payload?.featuredOriginRecord) || null;
    const relatedRecords = list(first(payload?.related_records, payload?.relatedRecords, []));
    return { profile, organization, dossier, timeline, originThread, symbols, currentSymbol, featuredOriginRecord, relatedRecords };
  }

  function profileName(data) {
    return text(data.profile.name, data.profile.display_name, data.profile.displayName, data.organization.name, data.profile.slug) || "Creative identity";
  }

  function profileSlug(data) {
    return text(data.profile.slug, data.organization.slug, requestedSlug());
  }

  function profileRoute(data) {
    return identityRoute({ ...data.organization, ...data.profile, slug: profileSlug(data) });
  }

  function timelineParts(data) {
    const timeline = data.timeline || {};
    const record = timeline.timeline || timeline.record || {};
    return {
      record,
      chapters: list(first(timeline.chapters, timeline.entries, [])),
      activities: list(first(timeline.activities, [])),
    };
  }

  function timelineRoute(data) {
    const parts = timelineParts(data);
    return safeUrl(first(parts.record.canonical_route, parts.record.canonicalRoute, parts.record.archive_route, parts.record.archiveRoute, parts.record.route)) ||
      (profileSlug(data) ? `/archive/timelines/${encodeURIComponent(profileSlug(data))}/` : "");
  }

  function originArtifactMarkup(record) {
    if (!record) return "";
    const media = primaryMedia(record);
    const route = archiveRoute(record);
    const title = text(record.title, record.name) || "Origin artifact";
    const caption = text(media?.caption, record.caption, record.summary);
    if (media) {
      return `<figure class="identity-origin-figure">
        <div class="identity-origin-media">
          <button class="identity-origin-trigger" type="button" data-origin-media aria-label="Enlarge ${escapeHtml(title)}">
            <img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.alt)}">
          </button>
        </div>
        ${caption ? `<figcaption>${inlineEmphasis(caption)}</figcaption>` : ""}
        ${route ? `<a class="identity-inline-link" href="${escapeHtml(route)}">Open artifact record</a>` : ""}
      </figure>`;
    }
    if (!route) return "";
    return `<aside class="identity-origin-record">
      <span class="identity-card-meta">Origin artifact</span>
      <h3>${escapeHtml(title)}</h3>
      ${text(record.summary) ? `<p>${escapeHtml(record.summary)}</p>` : ""}
      <a class="identity-inline-link" href="${escapeHtml(route)}">Open artifact record</a>
    </aside>`;
  }

  function currentMarkMarkup(symbol) {
    if (!symbol) return '<p class="identity-empty-section">The current mark has not been linked to this public profile yet.</p>';
    const route = symbolRoute(symbol);
    const name = text(symbol.name, symbol.title) || "Current mark";
    return `<div class="identity-symbol-grid">
      <article class="identity-symbol-card">
        <div class="identity-symbol-mark">${symbolVisual(symbol, name)}</div>
        <div class="identity-symbol-copy">
          <span class="identity-card-meta">${escapeHtml(text(symbol.role) || "Current symbol")}</span>
          <h3>${escapeHtml(name)}</h3>
          ${text(symbol.meaning, symbol.summary) ? `<p>${escapeHtml(text(symbol.meaning, symbol.summary))}</p>` : ""}
          ${route ? `<a class="identity-inline-link" href="${escapeHtml(route)}">Open Legend record</a>` : ""}
        </div>
      </article>
    </div>`;
  }

  function lineageMarkup(data) {
    const currentId = text(data.currentSymbol?.id);
    const symbolCards = data.symbols.filter((symbol) => text(symbol.id) !== currentId).map((symbol) => {
      const route = symbolRoute(symbol);
      const name = text(symbol.name, symbol.title) || "Connected symbol";
      return `<article class="identity-lineage-card">
        <div class="identity-symbol-mark">${symbolVisual(symbol, name)}</div>
        <div class="identity-lineage-copy">
          <span class="identity-card-meta">${escapeHtml(text(symbol.role) || "Connected mark")}</span>
          <h3>${escapeHtml(name)}</h3>
          ${text(symbol.meaning, symbol.summary) ? `<p>${escapeHtml(text(symbol.meaning, symbol.summary))}</p>` : ""}
          ${route ? `<a class="identity-inline-link" href="${escapeHtml(route)}">Open Legend record</a>` : ""}
        </div>
      </article>`;
    });
    const thread = data.originThread;
    const threadRoute = safeUrl(first(thread?.route, thread?.archive_route, thread?.archiveRoute)) ||
      (text(thread?.slug, thread?.id) ? `/archive/?origin=${encodeURIComponent(text(thread.slug, thread.id))}` : "");
    if (thread) {
      symbolCards.push(`<article class="identity-lineage-card identity-lineage-card--text">
        <div class="identity-lineage-copy">
          <span class="identity-card-meta">Origin Thread</span>
          <h3>${escapeHtml(text(thread.title, thread.name) || "Shared origin")}</h3>
          ${text(thread.summary) ? `<p>${escapeHtml(thread.summary)}</p>` : ""}
          ${threadRoute ? `<a class="identity-inline-link" href="${escapeHtml(threadRoute)}">Open Origin Thread</a>` : ""}
        </div>
      </article>`);
    }
    return symbolCards.length
      ? `<div class="identity-lineage-grid">${symbolCards.join("")}</div>`
      : '<p class="identity-empty-section">No cross-identity lineage has been published for this profile yet.</p>';
  }

  function timelineMarkup(data) {
    const parts = timelineParts(data);
    const entries = parts.chapters.length ? parts.chapters : parts.activities;
    if (!entries.length) return '<p class="identity-empty-section">No public timeline highlights are available yet.</p>';
    return `<div class="identity-timeline-list">${entries.slice(0, 3).map((entry) => {
      const title = text(entry.title, entry.name) || "Timeline entry";
      const date = text(entry.date_label, entry.dateLabel, entry.era_label, entry.eraLabel, entry.occurred_at, entry.occurredAt);
      const summary = text(entry.summary);
      const body = text(entry.body, entry.description);
      const route = archiveRoute(entry);
      return `<article class="identity-timeline-card">
        <span class="identity-timeline-date">${escapeHtml(date || "Date open")}</span>
        <div class="identity-timeline-copy">
          <h3>${escapeHtml(title)}</h3>
          ${summary ? `<p>${inlineEmphasis(summary)}</p>` : ""}
          ${body && body !== summary ? `<p>${inlineEmphasis(body)}</p>` : ""}
          ${route ? `<a class="identity-inline-link" href="${escapeHtml(route)}">Open record</a>` : ""}
        </div>
      </article>`;
    }).join("")}</div>`;
  }

  function relatedMarkup(data) {
    const featuredId = text(data.featuredOriginRecord?.entity_id, data.featuredOriginRecord?.entityId, data.featuredOriginRecord?.id);
    const records = data.relatedRecords.filter((record) => text(record.entity_id, record.entityId, record.id) !== featuredId);
    if (!records.length) return '<p class="identity-empty-section">No additional related work is published yet.</p>';
    return `<div class="identity-related-grid">${records.map((record) => {
      const route = archiveRoute(record);
      const media = primaryMedia(record);
      const title = text(record.title, record.name) || "Related record";
      const kind = text(record.kind_label, record.kindLabel, record.record_type, record.recordType, record.entity_type, record.entityType) || "Archive record";
      const tag = route ? "a" : "article";
      return `<${tag} class="identity-related-card"${route ? ` href="${escapeHtml(route)}"${linkAttributes(route)}` : ""}>
        ${media ? `<span class="identity-related-media"><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.alt)}" loading="lazy"></span>` : ""}
        <span class="identity-related-card-copy">
          <span class="identity-related-meta">${escapeHtml(label(kind))}</span>
          <h3>${escapeHtml(title)}</h3>
          ${text(record.summary, record.orientation) ? `<span class="identity-related-copy">${escapeHtml(text(record.summary, record.orientation))}</span>` : ""}
        </span>
      </${tag}>`;
    }).join("")}</div>`;
  }

  function archiveCallout(data) {
    const history = timelineRoute(data);
    const dossier = archiveRoute(data.dossier, profileSlug(data));
    if (!history && !dossier) return "";
    return `<aside class="identity-archive-callout" aria-labelledby="identity-archive-title">
      <div class="identity-archive-callout-copy">
        <span class="band-kicker">Archive / evidence and chronology</span>
        <h2 id="identity-archive-title">Full Archive History.</h2>
        <p>The profile explains this identity in the present. Its dossier holds the evidence; its timeline holds the chronology.</p>
      </div>
      <div class="identity-archive-actions">
        ${dossier ? `<a class="text-link" href="${escapeHtml(dossier)}">Identity dossier</a>` : ""}
        ${history ? `<a class="text-link" href="${escapeHtml(history)}">Full history</a>` : ""}
      </div>
    </aside>`;
  }

  function synchronizeDocument(data) {
    const name = profileName(data);
    const description = text(data.profile.hero_descriptor, data.profile.heroDescriptor, data.profile.current_role, data.profile.currentRole);
    const canonical = new URL(profileRoute(data), location.origin).href;
    document.title = `${name} · Creative Identities · the six.well construct`;
    document.querySelector("[data-identity-title]")?.replaceChildren(document.createTextNode(document.title));
    document.querySelector("[data-identity-description]")?.setAttribute("content", description);
    document.querySelector("[data-identity-canonical]")?.setAttribute("href", canonical);
    const current = document.querySelector("[data-identity-breadcrumb-current]");
    if (current) current.textContent = name;
  }

  function configureOriginDialog(record) {
    const trigger = detailHost?.querySelector("[data-origin-media]");
    const media = primaryMedia(record);
    if (!trigger || !media || !dialog || !dialogImage || !dialogCaption || !dialogTitle) return;
    const title = text(record.title, record.name) || "Origin artifact";
    const caption = text(media.caption, record.caption, record.summary);
    trigger.addEventListener("click", () => {
      dialogReturnTarget = trigger;
      dialogTitle.textContent = title;
      dialogImage.src = media.url;
      dialogImage.alt = media.alt;
      dialogCaption.textContent = caption;
      if (typeof dialog.showModal === "function") {
        document.body.classList.add("identity-dialog-open");
        dialog.showModal();
      } else {
        window.open(media.url, "_blank", "noopener,noreferrer");
      }
    });
  }

  function paintDetail(payload) {
    const data = normalizeDetail(payload);
    if (!data.profile || !profileSlug(data)) throw new Error("Missing creative identity profile.");
    const name = profileName(data);
    const kind = text(data.profile.kind_label, data.profile.kindLabel, data.profile.public_kind_label, data.profile.publicKindLabel) || "Creative identity";
    const descriptor = text(data.profile.hero_descriptor, data.profile.heroDescriptor);
    const lifecycle = label(first(data.profile.lifecycle_status, data.profile.lifecycleStatus));
    const originDate = text(data.profile.origin_date_label, data.profile.originDateLabel);
    const currentRole = text(data.profile.current_role, data.profile.currentRole);
    const originBody = text(data.profile.origin_body, data.profile.originBody, data.profile.origin_copy, data.profile.originCopy);
    const returnBody = text(data.profile.return_body, data.profile.returnBody, data.profile.return_copy, data.profile.returnCopy);
    const artifact = originArtifactMarkup(data.featuredOriginRecord);
    synchronizeDocument(data);
    detailHost.innerHTML = `<header class="identity-profile-hero">
      <div class="section-head site-hero site-hero--supporting" aria-labelledby="identity-profile-title">
        <span class="section-kicker">about / identities / ${escapeHtml(kind)}</span>
        <h1 class="hero-title" id="identity-profile-title">${escapeHtml(name)}</h1>
        ${descriptor ? `<p class="section-intro hero-descriptor">${escapeHtml(descriptor)}</p>` : ""}
        <nav class="section-nav" aria-label="identity navigation">
          <a href="/about/identities/">All identities</a>
          <a href="/currently">Current Works</a>
          <a href="/about/legend/">Legend</a>
          ${timelineRoute(data) ? `<a href="${escapeHtml(timelineRoute(data))}">Full history</a>` : ""}
        </nav>
      </div>
      <div class="identity-profile-facts" aria-label="Identity facts">
        ${lifecycle ? `<div class="identity-profile-fact"><strong>Lifecycle</strong><span>${escapeHtml(lifecycle)}</span></div>` : ""}
        ${originDate ? `<div class="identity-profile-fact"><strong>Origin</strong><span>${escapeHtml(originDate)}</span></div>` : ""}
        ${currentRole ? `<div class="identity-profile-fact"><strong>Current role</strong><span>${escapeHtml(currentRole)}</span></div>` : ""}
      </div>
    </header>

    <section class="identity-profile-section" aria-labelledby="identity-origin-title">
      <header class="identity-profile-section-head">
        <div><span class="band-kicker">01 / Beginning</span><h2 class="band-title" id="identity-origin-title">Origin.</h2></div>
        <p>The name begins as a specific object and moment; the Archive preserves that evidence without turning it into a background treatment.</p>
      </header>
      <div class="identity-origin-layout${artifact ? "" : " identity-origin-layout--copy-only"}">
        ${artifact}
        <div class="identity-origin-copy">${originBody ? `<p>${inlineEmphasis(originBody)}</p>` : '<p class="identity-empty-section">The public origin account is still being prepared.</p>'}</div>
      </div>
    </section>

    <section class="identity-profile-section" aria-labelledby="identity-return-title">
      <header class="identity-profile-section-head">
        <div><span class="band-kicker">02 / Continuity</span><h2 class="band-title" id="identity-return-title">Dormancy and Return.</h2></div>
        <div class="identity-return-copy">${returnBody ? `<p>${inlineEmphasis(returnBody)}</p>` : '<p class="identity-empty-section">The return account is still being prepared.</p>'}</div>
      </header>
    </section>

    <section class="identity-profile-section" aria-labelledby="identity-mark-title">
      <header class="identity-profile-section-head">
        <div><span class="band-kicker">03 / Legend</span><h2 class="band-title" id="identity-mark-title">Current Mark.</h2></div>
        <p>The Legend owns the mark and its evolving visual record; this profile places that mark in the identity’s larger history.</p>
      </header>
      ${currentMarkMarkup(data.currentSymbol)}
    </section>

    <section class="identity-profile-section" aria-labelledby="identity-lineage-title">
      <header class="identity-profile-section-head">
        <div><span class="band-kicker">04 / Shared source</span><h2 class="band-title" id="identity-lineage-title">Cross-Identity Lineage.</h2></div>
        <p>Marks, artifacts, and named systems can share an origin without becoming the same thing. Their connected records keep that lineage visible.</p>
      </header>
      ${lineageMarkup(data)}
    </section>

    <section class="identity-profile-section" aria-labelledby="identity-timeline-title">
      <header class="identity-profile-section-head">
        <div><span class="band-kicker">05 / Chronology</span><h2 class="band-title" id="identity-timeline-title">Timeline Highlights.</h2></div>
        <p>Selected moments from the authoritative Archive timeline. Undated work stays undated until the evidence supports something more precise.</p>
      </header>
      ${timelineMarkup(data)}
    </section>

    <section class="identity-profile-section" aria-labelledby="identity-related-title">
      <header class="identity-profile-section-head">
        <div><span class="band-kicker">06 / Work</span><h2 class="band-title" id="identity-related-title">Related Work.</h2></div>
        <p>Published works and records currently connected to this creative identity.</p>
      </header>
      ${relatedMarkup(data)}
    </section>

    ${archiveCallout(data)}`;
    detailHost.setAttribute("aria-busy", "false");
    configureOriginDialog(data.featuredOriginRecord);
  }

  function detailUnavailable() {
    detailHost.innerHTML = `<div class="identity-state" role="alert">
      <h1 class="band-title">This creative identity is unavailable.</h1>
      <p>It may be unpublished, archived, renamed, or temporarily unavailable.</p>
      <a class="identity-inline-link" href="/about/identities/">Return to Creative Identities</a>
    </div>`;
    detailHost.setAttribute("aria-busy", "false");
  }

  async function renderDetail() {
    if (!detailHost) return;
    const slug = requestedSlug();
    if (!slug) {
      detailUnavailable();
      return;
    }
    try {
      const response = await fetch(`/api/identities/${encodeURIComponent(slug)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Creative identity unavailable.");
      paintDetail(await response.json());
    } catch {
      detailUnavailable();
    }
  }

  if (dialog) {
    dialog.querySelector("[data-identity-media-close]")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      document.body.classList.remove("identity-dialog-open");
      if (dialogImage) {
        dialogImage.removeAttribute("src");
        dialogImage.alt = "";
      }
      if (dialogCaption) dialogCaption.textContent = "";
      const target = dialogReturnTarget;
      dialogReturnTarget = null;
      if (target?.isConnected) target.focus();
    });
  }

  renderIndex();
  renderDetail();
})();
