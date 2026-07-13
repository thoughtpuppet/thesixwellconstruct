/* ============================================================
   ART.PILL "BUILD A BRIEF" — visual-language symbol builder
   Data-driven from the managed Legend API, with the bundled JSON as an outage fallback.
   Each symbol renders its mark + meaning + "seen in" examples.
   Selections (max 12) form the brief carried into the submission form.
============================================================ */
(function () {
  "use strict";

  const MAX_SELECTIONS = 12;
  const DATA_URL = "/assets/build/symbols.json";
  const LEGEND_URL = "/api/legend";
  const CATEGORY_URL = "/api/legend/categories";
  const PUBLIC_THEMES = [
    "protection",
    "memory",
    "transformation",
    "body",
    "threshold",
    "devotion",
    "movement",
    "witness",
    "release",
    "identity",
  ];

  const el = (id) => document.getElementById(id);
  const filterRow = el("filterRow");
  const themeFilterRow = el("themeFilterRow");
  const symbolGrid = el("symbolGrid");
  const briefItems = el("briefItems");
  const briefEmpty = el("briefEmpty");
  const briefCount = el("briefCount");
  const briefLimit = el("briefLimit");
  const briefBegin = el("briefBegin");
  const selInput = el("selectedElements");
  const selSummary = el("selectedSummary");
  const summaryTags = el("summaryTags");

  if (!symbolGrid) return; // builder not present on this page

  let SYMBOLS = [];
  const byId = new Map();
  const selected = new Set();
  let activeCategory = "All";
  let activeTheme = "All";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── FILTERS ── */
  function buildSelect(select, values, activeValue, onSelect) {
    if (!select) return;
    select.innerHTML = values
      .map(
        (value) =>
          `<option value="${escapeHtml(value)}"${
            value === activeValue ? " selected" : ""
          }>${escapeHtml(value)}</option>`
      )
      .join("");
    select.addEventListener("change", () => {
      onSelect(select.value);
      filterSymbols();
    });
  }

  function buildFilters() {
    const categories = [
      "All",
      ...new Set(SYMBOLS.map((s) => s.category).filter(Boolean)),
    ];
    const availableThemes = new Set(
      SYMBOLS.flatMap((s) => (Array.isArray(s.themes) ? s.themes : [])).filter(Boolean)
    );
    const themes = ["All", ...PUBLIC_THEMES.filter((theme) => availableThemes.has(theme))];

    buildSelect(filterRow, categories, activeCategory, (value) => {
      activeCategory = value;
    });
    buildSelect(themeFilterRow, themes, activeTheme, (value) => {
      activeTheme = value;
    });
  }

  function filterSymbols() {
    document.querySelectorAll(".symbol-card").forEach((card) => {
      const themes = (card.dataset.themes || "").split("|").filter(Boolean);
      const categoryMatch =
        activeCategory === "All" || card.dataset.category === activeCategory;
      const themeMatch = activeTheme === "All" || themes.includes(activeTheme);
      const show = categoryMatch && themeMatch;
      card.dataset.hidden = show ? "false" : "true";
    });
  }

  /* ── SYMBOL CARDS ── */
  function exampleStrip(sym) {
    if (!Array.isArray(sym.examples) || sym.examples.length === 0) return "";
    const thumbs = sym.examples
      .slice(0, 4)
      .map((ex) => {
        const title = escapeHtml(ex.title || sym.name);
        return `<span class="symbol-example" title="${title}"><img src="${escapeHtml(
          ex.src || ex.image || ""
        )}" alt="${title}" loading="lazy"></span>`;
      })
      .join("");
    return `<div class="symbol-examples"><span class="symbol-examples-label">Seen in</span><div class="symbol-examples-row">${thumbs}</div></div>`;
  }

  function markup(sym) {
    // Prefer a drawn glyph image when provided, else the plain SVG mark.
    if (sym.glyph) {
      return `<span class="symbol-mark"><img src="${escapeHtml(
        sym.glyph
      )}" alt="${escapeHtml(sym.name)} mark"></span>`;
    }
    return `<span class="symbol-mark">${sym.svg || ""}</span>`;
  }

  function buildSymbols() {
    symbolGrid.innerHTML = "";
    SYMBOLS.forEach((sym) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "symbol-card";
      card.dataset.id = sym.id;
      card.dataset.category = sym.category;
      card.dataset.themes = Array.isArray(sym.themes) ? sym.themes.join("|") : "";
      card.dataset.name = sym.name;
      card.dataset.hidden = "false";
      card.setAttribute("aria-pressed", "false");
      card.innerHTML = `
        ${markup(sym)}
        <span class="symbol-cat">${escapeHtml(sym.category)}</span>
        <span class="symbol-name">${escapeHtml(sym.name)}</span>
        <span class="symbol-meaning">${escapeHtml(sym.meaning)}</span>
        ${exampleStrip(sym)}
        <span class="symbol-indicator"><span></span></span>
      `;
      card.addEventListener("click", () => toggleSymbol(sym, card));
      symbolGrid.appendChild(card);
    });
  }

  /* ── SELECTION LOGIC ── */
  function toggleSymbol(sym, card) {
    if (selected.has(sym.id)) {
      selected.delete(sym.id);
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    } else {
      if (selected.size >= MAX_SELECTIONS) return;
      selected.add(sym.id);
      card.classList.add("selected");
      card.setAttribute("aria-pressed", "true");
    }
    updateBrief();
  }

  function removeSymbol(id) {
    selected.delete(id);
    const card = symbolGrid.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    }
    updateBrief();
  }

  function updateBrief() {
    const count = selected.size;
    briefCount.textContent = `${count} of ${MAX_SELECTIONS}`;
    briefEmpty.style.display = count === 0 ? "block" : "none";
    briefLimit.classList.toggle("visible", count >= MAX_SELECTIONS);

    briefItems.innerHTML = "";
    selected.forEach((id) => {
      const sym = byId.get(id);
      if (!sym) return;
      const li = document.createElement("li");
      li.className = "brief-item";
      li.innerHTML = `
        <div class="brief-item-left">
          <span class="brief-item-cat">${escapeHtml(sym.category)}</span>
          <span class="brief-item-name">${escapeHtml(sym.name)}</span>
        </div>
        <button class="brief-item-remove" type="button" aria-label="Remove ${escapeHtml(
          sym.name
        )}">&times;</button>
      `;
      li.querySelector(".brief-item-remove").addEventListener("click", () =>
        removeSymbol(id)
      );
      briefItems.appendChild(li);
    });

    if (briefBegin) briefBegin.disabled = count === 0;

    const names = [...selected]
      .map((id) => byId.get(id)?.name)
      .filter(Boolean);
    if (selInput) selInput.value = names.join(", ");
    if (selSummary) selSummary.classList.toggle("visible", count > 0);
    if (summaryTags) {
      summaryTags.innerHTML = names
        .map((n) => `<span class="summary-tag">${escapeHtml(n)}</span>`)
        .join("");
    }
  }

  if (briefBegin) {
    briefBegin.addEventListener("click", () => {
      const form = document.getElementById("build-form");
      if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => {
        const first = document.getElementById("firstName");
        if (first) first.focus({ preventScroll: true });
      }, 600);
    });
  }

  /* ── INIT ── */
  async function loadManagedSymbols() {
    const [symbolsResponse, categoriesResponse] = await Promise.all([
      fetch(LEGEND_URL, { cache: "no-store", headers: { accept: "application/json" } }),
      fetch(CATEGORY_URL, { cache: "no-store", headers: { accept: "application/json" } }),
    ]);
    if (!symbolsResponse.ok || !categoriesResponse.ok) throw new Error("Managed Legend unavailable");
    const [symbolsPayload, categoriesPayload] = await Promise.all([
      symbolsResponse.json(),
      categoriesResponse.json(),
    ]);
    const categories = new Map((categoriesPayload.records || []).map((category, index) => [
      category.id,
      { name: category.name, order: index },
    ]));
    return (symbolsPayload.records || [])
      .map((symbol) => ({
        id: symbol.id,
        category: categories.get(symbol.category_id)?.name || symbol.category_id || "Unclassified",
        categoryOrder: categories.get(symbol.category_id)?.order ?? Number.MAX_SAFE_INTEGER,
        name: symbol.name,
        meaning: symbol.meaning,
        svg: symbol.svg_markup || "",
        examples: Array.isArray(symbol.examples) ? symbol.examples : [],
        themes: Array.isArray(symbol.themes) ? symbol.themes : [],
        sortOrder: Number(symbol.sort_order || 0),
      }))
      .sort((a, b) => a.categoryOrder - b.categoryOrder || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async function init() {
    try {
      SYMBOLS = await loadManagedSymbols();
    } catch {
      try {
        const res = await fetch(DATA_URL, { cache: "no-cache" });
        const data = await res.json();
        SYMBOLS = Array.isArray(data.symbols) ? data.symbols : [];
      } catch {
        SYMBOLS = [];
      }
    }
    SYMBOLS.forEach((s) => byId.set(s.id, s));
    buildFilters();
    buildSymbols();
    updateBrief();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
