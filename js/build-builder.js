import { buildCompositionSnapshot, relatedSymbolIds } from "./build-composition.js";

/* ============================================================
   ART.PILL "BUILD A BRIEF" — visual-language symbol builder
   Data-driven from the managed Legend API, with the bundled JSON as an outage fallback.
   Each symbol renders its mark + meaning + "seen in" examples.
   Selections (max 12) form the brief carried into the submission form.
============================================================ */
(function () {
  "use strict";

  const MAX_SELECTIONS = 12;
  const NOTE_MAX_LENGTH = 300;
  const AUTOSAVE_DELAY_MS = 600;
  const STORAGE_KEY = "art-pill-build-brief-draft:v1";
  const TOKEN_STORAGE_KEY = "art-pill-build-brief-resume-token";
  const DATA_URL = "/assets/build/symbols.json";
  const LEGEND_URL = "/api/legend";
  const CATEGORY_URL = "/api/legend/categories";
  const COMPOSITION_RULES_URL = "/api/legend/composition-rules";
  const PREFERRED_THEMES = [
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
  const selIdsInput = el("selectedSymbolIds");
  const selSummary = el("selectedSummary");
  const summaryTags = el("summaryTags");
  const selectionStatus = el("selectionStatus");
  const mobileTray = el("mobileSelectionTray");
  const mobileTrayToggle = el("mobileTrayToggle");
  const mobileTrayPanel = el("mobileTrayPanel");
  const mobileTrayCount = el("mobileTrayCount");
  const mobileTrayItems = el("mobileTrayItems");
  const mobileTrayContinue = el("mobileTrayContinue");
  const builderState = el("builderState");
  const builderStateText = el("builderStateText");
  const legendRetry = el("legendRetry");
  const buildForm = el("buildBriefForm");
  const symbolSelectionsInput = el("symbolSelectionsJson");
  const buildDraftStatus = el("buildDraftStatus");
  const mobileBuildDraftStatus = el("mobileBuildDraftStatus");
  const briefEmailSave = el("briefEmailSave");
  const mobileEmailSave = el("mobileEmailSave");
  const briefClearDraft = el("briefClearDraft");
  const emailDialog = el("buildDraftEmailDialog");
  const emailForm = el("buildDraftEmailForm");
  const emailInput = el("buildDraftEmail");
  const emailStatus = el("buildDraftEmailStatus");
  const emailSubmit = el("buildDraftEmailSubmit");
  const emailClose = el("buildDraftEmailClose");
  const emailCancel = el("buildDraftEmailCancel");
  const compositionInput = el("compositionSnapshotJson");
  const briefComposition = el("briefComposition");
  const briefCompositionText = el("briefCompositionText");
  const briefCompositionRules = el("briefCompositionRules");
  const mobileComposition = el("mobileComposition");
  const mobileCompositionText = el("mobileCompositionText");
  const mobileCompositionRules = el("mobileCompositionRules");
  const drawer = el("legendDrawer");
  const drawerScrim = el("legendDrawerScrim");
  const drawerClose = el("legendDrawerClose");
  const drawerTitle = el("legendDrawerTitle");
  const drawerCategory = el("legendDrawerCategory");
  const drawerMark = el("legendDrawerMark");
  const drawerBody = el("legendDrawerBody");
  const drawerSelect = el("legendDrawerSelect");
  const drawerPrevious = el("legendDrawerPrevious");
  const drawerNext = el("legendDrawerNext");
  const drawerFullRecord = el("legendDrawerFullRecord");
  const drawerNoteInput = el("legendDrawerNoteInput");
  const drawerNoteHelp = el("legendDrawerNoteHelp");
  const drawerNoteCount = el("legendDrawerNoteCount");

  if (!symbolGrid) return; // builder not present on this page

  const params = new URLSearchParams(location.search);
  const PERSISTENCE_DISABLED = params.has("kiosk") || params.get("preview") === "1";
  let SYMBOLS = [];
  let COMPOSITION_RULES = [];
  const byId = new Map();
  const selected = new Set();
  const selectionMeta = new Map();
  const notes = new Map();
  let activeCategory = "All";
  let activeTheme = "All";
  let saveTimer = 0;
  let serverDraft = null;
  let resumeToken = "";
  let restoring = false;
  let clientDraftId = crypto.randomUUID ? crypto.randomUUID() : `build-${Date.now()}`;
  let drawerSymbolId = "";
  let drawerTrigger = null;
  let restoredCompositionSnapshot = null;

  function announce(message) {
    if (!selectionStatus) return;
    selectionStatus.textContent = "";
    window.requestAnimationFrame(() => { selectionStatus.textContent = message; });
  }

  function setBuilderState(message = "", state = "") {
    if (!builderState || !builderStateText) return;
    builderState.hidden = !message;
    builderState.dataset.state = state;
    builderStateText.textContent = message;
    if (legendRetry) legendRetry.hidden = state !== "error";
  }

  function setFiltersDisabled(disabled) {
    if (filterRow) filterRow.disabled = disabled;
    if (themeFilterRow) themeFilterRow.disabled = disabled;
  }

  function setDraftStatus(message, state = "") {
    [buildDraftStatus, mobileBuildDraftStatus].forEach((status) => {
      if (!status) return;
      status.textContent = message;
      status.dataset.state = state;
    });
  }

  function fieldValue(id) {
    return String(el(id)?.value || "");
  }

  function setOwnerEmailLock(ownerEmail = "") {
    const contactEmail = el("email");
    const locked = Boolean(ownerEmail);
    if (contactEmail) {
      if (locked) contactEmail.value = ownerEmail;
      contactEmail.readOnly = locked;
    }
    if (emailInput) {
      if (locked) emailInput.value = ownerEmail;
      emailInput.readOnly = locked;
    }
  }

  function currentSymbolSelections() {
    return [...selected].map((id, order) => {
      const symbol = byId.get(id);
      const meta = selectionMeta.get(id) || {};
      return {
        id,
        order,
        name: symbol?.name || meta.name || id,
        category: symbol?.category || meta.category || "Unavailable",
        note: String(notes.get(id) || "").slice(0, NOTE_MAX_LENGTH),
      };
    });
  }

  function currentCompositionSnapshot() {
    const ids = [...selected];
    const restoredIds = Array.isArray(restoredCompositionSnapshot?.selectedSymbolIds)
      ? restoredCompositionSnapshot.selectedSymbolIds
      : [];
    if (
      restoredCompositionSnapshot
      && ids.length === restoredIds.length
      && ids.every((id, index) => id === restoredIds[index])
    ) return restoredCompositionSnapshot;
    return buildCompositionSnapshot({
      symbols: SYMBOLS,
      rules: COMPOSITION_RULES,
      selectedIds: ids,
    });
  }

  function currentDraftPayload() {
    return {
      version: 1,
      clientDraftId,
      symbolSelections: currentSymbolSelections(),
      compositionSnapshot: currentCompositionSnapshot(),
      contact: {
        firstName: fieldValue("firstName"),
        lastName: fieldValue("lastName"),
        email: fieldValue("email"),
        phone: fieldValue("phone"),
      },
      placement: fieldValue("placement"),
      scale: fieldValue("scale"),
      budgetRange: fieldValue("budgetRange"),
      budgetAmountDollars: fieldValue("budgetAmountDollars"),
      timeline: fieldValue("timeline"),
      designIntent: fieldValue("designIntent"),
      message: fieldValue("message"),
      updatedAt: new Date().toISOString(),
    };
  }

  function hasDraftContent(payload = currentDraftPayload()) {
    return payload.symbolSelections.length > 0
      || Boolean(payload.designIntent || payload.placement || payload.budgetRange || payload.message);
  }

  function saveLocal(payload) {
    if (PERSISTENCE_DISABLED) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...payload,
        serverDraftId: serverDraft?.id || "",
        serverRevision: serverDraft?.revision || 0,
      }));
      if (briefClearDraft) briefClearDraft.hidden = false;
    } catch {
      setDraftStatus("This browser could not save the draft.", "error");
    }
  }

  function loadLocal() {
    if (PERSISTENCE_DISABLED) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return parsed && parsed.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  function storeResumeToken(token) {
    resumeToken = token || "";
    try {
      if (resumeToken) sessionStorage.setItem(TOKEN_STORAGE_KEY, resumeToken);
      else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {}
  }

  function readResumeToken() {
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    const fromLink = fragment.get("resume") || "";
    if (fromLink) {
      history.replaceState(null, "", location.pathname + location.search);
      storeResumeToken(fromLink);
      return fromLink;
    }
    try { return sessionStorage.getItem(TOKEN_STORAGE_KEY) || ""; } catch { return ""; }
  }

  function populateTextFields(payload) {
    const values = {
      firstName: payload.contact?.firstName,
      lastName: payload.contact?.lastName,
      email: payload.contact?.email,
      phone: payload.contact?.phone,
      placement: payload.placement,
      scale: payload.scale,
      budgetRange: payload.budgetRange,
      budgetAmountDollars: payload.budgetAmountDollars,
      timeline: payload.timeline,
      designIntent: payload.designIntent,
      message: payload.message,
    };
    Object.entries(values).forEach(([id, value]) => {
      const input = el(id);
      if (input) input.value = String(value || "");
    });
    window.SixWellTattooBudget?.sync(buildForm);
  }

  function applyDraftPayload(payload) {
    restoring = true;
    selected.clear();
    notes.clear();
    selectionMeta.clear();
    restoredCompositionSnapshot = null;
    clientDraftId = payload.clientDraftId || clientDraftId;
    restoredCompositionSnapshot = payload.compositionSnapshot && typeof payload.compositionSnapshot === "object"
      ? payload.compositionSnapshot
      : null;
    (Array.isArray(payload.symbolSelections) ? payload.symbolSelections : []).slice(0, MAX_SELECTIONS).forEach((entry) => {
      const id = String(entry?.id || "").trim();
      if (!id || selected.has(id)) return;
      selected.add(id);
      notes.set(id, String(entry.note || "").slice(0, NOTE_MAX_LENGTH));
      selectionMeta.set(id, {
        name: String(entry.name || id),
        category: String(entry.category || "Unavailable"),
      });
    });
    populateTextFields(payload);
    symbolGrid.querySelectorAll(".symbol-card").forEach((card) => {
      const on = selected.has(card.dataset.id);
      card.classList.toggle("selected", on);
      card.setAttribute("aria-pressed", String(on));
    });
    updateBrief();
    restoring = false;
  }

  async function syncServer(payload) {
    if (!resumeToken || !serverDraft || PERSISTENCE_DISABLED) {
      setDraftStatus("Saved on this device.");
      return;
    }
    try {
      const response = await fetch("/api/build-drafts/current", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${resumeToken}`,
        },
        body: JSON.stringify({ revision: serverDraft.revision, payload }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && result.draft) {
          serverDraft = result.draft;
          setDraftStatus("Online draft changed elsewhere. Saved on this device; reopen the email link to reconcile.", "error");
          return;
        }
        throw new Error(result.error || "Online save failed.");
      }
      serverDraft = result.draft;
      saveLocal(payload);
      setDraftStatus("Saved online.");
    } catch {
      setDraftStatus("Saved on this device — online save pending.", "error");
    }
  }

  function scheduleSave() {
    if (restoring || PERSISTENCE_DISABLED) return;
    window.clearTimeout(saveTimer);
    setDraftStatus("Saving…");
    saveTimer = window.setTimeout(async () => {
      const payload = currentDraftPayload();
      saveLocal(payload);
      await syncServer(payload);
    }, AUTOSAVE_DELAY_MS);
  }

  async function restoreDrafts() {
    if (PERSISTENCE_DISABLED) {
      setDraftStatus("Draft saving is unavailable in preview or kiosk mode.");
      return;
    }
    const local = loadLocal();
    const token = readResumeToken();
    if (!token) {
      if (local && hasDraftContent(local)) {
        applyDraftPayload(local);
        setDraftStatus("Draft restored from this device.");
        if (briefClearDraft) briefClearDraft.hidden = false;
      }
      return;
    }
    resumeToken = token;
    try {
      const response = await fetch("/api/build-drafts/current", {
        headers: { authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to open this draft.");
      const remote = result.draft;
      const unrelatedLocal = local && hasDraftContent(local)
        && (!local.serverDraftId || local.serverDraftId !== remote.id);
      const openRemote = !unrelatedLocal || window.confirm(
        "A different build is saved on this device. Select OK to open the emailed draft, or Cancel to keep the device draft."
      );
      if (openRemote) {
        serverDraft = remote;
        applyDraftPayload(remote.payload || {});
        setOwnerEmailLock(remote.email || remote.payload?.contact?.email || "");
        saveLocal(remote.payload || {});
        setDraftStatus("Emailed draft restored. Saved online.");
      } else {
        storeResumeToken("");
        applyDraftPayload(local);
        setDraftStatus("Kept the draft saved on this device.");
      }
    } catch (error) {
      if (local && hasDraftContent(local)) applyDraftPayload(local);
      setDraftStatus(error.message || "The emailed draft could not be opened.", "error");
    }
  }

  function closeEmailDialog() {
    if (emailDialog?.open) emailDialog.close();
  }

  function openEmailDialog() {
    if (!selected.size || PERSISTENCE_DISABLED || !emailDialog) return;
    if (emailInput) emailInput.value = serverDraft?.email || fieldValue("email");
    setOwnerEmailLock(serverDraft?.email || "");
    if (emailStatus) emailStatus.textContent = "";
    emailDialog.showModal();
    window.setTimeout(() => emailInput?.focus(), 0);
  }

  async function emailDraft() {
    if (!emailInput?.reportValidity()) return;
    const email = emailInput.value.trim();
    if (emailSubmit) emailSubmit.disabled = true;
    if (emailStatus) emailStatus.textContent = "Saving this draft and preparing your link…";
    try {
      let response;
      if (resumeToken && serverDraft) {
        response = await fetch("/api/build-drafts/current/email", {
          method: "POST",
          headers: { authorization: `Bearer ${resumeToken}` },
        });
      } else {
        const payload = currentDraftPayload();
        payload.contact.email = email;
        response = await fetch("/api/build-drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "build_brief", email, payload }),
        });
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The resume email could not be sent.");
      if (result.resumeToken) storeResumeToken(result.resumeToken);
      if (result.draft) serverDraft = result.draft;
      if (el("email") && !fieldValue("email")) el("email").value = email;
      setOwnerEmailLock(serverDraft?.email || email);
      saveLocal(currentDraftPayload());
      const sent = result.emailSent !== false;
      if (emailStatus) {
        emailStatus.textContent = sent
          ? "Your private resume link was emailed. Future edits will save online."
          : `The draft is saved online, but the email was not sent. ${result.deliveryError || "Try again."}`;
      }
      setDraftStatus(sent ? "Saved online. Resume link emailed." : "Saved online — email delivery needs another try.", sent ? "" : "error");
      if (sent) window.setTimeout(closeEmailDialog, 900);
    } catch (error) {
      if (emailStatus) emailStatus.textContent = error.message || "The resume email could not be sent.";
    } finally {
      if (emailSubmit) emailSubmit.disabled = false;
    }
  }

  async function clearDraft() {
    if (!window.confirm("Clear the saved Build draft and revoke its emailed resume link?")) return;
    if (resumeToken && serverDraft) {
      await fetch("/api/build-drafts/current", {
        method: "DELETE",
        headers: { authorization: `Bearer ${resumeToken}` },
      }).catch(() => {});
    }
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    storeResumeToken("");
    serverDraft = null;
    setOwnerEmailLock("");
    selected.clear();
    notes.clear();
    selectionMeta.clear();
    restoredCompositionSnapshot = null;
    buildForm?.reset();
    symbolGrid.querySelectorAll(".symbol-card").forEach((card) => {
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    });
    updateBrief();
    if (briefClearDraft) briefClearDraft.hidden = true;
    setDraftStatus("Saved draft cleared.");
  }

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  function continueToForm() {
    window.SixWellAnalytics?.track("interactive_milestone", { action: "build-brief", itemId: "build-your-own", progress: 75, count: selected.size });
    const intent = document.getElementById("designIntent");
    const form = document.getElementById("build-form");
    if (form) form.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => intent?.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 450);
  }

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
    select.onchange = () => {
      onSelect(select.value);
      filterSymbols();
    };
  }

  function buildFilters() {
    const categories = [
      "All",
      ...new Set(SYMBOLS.map((s) => s.category).filter(Boolean)),
    ];
    const availableThemes = new Set(
      SYMBOLS.flatMap((s) => (Array.isArray(s.themes) ? s.themes : [])).filter(Boolean)
    );
    const preferredThemes = PREFERRED_THEMES.filter((theme) => availableThemes.has(theme));
    const otherThemes = [...availableThemes]
      .filter((theme) => !PREFERRED_THEMES.includes(theme))
      .sort((a, b) => a.localeCompare(b));
    const themes = ["All", ...preferredThemes, ...otherThemes];

    buildSelect(filterRow, categories, activeCategory, (value) => {
      activeCategory = value;
      window.SixWellAnalytics?.track("filter_change", { action: "build-category", itemId: value });
    });
    buildSelect(themeFilterRow, themes, activeTheme, (value) => {
      activeTheme = value;
      window.SixWellAnalytics?.track("filter_change", { action: "build-theme", itemId: value });
    });
  }

  function filterSymbols() {
    document.querySelectorAll(".symbol-card-shell").forEach((shell) => {
      const themes = (shell.dataset.themes || "").split("|").filter(Boolean);
      const categoryMatch =
        activeCategory === "All" || shell.dataset.category === activeCategory;
      const themeMatch = activeTheme === "All" || themes.includes(activeTheme);
      const show = categoryMatch && themeMatch;
      shell.dataset.hidden = show ? "false" : "true";
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
      const shell = document.createElement("article");
      shell.className = "symbol-card-shell";
      shell.dataset.id = sym.id;
      shell.dataset.category = sym.category;
      shell.dataset.themes = Array.isArray(sym.themes) ? sym.themes.join("|") : "";
      shell.dataset.hidden = "false";
      const card = document.createElement("button");
      card.type = "button";
      card.className = "symbol-card";
      card.dataset.id = sym.id;
      card.dataset.name = sym.name;
      card.setAttribute("aria-pressed", "false");
      card.setAttribute("aria-label", `Add ${sym.name} to your build`);
      card.innerHTML = `
        ${markup(sym)}
        <span class="symbol-cat">${escapeHtml(sym.category)}</span>
        <span class="symbol-name">${escapeHtml(sym.name)}</span>
        <span class="symbol-meaning">${escapeHtml(sym.essence || sym.meaning)}</span>
        <span class="symbol-indicator"><span></span></span>
      `;
      card.addEventListener("click", () => toggleSymbol(sym, card));
      const info = document.createElement("button");
      info.type = "button";
      info.className = "symbol-info-button";
      info.textContent = "i";
      info.setAttribute("aria-label", `Learn about ${sym.name}`);
      info.addEventListener("click", () => openDrawer(sym.id, info));
      shell.append(card, info);
      symbolGrid.appendChild(shell);
    });
  }

  /* ── SELECTION LOGIC ── */
  function toggleSymbol(sym, card) {
    restoredCompositionSnapshot = null;
    if (selected.has(sym.id)) {
      selected.delete(sym.id);
      window.SixWellAnalytics?.track("interactive_milestone", { action: "symbol-remove", itemId: sym.id, count: selected.size });
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
      updateBrief(`${sym.name} removed. ${selected.size} of ${MAX_SELECTIONS} selected.`);
      scheduleSave();
      return;
    } else {
      if (selected.size >= MAX_SELECTIONS) {
        announce(`Selection limit reached. Remove one of the ${MAX_SELECTIONS} selected symbols before adding ${sym.name}.`);
        briefLimit?.classList.add("visible");
        return;
      }
      selected.add(sym.id);
      window.SixWellAnalytics?.track(selected.size === 1 ? "interactive_start" : "interactive_milestone", { action: "symbol-add", itemId: sym.id, count: selected.size });
      selectionMeta.set(sym.id, { name: sym.name, category: sym.category });
      card.classList.add("selected");
      card.setAttribute("aria-pressed", "true");
    }
    updateBrief(`${sym.name} added. ${selected.size} of ${MAX_SELECTIONS} selected.`);
    scheduleSave();
  }

  function removeSymbol(id) {
    restoredCompositionSnapshot = null;
    selected.delete(id);
    const card = symbolGrid.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    }
    updateBrief(`${byId.get(id)?.name || "Symbol"} removed. ${selected.size} of ${MAX_SELECTIONS} selected.`);
    scheduleSave();
  }

  function noteEditor(id) {
    const note = String(notes.get(id) || "");
    return `
      <label class="brief-item-note">
        <span>What does this symbol mean to you? (optional)</span>
        <textarea data-symbol-note="${escapeHtml(id)}" maxlength="${NOTE_MAX_LENGTH}" rows="3">${escapeHtml(note)}</textarea>
        <span class="brief-note-meta"><span>Saved with this symbol</span><span data-note-count="${escapeHtml(id)}">${note.length} / ${NOTE_MAX_LENGTH}</span></span>
      </label>
    `;
  }

  function renderComposition() {
    const snapshot = currentCompositionSnapshot();
    const visible = selected.size > 0 && Boolean(snapshot.reading);
    const relationships = (snapshot.appliedRules || []).map((rule) =>
      `<li><strong>${escapeHtml(rule.type === "tension" ? "Tension" : "Authored relationship")}:</strong> ${escapeHtml(rule.interpretation)}</li>`
    ).join("");
    [
      [briefComposition, briefCompositionText, briefCompositionRules],
      [mobileComposition, mobileCompositionText, mobileCompositionRules],
    ].forEach(([container, textNode, list]) => {
      if (!container) return;
      container.hidden = !visible;
      if (textNode) textNode.textContent = visible ? snapshot.reading : "";
      if (list) list.innerHTML = relationships;
    });
    if (compositionInput) compositionInput.value = JSON.stringify(snapshot);
  }

  function drawerSection(title, content, { list = false, className = "" } = {}) {
    if (!content || (Array.isArray(content) && content.length === 0)) return "";
    const body = Array.isArray(content)
      ? `<ul class="${className}">${content.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p>${escapeHtml(content)}</p>`;
    return `<section class="legend-detail-section"><h3>${escapeHtml(title)}</h3>${body}</section>`;
  }

  function renderDrawer() {
    const sym = byId.get(drawerSymbolId);
    if (!sym || !drawer) return;
    const guidance = sym.buildGuidance || {};
    const context = sym.context || {};
    const authoredContext = [
      context.cultural_context ? `Inherited context: ${context.cultural_context}` : "",
      context.personal_relationship ? `Artist relationship: ${context.personal_relationship}` : "",
      context.reorientation?.statement ? `Reorientation: ${context.reorientation.statement}` : "",
      context.overlap_or_tension ? `Where meanings meet or resist: ${context.overlap_or_tension}` : "",
      context.viewer_opening ? `What remains open: ${context.viewer_opening}` : "",
    ].filter(Boolean);
    const applications = (Array.isArray(sym.applications) ? sym.applications : [])
      .map((entry) => [entry.title, entry.meaning].filter(Boolean).join(": "))
      .filter(Boolean);
    const related = relatedSymbolIds(COMPOSITION_RULES, sym.id)
      .map((id) => byId.get(id)?.name)
      .filter(Boolean);
    drawerTitle.textContent = sym.name;
    drawerCategory.textContent = sym.category;
    drawerMark.innerHTML = markup(sym).replace('class="symbol-mark"', 'class="legend-symbol-mark"');
    drawerBody.innerHTML = [
      drawerSection("Core meaning", sym.meaning),
      drawerSection("In the Legend", authoredContext, { list: true }),
      drawerSection("Emotional tones", guidance.emotionalTones || [], { list: true, className: "legend-tone-list" }),
      drawerSection("Questions to consider", guidance.reflectionQuestions || [], { list: true }),
      drawerSection("Applications and form changes", applications, { list: true }),
      drawerSection("Related symbols", related, { list: true, className: "legend-related-list" }),
    ].join("");
    const isSelected = selected.has(sym.id);
    drawerSelect.textContent = isSelected ? "Remove from Build" : "Add to Build";
    drawerSelect.disabled = !isSelected && selected.size >= MAX_SELECTIONS;
    drawerNoteInput.dataset.symbolNote = sym.id;
    drawerNoteInput.value = String(notes.get(sym.id) || "");
    drawerNoteInput.disabled = !isSelected;
    drawerNoteHelp.textContent = isSelected ? "Saved with this symbol." : "Add this symbol to enable your description.";
    drawerNoteCount.textContent = `${drawerNoteInput.value.length} / ${NOTE_MAX_LENGTH}`;
    drawerFullRecord.href = sym.canonicalRoute || sym.canonical_route || `/about/legend/${encodeURIComponent(sym.slug || sym.id)}/`;
    const index = SYMBOLS.findIndex((symbol) => symbol.id === sym.id);
    drawerPrevious.disabled = index <= 0;
    drawerNext.disabled = index < 0 || index >= SYMBOLS.length - 1;
  }

  function openDrawer(symbolId, trigger = null) {
    if (!byId.has(symbolId) || !drawer) return;
    drawerSymbolId = symbolId;
    drawerTrigger = trigger || drawerTrigger;
    renderDrawer();
    drawer.hidden = false;
    if (drawerScrim) drawerScrim.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => drawerClose?.focus(), 0);
  }

  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    if (drawerScrim) drawerScrim.hidden = true;
    document.body.style.overflow = "";
    const trigger = drawerTrigger;
    drawerTrigger = null;
    trigger?.focus();
  }

  function moveDrawer(direction) {
    const index = SYMBOLS.findIndex((symbol) => symbol.id === drawerSymbolId);
    const next = SYMBOLS[index + direction];
    if (!next) return;
    drawerSymbolId = next.id;
    renderDrawer();
    drawerTitle?.focus?.();
  }

  function updateBrief(statusMessage = "") {
    const count = selected.size;
    briefCount.textContent = `${count} of ${MAX_SELECTIONS}`;
    briefEmpty.style.display = count === 0 ? "block" : "none";
    briefLimit.classList.toggle("visible", count >= MAX_SELECTIONS);
    symbolGrid.querySelectorAll(".symbol-card").forEach((card) => {
      const unavailableAtLimit = count >= MAX_SELECTIONS && !selected.has(card.dataset.id);
      card.setAttribute("aria-disabled", String(unavailableAtLimit));
      card.setAttribute("aria-label", `${selected.has(card.dataset.id) ? "Remove" : "Add"} ${card.dataset.name} ${selected.has(card.dataset.id) ? "from" : "to"} your build`);
    });

    briefItems.innerHTML = "";
    selected.forEach((id) => {
      const sym = byId.get(id);
      const meta = selectionMeta.get(id) || {};
      const name = sym?.name || meta.name || id;
      const category = sym?.category || meta.category || "Unavailable";
      const li = document.createElement("li");
      li.className = `brief-item${sym ? "" : " unavailable"}`;
      li.innerHTML = `
        <div class="brief-item-left">
          <span class="brief-item-cat">${escapeHtml(category)}</span>
          <span class="brief-item-name">${escapeHtml(name)}</span>
          ${sym ? "" : '<span class="brief-item-unavailable">This symbol is no longer available. Remove it before submitting.</span>'}
        </div>
        <button class="brief-item-remove" type="button" aria-label="Remove ${escapeHtml(
          name
        )}">&times;</button>
        ${noteEditor(id)}
      `;
      li.querySelector(".brief-item-remove").addEventListener("click", () =>
        removeSymbol(id)
      );
      briefItems.appendChild(li);
    });

    if (briefBegin) briefBegin.disabled = count === 0;
    if (briefEmailSave) briefEmailSave.disabled = count === 0 || PERSISTENCE_DISABLED;
    if (mobileEmailSave) mobileEmailSave.disabled = count === 0 || PERSISTENCE_DISABLED;

    const names = [...selected]
      .map((id) => byId.get(id)?.name || selectionMeta.get(id)?.name || id)
      .filter(Boolean);
    const ids = [...selected];
    if (selInput) selInput.value = names.join(", ");
    if (selIdsInput) selIdsInput.value = ids.join(",");
    if (symbolSelectionsInput) symbolSelectionsInput.value = JSON.stringify(currentSymbolSelections());
    if (selSummary) selSummary.classList.toggle("visible", count > 0);
    if (summaryTags) {
      summaryTags.innerHTML = names
        .map((n) => `<span class="summary-tag">${escapeHtml(n)}</span>`)
        .join("");
    }

    if (mobileTray) {
      mobileTray.classList.toggle("visible", count > 0);
      document.body.classList.toggle("has-mobile-selection-tray", count > 0);
    }
    if (mobileTrayCount) mobileTrayCount.textContent = `${count} of ${MAX_SELECTIONS}`;
    if (mobileTrayItems) {
      mobileTrayItems.innerHTML = "";
      ids.forEach((id) => {
        const sym = byId.get(id);
        const meta = selectionMeta.get(id) || {};
        const name = sym?.name || meta.name || id;
        const item = document.createElement("li");
        item.innerHTML = `<span>${escapeHtml(name)}</span><button type="button" aria-label="Remove ${escapeHtml(name)}">&times;</button>${sym ? "" : '<span class="brief-item-unavailable">Unavailable</span>'}${noteEditor(id)}`;
        item.querySelector("button").addEventListener("click", () => removeSymbol(id));
        mobileTrayItems.appendChild(item);
      });
    }
    renderComposition();
    if (drawerSymbolId && !drawer?.hidden) renderDrawer();
    if (statusMessage) announce(statusMessage);
  }

  function handleNoteInput(event) {
    const input = event.target.closest?.("[data-symbol-note]");
    if (!input) return;
    const id = input.dataset.symbolNote;
    const value = input.value.slice(0, NOTE_MAX_LENGTH);
    notes.set(id, value);
    document.querySelectorAll("[data-symbol-note]").forEach((other) => {
      if (other !== input && other.dataset.symbolNote === id) other.value = value;
    });
    document.querySelectorAll("[data-note-count]").forEach((count) => {
      if (count.dataset.noteCount === id) count.textContent = `${value.length} / ${NOTE_MAX_LENGTH}`;
    });
    if (symbolSelectionsInput) symbolSelectionsInput.value = JSON.stringify(currentSymbolSelections());
    scheduleSave();
  }

  briefItems?.addEventListener("input", handleNoteInput);
  mobileTrayItems?.addEventListener("input", handleNoteInput);
  drawerNoteInput?.addEventListener("input", handleNoteInput);
  drawerClose?.addEventListener("click", closeDrawer);
  drawerScrim?.addEventListener("click", closeDrawer);
  drawerSelect?.addEventListener("click", () => {
    const sym = byId.get(drawerSymbolId);
    const card = symbolGrid.querySelector(`.symbol-card[data-id="${CSS.escape(drawerSymbolId)}"]`);
    if (sym && card) toggleSymbol(sym, card);
  });
  drawerPrevious?.addEventListener("click", () => moveDrawer(-1));
  drawerNext?.addEventListener("click", () => moveDrawer(1));
  drawer?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...drawer.querySelectorAll('button:not([disabled]),a[href]:not([hidden]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  if (briefBegin) {
    briefBegin.addEventListener("click", continueToForm);
  }

  mobileTrayToggle?.addEventListener("click", () => {
    const expanded = mobileTrayToggle.getAttribute("aria-expanded") === "true";
    mobileTrayToggle.setAttribute("aria-expanded", String(!expanded));
    if (mobileTrayPanel) mobileTrayPanel.hidden = expanded;
  });
  mobileTrayContinue?.addEventListener("click", continueToForm);
  briefEmailSave?.addEventListener("click", openEmailDialog);
  mobileEmailSave?.addEventListener("click", openEmailDialog);
  briefClearDraft?.addEventListener("click", clearDraft);
  emailClose?.addEventListener("click", closeEmailDialog);
  emailCancel?.addEventListener("click", closeEmailDialog);
  emailForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    emailDraft();
  });
  emailDialog?.addEventListener("click", (event) => {
    if (event.target === emailDialog) closeEmailDialog();
  });
  buildForm?.addEventListener("input", (event) => {
    const input = event.target;
    if (!input?.name || input.type === "file" || input.type === "checkbox" || input.name === "_gotcha") return;
    scheduleSave();
  });

  window.ArtPillBuildDrafts = {
    symbolSelections: currentSymbolSelections,
    compositionSnapshot: currentCompositionSnapshot,
    hasUnavailableSymbols: () => [...selected].some((id) => !byId.has(id)),
    submissionHeaders: () => resumeToken ? { "x-build-draft-token": resumeToken } : {},
    complete: () => {
      window.SixWellAnalytics?.track("interactive_complete", { action: "build-submitted", itemId: "build-your-own", progress: 100, count: selected.size });
      window.clearTimeout(saveTimer);
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      storeResumeToken("");
      serverDraft = null;
      setOwnerEmailLock("");
    },
  };

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
        slug: symbol.slug || symbol.id,
        category: categories.get(symbol.category_id)?.name || symbol.category_id || "Unclassified",
        categoryOrder: categories.get(symbol.category_id)?.order ?? Number.MAX_SAFE_INTEGER,
        name: symbol.name,
        meaning: symbol.meaning,
        essence: symbol.buildGuidance?.essence || "",
        svg: symbol.svg_markup || "",
        examples: Array.isArray(symbol.examples) ? symbol.examples : [],
        themes: Array.isArray(symbol.themes) ? symbol.themes : [],
        context: symbol.context && typeof symbol.context === "object" ? symbol.context : {},
        applications: Array.isArray(symbol.applications) ? symbol.applications : [],
        buildGuidance: symbol.buildGuidance && typeof symbol.buildGuidance === "object"
          ? symbol.buildGuidance
          : {},
        sortOrder: Number(symbol.sort_order || 0),
      }))
      .sort((a, b) => a.categoryOrder - b.categoryOrder || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async function init() {
    setBuilderState("Loading the Legend.", "loading");
    setFiltersDisabled(true);
    symbolGrid.setAttribute("aria-busy", "true");
    symbolGrid.innerHTML = "";
    byId.clear();
    let loadState = "managed";
    try {
      SYMBOLS = await loadManagedSymbols();
      try {
        const rulesResponse = await fetch(COMPOSITION_RULES_URL, { cache: "no-store", headers: { accept: "application/json" } });
        if (!rulesResponse.ok) throw new Error("Composition rules unavailable");
        const rulesPayload = await rulesResponse.json();
        COMPOSITION_RULES = Array.isArray(rulesPayload.records) ? rulesPayload.records : [];
      } catch {
        COMPOSITION_RULES = [];
      }
    } catch {
      loadState = "fallback";
      COMPOSITION_RULES = [];
      try {
        const res = await fetch(DATA_URL, { cache: "no-cache" });
        if (!res.ok) throw new Error("Bundled Legend unavailable");
        const data = await res.json();
        SYMBOLS = Array.isArray(data.symbols) ? data.symbols : [];
      } catch {
        loadState = "error";
        SYMBOLS = [];
      }
    }
    const uniqueSymbols = new Map();
    SYMBOLS.forEach((symbol) => {
      const id = String(symbol?.id || "").trim();
      if (id && !uniqueSymbols.has(id)) uniqueSymbols.set(id, { ...symbol, id });
    });
    SYMBOLS = [...uniqueSymbols.values()];
    SYMBOLS.forEach((s) => byId.set(s.id, s));
    buildFilters();
    buildSymbols();
    updateBrief();
    symbolGrid.setAttribute("aria-busy", "false");
    setFiltersDisabled(SYMBOLS.length === 0);
    if (loadState === "error") {
      setBuilderState("The Legend could not be loaded. Refresh this page or try again.", "error");
    } else if (SYMBOLS.length === 0) {
      setBuilderState("No published Legend symbols are currently available.", "empty");
    } else {
      setBuilderState();
    }
    await restoreDrafts();
  }

  legendRetry?.addEventListener("click", init);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
