/* Optional published-work references for the Custom tattoo inquiry. */
(function (global) {
  const root = document.getElementById("tattooReferencePicker");
  const form = document.getElementById("inquiryForm");
  if (!root || !form) return;

  const opener = document.getElementById("tattooReferenceOpen");
  const panel = document.getElementById("tattooReferencePanel");
  const count = document.getElementById("tattooReferenceSelectedCount");
  const mark = document.getElementById("tattooReferenceOpenMark");
  const tabs = [...root.querySelectorAll("[data-reference-kind]")];
  const search = document.getElementById("tattooReferenceSearch");
  const searchLabel = document.getElementById("tattooReferenceSearchLabel");
  const results = document.getElementById("tattooReferenceResults");
  const grid = document.getElementById("tattooReferenceGrid");
  const resultsCount = document.getElementById("tattooReferenceResultsCount");
  const selectedList = document.getElementById("tattooReferenceSelectedList");
  const followup = document.getElementById("tattooReferenceFollowup");
  const note = document.getElementById("selected_reference_note");
  const hidden = document.getElementById("selected_references_json");
  const status = document.getElementById("tattooReferenceStatus");
  const safeUrl = global.SixWellLegend?.safeUrl || (() => "");
  const safeSvg = global.SixWellLegend?.safeSvg || (() => "");
  const labels = { tattoo: "Tattoo", design: "Tattoo Design", symbol: "Legend symbol" };
  const placeholders = { tattoo: "Search tattoos", design: "Search designs", symbol: "Search symbols" };
  const searchLabels = { tattoo: "Find a tattoo", design: "Find a design", symbol: "Find a symbol" };
  const resultNames = { tattoo: "tattoo", design: "design", symbol: "symbol" };
  const records = { tattoo: [], design: [], symbol: [] };
  const pending = {};
  const selected = new Map();
  let active = "tattoo";

  function key(item) { return `${item.kind}:${item.id}`; }
  function text(value) { return String(value || "").trim(); }
  function imageFor(item) {
    const thumb = document.createElement("span");
    thumb.className = "tattoo-reference-picker__thumb";
    const url = safeUrl(item.imageUrl);
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      thumb.append(image);
    } else if (item.kind === "symbol" && item.svgMarkup) {
      const sanitized = safeSvg(item.svgMarkup);
      if (sanitized) thumb.innerHTML = sanitized;
    }
    if (!thumb.childNodes.length) thumb.textContent = item.title.slice(0, 1).toUpperCase() || "·";
    return thumb;
  }

  function normalizeTattoo(item) {
    if (!text(item.id)) return null;
    const portfolioNumber = /^port-(\d+)$/i.exec(text(item.id));
    return { kind: "tattoo", id: text(item.id), title: text(item.title) || (portfolioNumber ? `Tattoo ${portfolioNumber[1]}` : "Untitled tattoo"), imageUrl: text(item.imageUrl), svgMarkup: "" };
  }

  function normalizeDesign(item) {
    const id = text(item.entity_id || item.entityId);
    const entityType = text(item.entity_type || item.entityType);
    const isTattooDesign = entityType === "tattoo_design";
    const isFlashBackedDesign = entityType === "flash_item" && text(item.catalogue_prefix) === "TAT-DES";
    if ((!isTattooDesign && !isFlashBackedDesign) || !id) return null;
    return { kind: "design", id, title: text(item.title) || "Untitled design", imageUrl: text(item.primaryImage || item.imageUrl), svgMarkup: "" };
  }

  function normalizeSymbol(item) {
    if (!text(item.id)) return null;
    return { kind: "symbol", id: text(item.id), title: text(item.name) || "Untitled symbol", imageUrl: text(item.image_url), svgMarkup: text(item.svg_markup) };
  }

  async function getJson(url) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Could not load references (${response.status}).`);
    return response.json();
  }

  async function loadKind(kind) {
    if (pending[kind]) return pending[kind];
    pending[kind] = (async () => {
      if (kind === "tattoo") {
        const data = await getJson("/api/portfolio");
        records.tattoo = (data.items || []).map(normalizeTattoo).filter(Boolean);
      } else if (kind === "symbol") {
        const data = await getJson("/api/legend");
        records.symbol = (data.records || []).map(normalizeSymbol).filter(Boolean);
      } else {
        const designs = [];
        let page = 1;
        let totalPages = 1;
        do {
          const data = await getJson(`/api/archive/items?medium=tattoos&limit=100&page=${page}`);
          designs.push(...(data.items || []).map(normalizeDesign).filter(Boolean));
          totalPages = Math.max(1, Number(data.pagination?.totalPages || data.pagination?.total_pages || 1));
          page += 1;
        } while (page <= totalPages);
        records.design = designs;
      }
      return records[kind];
    })();
    try {
      return await pending[kind];
    } catch (error) {
      delete pending[kind];
      throw error;
    }
  }

  function syncSelected() {
    const items = [...selected.values()];
    hidden.value = JSON.stringify(items.map(({ kind, id }) => ({ kind, id })));
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
    count.textContent = `Selected art.pill references (${items.length} of 3)`;
    followup.hidden = items.length === 0;
    note.disabled = items.length === 0;
    if (!items.length) note.value = "";
    selectedList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("span");
      empty.className = "tattoo-reference-picker__empty-selection";
      empty.textContent = "Nothing selected yet.";
      selectedList.append(empty);
    }
    items.forEach((item) => {
      const remove = document.createElement("button");
      remove.className = "tattoo-reference-picker__remove";
      remove.type = "button";
      remove.textContent = `${item.title} ×`;
      remove.setAttribute("aria-label", `Remove ${item.title}`);
      remove.addEventListener("click", () => {
        selected.delete(key(item));
        status.textContent = "";
        syncSelected();
        render();
        count.focus();
      });
      selectedList.append(remove);
    });
  }

  function choose(item) {
    const id = key(item);
    if (selected.has(id)) {
      selected.delete(id);
      status.textContent = `${item.title} removed.`;
    } else {
      if (selected.size >= 3) {
        status.textContent = "Choose up to 3 references. Remove one before adding another.";
        return;
      }
      selected.set(id, item);
      status.textContent = `${item.title} selected.`;
    }
    syncSelected();
    render(id);
  }

  function render(focusKey) {
    const query = search.value.trim().toLocaleLowerCase();
    const items = records[active].filter((item) => item.title.toLocaleLowerCase().includes(query));
    resultsCount.textContent = `${items.length} ${resultNames[active]}${items.length === 1 ? "" : "s"}${query ? " found" : ""}`;
    grid.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "tattoo-reference-picker__note";
      empty.textContent = query ? "No matches. Try another word or use the field below." : "No published examples are available in this group yet.";
      grid.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "tattoo-reference-picker__item";
      card.append(imageFor(item));
      const copy = document.createElement("span");
      copy.className = "tattoo-reference-picker__item-copy";
      const title = document.createElement("strong");
      title.className = "tattoo-reference-picker__item-title";
      title.textContent = item.title;
      const kind = document.createElement("span");
      kind.className = "tattoo-reference-picker__item-kind";
      kind.textContent = item.kind === "tattoo" ? "Completed tattoo" : labels[item.kind];
      copy.append(title, kind);
      card.append(copy);
      const button = document.createElement("button");
      button.className = "tattoo-reference-picker__select";
      button.type = "button";
      button.dataset.referenceId = key(item);
      button.setAttribute("aria-pressed", selected.has(key(item)) ? "true" : "false");
      button.setAttribute("aria-label", `${selected.has(key(item)) ? "Remove" : "Select"} ${labels[item.kind]}: ${item.title}`);
      button.textContent = selected.has(key(item)) ? "Added" : "Add";
      button.addEventListener("click", () => choose(item));
      card.append(button);
      fragment.append(card);
    });
    grid.append(fragment);
    if (focusKey) {
      [...grid.querySelectorAll("[data-reference-id]")].find((button) => button.dataset.referenceId === focusKey)?.focus({ preventScroll: true });
    }
  }

  async function activate(kind) {
    active = kind;
    tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.referenceKind === kind)));
    search.value = "";
    search.placeholder = placeholders[kind];
    searchLabel.textContent = searchLabels[kind];
    results.scrollTop = 0;
    grid.replaceChildren();
    resultsCount.textContent = `Loading ${kind === "tattoo" ? "tattoos" : kind === "design" ? "designs" : "symbols"}…`;
    try {
      await loadKind(kind);
      if (active === kind) render();
    } catch {
      if (active !== kind) return;
      resultsCount.textContent = "Could not load these examples.";
      status.textContent = "Please try this group again, or name the example below.";
    }
  }

  opener.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    opener.setAttribute("aria-expanded", String(open));
    mark.textContent = open ? "−" : "+";
    if (open) activate(active);
  });
  tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab.dataset.referenceKind)));
  search.addEventListener("input", render);

  global.SixWellTattooReferencePicker = Object.freeze({
    addPortfolioReference(item) {
      const normalized = normalizeTattoo(item);
      if (normalized && !selected.has(key(normalized)) && selected.size < 3) {
        selected.set(key(normalized), normalized);
        syncSelected();
        render();
      }
    },
    selectionSummary() {
      return [...selected.values()].map((item) => `${labels[item.kind]}: ${item.title}`).join("; ") || "None selected";
    },
  });
})(window);
