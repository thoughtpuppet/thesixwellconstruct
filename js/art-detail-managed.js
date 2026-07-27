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
    script.src = "/js/construct-connections.js?v=5";
    script.onload = run;
    document.head.appendChild(script);
  }

  async function hydrate() {
    const currentPath = location.pathname.replace(/\/+$/, "");
    try {
      const response = await fetch("/api/art", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Managed art unavailable.");
      const payload = await response.json();
      const record = (payload.records || []).find((item) => text(item.legacy_path).replace(/\/+$/, "") === currentPath);
      if (!record) return;

      mountConnections(record.id);
      const media = Array.isArray(record.media) ? record.media[0] : null;
      document.title = `${record.title} · the six.well construct`;
      const title = document.querySelector("[data-art-field='title'],.painting-title");
      if (title) title.textContent = record.title || "Untitled work";
      document.querySelectorAll("[data-art-field='primary-image'],.painting-frame img,.lightbox img,#lightboxImg").forEach((image) => {
        if (media?.url) image.src = media.url;
        image.alt = media?.alt || record.title || "Artwork";
      });
      renderMeta(record);
      renderStatement(record);
      renderOriginalAvailability(record);
      await loadPrint(record);
    } catch {
      // Bundled detail content remains visible during an API outage.
    }
  }

  window.ArtDetailManaged = { resolvePrintState };
  hydrate();
})();
