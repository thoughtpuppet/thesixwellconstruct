/* ============================================================
   ART.PILL "BUILD A BRIEF" — visual-language symbol builder
   Data-driven from /assets/build/symbols.json.
   Each symbol renders its mark + meaning + "seen in" examples.
   Selections (max 6) form the brief carried into the submission form.
============================================================ */
(function () {
  "use strict";

  const MAX_SELECTIONS = 6;
  const DATA_URL = "/assets/build/symbols.json";

  const el = (id) => document.getElementById(id);
  const filterRow = el("filterRow");
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── FILTERS ── */
  function buildFilters() {
    const categories = ["All", ...new Set(SYMBOLS.map((s) => s.category))];
    filterRow.innerHTML = "";
    categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (cat === "All" ? " active" : "");
      btn.innerHTML = `<span class="chip-label">${escapeHtml(cat)}</span>`;
      btn.addEventListener("click", () => {
        activeCategory = cat;
        document
          .querySelectorAll(".chip")
          .forEach((c) =>
            c.classList.toggle(
              "active",
              c.querySelector(".chip-label").textContent === cat
            )
          );
        filterSymbols();
      });
      filterRow.appendChild(btn);
    });
  }

  function filterSymbols() {
    document.querySelectorAll(".symbol-card").forEach((card) => {
      const show =
        activeCategory === "All" || card.dataset.category === activeCategory;
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
          ex.src
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
  async function init() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-cache" });
      const data = await res.json();
      SYMBOLS = Array.isArray(data.symbols) ? data.symbols : [];
    } catch (err) {
      SYMBOLS = [];
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
