(function () {
  "use strict";

  const root = document.querySelector("[data-practice-record]");
  if (!root) return;

  const slug = root.dataset.practiceRecord;
  const text = (value) => String(value ?? "").trim();
  const element = (tag, className, value = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  };

  async function json(path) {
    const response = await fetch(path, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
  }

  function mediaFor(record, role) {
    const media = Array.isArray(record.media) ? record.media : [];
    return media.find((item) => item.role === role) || null;
  }

  function mediaFigure(media, primary) {
    if (!media) return null;
    const figure = element("figure", "practice-section-media");
    if (text(media.mimeType).startsWith("video/")) {
      const video = document.createElement("video");
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = media.url;
      if (primary?.url) video.poster = primary.url;
      video.setAttribute("aria-label", media.alt || "Process video");
      figure.append(video);
      figure.append(element("p", "practice-video-description", media.alt || media.caption || "Ambient process video."));
    } else {
      const image = document.createElement("img");
      image.src = media.url;
      image.alt = media.alt || "Process photograph";
      image.loading = "lazy";
      figure.append(image);
      if (media.caption) figure.append(element("figcaption", "", media.caption));
    }
    return figure;
  }

  function artSlug(connection) {
    const route = text(connection?.related?.route);
    const match = route.match(/^\/art\/([^/]+)\/$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function originCard(work) {
    const media = Array.isArray(work.media) ? work.media.find((item) => item.role === "primary") || work.media[0] : null;
    const card = element("article", "practice-origin-card");
    if (media?.url) {
      const mediaLink = element("a", "practice-origin-media");
      mediaLink.href = work.canonicalRoute || work.canonical_route || `/art/${encodeURIComponent(work.slug)}/`;
      const image = document.createElement("img");
      image.src = media.url;
      image.alt = media.alt || work.title;
      image.loading = "lazy";
      mediaLink.append(image);
      card.append(mediaLink);
    }
    const copy = element("div", "practice-origin-copy");
    copy.append(element("span", "practice-origin-kicker", "Origin work"));
    copy.append(element("h3", "practice-origin-title", work.title));
    copy.append(element("p", "practice-origin-meta", [work.year, work.medium, work.dimensions].filter(Boolean).join(" · ")));
    const status = element("div", "practice-origin-status");
    status.append(element("span", "", work.availability || "unavailable"));
    if (work.whereabouts_status === "unknown") status.append(element("span", "", "Whereabouts unknown"));
    copy.append(status);
    const link = element("a", "practice-origin-link", "Open the canonical artwork record");
    link.href = work.canonicalRoute || work.canonical_route || `/art/${encodeURIComponent(work.slug)}/`;
    copy.append(link);
    card.append(copy);
    return card;
  }

  async function loadOrigin(host, practiceId) {
    try {
      const payload = await json(`/api/connections/${encodeURIComponent(practiceId)}`);
      const connection = (payload.records || []).find((item) => item.relationshipType?.slug === "documented-by" && item.related?.entityType === "art_work");
      const relatedSlug = artSlug(connection);
      if (!relatedSlug) throw new Error("Origin relationship missing");
      const artPayload = await json(`/api/art/${encodeURIComponent(relatedSlug)}`);
      const work = artPayload.record || artPayload.records?.[0];
      if (!work) throw new Error("Origin artwork missing");
      host.replaceChildren(originCard(work));
    } catch {
      host.replaceChildren(element("p", "practice-origin-meta", "The connected origin work is temporarily unavailable."));
    }
  }

  function sectionMarkup(section, record, primary) {
    const article = element("section", "practice-section");
    article.id = `practice-${section.id}`;
    const index = element("div", "practice-section-index");
    index.append(element("span", "practice-section-eyebrow", section.eyebrow));
    const copy = element("div", "practice-section-copy");
    copy.append(element("h2", "", section.title));
    copy.append(element("p", "", section.body));
    if (section.mediaRole === "origin-work") {
      const host = element("div", "practice-origin-host");
      host.setAttribute("data-practice-origin", "");
      copy.append(host);
    } else if (section.mediaRole) {
      const media = mediaFor(record, section.mediaRole);
      const figure = mediaFigure(media, primary);
      if (figure) copy.append(figure);
    }
    article.append(index, copy);
    return article;
  }

  async function start() {
    const loading = root.querySelector("[data-practice-loading]");
    const content = root.querySelector("[data-practice-content]");
    const error = root.querySelector("[data-practice-error]");
    try {
      const payload = await json(`/api/archive/${encodeURIComponent(slug)}`);
      const record = payload.record || payload.records?.[0];
      if (!record || record.record_type !== "practice") throw new Error("Practice record missing");
      const sections = Array.isArray(record.practiceSections) ? record.practiceSections : record.practice_sections || [];
      const primary = mediaFor(record, "primary") || record.media?.find((item) => text(item.mimeType).startsWith("image/"));

      document.title = `${record.title} · Archive · the six.well construct`;
      const description = document.querySelector('meta[name="description"]');
      if (description) description.content = record.summary;
      root.querySelector("[data-practice-title]").textContent = record.title;
      root.querySelector("[data-practice-summary]").textContent = record.summary;
      root.querySelector("[data-practice-label]").textContent = record.node_label || "Art Making / Practice Record";
      root.querySelector("[data-practice-date]").textContent = [record.date_or_period, record.timeline_period].filter(Boolean).join(" · ");

      const lead = root.querySelector("[data-practice-lead-media]");
      if (primary?.url) {
        const image = lead.querySelector("[data-practice-lead-image]");
        image.src = primary.url;
        image.alt = primary.alt || "Prepared plywood painting panels";
        lead.querySelector("[data-practice-lead-caption]").textContent = primary.caption || "";
        lead.hidden = false;
      }

      const sectionHost = root.querySelector("[data-practice-sections]");
      sectionHost.replaceChildren(...sections.map((section) => sectionMarkup(section, record, primary)));
      const originHost = sectionHost.querySelector("[data-practice-origin]");
      if (originHost) loadOrigin(originHost, record.id);

      const closing = root.querySelector("[data-practice-closing]");
      if (record.why_it_matters) {
        closing.querySelector("[data-practice-closing-copy]").textContent = record.why_it_matters;
        closing.hidden = false;
      }

      loading.hidden = true;
      content.hidden = false;
    } catch {
      loading.hidden = true;
      error.hidden = false;
    }
  }

  start();
})();
