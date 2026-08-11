(function () {
  const ORIGINAL_STATES = new Set(["available", "sold", "not-for-sale", "unavailable"]);

  function text(value) {
    return String(value || "").trim();
  }

  function humanState(value) {
    return text(value).replaceAll("-", " ");
  }

  function originalState(value) {
    const normalized = text(value).toLowerCase().replace(/\s+/g, "-");
    return ORIGINAL_STATES.has(normalized) ? normalized : "unavailable";
  }

  function resolvePrintState({ intent = "unavailable", connection = null, product = null, shopifyFailed = false } = {}) {
    if (!connection) {
      return intent === "planned"
        ? { state: "coming-soon", label: "coming soon", action: "coming soon", href: "", disabled: true }
        : { state: "unavailable", label: "unavailable", action: "unavailable", href: "", disabled: true };
    }
    const href = text(connection.route);
    if (!text(connection.shopifyHandle) || !href) {
      return { state: "unavailable", label: "unavailable", action: "unavailable", href: "", disabled: true };
    }
    if (shopifyFailed) {
      return { state: "check-availability", label: "check availability", action: "view print", href, disabled: false };
    }
    if (!product) {
      return { state: "unavailable", label: "unavailable", action: "unavailable", href: "", disabled: true };
    }
    return product.availableForSale
      ? { state: "available", label: "available", action: "get a print", href, disabled: false }
      : { state: "sold-out", label: "sold out", action: "view print", href, disabled: false };
  }

  function setStatus(status, state, label = humanState(state)) {
    if (!status) return;
    status.className = `avail-status ${state}`;
    status.dataset.availability = state;
    status.textContent = label;
  }

  function setAction(action, { action: label, href, disabled }) {
    if (!action) return;
    action.textContent = label;
    action.classList.toggle("disabled", disabled);
    action.setAttribute("aria-disabled", disabled ? "true" : "false");
    action.tabIndex = disabled ? -1 : 0;
    if (action instanceof HTMLAnchorElement) {
      if (disabled || !href) action.removeAttribute("href");
      else action.href = href;
    }
  }

  function renderMeta(record) {
    const meta = document.querySelector("[data-art-meta],.painting-meta");
    if (!meta) return;
    const values = [
      text(record.year),
      text(record.medium),
      text(record.dimensions),
      record.series_id ? "series" : "standalone",
    ].filter(Boolean);
    meta.replaceChildren();
    values.forEach((value, index) => {
      if (index) {
        const separator = document.createElement("span");
        separator.className = "meta-sep";
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "·";
        meta.appendChild(separator);
      }
      const item = document.createElement("span");
      item.className = "meta-item";
      item.textContent = value;
      meta.appendChild(item);
    });
  }

  function renderStatement(record) {
    const statement = document.querySelector("[data-art-field='statement'],.statement-body");
    if (!statement) return;
    const published = text(record.statement);
    statement.classList.toggle("placeholder", !published);
    const paragraph = document.createElement("p");
    paragraph.textContent = published || "No public statement has been published for this work.";
    statement.replaceChildren(paragraph);
  }

  function renderOriginalAvailability(record) {
    const state = originalState(record.availability);
    const label = humanState(state);
    const row = document.querySelector("[data-art-original-row]");
    if (row) row.dataset.originalState = state;
    document.querySelectorAll("[data-art-field='availability-badge'],.painting-badge").forEach((badge) => {
      badge.dataset.availability = state;
      badge.textContent = label;
    });
    setStatus(document.querySelector("[data-art-original-status],.avail-row .avail-status"), state, label);

    const action = document.querySelector("[data-art-original-action]");
    const location = document.querySelector("[data-art-original-location]");
    const canAcquire = Number(record.acquisition_eligible) === 1 && state === "available";
    const hasLocation = state === "sold" && text(location?.textContent);

    if (location) location.hidden = !hasLocation;
    if (!action) return;
    action.hidden = hasLocation;
    if (hasLocation) return;
    setAction(action, canAcquire
      ? {
          action: "acquire",
          href: `/art/acquisitioninquiry.html?work=${encodeURIComponent(record.slug || record.id)}`,
          disabled: false,
        }
      : { action: label, href: "", disabled: true });
  }

  function renderPrintState(result) {
    const row = document.querySelector("[data-art-print-row]");
    if (!row) return;
    row.dataset.printState = result.state;
    setStatus(row.querySelector("[data-art-print-status],.avail-status"), result.state, result.label);
    setAction(row.querySelector("[data-art-print-action],.avail-action"), result);
  }

  async function loadPrint(record) {
    const intent = record.print_intent === "planned" ? "planned" : "unavailable";
    renderPrintState(resolvePrintState({ intent }));
    try {
      const response = await fetch(`/api/connections/${encodeURIComponent(record.id)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = await response.json();
      const printRecord = (payload.records || []).find((item) => (
        item.related?.entityType === "merch_item"
        && text(item.related?.kindLabel).toLowerCase() === "print"
      ));
      const connection = printRecord?.related || null;
      if (!connection) return;
      if (!text(connection.shopifyHandle) || !text(connection.route)) {
        renderPrintState(resolvePrintState({ intent, connection }));
        return;
      }
      try {
        const productResponse = await fetch(`/api/shop/product?handle=${encodeURIComponent(connection.shopifyHandle)}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (productResponse.status === 404) {
          renderPrintState(resolvePrintState({ intent, connection, product: null }));
          return;
        }
        if (!productResponse.ok) throw new Error("Shopify availability failed.");
        const productPayload = await productResponse.json();
        renderPrintState(resolvePrintState({ intent, connection, product: productPayload.product || null }));
      } catch {
        renderPrintState(resolvePrintState({ intent, connection, shopifyFailed: true }));
      }
    } catch {
      // The managed print intent already supplies an accurate fallback.
    }
  }

  function mountConnections(entityId) {
    const legacy = [...document.querySelectorAll("[data-legacy-connections]")];
    const first = document.querySelector(".related-block[data-legacy-connections],section.related[data-legacy-connections],.related-row[data-legacy-connections]") || legacy[0];
    const footer = document.querySelector("footer");
    const host = first?.matches("section,.related-row") ? first : document.createElement("section");
    if (!host.isConnected) {
      if (first?.parentNode) first.parentNode.insertBefore(host, first);
      else if (footer?.parentNode) footer.parentNode.insertBefore(host, footer);
      else document.body.appendChild(host);
    }
    const run = async () => {
      await window.ConstructConnections?.mount({ entityId, host, embedded: Boolean(first) });
      if (!host.hidden) legacy.forEach((node) => { if (node !== host) node.hidden = true; });
    };
    if (window.ConstructConnections) return run();
    const script = document.createElement("script");
    script.src = "/js/construct-connections.js?v=9";
    script.onload = run;
    document.head.appendChild(script);
  }

  function embeddedRecord() {
    const node = document.getElementById("art-record-data");
    if (!text(node?.textContent)) return null;
    try {
      const payload = JSON.parse(node.textContent);
      return payload?.record || null;
    } catch {
      return null;
    }
  }

  function managedTemplate() {
    return Boolean(document.body?.hasAttribute("data-managed-art-detail"));
  }

  function previewRequest() {
    return location.pathname.replace(/\/+$/, "") === "/studio/art-preview";
  }

  function dynamicSlug() {
    const match = location.pathname.match(/^\/art\/([^/.]+)\/?$/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return "";
    }
  }

  function studioToken() {
    return localStorage.getItem("swc_submissions_admin_token") || "";
  }

  async function fetchPreviewRecord() {
    const recordId = new URLSearchParams(location.search).get("work") || "";
    const token = studioToken();
    if (!recordId) throw new Error("Choose an artwork from Studio to preview.");
    if (!token) throw new Error("Unlock Studio before previewing this artwork.");
    const response = await fetch("/api/admin/art", {
      cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(response.status === 401
      ? "Your Studio session has expired. Unlock Studio and try again."
      : "The Studio artwork preview is unavailable.");
    const payload = await response.json();
    const record = (payload.records || []).find((item) => item.id === recordId);
    if (!record) throw new Error("That artwork record no longer exists.");
    return record;
  }

  async function fetchPublicRecord() {
    const embedded = embeddedRecord();
    if (embedded) return embedded;
    const slug = dynamicSlug();
    if (slug) {
      const response = await fetch(`/api/art/${encodeURIComponent(slug)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("This artwork is not published.");
      const payload = await response.json();
      if (!payload.record) throw new Error("This artwork is not published.");
      return payload.record;
    }

    const currentPath = location.pathname.replace(/\/+$/, "");
    const response = await fetch("/api/art", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("Managed art unavailable.");
    const payload = await response.json();
    return (payload.records || []).find((item) => (
      text(item.legacy_path).replace(/\/+$/, "") === currentPath
    )) || null;
  }

  async function previewMediaUrl(media) {
    const direct = text(media?.adminUrl);
    if (!direct || !previewRequest()) return text(media?.url);
    const response = await fetch(direct, {
      cache: "no-store",
      headers: { authorization: `Bearer ${studioToken()}` },
    });
    if (!response.ok) return text(media?.url);
    return URL.createObjectURL(await response.blob());
  }

  function setManagedState(message = "") {
    const state = document.querySelector("[data-art-detail-state]");
    const shell = document.querySelector("[data-art-detail-shell]");
    if (!state || !shell) return;
    state.hidden = !message;
    state.textContent = message;
    shell.hidden = Boolean(message);
  }

  function bindTemplateControls() {
    if (!managedTemplate()) return;
    const lightbox = document.getElementById("lightbox");
    const closeLightboxButton = document.getElementById("lightboxClose");
    const image = document.querySelector("[data-art-field='primary-image']");
    const lightboxImage = document.getElementById("lightboxImg");
    const closeLightbox = () => {
      lightbox?.classList.remove("open");
      document.body.style.overflow = "";
    };
    document.querySelector("[data-art-lightbox-trigger]")?.addEventListener("click", () => {
      if (!image?.src) return;
      if (lightboxImage) {
        lightboxImage.src = image.src;
        lightboxImage.alt = image.alt;
      }
      lightbox?.classList.add("open");
      document.body.style.overflow = "hidden";
    });
    closeLightboxButton?.addEventListener("click", closeLightbox);
    lightbox?.addEventListener("click", (event) => {
      if (event.target === lightbox) closeLightbox();
    });

    const drawer = document.getElementById("cartDrawer");
    const overlay = document.getElementById("cartOverlay");
    const closeCart = () => {
      drawer?.classList.remove("open");
      overlay?.classList.remove("open");
      drawer?.setAttribute("aria-hidden", "true");
    };
    document.getElementById("cartToggle")?.addEventListener("click", () => {
      drawer?.classList.add("open");
      overlay?.classList.add("open");
      drawer?.setAttribute("aria-hidden", "false");
    });
    document.getElementById("drawerClose")?.addEventListener("click", closeCart);
    overlay?.addEventListener("click", closeCart);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeLightbox();
      closeCart();
    });
  }

  async function hydrateRecord(record) {
    if (!record) return false;
    const mediaList = Array.isArray(record.media) ? record.media : [];
    const media = mediaList.find((item) => item.role === "primary") || mediaList[0] || null;
    const mediaUrl = await previewMediaUrl(media);
    const titleText = text(record.title) || "Untitled work";
    document.title = `${titleText} \u00b7 art \u00b7 the six.well construct`;
    const description = document.querySelector("meta[name='description']");
    if (description) description.content = text(record.statement) || `Artwork detail for ${titleText}.`;
    const title = document.querySelector("[data-art-field='title'],.painting-title");
    if (title) title.textContent = titleText;
    const breadcrumb = document.querySelector("[data-art-field='breadcrumb'],.breadcrumb-current");
    if (breadcrumb) breadcrumb.textContent = titleText;
    document.querySelectorAll("[data-art-field='primary-image'],.painting-frame img,.lightbox img,#lightboxImg").forEach((image) => {
      if (mediaUrl) image.src = mediaUrl;
      image.alt = media?.alt || titleText;
    });
    const frame = document.querySelector(".split-image");
    if (frame) frame.hidden = !mediaUrl;
    renderMeta(record);
    renderStatement(record);
    renderOriginalAvailability(record);
    mountConnections(record.id);
    setManagedState("");
    await loadPrint(record);
    return true;
  }

  async function hydrate() {
    try {
      const record = previewRequest() ? await fetchPreviewRecord() : await fetchPublicRecord();
      if (!record) {
        if (managedTemplate()) setManagedState("This artwork is not available.");
        return;
      }
      await hydrateRecord(record);
    } catch (error) {
      // Bundled detail content remains visible during an API outage.
      if (managedTemplate()) setManagedState(error?.message || "This artwork is unavailable.");
    }
  }

  window.ArtDetailManaged = { resolvePrintState };
  bindTemplateControls();
  hydrate();
})();
