(function () {
  "use strict";

  const TOKEN_KEY = "swc_submissions_admin_token";
  const API_ROOT = "/api/admin/crm";
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const DIRECTORY_LIMIT = 50;
  const MANAGED_VIEWS = new Set(["directory", "attention", "integrations"]);
  const NODE_OPTIONS = [
    ["node-tattoos", "Tattooing"],
    ["node-art", "Art"],
    ["node-merch", "Merch"],
    ["node-events", "Events"],
    ["node-music", "Music"],
    ["node-writings", "Writings"],
    ["node-archive", "Archive"],
    ["node-film", "Film"],
    ["node-about", "About"],
  ];
  const INTERACTION_OPTIONS = [
    ["inquiry", "Inquiry"],
    ["booking", "Booking"],
    ["appointment", "Appointment"],
    ["attendance", "Attendance"],
    ["waitlist", "Waitlist"],
    ["order", "Order"],
    ["newsletter", "Newsletter"],
    ["performance", "Performance"],
    ["collaboration", "Collaboration"],
    ["referral", "Referral"],
    ["contribution", "Contribution"],
    ["manual", "Other / manual"],
  ];
  const IMPORT_TARGETS = [
    ["", "Do not import"],
    ["name", "Full / display name"],
    ["preferred_name", "Preferred name"],
    ["first_name", "First name"],
    ["last_name", "Last name"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["instagram", "Instagram"],
    ["organization", "Organization"],
    ["pronouns", "Pronouns"],
    ["date", "Interaction date"],
    ["interaction", "Interaction type"],
    ["node", "Construct node"],
    ["amount", "Amount"],
    ["tip", "Tip"],
    ["currency", "Currency"],
    ["payment_reference", "Payment reference"],
    ["tags", "Tags"],
    ["notes", "Notes"],
    ["tier", "Tier proposal"],
    ["consent", "Newsletter consent"],
    ["provider_id", "Provider / external ID"],
  ];
  const IMPORT_TARGET_FIELDS = new Set(IMPORT_TARGETS.map(([value]) => value).filter(Boolean));
  const REVIEWABLE_IMPORT_CLASSIFICATIONS = new Set([
    "possible_match",
    "money_conflict",
    "invalid",
    "duplicate_in_file",
  ]);

  const state = {
    view: "directory",
    renderSequence: 0,
    controller: null,
    selectedPersonId: "",
    people: [],
    directoryCount: 0,
    directoryOffset: 0,
    directoryLoadSequence: 0,
    personLoadSequence: 0,
    attentionLoadSequence: 0,
    integrationsLoadSequence: 0,
    importFlow: null,
    integrationsPayload: null,
    imports: [],
  };

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.payload = payload;
    }
  }

  function elements() {
    return {
      layout: document.getElementById("layout"),
      listPane: document.getElementById("listPane"),
      toolbar: document.getElementById("toolbar"),
      list: document.getElementById("submissionList"),
      detail: document.getElementById("detailPane"),
      status: document.getElementById("status"),
    };
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  }

  function attr(value) {
    return esc(value);
  }

  function selectorEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function first(record, ...keys) {
    for (const key of keys) {
      if (record && record[key] !== undefined && record[key] !== null) return record[key];
    }
    return "";
  }

  function listFrom(payload, ...keys) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
  }

  function objectFrom(payload, ...keys) {
    for (const key of keys) {
      const value = payload?.[key];
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    }
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  }

  function jsonObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(String(value || ""));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function truthy(value) {
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function normalizedState(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function tierValue(person) {
    const raw = first(person, "tier", "relationshipTier", "relationship_tier");
    const value = ({ 1: "I", 2: "II", 3: "III" })[String(raw)] || String(raw || "").toUpperCase();
    return ["I", "II", "III"].includes(value) ? value : "";
  }

  function tierLabel(value) {
    return value ? `Tier ${value}` : "Unrated";
  }

  function personName(person) {
    return first(person, "displayName", "display_name", "preferredName", "preferred_name", "name") || "Unnamed person";
  }

  function personId(person) {
    return String(first(person, "id", "personId", "person_id") || "");
  }

  function centsValue(record, ...keys) {
    const value = first(record, ...keys);
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : 0;
  }

  function presentCents(record, ...keys) {
    for (const key of keys) {
      if (!record || record[key] === undefined || record[key] === null || record[key] === "") continue;
      const number = Number(record[key]);
      if (Number.isFinite(number)) return { found: true, value: Math.round(number) };
    }
    return { found: false, value: 0 };
  }

  function formatMoney(cents, currency = "USD") {
    const value = Number(cents);
    if (!Number.isFinite(value)) return "—";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: String(currency || "USD").toUpperCase(),
      }).format(value / 100);
    } catch {
      return `${(value / 100).toFixed(2)} ${String(currency || "USD").toUpperCase()}`;
    }
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-US", includeTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }).format(date);
  }

  function dateTimeLocalValue(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
  }

  function localDateTimeToIso(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error("Choose a valid date and time.");
    return parsed.toISOString();
  }

  function optionMarkup(options, selected = "", emptyLabel = "") {
    const empty = emptyLabel ? `<option value="">${esc(emptyLabel)}</option>` : "";
    return empty + options.map(([value, label]) => (
      `<option value="${attr(value)}" ${String(selected) === String(value) ? "selected" : ""}>${esc(label)}</option>`
    )).join("");
  }

  function chips(values, className = "people-chip") {
    return (values || []).filter(Boolean).map((value) => (
      `<span class="${className}">${esc(typeof value === "object" ? first(value, "name", "label", "id") : value)}</span>`
    )).join("");
  }

  function statusChip(value, label = "") {
    const stateValue = normalizedState(value || "unknown");
    return `<span class="people-status-chip" data-state="${attr(stateValue)}">${esc(label || String(value || "unknown").replace(/_/g, " "))}</span>`;
  }

  function notice(message, kind = "info") {
    return `<div class="people-notice" data-kind="${attr(kind)}" role="${kind === "error" ? "alert" : "status"}">${esc(message)}</div>`;
  }

  function setTopStatus(message) {
    const status = elements().status;
    if (status) status.textContent = message;
  }

  function setFormStatus(form, message, kind = "info") {
    const target = form?.querySelector("[data-form-status]");
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
  }

  function disableForm(form, disabled) {
    form?.querySelectorAll("button,input,select,textarea").forEach((control) => {
      control.disabled = disabled;
    });
    form?.querySelectorAll(".datetimepicker-input").forEach((control) => {
      control.disabled = disabled;
      control.setAttribute("aria-disabled", String(disabled));
    });
  }

  function enhanceStudioControls(root) {
    window.StudioAdminCollapse?.enhance(root);
    window.StudioEnhanceControls?.(root);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("authorization", `Bearer ${localStorage.getItem(TOKEN_KEY) || ""}`);
    const request = { ...options, headers };
    if (request.body && !(request.body instanceof FormData) && typeof request.body !== "string") {
      headers.set("content-type", "application/json");
      request.body = JSON.stringify(request.body);
    }
    if (!request.signal && state.controller) request.signal = state.controller.signal;
    const endpoint = path.startsWith("/api/") ? path : `${API_ROOT}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await fetch(endpoint, request);
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("json")
      ? await response.json().catch(() => ({}))
      : { message: await response.text().catch(() => "") };
    if (!response.ok) {
      if (response.status === 401) setTopStatus("Locked");
      const reported = first(payload, "error", "message");
      const message = reported && typeof reported === "object"
        ? first(reported, "message", "code")
        : reported;
      throw new ApiError(
        message || `Request failed (${response.status})`,
        response.status,
        payload,
      );
    }
    return payload;
  }

  async function apiFirst(paths, options = {}) {
    let lastError;
    for (const path of paths) {
      try {
        return await api(path, options);
      } catch (error) {
        lastError = error;
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    throw lastError || new Error("No compatible endpoint is available.");
  }

  async function apiBlob(path) {
    const headers = new Headers();
    headers.set("authorization", `Bearer ${localStorage.getItem(TOKEN_KEY) || ""}`);
    const endpoint = path.startsWith("/api/") ? path : `${API_ROOT}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await fetch(endpoint, { headers, signal: state.controller?.signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const reported = first(payload, "error", "message");
      const message = reported && typeof reported === "object" ? first(reported, "message", "code") : reported;
      throw new ApiError(message || `Request failed (${response.status})`, response.status, payload);
    }
    return response.blob();
  }

  function isManagedView(tab, subView) {
    return tab === "people" && MANAGED_VIEWS.has(subView || "directory");
  }

  function prepareView(mode) {
    const ui = elements();
    if (!ui.layout || !ui.listPane || !ui.toolbar || !ui.list || !ui.detail) {
      throw new Error("The Studio console panes are not available.");
    }
    ui.layout.dataset.peopleManaged = "true";
    ui.detail.classList.add("people-manager");
    ui.list.classList.remove("empty");
    if (mode === "split") {
      ui.layout.classList.remove("single");
      ui.listPane.hidden = false;
      ui.toolbar.hidden = false;
    } else {
      ui.layout.classList.add("single");
      ui.listPane.hidden = true;
      ui.toolbar.hidden = true;
      ui.toolbar.innerHTML = "";
      ui.list.innerHTML = "";
    }
    return ui;
  }

  function unmount() {
    state.renderSequence += 1;
    state.controller?.abort();
    state.controller = null;
    state.view = "";
    const ui = elements();
    ui.layout?.classList.remove("single");
    if (ui.layout) delete ui.layout.dataset.peopleManaged;
    if (ui.listPane) ui.listPane.hidden = false;
    if (ui.toolbar) ui.toolbar.hidden = false;
    ui.detail?.classList.remove("people-manager");
  }

  async function render(tab, subView = "directory") {
    if (!isManagedView(tab, subView)) return false;
    const renderSequence = ++state.renderSequence;
    state.controller?.abort();
    state.controller = new AbortController();
    state.view = subView;
    setTopStatus("Loading People");
    try {
      if (subView === "directory") await renderDirectory();
      else if (subView === "attention") await renderAttention();
      else await renderIntegrations();
      if (renderSequence !== state.renderSequence || state.view !== subView) return true;
      if (elements().status?.textContent === "Loading People") setTopStatus("People ready");
    } catch (error) {
      if (error?.name === "AbortError" || renderSequence !== state.renderSequence || state.view !== subView) return true;
      const ui = prepareView("single");
      ui.detail.innerHTML = notice(error.message || "People could not be loaded.", "error");
      setTopStatus("People error");
    }
    return true;
  }

  function directoryToolbar() {
    return `
      <form class="people-toolbar" data-people-search>
        <div class="people-toolbar-row">
          <label class="people-sr-only" for="people-search">Search people</label>
          <input id="people-search" name="q" type="search" autocomplete="off" placeholder="Search name, email, phone, handle">
          <button class="button" type="submit">Search</button>
          <button class="button" type="button" data-new-person>New person</button>
          <button class="button" type="button" data-export-people>Export people CSV</button>
        </div>
        <details class="people-filter-disclosure">
          <summary>
            <span>Directory filters</span>
            <span class="people-helper">Tier, node, activity, consent, spend</span>
          </summary>
          <div class="people-filter-row">
            <select name="tier" aria-label="Filter by tier">
              <option value="">All tiers</option>
              <option value="unrated">Unrated</option>
              <option value="I">Tier I · Core</option>
              <option value="II">Tier II · Returning</option>
              <option value="III">Tier III · Connected</option>
            </select>
            <select name="nodeId" aria-label="Filter by Construct node">${optionMarkup(NODE_OPTIONS, "", "All nodes")}</select>
            <select name="interactionType" aria-label="Filter by interaction">${optionMarkup(INTERACTION_OPTIONS, "", "All interactions")}</select>
            <select name="consent" aria-label="Filter by marketing consent">
              <option value="">Any consent</option>
              <option value="subscribed">Subscribed</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="unknown">Unknown</option>
            </select>
            <select name="followup" aria-label="Filter by follow-up">
              <option value="">Any follow-up</option>
              <option value="overdue">Overdue</option>
              <option value="open">Open</option>
            </select>
            <input name="minSpend" type="number" min="0" step="1" inputmode="decimal" placeholder="Minimum spend" aria-label="Minimum net spend in dollars">
            <button class="button" type="button" data-reset-people-filters>Clear</button>
          </div>
        </details>
      </form>`;
  }

  async function renderDirectory() {
    const ui = prepareView("split");
    ui.toolbar.innerHTML = directoryToolbar();
    ui.list.innerHTML = '<div class="people-list-status">Loading people…</div>';
    ui.detail.innerHTML = '<p class="people-empty">Select a person or create a new record.</p>';
    state.directoryOffset = 0;
    bindDirectoryControls(ui);
    enhanceStudioControls(ui.toolbar);
    await loadPeople({ chooseFirst: !state.selectedPersonId });
  }

  function bindDirectoryControls(ui) {
    const form = ui.toolbar.querySelector("[data-people-search]");
    let searchTimer;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      state.directoryOffset = 0;
      loadPeople({ chooseFirst: true });
    });
    form.addEventListener("change", (event) => {
      if (!event.target.matches("select,input[name='minSpend']")) return;
      state.directoryOffset = 0;
      loadPeople({ chooseFirst: true });
    });
    form.elements.q.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.directoryOffset = 0;
        loadPeople({ chooseFirst: true });
      }, 320);
    });
    form.querySelector("[data-new-person]").addEventListener("click", () => {
      state.selectedPersonId = "";
      state.personLoadSequence += 1;
      ui.list.querySelectorAll(".people-person-row").forEach((row) => {
        row.classList.remove("is-active");
        row.setAttribute("aria-pressed", "false");
      });
      renderCreatePerson();
    });
    form.querySelector("[data-reset-people-filters]").addEventListener("click", () => {
      form.reset();
      form.querySelectorAll("select").forEach((select) => select._customSync?.());
      state.directoryOffset = 0;
      loadPeople({ chooseFirst: true });
    });
    form.querySelector("[data-export-people]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        button.disabled = true;
        setTopStatus("Preparing People export");
        const blob = await apiBlob("/exports/people.csv");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `construct-people-${new Date().toISOString().slice(0, 10)}.csv`;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setTopStatus("People export ready");
      } catch (error) {
        setTopStatus(error.message || "People export failed");
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
    ui.list.addEventListener("click", (event) => {
      const personButton = event.target.closest("[data-person-id]");
      const pageButton = event.target.closest("[data-people-page]");
      if (personButton) {
        selectPerson(personButton.dataset.personId);
        return;
      }
      if (pageButton) {
        const direction = Number(pageButton.dataset.peoplePage) || 0;
        state.directoryOffset = Math.max(0, state.directoryOffset + direction * DIRECTORY_LIMIT);
        loadPeople({ chooseFirst: true });
      }
    }, { signal: state.controller.signal });
  }

  function currentDirectoryQuery() {
    const form = elements().toolbar?.querySelector("[data-people-search]");
    const query = new URLSearchParams({
      limit: String(DIRECTORY_LIMIT),
      offset: String(state.directoryOffset),
    });
    if (!form) return query;
    const values = new FormData(form);
    const simpleFilters = {
      q: values.get("q"),
      tier: values.get("tier"),
      node: values.get("nodeId"),
      interaction: values.get("interactionType"),
      consent: values.get("consent"),
      followup: values.get("followup"),
    };
    Object.entries(simpleFilters).forEach(([key, raw]) => {
      const value = String(raw || "").trim();
      if (value) query.set(key, key === "tier" ? ({ I: "1", II: "2", III: "3" })[value] || value : value);
    });
    const minSpend = Number(values.get("minSpend"));
    if (Number.isFinite(minSpend) && minSpend > 0) query.set("minSpendCents", String(Math.round(minSpend * 100)));
    return query;
  }

  async function loadPeople({ chooseFirst = false } = {}) {
    const ui = elements();
    if (state.view !== "directory" || !ui.list) return;
    const loadSequence = ++state.directoryLoadSequence;
    ui.list.setAttribute("aria-busy", "true");
    ui.list.innerHTML = '<div class="people-list-status">Loading people…</div>';
    try {
      const payload = await api(`/people?${currentDirectoryQuery()}`);
      if (state.view !== "directory" || loadSequence !== state.directoryLoadSequence) return;
      state.people = listFrom(payload, "people", "records", "items");
      state.directoryCount = Number(first(payload, "count", "total", "totalCount")) || state.people.length;
      if (chooseFirst && !state.people.some((person) => personId(person) === state.selectedPersonId)) {
        state.selectedPersonId = personId(state.people[0]);
      }
      renderPeopleList();
      ui.list.setAttribute("aria-busy", "false");
      if (state.selectedPersonId) await loadPerson(state.selectedPersonId);
      else ui.detail.innerHTML = '<p class="people-empty">No matching people. Create a person or adjust the filters.</p>';
    } catch (error) {
      if (error?.name === "AbortError" || state.view !== "directory" || loadSequence !== state.directoryLoadSequence) return;
      ui.list.setAttribute("aria-busy", "false");
      ui.list.innerHTML = notice(error.message || "People could not be loaded.", "error");
      ui.detail.innerHTML = '<p class="people-empty">Directory unavailable.</p>';
      setTopStatus("People error");
    }
  }

  function renderPeopleList() {
    const ui = elements();
    if (!ui.list) return;
    const rows = state.people.map((person) => {
      const id = personId(person);
      const tier = tierValue(person);
      const email = first(person, "primaryEmail", "primary_email", "email");
      const phone = first(person, "primaryPhone", "primary_phone", "phone");
      const net = centsValue(person, "netSpendCents", "net_spend_cents", "lifetimeSpendCents", "lifetime_spend_cents");
      const last = first(person, "lastInteractionAt", "last_interaction_at", "updatedAt", "updated_at");
      const nodes = listFrom(person, "nodes", "nodeIds", "node_ids").slice(0, 3);
      return `
        <button class="people-person-row ${id === state.selectedPersonId ? "is-active" : ""}" type="button" data-person-id="${attr(id)}" aria-pressed="${id === state.selectedPersonId ? "true" : "false"}">
          <span class="people-person-row-top">
            <span class="people-person-name">${esc(personName(person))}</span>
            <span class="people-tier" data-tier="${attr(tier)}">${esc(tierLabel(tier))}</span>
          </span>
          <span class="people-person-meta">${esc([email, phone].filter(Boolean).join(" · ") || "No contact identity")}</span>
          <span class="people-person-meta">${esc(formatMoney(net, first(person, "currency") || "USD"))} net · ${esc(formatDate(last))}</span>
          ${nodes.length ? `<span class="people-chip-list">${chips(nodes, "people-node-chip")}</span>` : ""}
        </button>`;
    }).join("");
    const pageStart = state.directoryCount ? state.directoryOffset + 1 : 0;
    const pageEnd = Math.min(state.directoryCount, state.directoryOffset + state.people.length);
    ui.list.innerHTML = `
      <div class="people-list">
        ${rows || '<div class="people-list-status">No matching people.</div>'}
        <div class="people-panel" role="status" aria-live="polite" aria-atomic="true">
          <div class="people-person-meta">${pageStart}–${pageEnd} of ${state.directoryCount}</div>
          <div class="people-inline-actions">
            <button class="button" type="button" data-people-page="-1" ${state.directoryOffset <= 0 ? "disabled" : ""}>Previous</button>
            <button class="button" type="button" data-people-page="1" ${pageEnd >= state.directoryCount ? "disabled" : ""}>Next</button>
          </div>
        </div>
      </div>`;
  }

  async function selectPerson(id) {
    state.selectedPersonId = String(id || "");
    elements().list?.querySelectorAll(".people-person-row").forEach((row) => {
      const selected = row.dataset.personId === state.selectedPersonId;
      row.classList.toggle("is-active", selected);
      row.setAttribute("aria-pressed", String(selected));
    });
    await loadPerson(state.selectedPersonId);
  }

  function renderCreatePerson() {
    const detail = elements().detail;
    if (!detail) return;
    detail.innerHTML = `
      <div class="people-page-head">
        <h2>New Person</h2>
        <p>Create the identity first. Interactions, money, notes, and tier context can be added after saving.</p>
      </div>
      <section data-admin-section-title="Identity">
        <h3>Identity</h3>
        <form class="people-form" data-create-person>
          <div class="people-form-grid">
            <label>Display name<input name="displayName" required autocomplete="name"></label>
            <label>Preferred name<input name="preferredName" autocomplete="nickname"></label>
            <label>Email<input name="email" type="email" autocomplete="email"></label>
            <label>Phone<input name="phone" type="tel" autocomplete="tel"></label>
            <label>Instagram<input name="instagram" autocomplete="off" placeholder="@handle"></label>
            <label>Organization<input name="organization" autocomplete="organization"></label>
            <label>Pronouns<input name="pronouns" autocomplete="off"></label>
            <label>Preferred contact
              <select name="preferredContactMethod">
                <option value="">Not set</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="none">Do not contact</option>
                <option value="instagram">Instagram</option>
              </select>
            </label>
            <label>Tags<input name="tags" placeholder="collector, referral, collaborator"></label>
            <label class="people-wide">Relationship summary<textarea name="summary" placeholder="Factual context that makes the relationship easier to support."></textarea></label>
          </div>
          <div class="people-actions">
            <button class="button" type="submit">Create person</button>
            <button class="button" type="button" data-cancel-create>Cancel</button>
            <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
          </div>
        </form>
      </section>`;
    const form = detail.querySelector("[data-create-person]");
    form.querySelector("[data-cancel-create]").addEventListener("click", () => {
      if (state.people.length) selectPerson(personId(state.people[0]));
      else detail.innerHTML = '<p class="people-empty">No people yet.</p>';
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const payload = {
        displayName: String(values.get("displayName") || "").trim(),
        preferredName: String(values.get("preferredName") || "").trim(),
        email: String(values.get("email") || "").trim(),
        phone: String(values.get("phone") || "").trim(),
        instagram: String(values.get("instagram") || "").trim(),
        organization: String(values.get("organization") || "").trim(),
        pronouns: String(values.get("pronouns") || "").trim(),
        preferredContactMethod: String(values.get("preferredContactMethod") || ""),
        tags: String(values.get("tags") || "").split(",").map((value) => value.trim()).filter(Boolean),
        summary: String(values.get("summary") || "").trim(),
      };
      try {
        disableForm(form, true);
        setFormStatus(form, "Creating…");
        const result = await api("/people", { method: "POST", body: payload });
        const created = objectFrom(result, "person", "record");
        state.selectedPersonId = personId(created) || String(first(result, "id", "personId") || "");
        await loadPeople({ chooseFirst: !state.selectedPersonId });
      } catch (error) {
        setFormStatus(form, error.message || "Could not create person.", "error");
      } finally {
        disableForm(form, false);
      }
    });
    enhanceStudioControls(detail);
  }

  async function loadPerson(id) {
    const detail = elements().detail;
    if (!detail || !id) return;
    const loadSequence = ++state.personLoadSequence;
    detail.innerHTML = '<p class="people-empty">Loading person…</p>';
    try {
      const payload = await api(`/people/${encodeURIComponent(id)}`);
      if (state.view !== "directory" || state.selectedPersonId !== String(id) || loadSequence !== state.personLoadSequence) return;
      renderPersonDetail(payload);
    } catch (error) {
      if (error?.name === "AbortError" || state.view !== "directory" || state.selectedPersonId !== String(id) || loadSequence !== state.personLoadSequence) return;
      detail.innerHTML = notice(error.message || "This person could not be loaded.", "error");
    }
  }

  function transactionSignedCents(transaction) {
    const status = normalizedState(first(transaction, "status", "state"));
    if (["void", "voided", "failed", "cancelled", "canceled"].includes(status)) return 0;
    const rawAmount = centsValue(transaction, "amountCents", "amount_cents", "amount");
    const amount = Math.abs(rawAmount);
    const kind = normalizedState(first(transaction, "kind", "type", "transactionType", "transaction_type"));
    if (kind === "adjustment") return rawAmount;
    return ["refund", "credit", "reversal"].includes(kind) ? -amount : amount;
  }

  function profileTotals(person, transactions, interactions) {
    const settledTransactions = transactions.filter((transaction) => {
      const status = normalizedState(first(transaction, "status", "state") || "settled");
      return ["settled", "completed", "paid", "succeeded", "manual"].includes(status);
    });
    const calculatedNet = settledTransactions.reduce((sum, transaction) => sum + transactionSignedCents(transaction), 0);
    const calculatedGross = settledTransactions.reduce((sum, transaction) => Math.max(0, transactionSignedCents(transaction)) + sum, 0);
    const calculatedTips = settledTransactions.reduce((sum, transaction) => sum + centsValue(transaction, "tipCents", "tip_cents"), 0);
    const suppliedTotals = person?.totals && typeof person.totals === "object"
      ? person.totals
      : person?.money && typeof person.money === "object"
        ? person.money
        : {};
    const directNet = presentCents(person, "netSpendCents", "net_spend_cents", "lifetimeSpendCents", "lifetime_spend_cents");
    const nestedNet = presentCents(suppliedTotals, "netSpendCents", "net_spend_cents", "net");
    const directGross = presentCents(person, "settledGrossCents", "settled_gross_cents", "grossSpendCents", "gross_spend_cents");
    const nestedGross = presentCents(suppliedTotals, "settledGrossCents", "settled_gross_cents", "grossSpendCents", "gross_spend_cents", "gross");
    const directTips = presentCents(person, "tipCents", "tip_cents", "tipsCents", "tips_cents");
    const nestedTips = presentCents(suppliedTotals, "tipCents", "tip_cents", "tips");
    const net = directNet.found ? directNet.value : nestedNet.found ? nestedNet.value : calculatedNet;
    const gross = directGross.found ? directGross.value : nestedGross.found ? nestedGross.value : calculatedGross;
    const tips = directTips.found ? directTips.value : nestedTips.found ? nestedTips.value : calculatedTips;
    const nodeValues = new Set();
    listFrom(person, "nodes", "nodeIds", "node_ids").forEach((node) => node && nodeValues.add(String(node)));
    [...interactions, ...transactions].forEach((record) => {
      const node = first(record, "nodeName", "node_name", "nodeId", "node_id", "node");
      if (node) nodeValues.add(String(node));
    });
    return { net, gross, tips, nodes: [...nodeValues] };
  }

  function contactValue(identities, kind, person) {
    const matching = identities.find((identity) => normalizedState(first(identity, "kind", "type", "identityType", "identity_type")) === kind);
    if (matching) return first(matching, "displayValue", "display_value", "value", "normalizedValue", "normalized_value");
    if (kind === "email") return first(person, "primaryEmail", "primary_email", "email");
    if (kind === "phone") return first(person, "primaryPhone", "primary_phone", "phone");
    return "";
  }

  function identityRecords(identities) {
    if (!identities.length) return '<div class="people-empty">No contact identities recorded.</div>';
    return `<div class="people-record-list">${identities.map((identity) => {
      const kind = first(identity, "kind", "type", "identityType", "identity_type") || "identity";
      const label = first(identity, "label");
      const value = first(identity, "displayValue", "display_value", "value", "normalizedValue", "normalized_value");
      const provider = first(identity, "provider", "sourceProvider", "source_provider");
      const providerLabel = provider === "square_payer_label" ? "Square payment" : provider;
      const primary = truthy(first(identity, "primary", "isPrimary", "is_primary"));
      const verified = truthy(first(identity, "verified", "isVerified", "is_verified"));
      return `<article class="people-record">
        <div class="people-record-head">
          <strong class="people-record-title">${esc(label || kind)}</strong>
          ${primary ? statusChip("active", "Primary") : ""}
        </div>
        <div class="people-record-body">${esc(value || "Value unavailable")}</div>
        <div class="people-record-meta">${esc([providerLabel, verified ? "verified" : ""].filter(Boolean).join(" · ") || "manual")}</div>
      </article>`;
    }).join("")}</div>`;
  }

  function activityRecords(interactions, transactions, attendance) {
    const records = [
      ...interactions.map((item) => ({ ...item, _recordKind: "interaction" })),
      ...transactions.map((item) => ({ ...item, _recordKind: "transaction" })),
      ...attendance.map((item) => ({ ...item, _recordKind: "attendance" })),
    ].sort((a, b) => {
      const aDate = new Date(first(a, "occurredAt", "occurred_at", "createdAt", "created_at", "checkedInAt", "checked_in_at") || 0).getTime();
      const bDate = new Date(first(b, "occurredAt", "occurred_at", "createdAt", "created_at", "checkedInAt", "checked_in_at") || 0).getTime();
      return bDate - aDate;
    });
    if (!records.length) return '<div class="people-empty">No interactions yet.</div>';
    return `<div class="people-record-list">${records.map((record) => {
      const kind = record._recordKind === "transaction"
        ? first(record, "kind", "type", "transactionType", "transaction_type") || "transaction"
        : record._recordKind === "attendance"
          ? "attendance"
          : first(record, "kind", "type", "interactionType", "interaction_type") || "interaction";
      const metadata = objectFrom(record, "metadata");
      const label = first(record, "label", "title", "description", "note", "eventTitle", "event_title") || String(kind).replace(/_/g, " ");
      const detailText = first(record, "details", "body") || first(metadata, "details", "note");
      const when = first(record, "occurredAt", "occurred_at", "createdAt", "created_at", "checkedInAt", "checked_in_at");
      const node = first(record, "nodeName", "node_name", "nodeId", "node_id", "node");
      const channel = first(record, "channel");
      const source = first(record, "sourceProvider", "source_provider", "provider", "source") || "manual";
      const amount = record._recordKind === "transaction"
        ? `<span class="people-record-amount">${esc(formatMoney(transactionSignedCents(record), first(record, "currency") || "USD"))}</span>`
        : "";
      return `<article class="people-record">
        <div class="people-record-head">
          <div>
            <strong class="people-record-title">${esc(label)}</strong>
            <div class="people-record-meta">${esc(String(kind).replace(/_/g, " "))}</div>
          </div>
          ${amount}
        </div>
        <div class="people-chip-list">
          ${node ? `<span class="people-node-chip">${esc(node)}</span>` : ""}
          ${channel ? `<span class="people-chip">${esc(channel)}</span>` : ""}
          ${statusChip(first(record, "status", "state") || "recorded")}
        </div>
        ${detailText ? `<div class="people-record-body">${esc(detailText)}</div>` : ""}
        <div class="people-source">${esc(formatDate(when, true))} · ${esc(source)}</div>
      </article>`;
    }).join("")}</div>`;
  }

  function noteRecords(notes) {
    if (!notes.length) return '<div class="people-empty">No notes yet.</div>';
    return `<div class="people-record-list">${notes.map((note) => `
      <article class="people-record">
        <div class="people-record-head">
          <strong class="people-record-title">${esc(noteCategoryLabel(first(note, "category")))}</strong>
          ${truthy(first(note, "pinned", "isPinned", "is_pinned")) ? statusChip("active", "Pinned") : ""}
        </div>
        <div class="people-record-body">${esc(first(note, "body", "note", "content") || "")}</div>
        <div class="people-record-meta">${esc(formatDate(first(note, "createdAt", "created_at", "updatedAt", "updated_at"), true))} · ${esc(first(note, "sourceLabel", "source_label") || "Studio")}</div>
      </article>`).join("")}</div>`;
  }

  function noteCategoryLabel(category) {
    return ({
      relationship: "Relationship",
      preference: "Preference",
      project: "Project",
      follow_up: "Follow-up context",
      accessibility: "Accessibility preference",
      legacy_import: "Legacy import",
      personal_context: "Personal context",
    })[String(category || "")] || "Relationship note";
  }

  function personalContextRecords(records) {
    if (!records.length) return '<div class="people-empty">No private context notes yet.</div>';
    return `<div class="people-record-list">${records.map((note) => {
      const noteId = first(note, "id");
      const pinned = truthy(first(note, "pinned", "isPinned", "is_pinned"));
      const body = first(note, "body", "note", "content") || "";
      return `
        <article class="people-record" data-note-kind="personal_context">
          <div class="people-record-head">
            <strong class="people-record-title">Personal context</strong>
            <div class="people-chip-list">
              ${statusChip("private", "Sensitive")}
              ${statusChip("active", "Shared by client")}
              ${pinned ? statusChip("active", "Pinned") : ""}
            </div>
          </div>
          <div class="people-record-body">${esc(body)}</div>
          <div class="people-record-meta">${esc(formatDate(first(note, "createdAt", "created_at"), true))} · Shared directly by client</div>
          <details class="people-note-editor">
            <summary>Edit private context</summary>
            <form class="people-form" data-personal-context-edit data-note-id="${attr(noteId)}">
              <label>Context note
                <textarea name="body" required maxlength="10000">${esc(body)}</textarea>
              </label>
              <label class="people-check"><input name="pinned" type="checkbox" ${pinned ? "checked" : ""}><span>Pin this context near the top of the private context list.</span></label>
              <div class="people-actions">
                <button class="button" type="submit">Save changes</button>
                <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
              </div>
            </form>
          </details>
          <div class="people-inline-actions">
            <button class="button" type="button" data-personal-context-remove="${attr(noteId)}">Remove private context</button>
          </div>
        </article>`;
    }).join("")}</div>`;
  }

  function followupRecords(followups) {
    if (!followups.length) return '<div class="people-empty">No follow-ups yet.</div>';
    return `<div class="people-record-list">${followups.map((followup) => {
      const status = first(followup, "status", "state") || "open";
      const dueAt = first(followup, "dueAt", "due_at");
      const overdue = dueAt && new Date(dueAt).getTime() < Date.now() && normalizedState(status) === "open";
      return `<article class="people-record" ${overdue ? 'data-kind="attention"' : ""}>
        <div class="people-record-head">
          <strong class="people-record-title">${esc(first(followup, "title", "action", "label") || "Follow up")}</strong>
          ${statusChip(overdue ? "overdue" : status)}
        </div>
        ${first(followup, "note", "notes", "body", "description") ? `<div class="people-record-body">${esc(first(followup, "note", "notes", "body", "description"))}</div>` : ""}
        <div class="people-record-meta">Due ${esc(formatDate(dueAt, true))}</div>
        ${normalizedState(status) === "open" && first(followup, "id")
          ? `<div class="people-inline-actions"><button class="button" type="button" data-followup-status="${attr(first(followup, "id"))}" data-status="done">Mark complete</button><button class="button" type="button" data-followup-status="${attr(first(followup, "id"))}" data-status="cancelled">Cancel</button></div>`
          : ""}
      </article>`;
    }).join("")}</div>`;
  }

  function subscriptionRecords(subscriptions) {
    if (!subscriptions.length) return '<div class="people-empty">No newsletter subscriptions recorded.</div>';
    return `<div class="people-record-list">${subscriptions.map((subscription) => {
      const provider = first(subscription, "provider", "sourceProvider", "source_provider") || "newsletter";
      const publication = first(subscription, "publicationName", "publication_name", "publicationId", "publication_id");
      const status = first(subscription, "status", "state") || "unknown";
      const changedAt = first(subscription, "unsubscribedAt", "unsubscribed_at", "subscribedAt", "subscribed_at", "updatedAt", "updated_at");
      return `<article class="people-record">
        <div class="people-record-head">
          <strong class="people-record-title">${esc([provider, publication].filter(Boolean).join(" · "))}</strong>
          ${statusChip(status)}
        </div>
        <div class="people-record-meta">${esc(formatDate(changedAt, true))} · ${esc(first(subscription, "consentSource", "consent_source") || "source record")}</div>
      </article>`;
    }).join("")}</div>`;
  }

  function suppressionRecords(suppressions) {
    const active = suppressions.filter((suppression) => {
      const value = first(suppression, "active", "isActive", "is_active");
      return value === "" || truthy(value);
    });
    if (!active.length) return "";
    return `
      <div class="people-record-list">
        ${active.map((suppression) => {
          const provider = first(suppression, "provider", "sourceProvider", "source_provider") || "all marketing";
          const reason = first(suppression, "reason", "source", "note") || "Unsubscribe or suppression override";
          const updatedAt = first(suppression, "updatedAt", "updated_at", "createdAt", "created_at");
          return `<article class="people-record" data-kind="attention">
            <div class="people-record-head">
              <strong class="people-record-title">${esc(provider)} suppression</strong>
              ${statusChip("suppressed", "Active override")}
            </div>
            <div class="people-record-body">${esc(reason)}</div>
            <div class="people-record-meta">${esc(formatDate(updatedAt, true))}</div>
          </article>`;
        }).join("")}
      </div>`;
  }

  function auditRecords(audit, tierHistory) {
    const records = [
      ...audit.map((item) => ({ ...item, _kind: "audit" })),
      ...tierHistory.map((item) => ({ ...item, _kind: "tier" })),
    ].sort((a, b) => new Date(first(b, "createdAt", "created_at", "changedAt", "changed_at") || 0) - new Date(first(a, "createdAt", "created_at", "changedAt", "changed_at") || 0));
    if (!records.length) return '<div class="people-empty">No audit events yet.</div>';
    return `<div class="people-record-list">${records.map((record) => {
      const title = record._kind === "tier"
        ? `Tier ${first(record, "tier", "newTier", "new_tier") || "changed"}`
        : first(record, "action", "eventType", "event_type") || "Record updated";
      const body = first(record, "rationale", "summary", "description", "metadataSummary", "metadata_summary");
      return `<article class="people-record">
        <strong class="people-record-title">${esc(title)}</strong>
        ${body ? `<div class="people-record-body">${esc(body)}</div>` : ""}
        <div class="people-record-meta">${esc(formatDate(first(record, "createdAt", "created_at", "changedAt", "changed_at"), true))}</div>
      </article>`;
    }).join("")}</div>`;
  }

  function profileForm(person, tags) {
    const tagValues = tags.map((tag) => typeof tag === "object" ? first(tag, "name", "label") : tag).filter(Boolean);
    return `
      <form class="people-form" data-profile-form>
        <div class="people-form-grid">
          <label>Display name<input name="displayName" value="${attr(personName(person))}" required></label>
          <label>Preferred name<input name="preferredName" value="${attr(first(person, "preferredName", "preferred_name"))}"></label>
          <label>Preferred contact
            <select name="preferredContactMethod">
              ${optionMarkup([["", "Not set"], ["email", "Email"], ["phone", "Phone / text"], ["instagram", "Instagram"], ["none", "Do not contact"]], first(person, "preferredContactMethod", "preferred_contact_method"))}
            </select>
          </label>
          <label>Relationship status
            <select name="relationshipStatus">
              ${optionMarkup([["active", "Active"], ["inactive", "Inactive"], ["archived", "Archived"], ["suppressed", "Suppressed"]], first(person, "relationshipStatus", "relationship_status") || "active")}
            </select>
          </label>
          <label>Organization<input name="organization" value="${attr(first(person, "organization"))}"></label>
          <label>Pronouns<input name="pronouns" value="${attr(first(person, "pronouns"))}"></label>
          <label>Instagram<input name="instagram" value="${attr(first(person, "instagram"))}" placeholder="@handle"></label>
          <label>Tags<input name="tags" value="${attr(tagValues.join(", "))}" placeholder="collector, collaborator"></label>
          <label class="people-wide">Relationship summary<textarea name="summary">${esc(first(person, "summary", "relationshipSummary", "relationship_summary"))}</textarea></label>
        </div>
        <div class="people-actions">
          <button class="button" type="submit">Save profile</button>
          <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
        </div>
      </form>`;
  }

  function tierForm(person) {
    const tier = tierValue(person);
    return `
      <form class="people-form" data-tier-form data-current-tier="${attr(tier)}">
        <div class="people-form-grid">
          <label>Relationship tier
            <select name="tier">
              ${optionMarkup([["", "Unrated"], ["III", "Tier III · Connected"], ["II", "Tier II · Returning"], ["I", "Tier I · Core"]], tier)}
            </select>
          </label>
          <label class="people-wide">Rationale
            <textarea name="tierRationale" placeholder="Why this relationship tier is useful and fair.">${esc(first(person, "tierRationale", "tier_rationale"))}</textarea>
          </label>
        </div>
        <p class="people-helper">Tier is manual relationship context only. It does not change prices, access, or priority.</p>
        <div class="people-actions">
          <button class="button" type="submit">Update tier</button>
          <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
        </div>
      </form>`;
  }

  function addIdentityForm() {
    return `
      <details>
        <summary>Add contact identity</summary>
        <form class="people-form" data-identity-form>
          <div class="people-form-grid">
            <label>Identity type
              <select name="kind">
                ${optionMarkup([["email", "Email"], ["phone", "Phone"], ["instagram", "Instagram"], ["shopify_customer", "Shopify customer"], ["square_customer", "Square customer"], ["beehiiv_subscription", "beehiiv subscription"], ["substack_subscriber", "Substack subscriber"]], "email")}
              </select>
            </label>
            <label>Value<input name="value" required></label>
            <label>Provider<input name="provider" value="manual"></label>
            <label class="people-check"><input name="primary" type="checkbox"><span>Make this the primary identity for this contact type.</span></label>
          </div>
          <div class="people-actions">
            <button class="button" type="submit">Add identity</button>
            <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
          </div>
        </form>
      </details>`;
  }

  function addInteractionForm() {
    return `
      <details>
        <summary>Add manual interaction</summary>
        <form class="people-form" data-interaction-form>
          <div class="people-form-grid">
            <label>Interaction type<select name="kind">${optionMarkup(INTERACTION_OPTIONS, "manual")}</select></label>
            <label>Construct node<select name="nodeId">${optionMarkup(NODE_OPTIONS, "", "No node")}</select></label>
            <label>Channel
              <select name="channel">
                ${optionMarkup([["manual", "Manual"], ["tattoo_booking", "Tattoo booking"], ["studio_booking", "Studio booking"], ["event", "Event"], ["merch", "Merch"], ["newsletter", "Newsletter"], ["archive", "Archive"], ["other", "Other"]], "manual")}
              </select>
            </label>
            <label class="people-wide">Label<input name="label" required placeholder="Studio visit, referral, collaboration…"></label>
            <label>Occurred at<input name="occurredAt" type="datetime-local" value="${attr(dateTimeLocalValue())}" required></label>
            <label>Status
              <select name="status">
                ${optionMarkup([["completed", "Completed"], ["planned", "Planned"], ["cancelled", "Cancelled"], ["no_show", "No-show"]], "completed")}
              </select>
            </label>
            <label class="people-wide">Details<textarea name="details" placeholder="Factual context only."></textarea></label>
          </div>
          <div class="people-actions">
            <button class="button" type="submit">Add interaction</button>
            <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
          </div>
        </form>
      </details>`;
  }

  function addTransactionForm() {
    return `
      <details>
        <summary>Add manual transaction</summary>
        <form class="people-form" data-transaction-form>
          <div class="people-form-grid">
            <label>Transaction type
              <select name="kind">
                ${optionMarkup([["charge", "Charge / payment"], ["refund", "Refund"], ["adjustment", "Adjustment"]], "charge")}
              </select>
            </label>
            <label>Status
              <select name="status">
                ${optionMarkup([["settled", "Settled"], ["pending", "Pending"], ["void", "Void"]], "settled")}
              </select>
            </label>
            <label>Amount<input name="amount" type="number" step=".01" inputmode="decimal" required></label>
            <label>Tip<input name="tip" type="number" min="0" step=".01" inputmode="decimal" value="0"></label>
            <label>Currency<input name="currency" value="USD" maxlength="3" required></label>
            <label>Construct node<select name="nodeId">${optionMarkup(NODE_OPTIONS, "", "No node")}</select></label>
            <label>Occurred at<input name="occurredAt" type="datetime-local" value="${attr(dateTimeLocalValue())}" required></label>
            <label>Reference<input name="reference" placeholder="Receipt, cash log, order ID"></label>
            <label class="people-wide">Description<input name="label" required placeholder="Final tattoo balance, art purchase…"></label>
          </div>
          <p class="people-helper">Only settled payments count toward lifetime spend. Use refunds for returned money and adjustments for documented corrections.</p>
          <div class="people-actions">
            <button class="button" type="submit">Add transaction</button>
            <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
          </div>
        </form>
      </details>`;
  }

  function addNoteForm() {
    return `
      <form class="people-form" data-note-form>
        <div class="people-form-grid">
          <label>Category
            <select name="category">
              ${optionMarkup([["relationship", "Relationship"], ["preference", "Preference"], ["project", "Project"], ["follow_up", "Follow-up context"], ["accessibility", "Accessibility preference"], ["legacy_import", "Legacy import"]], "relationship")}
            </select>
          </label>
          <label class="people-check"><input name="pinned" type="checkbox"><span>Pin this note near the top of the relationship record.</span></label>
          <label class="people-wide">Note<textarea name="body" required placeholder="Useful factual context; avoid gossip or unnecessary sensitive information."></textarea></label>
        </div>
        <div class="people-actions">
          <button class="button" type="submit">Add note</button>
          <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
        </div>
      </form>`;
  }

  function addPersonalContextForm() {
    return `
      <form class="people-form" data-personal-context-form>
        <div class="people-form-grid">
          <div class="people-note-policy">
            <strong>Owner-only, profile-only context</strong>
            <span>Excluded from directory search, People exports, tier decisions, and marketing. Record only what the client shared directly—never assumptions or third-party gossip.</span>
          </div>
          <input name="provenance" type="hidden" value="shared_by_client">
          <label class="people-wide">Private memory note
            <textarea name="body" required maxlength="10000" placeholder="Profession, family, identity, or life context the client directly shared with you."></textarea>
          </label>
          <label class="people-check"><input name="pinned" type="checkbox"><span>Pin this context near the top of the private context list.</span></label>
          <label class="people-check"><input name="confirmShared" type="checkbox" required><span>I confirm this information was shared directly by the client.</span></label>
        </div>
        <div class="people-actions">
          <button class="button" type="submit">Add private context</button>
          <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
        </div>
      </form>`;
  }

  function addFollowupForm() {
    return `
      <form class="people-form" data-followup-form>
        <div class="people-form-grid">
          <label class="people-wide">Next action<input name="title" required placeholder="Send booking options, invite to event…"></label>
          <label>Due at<input name="dueAt" type="datetime-local" required></label>
          <label>Priority
            <select name="priority">${optionMarkup([["low", "Low"], ["normal", "Normal"], ["high", "High"]], "normal")}</select>
          </label>
          <label class="people-wide">Context<textarea name="notes"></textarea></label>
        </div>
        <div class="people-actions">
          <button class="button" type="submit">Add follow-up</button>
          <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
        </div>
      </form>`;
  }

  function renderPersonDetail(payload) {
    const detail = elements().detail;
    if (!detail) return;
    const person = objectFrom(payload, "person", "record");
    const identities = listFrom(payload, "identities");
    const tags = listFrom(payload, "tags");
    const interactions = listFrom(payload, "interactions");
    const transactions = listFrom(payload, "transactions");
    const notes = listFrom(payload, "notes");
    const personalContext = listFrom(payload, "personalContext", "personal_context");
    const followups = listFrom(payload, "followups");
    const subscriptions = listFrom(payload, "subscriptions", "marketingSubscriptions");
    const suppressions = listFrom(payload, "suppressions");
    const attendance = listFrom(payload, "attendance");
    const tierHistory = listFrom(payload, "tierHistory", "tier_history");
    const audit = listFrom(payload, "audit", "auditEvents", "audit_events");
    const totals = profileTotals(person, transactions, interactions);
    const email = contactValue(identities, "email", person);
    const phone = contactValue(identities, "phone", person);
    const tier = tierValue(person);
    const lastInteraction = first(person, "lastInteractionAt", "last_interaction_at")
      || first(interactions[0], "occurredAt", "occurred_at", "createdAt", "created_at");

    detail.innerHTML = `
      <div class="people-profile-head">
        <div class="people-profile-title-row">
          <div>
            <h2>${esc(personName(person))}</h2>
            <div class="people-profile-contact">
              ${email ? `<span>${esc(email)}</span>` : ""}
              ${phone ? `<span>${esc(phone)}</span>` : ""}
              ${first(person, "instagram") ? `<span>${esc(first(person, "instagram"))}</span>` : ""}
            </div>
          </div>
          <span class="people-tier" data-tier="${attr(tier)}">${esc(tierLabel(tier))}</span>
        </div>
        <div class="people-chip-list">
          ${chips(tags)}
          ${totals.nodes.map((node) => `<span class="people-node-chip">${esc(node)}</span>`).join("")}
        </div>
        <div class="people-stats">
          <div class="people-stat"><span>Net spend</span><strong>${esc(formatMoney(totals.net, first(person, "currency") || "USD"))}</strong></div>
          <div class="people-stat"><span>Gross paid</span><strong>${esc(formatMoney(totals.gross, first(person, "currency") || "USD"))}</strong></div>
          <div class="people-stat"><span>Tips</span><strong>${esc(formatMoney(totals.tips, first(person, "currency") || "USD"))}</strong></div>
          <div class="people-stat"><span>Last interaction</span><strong>${esc(formatDate(lastInteraction))}</strong></div>
        </div>
      </div>

      <section data-admin-section-title="Profile and tags">
        <h3>Profile and tags</h3>
        ${profileForm(person, tags)}
      </section>

      <section data-admin-section-title="Relationship tier">
        <h3>Relationship tier</h3>
        ${tierForm(person)}
      </section>

      <section data-admin-section-title="Contact identities">
        <h3>Contact identities</h3>
        ${identityRecords(identities)}
        ${addIdentityForm()}
      </section>

      <section data-admin-section-title="Construct activity">
        <h3>Construct activity</h3>
        ${activityRecords(interactions, transactions, attendance)}
        ${addInteractionForm()}
      </section>

      <section data-admin-section-title="Money">
        <h3>Money</h3>
        <p class="people-section-copy">Settled charges add to spend. Successful refunds subtract from it. Tips stay visible separately.</p>
        ${transactions.length ? activityRecords([], transactions, []) : '<div class="people-empty">No transactions yet.</div>'}
        ${addTransactionForm()}
      </section>

      <section data-admin-section-title="Notes">
        <h3>Notes</h3>
        ${noteRecords(notes)}
        ${addNoteForm()}
      </section>

      <section data-admin-section-title="Personal context" data-admin-default="closed">
        <h3>Personal context</h3>
        <p class="people-section-copy">Private memory notes for facts the client shared directly. These notes never affect their tier, outreach, or public record.</p>
        ${personalContextRecords(personalContext)}
        ${addPersonalContextForm()}
      </section>

      <section data-admin-section-title="Follow-ups">
        <h3>Follow-ups</h3>
        ${followupRecords(followups)}
        ${addFollowupForm()}
      </section>

      <section data-admin-section-title="Newsletter consent">
        <h3>Newsletter consent</h3>
        <p class="people-section-copy">Consent is tracked by provider and publication. An email address alone is not consent.</p>
        ${suppressionRecords(suppressions)}
        ${subscriptionRecords(subscriptions)}
      </section>

      <section data-admin-section-title="History and provenance" data-admin-default="closed">
        <h3>History and provenance</h3>
        ${auditRecords(audit, tierHistory)}
      </section>`;
    bindPersonForms(detail, personId(person));
    enhanceStudioControls(detail);
  }

  function formValue(form, name) {
    return String(new FormData(form).get(name) || "").trim();
  }

  function dollarsToCents(value, label, allowNegative = false) {
    const number = Number(String(value || "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(number) || (!allowNegative && number < 0)) {
      throw new Error(`${label} must be a valid ${allowNegative ? "" : "non-negative "}amount.`);
    }
    return Math.round(number * 100);
  }

  function newRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function submitPersonForm(form, path, body, successMessage) {
    try {
      disableForm(form, true);
      setFormStatus(form, "Saving…");
      await api(path, { method: "POST", body });
      setFormStatus(form, successMessage, "success");
      await Promise.all([loadPerson(state.selectedPersonId), refreshSelectedPersonRow()]);
      return true;
    } catch (error) {
      setFormStatus(form, error.message || "Could not save.", "error");
      return false;
    } finally {
      if (form.isConnected) disableForm(form, false);
    }
  }

  async function refreshSelectedPersonRow() {
    if (state.view !== "directory") return;
    const loadSequence = ++state.directoryLoadSequence;
    try {
      const payload = await api(`/people?${currentDirectoryQuery()}`);
      if (state.view !== "directory" || loadSequence !== state.directoryLoadSequence) return;
      state.people = listFrom(payload, "people", "records", "items");
      state.directoryCount = Number(first(payload, "count", "total", "totalCount")) || state.people.length;
      renderPeopleList();
    } catch {
      // The detail mutation succeeded; the next directory refresh will reconcile the list.
    }
  }

  function bindPersonForms(detail, id) {
    const encodedId = encodeURIComponent(id);
    detail.querySelector("[data-profile-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = {
        displayName: formValue(form, "displayName"),
        preferredName: formValue(form, "preferredName"),
        preferredContactMethod: formValue(form, "preferredContactMethod"),
        relationshipStatus: formValue(form, "relationshipStatus"),
        organization: formValue(form, "organization"),
        pronouns: formValue(form, "pronouns"),
        instagram: formValue(form, "instagram"),
        summary: formValue(form, "summary"),
        tags: formValue(form, "tags").split(",").map((value) => value.trim()).filter(Boolean),
      };
      try {
        disableForm(form, true);
        setFormStatus(form, "Saving…");
        await api(`/people/${encodedId}`, { method: "PATCH", body });
        await Promise.all([loadPerson(id), refreshSelectedPersonRow()]);
      } catch (error) {
        setFormStatus(form, error.message || "Could not update profile.", "error");
      } finally {
        if (form.isConnected) disableForm(form, false);
      }
    });

    detail.querySelector("[data-tier-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const tier = formValue(form, "tier");
      const rationale = formValue(form, "tierRationale");
      const tierChanged = tier !== String(form.dataset.currentTier || "");
      if (tierChanged && !rationale) {
        setFormStatus(form, "A rationale is required whenever the tier changes, including clearing it.", "error");
        return;
      }
      try {
        disableForm(form, true);
        setFormStatus(form, "Updating tier…");
        await api(`/people/${encodedId}`, { method: "PATCH", body: { tier: tier ? ({ I: 1, II: 2, III: 3 })[tier] : null, tierRationale: rationale } });
        await Promise.all([loadPerson(id), refreshSelectedPersonRow()]);
      } catch (error) {
        setFormStatus(form, error.message || "Could not update tier.", "error");
      } finally {
        if (form.isConnected) disableForm(form, false);
      }
    });

    detail.querySelector("[data-identity-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      submitPersonForm(form, `/people/${encodedId}/identities`, {
        kind: formValue(form, "kind"),
        value: formValue(form, "value"),
        provider: formValue(form, "provider") || "manual",
        primary: form.elements.primary.checked,
      }, "Identity added.");
    });

    detail.querySelector("[data-interaction-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      let occurredAt;
      try {
        occurredAt = localDateTimeToIso(formValue(form, "occurredAt"));
      } catch (error) {
        setFormStatus(form, error.message, "error");
        return;
      }
      submitPersonForm(form, `/people/${encodedId}/interactions`, {
        kind: formValue(form, "kind"),
        interactionType: formValue(form, "kind"),
        nodeId: formValue(form, "nodeId") || null,
        channel: formValue(form, "channel"),
        label: formValue(form, "label"),
        occurredAt,
        status: formValue(form, "status"),
        details: formValue(form, "details"),
        metadata: { details: formValue(form, "details") },
        sourceProvider: "manual",
      }, "Interaction added.");
    });

    detail.querySelector("[data-transaction-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      let amountCents;
      let tipCents;
      let occurredAt;
      try {
        amountCents = dollarsToCents(formValue(form, "amount"), "Amount", formValue(form, "kind") === "adjustment");
        tipCents = dollarsToCents(formValue(form, "tip") || "0", "Tip");
        occurredAt = localDateTimeToIso(formValue(form, "occurredAt"));
      } catch (error) {
        setFormStatus(form, error.message, "error");
        return;
      }
      const requestId = form.dataset.transactionRequestId || newRequestId();
      form.dataset.transactionRequestId = requestId;
      const saved = await submitPersonForm(form, `/people/${encodedId}/transactions`, {
        kind: formValue(form, "kind"),
        transactionType: formValue(form, "kind"),
        status: formValue(form, "status"),
        amountCents,
        tipCents,
        currency: formValue(form, "currency").toUpperCase(),
        nodeId: formValue(form, "nodeId") || null,
        occurredAt,
        reference: formValue(form, "reference"),
        requestId,
        label: formValue(form, "label"),
        note: [formValue(form, "label"), formValue(form, "reference")].filter(Boolean).join(" · "),
        sourceProvider: "manual",
      }, "Transaction added.");
      if (saved) delete form.dataset.transactionRequestId;
    });

    detail.querySelector("[data-note-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      submitPersonForm(form, `/people/${encodedId}/notes`, {
        category: formValue(form, "category"),
        body: formValue(form, "body"),
        pinned: form.elements.pinned.checked,
      }, "Note added.");
    });

    detail.querySelector("[data-personal-context-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.elements.confirmShared.checked) {
        setFormStatus(form, "Confirm that the client shared this information directly.", "error");
        return;
      }
      submitPersonForm(form, `/people/${encodedId}/personal-context`, {
        body: formValue(form, "body"),
        pinned: form.elements.pinned.checked,
        provenance: formValue(form, "provenance"),
      }, "Private context added.");
    });

    detail.querySelectorAll("[data-personal-context-edit]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const activeForm = event.currentTarget;
        const noteId = activeForm.dataset.noteId;
        try {
          disableForm(activeForm, true);
          setFormStatus(activeForm, "Saving…");
          await api(`/people/${encodedId}/personal-context/${encodeURIComponent(noteId)}`, {
            method: "PATCH",
            body: {
              body: String(activeForm.elements.body?.value || "").trim(),
              pinned: activeForm.elements.pinned.checked,
              provenance: "shared_by_client",
            },
          });
          await loadPerson(id);
        } catch (error) {
          setFormStatus(activeForm, error.message || "Could not update private context.", "error");
        } finally {
          if (activeForm.isConnected) disableForm(activeForm, false);
        }
      });
    });

    detail.querySelectorAll("[data-personal-context-remove]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("Remove this private context note? Its sensitive text will be permanently scrubbed.")) return;
        try {
          button.disabled = true;
          await api(`/people/${encodedId}/personal-context/${encodeURIComponent(button.dataset.personalContextRemove)}`, {
            method: "DELETE",
          });
          await loadPerson(id);
        } catch (error) {
          button.disabled = false;
          alert(error.message || "The private context could not be removed.");
        }
      });
    });

    detail.querySelector("[data-followup-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      let dueAt;
      try {
        dueAt = localDateTimeToIso(formValue(form, "dueAt"));
      } catch (error) {
        setFormStatus(form, error.message, "error");
        return;
      }
      submitPersonForm(form, `/people/${encodedId}/followups`, {
        action: formValue(form, "title"),
        dueAt,
        priority: formValue(form, "priority"),
        note: formValue(form, "notes"),
      }, "Follow-up added.");
    });

    detail.querySelectorAll("[data-followup-status]").forEach((button) => {
      button.addEventListener("click", async () => {
        const nextStatus = button.dataset.status;
        try {
          button.disabled = true;
          await api(`/people/${encodedId}/followups`, {
            method: "PATCH",
            body: { id: button.dataset.followupStatus, status: nextStatus },
          });
          await loadPerson(id);
        } catch (error) {
          button.disabled = false;
          alert(error.message || "The follow-up could not be updated.");
        }
      });
    });
  }

  function flattenAttention(payload) {
    const direct = listFrom(payload, "items", "attention", "records");
    if (direct.length) return direct;
    const groups = [
      ["possible_duplicate", "Possible duplicate", ["duplicates", "possibleDuplicates", "possible_duplicates"]],
      ["unmatched_payment", "Unmatched payment", ["unmatchedPayments", "unmatched_payments"]],
      ["money_conflict", "Money conflict", ["moneyConflicts", "money_conflicts", "spendingConflicts", "spending_conflicts"]],
      ["sync_failure", "Sync failure", ["syncFailures", "sync_failures"]],
      ["overdue_followup", "Overdue follow-up", ["overdueFollowups", "overdue_followups"]],
      ["consent_conflict", "Consent conflict", ["consentConflicts", "consent_conflicts"]],
    ];
    return groups.flatMap(([kind, label, keys]) => {
      const rows = listFrom(payload, ...keys);
      return rows.map((row) => ({ ...row, kind: first(row, "kind", "type") || kind, categoryLabel: label }));
    });
  }

  function attentionCard(item) {
    const record = objectFrom(item, "record");
    const metadata = jsonObject(first(record, "metadata_json", "metadataJson", "metadata"));
    const payerNameHint = first(metadata, "payerDisplayName", "payer_display_name");
    const conflicts = listFrom(metadata, "conflicts");
    const conflictPersonIds = listFrom(metadata, "personIds", "person_ids");
    const conflictMessage = conflicts.includes("payer_name_disagreement")
      ? "Square supplied different unverified payer names for this exact customer. Open the person and review the saved labels."
      : conflicts.length
        ? `Review: ${conflicts.map((value) => String(value).replace(/_/g, " ")).join(", ")}.`
        : "";
    const kind = first(item, "kind", "type", "category") || "attention";
    const title = first(item, "title", "label", "categoryLabel")
      || first(record, "title", "label", "action", "displayName", "display_name")
      || String(kind).replace(/_/g, " ");
    const message = first(item, "message", "description", "reason", "summary")
      || (payerNameHint
        ? `Square supplied the unverified payer name “${payerNameHint}”. Review it before attaching this payment.`
        : "")
      || conflictMessage
      || first(record, "message", "description", "reason", "error", "note", "action")
      || "This record needs review.";
    const person = objectFrom(item, "person");
    const id = String(
      first(item, "personId", "person_id")
      || first(record, "personId", "person_id")
      || personId(person)
      || (conflictPersonIds.length === 1 ? conflictPersonIds[0] : "")
    );
    const createdAt = first(item, "createdAt", "created_at", "dueAt", "due_at", "occurredAt", "occurred_at")
      || first(record, "createdAt", "created_at", "dueAt", "due_at", "occurredAt", "occurred_at");
    const amount = centsValue(item, "amountCents", "amount_cents") || centsValue(record, "amountCents", "amount_cents");
    const currency = first(item, "currency") || first(record, "currency") || "USD";
    const recordName = first(record, "personName", "person_name", "displayName", "display_name");
    return `
      <article class="people-attention-card">
        <div class="people-record-head">
          <h3>${esc(title)}</h3>
          ${statusChip("attention", String(kind).replace(/_/g, " "))}
        </div>
        ${id ? `<strong class="people-record-title">${esc(personName(person) !== "Unnamed person" ? personName(person) : first(item, "personName", "person_name") || recordName || "Person record")}</strong>` : ""}
        <p>${esc(message)}</p>
        ${amount ? `<span class="people-record-amount">${esc(formatMoney(amount, currency))}</span>` : ""}
        ${createdAt ? `<div class="people-record-meta">${esc(formatDate(createdAt, true))}</div>` : ""}
        ${id ? `<div class="people-actions"><button class="button" type="button" data-open-person="${attr(id)}">Open person</button></div>` : ""}
      </article>`;
  }

  async function renderAttention() {
    const ui = prepareView("single");
    ui.detail.innerHTML = `
      <div class="people-page-head">
        <div class="people-section-head">
          <div>
            <h2>Needs Attention</h2>
            <p>Duplicates, unmatched money, consent conflicts, sync failures, and overdue follow-ups gather here without changing source records.</p>
          </div>
          <button class="button" type="button" data-refresh-attention>Refresh</button>
        </div>
      </div>
      <div data-attention-results>${notice("Loading attention queue…")}</div>`;
    const results = ui.detail.querySelector("[data-attention-results]");
    const load = async () => {
      results.innerHTML = notice("Loading attention queue…");
      try {
        const payload = await api("/needs-attention");
        if (state.view !== "attention") return;
        const items = flattenAttention(payload);
        results.innerHTML = items.length
          ? `<div class="people-attention-grid">${items.map(attentionCard).join("")}</div>`
          : notice("Nothing currently needs attention.", "success");
      } catch (error) {
        if (error?.name === "AbortError" || state.view !== "attention") return;
        results.innerHTML = notice(error.message || "The attention queue could not be loaded.", "error");
        setTopStatus("People error");
      }
    };
    ui.detail.querySelector("[data-refresh-attention]").addEventListener("click", load);
    ui.detail.addEventListener("click", (event) => {
      const button = event.target.closest("[data-open-person]");
      if (!button) return;
      state.selectedPersonId = button.dataset.openPerson;
      const directoryButton = document.querySelector('.subnav-btn[data-subview="directory"]');
      if (directoryButton) directoryButton.click();
      else render("people", "directory");
    }, { signal: state.controller.signal });
    await load();
  }

  function importSteps(active) {
    const steps = [["upload", "1 · Upload"], ["mapping", "2 · Map"], ["review", "3 · Review"], ["applied", "4 · Complete"]];
    return `<ol class="people-import-steps" aria-label="Import progress">${steps.map(([value, label]) => (
      `<li class="people-import-step ${active === value ? "is-active" : ""}" ${active === value ? 'aria-current="step"' : ""}>${esc(label)}</li>`
    )).join("")}</ol>`;
  }

  function initialImportMarkup() {
    return `
      ${importSteps("upload")}
      <div class="people-import-head">
        <div>
          <h3>Legacy Lists</h3>
          <p>Upload one UTF-8 CSV or TSV at a time. The file is analyzed before anything becomes a person, interaction, note, or transaction.</p>
        </div>
        <span class="people-status-chip" data-state="manual">5 MB · 10,000 rows · 100 columns</span>
      </div>
      <form class="people-form" data-import-analyze enctype="multipart/form-data">
        <label class="people-file-drop" data-file-drop>
          <strong class="people-record-title">Choose CSV or TSV</strong>
          <span>Excel and Google Sheets tabs should be exported one sheet per CSV.</span>
          <input name="file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" required>
          <span class="people-helper" data-file-name>No file selected.</span>
        </label>
        <div class="people-form-grid">
          <label>Source label<input name="label" required placeholder="2018–2021 tattoo clients"></label>
          <label>Source system
            <select name="sourceProvider">
              ${optionMarkup([["legacy_list", "Legacy client list"], ["substack", "Substack subscriber export"], ["studio_archive", "Studio archive"], ["other", "Other historical list"]], "legacy_list")}
            </select>
          </label>
          <label>Approximate period start<input name="periodStart" type="date"></label>
          <label>Approximate period end<input name="periodEnd" type="date"></label>
          <label>Default interaction<select name="defaultInteractionType">${optionMarkup(INTERACTION_OPTIONS, "appointment")}</select></label>
          <label>Default node<select name="defaultNodeId">${optionMarkup(NODE_OPTIONS, "node-tattoos", "No default node")}</select></label>
          <label>Date format
            <select name="dateFormat">
              ${optionMarkup([["auto", "Detect automatically"], ["mdy", "MM/DD/YYYY"], ["dmy", "DD/MM/YYYY"], ["ymd", "YYYY-MM-DD"]], "auto")}
            </select>
          </label>
          <label>Currency<input name="currency" value="USD" maxlength="3" required></label>
          <label>Money column meaning
            <select name="moneyMode">
              ${optionMarkup([["none", "No money column"], ["transaction", "Individual paid transactions"], ["aggregate", "Aggregate lifetime total"], ["estimate", "Estimate or quote"], ["unpaid", "Unpaid balance"]], "none")}
            </select>
          </label>
          <label class="people-check">
            <input name="newsletterExport" type="checkbox">
            <span>This is a genuine subscriber export. Email addresses in ordinary client lists do not create newsletter consent.</span>
          </label>
        </div>
        <div class="people-actions">
          <button class="button" type="submit">Analyze file</button>
          <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
        </div>
      </form>`;
  }

  function providerCard(provider) {
    const id = String(first(provider, "id", "provider") || "provider");
    const ready = truthy(first(provider, "ready")) || normalizedState(first(provider, "status")) === "ready";
    const configured = truthy(first(provider, "configured"));
    const missing = listFrom(provider, "missing");
    const details = objectFrom(provider, "details");
    const lastSyncRecord = first(provider, "lastSync", "last_sync");
    const lastSyncRecordAt = lastSyncRecord && typeof lastSyncRecord === "object"
      ? first(
          lastSyncRecord,
          "completedAt",
          "completed_at",
          "updatedAt",
          "updated_at",
          "startedAt",
          "started_at"
        )
      : lastSyncRecord;
    const lastSyncRaw = first(provider, "lastSyncAt", "last_sync_at", "checkpoint", "updatedAt", "updated_at")
      || lastSyncRecordAt
      || first(details, "lastSyncAt", "last_sync_at");
    const lastSync = lastSyncRaw && typeof lastSyncRaw === "object"
      ? first(lastSyncRaw, "updatedAt", "updated_at", "occurredAt", "occurred_at", "beginTime", "begin_time")
      : lastSyncRaw;
    const mode = first(provider, "mode") || "api";
    const status = first(provider, "status") || (ready ? "ready" : configured ? "attention" : "manual");
    return `
      <article class="people-integration-card">
        <div class="people-integration-head">
          <div>
            <h3>${esc(first(provider, "label", "name") || id)}</h3>
            <div class="people-record-meta">${esc(mode)} connection</div>
          </div>
          ${statusChip(status)}
        </div>
        <p>${ready ? "Configured and ready to reconcile." : configured ? "Configured but needs attention." : mode === "csv" ? "Managed through reviewed CSV imports." : "Credentials are not fully configured."}</p>
        <div class="people-integration-metrics">
          <div><strong>${esc(lastSync ? formatDate(lastSync, true) : "Never")}</strong><span>Last sync</span></div>
          <div><strong>${esc(missing.length ? String(missing.length) : "0")}</strong><span>Missing settings</span></div>
        </div>
        ${missing.length ? `<div class="people-helper">Missing: ${esc(missing.join(", "))}</div>` : ""}
        ${mode === "api" ? `<div class="people-actions">
          <button class="button" type="button" data-sync-provider="${attr(id)}" data-sync-mode="incremental" ${ready ? "" : "disabled"}>Sync now</button>
          <button class="button" type="button" data-sync-provider="${attr(id)}" data-sync-mode="full" ${ready ? "" : "disabled"}>Full sync</button>
        </div>` : ""}
        <div class="people-helper" data-provider-result="${attr(id)}" role="status" aria-live="polite"></div>
      </article>`;
  }

  function providerStatusMarkup(payload) {
    const providers = listFrom(payload, "providers", "records", "items");
    if (!providers.length) return notice("Provider status is not available yet.");
    return `<div class="people-integration-grid">${providers.map(providerCard).join("")}</div>`;
  }

  function importBatchId(batch) {
    return String(first(batch, "id", "importBatchId", "import_batch_id") || "");
  }

  function importHistoryCard(batch) {
    const id = importBatchId(batch);
    const status = first(batch, "status", "state") || "analyzed";
    const config = objectFrom(batch, "config");
    const label = first(batch, "label", "sourceLabel", "source_label")
      || first(config, "label", "sourceLabel")
      || first(batch, "filename", "fileName", "file_name")
      || "Legacy list";
    const summary = objectFrom(batch, "summary", "counts");
    const applyStates = objectFrom(summary, "applyStates", "apply_states");
    const rows = Number(first(batch, "rowCount", "row_count") || first(summary, "total", "rows")) || 0;
    const applied = Number(first(applyStates, "applied") || first(summary, "applied", "created", "peopleCreated", "people_created")) || 0;
    const statusValue = normalizedState(status);
    return `
      <article class="people-import-card">
        <div class="people-import-head">
          <div>
            <h3>${esc(label)}</h3>
            <div class="people-import-meta">${esc(first(batch, "filename", "fileName", "file_name") || "source file")} · ${esc(formatDate(first(batch, "createdAt", "created_at"), true))}</div>
          </div>
          ${statusChip(status)}
        </div>
        <div class="people-integration-metrics">
          <div><strong>${rows}</strong><span>Rows</span></div>
          <div><strong>${applied}</strong><span>Applied</span></div>
        </div>
        <div class="people-actions">
          <button class="button" type="button" data-import-open="${attr(id)}">Review</button>
          <button class="button" type="button" data-import-exceptions="${attr(id)}">Exceptions CSV</button>
          ${["applying", "applied", "completed", "partially_applied"].includes(statusValue)
            ? `<button class="button danger-button" type="button" data-import-rollback="${attr(id)}">Rollback</button>`
            : ""}
        </div>
        <div class="people-helper" data-import-result="${attr(id)}" role="status" aria-live="polite"></div>
      </article>`;
  }

  function importHistoryMarkup(batches) {
    return batches.length
      ? `<div class="people-import-list">${batches.map(importHistoryCard).join("")}</div>`
      : '<div class="people-empty">No historical imports yet.</div>';
  }

  function integrationsShell() {
    return `
      <div class="people-page-head">
        <div class="people-section-head">
          <div>
            <h2>Integrations &amp; Imports</h2>
            <p>Provider records remain authoritative. Imports are staged, reviewed, idempotent, and reversible.</p>
          </div>
          <button class="button" type="button" data-refresh-integrations>Refresh status</button>
        </div>
      </div>

      <section data-admin-section-title="Connected sources">
        <h3>Connected sources</h3>
        <div data-provider-status>${notice("Loading provider status…")}</div>
      </section>

      <section data-admin-section-title="Construct backfill">
        <h3>Construct backfill</h3>
        <p class="people-section-copy">Preview or import existing submissions, appointments, settled deposits, event tickets, waitlists, and open-mic records. Event submission mirrors are excluded.</p>
        <div class="people-actions">
          <button class="button" type="button" data-backfill="preview">Preview backfill</button>
          <button class="button" type="button" data-backfill="apply">Run backfill</button>
          <span class="people-helper" data-backfill-result role="status" aria-live="polite"></span>
        </div>
      </section>

      <article class="people-panel" data-import-wizard aria-label="Legacy list importer">
        ${initialImportMarkup()}
      </article>

      <section data-admin-section-title="Import history">
        <div class="people-section-head">
          <h3>Import history</h3>
          <span class="people-helper">Rollback preserves the audit summary and deactivates batch-owned records.</span>
        </div>
        <div data-import-history>${notice("Loading import history…")}</div>
      </section>`;
  }

  async function renderIntegrations() {
    const ui = prepareView("single");
    state.importFlow = null;
    ui.detail.innerHTML = integrationsShell();
    bindIntegrations(ui.detail);
    enhanceStudioControls(ui.detail);
    await loadIntegrationData();
  }

  async function loadIntegrationData() {
    const detail = elements().detail;
    if (!detail || state.view !== "integrations") return;
    const statusTarget = detail.querySelector("[data-provider-status]");
    const historyTarget = detail.querySelector("[data-import-history]");
    const [statusResult, importsResult] = await Promise.allSettled([
      apiFirst(["/sync/status", "/integrations"]),
      api("/imports?limit=50&offset=0"),
    ]);
    if (state.view !== "integrations") return;
    if (statusResult.status === "fulfilled") {
      state.integrationsPayload = statusResult.value;
      if (statusTarget) statusTarget.innerHTML = providerStatusMarkup(statusResult.value);
    } else if (statusTarget) {
      statusTarget.innerHTML = notice(statusResult.reason?.message || "Provider status could not be loaded.", "error");
    }
    if (importsResult.status === "fulfilled") {
      state.imports = listFrom(importsResult.value, "imports", "batches", "records", "items");
      if (historyTarget) historyTarget.innerHTML = importHistoryMarkup(state.imports);
    } else if (historyTarget) {
      historyTarget.innerHTML = notice(importsResult.reason?.message || "Import history could not be loaded.", "error");
    }
    if (statusResult.status === "rejected" && importsResult.status === "rejected") setTopStatus("People error");
  }

  function integrationResultSummary(payload) {
    const stats = objectFrom(payload, "stats");
    const records = objectFrom(payload, "records");
    const summary = objectFrom(payload, "summary");
    const values = [
      first(stats, "received") ? `${first(stats, "received")} received` : "",
      first(stats, "accepted") ? `${first(stats, "accepted")} accepted` : "",
      first(stats, "skipped") ? `${first(stats, "skipped")} skipped` : "",
      first(stats, "pages") ? `${first(stats, "pages")} pages` : "",
      first(stats, "customerProfilesReceived") ? `${first(stats, "customerProfilesReceived")} customer profiles` : "",
      first(stats, "paymentNameHintsReceived") ? `${first(stats, "paymentNameHintsReceived")} payment-name hints` : "",
      first(summary, "peopleCreated", "people_created") ? `${first(summary, "peopleCreated", "people_created")} people created` : "",
      first(summary, "matched") ? `${first(summary, "matched")} matched` : "",
      first(records, "payments") ? `${first(records, "payments")} payments` : "",
      first(records, "orders") ? `${first(records, "orders")} orders` : "",
      first(records, "subscriptions") ? `${first(records, "subscriptions")} subscriptions` : "",
    ].filter(Boolean);
    const warnings = listFrom(payload, "warnings");
    const base = values.join(" · ") || first(payload, "message") || "Complete.";
    if (!warnings.length) return base;
    const warningText = warnings
      .slice(0, 2)
      .map((warning) => String(warning || "").trim())
      .filter(Boolean)
      .join(" ");
    const extraWarnings = Math.max(0, warnings.length - 2);
    return `${base} · ${warningText || `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}${extraWarnings ? ` (+${extraWarnings} more)` : ""}`;
  }

  function bindIntegrations(detail) {
    detail.addEventListener("click", async (event) => {
      const refresh = event.target.closest("[data-refresh-integrations]");
      const sync = event.target.closest("[data-sync-provider]");
      const backfill = event.target.closest("[data-backfill]");
      const open = event.target.closest("[data-import-open]");
      const rollback = event.target.closest("[data-import-rollback]");
      const exceptions = event.target.closest("[data-import-exceptions]");
      const reset = event.target.closest("[data-import-reset]");
      const backToMap = event.target.closest("[data-import-back-map]");
      const page = event.target.closest("[data-import-page]");
      if (refresh) {
        await loadIntegrationData();
        return;
      }
      if (sync) {
        const provider = sync.dataset.syncProvider;
        const mode = sync.dataset.syncMode || "incremental";
        if (mode === "full" && !confirm(`Run a full ${provider} reconciliation? Existing source-linked records will be updated, not duplicated.`)) return;
        const output = detail.querySelector(`[data-provider-result="${selectorEscape(provider)}"]`);
        try {
          sync.disabled = true;
          if (output) output.textContent = `${mode === "full" ? "Full" : "Incremental"} sync running…`;
          const payload = await api(`/sync/${encodeURIComponent(provider)}`, {
            method: "POST",
            body: { mode, maxPages: 4 },
          });
          if (output) output.textContent = integrationResultSummary(payload);
          await loadIntegrationData();
        } catch (error) {
          if (output) output.textContent = error.message || "Sync failed.";
        } finally {
          if (sync.isConnected) sync.disabled = false;
        }
        return;
      }
      if (backfill) {
        const preview = backfill.dataset.backfill === "preview";
        if (!preview && !confirm("Run the Construct backfill now? Exact identities will link automatically; ambiguous records remain in Needs Attention.")) return;
        const output = detail.querySelector("[data-backfill-result]");
        const controls = [...detail.querySelectorAll("[data-backfill]")];
        try {
          controls.forEach((button) => { button.disabled = true; });
          if (output) output.textContent = preview ? "Building preview…" : "Backfill running…";
          const payload = await apiFirst(["/backfill", "/sync/backfill"], {
            method: "POST",
            body: { dryRun: preview, mode: preview ? "preview" : "apply" },
          });
          if (output) output.textContent = integrationResultSummary(payload);
          if (!preview) await loadIntegrationData();
        } catch (error) {
          if (output) output.textContent = error.message || "Backfill failed.";
        } finally {
          controls.forEach((button) => { if (button.isConnected) button.disabled = false; });
        }
        return;
      }
      if (open) {
        await openImportBatch(open.dataset.importOpen);
        return;
      }
      if (rollback) {
        await rollbackImport(rollback.dataset.importRollback);
        return;
      }
      if (exceptions) {
        await downloadImportExceptions(exceptions.dataset.importExceptions);
        return;
      }
      if (reset) {
        state.importFlow = null;
        renderImportWizard();
        return;
      }
      if (backToMap && state.importFlow) {
        state.importFlow.step = "mapping";
        renderImportWizard();
        return;
      }
      if (page && state.importFlow) {
        await changeImportPage(Number(page.dataset.importPage) || 0);
      }
    }, { signal: state.controller.signal });

    detail.addEventListener("submit", (event) => {
      const analyze = event.target.closest("[data-import-analyze]");
      const mapping = event.target.closest("[data-import-mapping]");
      const decisions = event.target.closest("[data-import-decisions]");
      const apply = event.target.closest("[data-import-apply]");
      if (analyze) {
        event.preventDefault();
        analyzeImport(analyze);
      } else if (mapping) {
        event.preventDefault();
        saveImportMapping(mapping);
      } else if (decisions) {
        event.preventDefault();
        saveImportDecisions(decisions);
      } else if (apply) {
        event.preventDefault();
        applyImport(apply);
      }
    }, { signal: state.controller.signal });

    detail.addEventListener("change", (event) => {
      if (event.target.matches('[data-import-analyze] input[type="file"]')) {
        const file = event.target.files?.[0];
        const label = event.target.closest("form")?.querySelector("[data-file-name]");
        if (label) label.textContent = file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : "No file selected.";
      }
      if (event.target.matches("[data-review-filter]")) {
        const value = event.target.value;
        detail.querySelectorAll("[data-review-classification]").forEach((row) => {
          row.hidden = Boolean(value && row.dataset.reviewClassification !== value);
        });
      }
      if (event.target.matches("[data-row-decision]")) {
        const row = event.target.closest("[data-import-decision-row]");
        const person = row?.querySelector("[data-row-person-wrap]");
        const candidate = row?.querySelector("[data-row-candidate-wrap]");
        if (person) person.hidden = event.target.value !== "link";
        if (candidate) candidate.hidden = event.target.value !== "link";
      }
      if (event.target.matches("[data-row-candidate]")) {
        const input = event.target.closest("[data-import-decision-row]")?.querySelector("[data-row-person]");
        if (input && event.target.value) input.value = event.target.value;
      }
    }, { signal: state.controller.signal });

    detail.addEventListener("dragover", (event) => {
      const drop = event.target.closest("[data-file-drop]");
      if (!drop) return;
      event.preventDefault();
      drop.classList.add("is-over");
    }, { signal: state.controller.signal });
    detail.addEventListener("dragleave", (event) => {
      event.target.closest("[data-file-drop]")?.classList.remove("is-over");
    }, { signal: state.controller.signal });
    detail.addEventListener("drop", (event) => {
      const drop = event.target.closest("[data-file-drop]");
      if (!drop) return;
      event.preventDefault();
      drop.classList.remove("is-over");
      const file = event.dataTransfer?.files?.[0];
      const input = drop.querySelector('input[type="file"]');
      if (!file || !input) return;
      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
        const label = drop.querySelector("[data-file-name]");
        if (label) label.textContent = "Use the file chooser to select this file.";
      }
    }, { signal: state.controller.signal });
  }

  function importConfigFromForm(form) {
    const values = new FormData(form);
    const sourceProvider = String(values.get("sourceProvider") || "legacy_list");
    return {
      sourceLabel: String(values.get("label") || "").trim(),
      sourcePeriodStart: String(values.get("periodStart") || ""),
      sourcePeriodEnd: String(values.get("periodEnd") || ""),
      defaultInteractionType: String(values.get("defaultInteractionType") || "manual"),
      defaultNodeId: String(values.get("defaultNodeId") || ""),
      dateFormat: String(values.get("dateFormat") || "auto"),
      currency: String(values.get("currency") || "USD").toUpperCase(),
      moneyMode: String(values.get("moneyMode") || "none"),
      newsletterExport: Boolean(form.elements.newsletterExport?.checked),
      newsletterProvider: sourceProvider === "substack" ? "substack" : "",
      subscriptionStatus: sourceProvider === "substack" ? "subscribed" : "unknown",
    };
  }

  function validateImportFile(file) {
    if (!file) throw new Error("Choose a CSV or TSV file.");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("The file exceeds the 5 MB import limit.");
    const extension = file.name.toLowerCase().split(".").pop();
    if (!["csv", "tsv"].includes(extension)) throw new Error("Use a .csv or .tsv file.");
  }

  function importColumns(payload) {
    let columns = listFrom(payload, "columns", "headers");
    const preview = listFrom(payload, "preview", "rows");
    if (!columns.length && preview.length) {
      const raw = objectFrom(preview[0], "raw", "values", "source");
      columns = Object.keys(raw);
    }
    return columns.map((column) => {
      if (typeof column === "string") return { name: column, samples: [] };
      return {
        name: String(first(column, "name", "header", "column") || ""),
        samples: listFrom(column, "samples", "examples"),
      };
    }).filter((column) => column.name);
  }

  function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  function inferredTarget(header) {
    const value = normalizeHeader(header);
    const patterns = [
      ["name", /^(name|full_name|client_name|customer_name|contact_name)$/],
      ["first_name", /^(first|first_name|firstname)$/],
      ["last_name", /^(last|last_name|lastname|surname)$/],
      ["preferred_name", /^(preferred_name|preferred|nickname)$/],
      ["email", /(email|e_mail)/],
      ["phone", /(phone|mobile|cell|telephone)/],
      ["instagram", /(instagram|ig_handle|insta)/],
      ["organization", /(organization|organisation|company|business)/],
      ["pronouns", /pronoun/],
      ["date", /(^date$|appointment_date|session_date|purchase_date|created_at)/],
      ["interaction", /(interaction|service|appointment_type|booking_type)/],
      ["node", /(^node$|construct_node|department|medium)/],
      ["tip", /(^tip$|gratuity)/],
      ["currency", /currency/],
      ["payment_reference", /(payment.*(id|reference)|receipt|transaction_id|order_id)/],
      ["amount", /(^amount$|amount_paid|paid|price|spend|total_spent|lifetime_value)/],
      ["tags", /(tag|label|category)/],
      ["notes", /(note|comment|memo|context)/],
      ["tier", /(^tier$|client_tier|relationship_tier)/],
      ["consent", /(consent|subscribed|subscription_status|newsletter)/],
      ["provider_id", /(customer_id|client_id|subscriber_id|external_id)/],
    ];
    return patterns.find(([, pattern]) => pattern.test(value))?.[0] || "";
  }

  function importMappingObject(payload, columns) {
    const supplied = first(payload, "mapping", "columnMapping", "column_mapping");
    const mapping = {};
    const headers = new Set(columns.map((column) => column.name));
    if (Array.isArray(supplied)) {
      supplied.forEach((entry) => {
        const source = first(entry, "source", "column", "header");
        const target = first(entry, "target", "field");
        if (source && headers.has(String(source)) && IMPORT_TARGET_FIELDS.has(String(target))) {
          mapping[source] = target;
        }
      });
    } else if (supplied && typeof supplied === "object") {
      Object.entries(supplied).forEach(([key, value]) => {
        const stringValue = String(value || "");
        if (headers.has(key) && IMPORT_TARGET_FIELDS.has(stringValue)) mapping[key] = stringValue;
        else if (IMPORT_TARGET_FIELDS.has(key) && headers.has(stringValue)) mapping[stringValue] = key;
      });
    }
    columns.forEach((column) => {
      if (mapping[column.name] === undefined) mapping[column.name] = inferredTarget(column.name);
    });
    return mapping;
  }

  function samplesForColumn(column, preview) {
    const direct = (column.samples || []).filter((value) => value !== null && value !== undefined && value !== "").slice(0, 3);
    if (direct.length) return direct;
    const values = preview.map((row) => {
      const raw = objectFrom(row, "raw", "values", "source");
      return raw[column.name];
    }).filter((value) => value !== null && value !== undefined && value !== "");
    return values.slice(0, 3);
  }

  async function analyzeImport(form) {
    const file = form.elements.file.files?.[0];
    try {
      validateImportFile(file);
      const config = importConfigFromForm(form);
      if (!config.sourceLabel) throw new Error("Give this source a clear label.");
      disableForm(form, true);
      setFormStatus(form, "Analyzing columns, identities, and money…");
      const body = new FormData();
      body.append("file", file, file.name);
      body.append("config", JSON.stringify(config));
      const payload = await api("/imports/analyze", { method: "POST", body });
      const batch = objectFrom(payload, "importBatch", "import_batch", "batch");
      const columns = importColumns(payload);
      if (!importBatchId(batch) && !first(payload, "importId", "import_id", "id")) throw new Error("The analyzer did not return an import batch.");
      if (!columns.length) throw new Error("No usable columns were found in this file.");
      const preview = listFrom(payload, "preview", "rows");
      state.importFlow = {
        step: "mapping",
        id: importBatchId(batch) || String(first(payload, "importId", "import_id", "id")),
        batch,
        columns,
        mapping: importMappingObject(payload, columns),
        preview,
        summary: objectFrom(payload, "summary"),
        config,
        filename: file.name,
      };
      renderImportWizard();
      await loadIntegrationData();
    } catch (error) {
      setFormStatus(form, error.message || "The file could not be analyzed.", "error");
    } finally {
      if (form.isConnected) disableForm(form, false);
    }
  }

  function mappingMarkup(flow) {
    const config = flow.config || {};
    const preview = flow.preview || [];
    const mappings = flow.columns.map((column) => {
      const samples = samplesForColumn(column, preview);
      return `
        <div class="people-mapping-row">
          <div class="people-mapping-source">${esc(column.name)}</div>
          <div class="people-mapping-sample">${samples.length ? samples.map((value) => esc(value)).join(" · ") : "No sample value"}</div>
          <label>Import as
            <select data-map-column="${attr(column.name)}">
              ${optionMarkup(IMPORT_TARGETS, flow.mapping[column.name] || "")}
            </select>
          </label>
        </div>`;
    }).join("");
    return `
      ${importSteps("mapping")}
      <div class="people-import-head">
        <div>
          <h3>Map ${esc(flow.filename || first(flow.batch, "filename", "fileName", "file_name") || "legacy list")}</h3>
          <p>Review every suggested mapping. Unmapped columns stay in temporary staging only and do not become permanent CRM fields.</p>
        </div>
        <button class="button" type="button" data-import-reset>Start over</button>
      </div>
      <form class="people-form" data-import-mapping>
        <div class="people-mapping-grid">${mappings}</div>
        <section data-admin-section-title="Import defaults">
          <h4>Batch defaults</h4>
          <div class="people-form-grid">
            <label>Default interaction<select name="defaultInteractionType">${optionMarkup(INTERACTION_OPTIONS, config.defaultInteractionType || "manual")}</select></label>
            <label>Default node<select name="defaultNodeId">${optionMarkup(NODE_OPTIONS, config.defaultNodeId || "", "No default node")}</select></label>
            <label>Date format
              <select name="dateFormat">${optionMarkup([["auto", "Detect automatically"], ["mdy", "MM/DD/YYYY"], ["dmy", "DD/MM/YYYY"], ["ymd", "YYYY-MM-DD"]], config.dateFormat || "auto")}</select>
            </label>
            <label>Currency<input name="currency" value="${attr(config.currency || "USD")}" maxlength="3"></label>
            <label>Money meaning
              <select name="moneyMode">${optionMarkup([["none", "No money column"], ["transaction", "Individual paid transactions"], ["aggregate", "Aggregate lifetime total"], ["estimate", "Estimate or quote"], ["unpaid", "Unpaid balance"]], config.moneyMode || "none")}</select>
            </label>
            <label class="people-check">
              <input name="newsletterExport" type="checkbox" ${config.newsletterExport ? "checked" : ""}>
              <span>This is a genuine newsletter subscriber export.</span>
            </label>
            <label>Newsletter provider
              <input name="newsletterProvider" value="${attr(config.newsletterProvider || "")}" placeholder="substack or beehiiv">
            </label>
            <label>Default subscriber status
              <select name="subscriptionStatus">
                ${optionMarkup([["subscribed", "Subscribed"], ["unsubscribed", "Unsubscribed"], ["paused", "Paused"], ["unknown", "Unknown"]], config.subscriptionStatus || "unknown")}
              </select>
            </label>
          </div>
        </section>
        <div class="people-actions">
          <button class="button" type="submit">Save mapping &amp; review rows</button>
          <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
        </div>
      </form>`;
  }

  function mappingConfigFromForm(form, existing) {
    const values = new FormData(form);
    return {
      ...(existing || {}),
      defaultInteractionType: String(values.get("defaultInteractionType") || "manual"),
      defaultNodeId: String(values.get("defaultNodeId") || ""),
      dateFormat: String(values.get("dateFormat") || "auto"),
      currency: String(values.get("currency") || "USD").toUpperCase(),
      moneyMode: String(values.get("moneyMode") || "none"),
      newsletterExport: Boolean(form.elements.newsletterExport?.checked),
      newsletterProvider: String(values.get("newsletterProvider") || "").trim().toLowerCase(),
      subscriptionStatus: String(values.get("subscriptionStatus") || "unknown"),
    };
  }

  async function saveImportMapping(form) {
    if (!state.importFlow) return;
    const mapping = {};
    form.querySelectorAll("[data-map-column]").forEach((select) => {
      mapping[select.dataset.mapColumn] = select.value;
    });
    const mappedTargets = Object.values(mapping).filter(Boolean);
    if (!mappedTargets.some((target) => ["name", "first_name", "last_name", "email", "phone", "instagram"].includes(target))) {
      setFormStatus(form, "Map at least one usable identity field: name, email, phone, or Instagram.", "error");
      return;
    }
    const duplicates = [...new Set(mappedTargets.filter((target, index) => mappedTargets.indexOf(target) !== index))];
    if (duplicates.length) {
      const sources = Object.entries(mapping)
        .filter(([, target]) => duplicates.includes(target))
        .map(([source, target]) => `${source} → ${target}`);
      setFormStatus(form, `Each CRM field can be mapped once. Resolve: ${sources.join(", ")}.`, "error");
      return;
    }
    const config = mappingConfigFromForm(form, state.importFlow.config);
    if (config.newsletterExport && !config.newsletterProvider) {
      setFormStatus(form, "Enter the newsletter provider for a genuine subscriber export.", "error");
      return;
    }
    try {
      disableForm(form, true);
      setFormStatus(form, "Saving mapping and classifying rows…");
      const id = state.importFlow.id;
      const saved = await api(`/imports/${encodeURIComponent(id)}`, { method: "PATCH", body: { mapping, config } });
      const rowsPayload = await api(`/imports/${encodeURIComponent(id)}/rows?limit=250&offset=0`);
      state.importFlow = {
        ...state.importFlow,
        step: "review",
        mapping,
        config,
        batch: objectFrom(saved, "importBatch", "batch") || state.importFlow.batch,
        rowsPayload,
        rows: listFrom(rowsPayload, "rows", "records", "items"),
        candidates: listFrom(rowsPayload, "candidates"),
        summary: objectFrom(rowsPayload, "summary", "counts"),
      };
      renderImportWizard();
      await loadIntegrationData();
    } catch (error) {
      setFormStatus(form, error.message || "The mapping could not be saved.", "error");
    } finally {
      if (form.isConnected) disableForm(form, false);
    }
  }

  function mappedRawValue(row, flow, target) {
    const normalized = objectFrom(row, "normalized", "record", "person");
    const normalizedValue = first(normalized, target, target.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()));
    if (normalizedValue !== "") return normalizedValue;
    const sourceColumn = Object.entries(flow.mapping || {}).find(([, mapped]) => mapped === target)?.[0];
    if (!sourceColumn) return "";
    const raw = objectFrom(row, "raw", "values", "source");
    return raw[sourceColumn] ?? "";
  }

  function rowClassification(row) {
    return normalizedState(first(row, "classification", "status", "result", "matchType", "match_type") || "review");
  }

  function classificationLabel(value) {
    const labels = {
      new_person: "New person",
      exact_match: "Exact match",
      possible_match: "Possible match",
      duplicate_in_file: "Duplicate in file",
      already_imported: "Already imported",
      money_conflict: "Money conflict",
      invalid: "Invalid",
      review: "Review",
    };
    return labels[value] || String(value || "review").replace(/_/g, " ");
  }

  function importDecisionMarkup(row, flow, editable = true) {
    const classification = rowClassification(row);
    if (!REVIEWABLE_IMPORT_CLASSIFICATIONS.has(classification)) {
      return `<span class="people-helper">${esc(first(row, "decision") || "automatic")}</span>`;
    }
    const rowId = String(first(row, "id", "rowId", "row_id") || "");
    const decision = String(first(row, "decision") || "review");
    const matchDetail = objectFrom(row, "matchDetail", "match_detail", "match");
    const candidates = [...new Set([
      ...listFrom(matchDetail, "emailCandidates", "email_candidates"),
      ...listFrom(matchDetail, "phoneCandidates", "phone_candidates"),
      ...listFrom(matchDetail, "nameCandidates", "name_candidates"),
    ].map(String).filter(Boolean))];
    const personId = String(first(row, "targetPersonId", "target_person_id", "matchedPersonId", "matched_person_id")
      || (candidates.length === 1 ? candidates[0] : ""));
    const candidateRecords = (flow.candidates || []).filter((candidate) => candidates.includes(String(first(candidate, "id", "personId", "person_id"))));
    const decisionOptions = ["invalid", "duplicate_in_file"].includes(classification)
      ? [["review", "Needs review"], ["skip", "Skip row"]]
      : classification === "money_conflict"
        ? [["review", "Needs review"], ["link", "Link person"], ["skip", "Skip row"]]
        : [["review", "Needs review"], ["create", "Create person"], ["link", "Link person"], ["skip", "Skip row"]];
    return `
      <div class="people-decision" data-import-decision-row="${attr(rowId)}">
        <label>Decision
          <select data-row-decision data-original-decision="${attr(decision)}" ${editable ? "" : "disabled"}>
            ${optionMarkup(decisionOptions, decision)}
          </select>
        </label>
        ${candidateRecords.length ? `<label data-row-candidate-wrap ${decision === "link" ? "" : "hidden"}>Match candidate
          <select data-row-candidate ${editable ? "" : "disabled"}>
            <option value="">Choose candidate</option>
            ${candidateRecords.map((candidate) => {
              const id = String(first(candidate, "id", "personId", "person_id"));
              const name = first(candidate, "displayName", "display_name", "name") || "Unnamed person";
              const contact = first(candidate, "primaryEmail", "primary_email", "primaryPhone", "primary_phone");
              return `<option value="${attr(id)}" ${id === personId ? "selected" : ""}>${esc([name, contact, id].filter(Boolean).join(" · "))}</option>`;
            }).join("")}
          </select>
        </label>` : ""}
        <label data-row-person-wrap ${decision === "link" ? "" : "hidden"}>Person ID
          <input data-row-person value="${attr(personId)}" data-original-person="${attr(personId)}" placeholder="crm-person-…" autocomplete="off" ${editable ? "" : "disabled"}>
        </label>
        ${candidates.length ? `<span class="people-helper">Candidates: ${candidates.map(esc).join(" · ")}</span>` : ""}
      </div>`;
  }

  function reviewRowMarkup(row, flow, index, editable = true) {
    const classification = rowClassification(row);
    const name = mappedRawValue(row, flow, "name")
      || [mappedRawValue(row, flow, "first_name"), mappedRawValue(row, flow, "last_name")].filter(Boolean).join(" ")
      || "Unnamed";
    const email = mappedRawValue(row, flow, "email");
    const phone = mappedRawValue(row, flow, "phone");
    const interaction = mappedRawValue(row, flow, "interaction") || flow.config?.defaultInteractionType || "manual";
    const date = mappedRawValue(row, flow, "date");
    const amount = mappedRawValue(row, flow, "amount");
    const validationErrors = listFrom(row, "validationErrors", "validation_errors", "errors");
    const warnings = listFrom(row, "warnings");
    const note = [
      first(row, "reason", "message", "error"),
      ...validationErrors,
      ...warnings,
    ].filter(Boolean).join(" · ")
      || mappedRawValue(row, flow, "notes")
      || first(objectFrom(row, "match"), "reason", "label");
    const rowNumber = first(row, "rowNumber", "row_number", "index") || index + 2;
    return `
      <tr data-review-classification="${attr(classification)}">
        <td>${esc(rowNumber)}</td>
        <td>${statusChip(classification, classificationLabel(classification))}</td>
        <td><strong>${esc(name)}</strong></td>
        <td>${esc([email, phone].filter(Boolean).join(" · ") || "—")}</td>
        <td>${esc([interaction, date].filter(Boolean).join(" · ") || "—")}</td>
        <td>${esc(amount || "—")}</td>
        <td>${esc(note || "—")}</td>
        <td>${importDecisionMarkup(row, flow, editable)}</td>
      </tr>`;
  }

  function summaryCounts(flow) {
    const summary = flow.summary || {};
    const rows = flow.rows || [];
    const classifications = {};
    rows.forEach((row) => {
      const key = rowClassification(row);
      classifications[key] = (classifications[key] || 0) + 1;
    });
    const value = (key, ...aliases) => Number(first(summary, key, ...aliases)) || classifications[key] || 0;
    const reviewRequired = Number(first(summary, "reviewRequired", "review_required"))
      || rows.filter((row) => String(first(row, "decision")) === "review").length;
    const total = Number(first(summary, "total", "rowCount", "row_count")) || rows.length;
    return {
      total,
      new_person: value("new_person", "newPerson", "newPeople", "new_people"),
      exact_match: value("exact_match", "exactMatch", "exactMatches", "exact_matches"),
      possible_match: value("possible_match", "possibleMatch", "possibleMatches", "possible_matches"),
      duplicate_in_file: value("duplicate_in_file", "duplicateInFile", "duplicates"),
      already_imported: value("already_imported", "alreadyImported"),
      money_conflict: value("money_conflict", "moneyConflict", "moneyConflicts"),
      invalid: value("invalid", "invalidRows", "invalid_rows"),
      reviewRequired,
    };
  }

  function reviewSummaryMarkup(counts) {
    const entries = [
      ["total", "Rows"],
      ["new_person", "New people"],
      ["exact_match", "Exact matches"],
      ["possible_match", "Possible matches"],
      ["duplicate_in_file", "Duplicates"],
      ["already_imported", "Already imported"],
      ["money_conflict", "Money conflicts"],
      ["invalid", "Invalid"],
    ];
    return `<div class="people-review-summary">${entries.map(([key, label]) => (
      `<div><strong>${counts[key] || 0}</strong><span>${esc(label)}</span></div>`
    )).join("")}</div>`;
  }

  function reviewMarkup(flow) {
    const rows = flow.rows || [];
    const counts = summaryCounts(flow);
    const classifications = [...new Set(rows.map(rowClassification))].sort();
    const batchStatus = first(flow.batch, "status", "state") || "analyzed";
    const statusValue = normalizedState(batchStatus);
    const applying = statusValue === "applying";
    const canEdit = !["applying", "applied", "rolled_back"].includes(statusValue);
    const offset = Number(flow.rowsOffset || 0);
    const pageStart = counts.total ? offset + 1 : 0;
    const pageEnd = Math.min(counts.total, offset + rows.length);
    return `
      ${importSteps("review")}
      <div class="people-import-head">
        <div>
          <h3>Review ${esc(flow.filename || first(flow.batch, "filename", "fileName", "file_name") || "legacy list")}</h3>
          <p>Exact unique emails may link automatically. Phone-only, name-only, shared-email, and fuzzy matches stay reviewable.</p>
        </div>
        ${statusChip(batchStatus)}
      </div>
      ${reviewSummaryMarkup(counts)}
      <div class="people-filter-row">
        <select data-review-filter aria-label="Filter reviewed rows">
          <option value="">All classifications</option>
          ${classifications.map((classification) => `<option value="${attr(classification)}">${esc(classificationLabel(classification))}</option>`).join("")}
        </select>
        <button class="button" type="button" data-import-exceptions="${attr(flow.id)}">Download exceptions</button>
      </div>
      <form class="people-form" data-import-decisions ${canEdit ? "" : 'aria-disabled="true"'}>
        <div class="people-review-table-wrap">
          <table class="people-review-table">
            <thead><tr><th>Row</th><th>Classification</th><th>Person</th><th>Contact</th><th>Interaction</th><th>Money</th><th>Review note</th><th>Decision</th></tr></thead>
            <tbody>${rows.map((row, index) => reviewRowMarkup(row, flow, index, canEdit)).join("") || '<tr><td colspan="8">No rows returned.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="people-actions">
          ${canEdit ? '<button class="button" type="submit">Save row decisions</button>' : ""}
          <span class="people-helper">Showing ${pageStart}–${pageEnd} of ${counts.total}</span>
          <button class="button" type="button" data-import-page="${Math.max(0, offset - 250)}" ${offset <= 0 ? "disabled" : ""}>Previous rows</button>
          <button class="button" type="button" data-import-page="${offset + 250}" ${pageEnd >= counts.total ? "disabled" : ""}>Next rows</button>
          <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
        </div>
      </form>
      ${counts.reviewRequired ? notice(`${counts.reviewRequired} row${counts.reviewRequired === 1 ? "" : "s"} still require a saved decision before apply.`, "error") : ""}
      <form class="people-form" data-import-apply>
        <div class="people-form-grid">
          <label class="people-check">
            <input name="confirmTierProposals" type="checkbox" ${flow.config?.confirmImportedTiers ? "checked" : ""} ${applying ? "disabled" : ""}>
            <span>Allow imported tiers to fill Unrated records. Existing tiers are never overwritten.</span>
          </label>
          <label class="people-check">
            <input name="confirmAggregateSpend" type="checkbox" ${flow.config?.aggregateConfirmed ? "checked" : ""} ${applying ? "disabled" : ""}>
            <span>Confirm aggregate totals do not overlap Square, Shopify, or existing D1 payments. Leave off unless verified.</span>
          </label>
          <label class="people-check">
            <input name="completeSubscriberExport" type="checkbox" ${flow.config?.completeSubscriberExport ? "checked" : ""} ${applying ? "disabled" : ""}>
            <span>This is a complete subscriber export. Missing rows may become inactive only for this provider/publication.</span>
          </label>
        </div>
        <div class="people-actions">
          <button class="button" type="submit" ${counts.reviewRequired ? "disabled" : ""}>${applying ? "Resume import" : "Apply reviewed import"}</button>
          ${canEdit ? '<button class="button" type="button" data-import-back-map>Back to mapping</button>' : ""}
          ${applying ? `<button class="button danger-button" type="button" data-import-rollback="${attr(flow.id)}">Rollback batch</button>` : ""}
          <button class="button" type="button" data-import-reset>Cancel</button>
          <span class="people-helper" data-form-status role="status" aria-live="polite"></span>
        </div>
      </form>`;
  }

  function appliedMarkup(flow) {
    const batch = objectFrom(flow.result, "importBatch", "batch");
    const summary = objectFrom(batch, "summary", "counts");
    const applyStates = objectFrom(summary, "applyStates", "apply_states");
    const counts = {
      total: Number(first(summary, "total", "rows", "rowCount", "row_count")) || 0,
      new_person: Number(first(summary, "newPerson", "peopleCreated", "people_created", "newPeople", "new_people")) || 0,
      exact_match: Number(first(summary, "exactMatch", "matched", "peopleMatched", "people_matched")) || 0,
      possible_match: Number(first(summary, "possibleMatch", "attention", "needsAttention", "needs_attention")) || 0,
      duplicate_in_file: Number(first(summary, "duplicateInFile", "skipped", "rowsSkipped", "rows_skipped")) || 0,
      already_imported: Number(first(summary, "alreadyImported", "already_imported")) || 0,
      money_conflict: Number(first(summary, "moneyConflict", "moneyConflicts", "money_conflicts")) || 0,
      invalid: Number(first(summary, "invalid", "invalidRows", "invalid_rows")) || 0,
    };
    const applied = Number(first(flow.result, "appliedTotal", "applied")) || Number(first(applyStates, "applied")) || 0;
    const failed = Number(first(flow.result, "failed")) || Number(first(applyStates, "error")) || 0;
    return `
      ${importSteps("applied")}
      <div class="people-import-head">
        <div>
          <h3>Import complete</h3>
          <p>${esc(first(flow.result, "message") || "The reviewed batch was applied. Source links and audit history were preserved.")}</p>
        </div>
        ${statusChip("applied")}
      </div>
      ${reviewSummaryMarkup(counts)}
      <p class="people-helper">${applied} applied · ${failed} failed</p>
      <div class="people-actions">
        <button class="button" type="button" data-import-open="${attr(flow.id)}">Review applied rows</button>
        <button class="button" type="button" data-import-exceptions="${attr(flow.id)}">Exceptions CSV</button>
        <button class="button danger-button" type="button" data-import-rollback="${attr(flow.id)}">Rollback batch</button>
        <button class="button" type="button" data-import-reset>Import another list</button>
      </div>`;
  }

  function closedImportMarkup(flow) {
    const status = first(flow.batch, "status", "state") || "rolled_back";
    return `
      ${importSteps("review")}
      <div class="people-import-head">
        <div>
          <h3>Import ${esc(String(status).replace(/_/g, " "))}</h3>
          <p>This batch is retained for audit history and cannot be applied again. Start a new upload to reimport its source.</p>
        </div>
        ${statusChip(status)}
      </div>
      ${reviewSummaryMarkup(summaryCounts(flow))}
      <div class="people-actions">
        <button class="button" type="button" data-import-exceptions="${attr(flow.id)}">Exceptions CSV</button>
        <button class="button" type="button" data-import-reset>Import another list</button>
      </div>`;
  }

  function renderImportWizard() {
    const wizard = elements().detail?.querySelector("[data-import-wizard]");
    if (!wizard) return;
    if (!state.importFlow) wizard.innerHTML = initialImportMarkup();
    else if (state.importFlow.step === "mapping") wizard.innerHTML = mappingMarkup(state.importFlow);
    else if (state.importFlow.step === "review") wizard.innerHTML = reviewMarkup(state.importFlow);
    else if (state.importFlow.step === "applied") wizard.innerHTML = appliedMarkup(state.importFlow);
    else wizard.innerHTML = closedImportMarkup(state.importFlow);
    enhanceStudioControls(wizard);
  }

  function collectImportRowDecisions(scope, { changedOnly = false } = {}) {
    const decisions = [];
    scope?.querySelectorAll("[data-import-decision-row]").forEach((row) => {
      const select = row.querySelector("[data-row-decision]");
      const input = row.querySelector("[data-row-person]");
      if (!select) return;
      const decision = String(select.value || "review");
      const personId = String(input?.value || "").trim();
      if (decision === "link" && !personId) {
        throw new Error(`Choose a person ID for import row ${row.dataset.importDecisionRow || ""}.`);
      }
      const changed = decision !== String(select.dataset.originalDecision || "")
        || personId !== String(input?.dataset.originalPerson || "");
      if (changedOnly && !changed) return;
      decisions.push({
        rowId: row.dataset.importDecisionRow,
        decision,
        matchedPersonId: decision === "link" ? personId : null,
        targetPersonId: decision === "link" ? personId : null,
      });
    });
    return decisions;
  }

  async function saveImportDecisions(form) {
    if (!state.importFlow) return;
    let rowDecisions;
    try {
      rowDecisions = collectImportRowDecisions(form, { changedOnly: true });
    } catch (error) {
      setFormStatus(form, error.message, "error");
      return;
    }
    if (!rowDecisions.length) {
      setFormStatus(form, "No row decisions changed.");
      return;
    }
    try {
      disableForm(form, true);
      setFormStatus(form, "Saving row decisions…");
      const { id, rowsOffset = 0 } = state.importFlow;
      await api(`/imports/${encodeURIComponent(id)}`, { method: "PATCH", body: { rowDecisions } });
      await openImportBatch(id, rowsOffset);
    } catch (error) {
      setFormStatus(form, error.message || "Row decisions could not be saved.", "error");
    } finally {
      if (form.isConnected) disableForm(form, false);
    }
  }

  async function changeImportPage(offset) {
    if (!state.importFlow) return;
    const form = elements().detail?.querySelector("[data-import-decisions]");
    try {
      const rowDecisions = collectImportRowDecisions(form, { changedOnly: true });
      if (rowDecisions.length) {
        setFormStatus(form, "Saving decisions before changing rows…");
        await api(`/imports/${encodeURIComponent(state.importFlow.id)}`, { method: "PATCH", body: { rowDecisions } });
      }
      await openImportBatch(state.importFlow.id, Math.max(0, offset));
    } catch (error) {
      setFormStatus(form, error.message || "Could not change import rows.", "error");
    }
  }

  async function allImportRowDecisions(flow) {
    const total = summaryCounts(flow).total;
    const pageSize = 250;
    const records = [];
    for (let offset = 0; offset < total; offset += pageSize) {
      const page = offset === Number(flow.rowsOffset || 0)
        ? flow.rows || []
        : listFrom(await api(`/imports/${encodeURIComponent(flow.id)}/rows?limit=${pageSize}&offset=${offset}`), "rows", "records", "items");
      page.forEach((row) => {
        if (!REVIEWABLE_IMPORT_CLASSIFICATIONS.has(rowClassification(row))) return;
        const decision = String(first(row, "decision") || "review");
        const targetPersonId = String(first(row, "targetPersonId", "target_person_id", "matchedPersonId", "matched_person_id") || "");
        records.push({
          rowId: String(first(row, "id", "rowId", "row_id") || ""),
          decision,
          matchedPersonId: decision === "link" ? targetPersonId : null,
          targetPersonId: decision === "link" ? targetPersonId : null,
        });
      });
    }
    return records.filter((record) => record.rowId);
  }

  async function applyImport(form) {
    if (!state.importFlow) return;
    const flow = state.importFlow;
    const id = flow.id;
    const statusValue = normalizedState(first(flow.batch, "status", "state"));
    const resuming = statusValue === "applying";
    const body = {
      confirmTierProposals: resuming ? Boolean(flow.config?.confirmImportedTiers) : form.elements.confirmTierProposals.checked,
      confirmAggregateSpend: resuming ? Boolean(flow.config?.aggregateConfirmed) : form.elements.confirmAggregateSpend.checked,
      completeSubscriberExport: resuming ? Boolean(flow.config?.completeSubscriberExport) : form.elements.completeSubscriberExport.checked,
      limit: 200,
    };
    if (!resuming && summaryCounts(flow).reviewRequired) {
      setFormStatus(form, "Save a decision for every review row before applying.", "error");
      return;
    }
    if (!resuming && body.confirmAggregateSpend && !confirm("Confirm that aggregate totals were checked against Square, Shopify, and current D1 payments. Continue?")) return;
    if (!confirm(`${resuming ? "Resume" : "Apply"} this reviewed import? Repeating the same batch is idempotent and the batch can be rolled back.`)) return;
    try {
      disableForm(form, true);
      if (!resuming) {
        setFormStatus(form, "Saving confirmations and reviewed decisions…");
        const config = {
          ...(flow.config || {}),
          confirmImportedTiers: body.confirmTierProposals,
          aggregateConfirmed: body.confirmAggregateSpend,
          completeSubscriberExport: body.completeSubscriberExport,
        };
        const rowDecisions = await allImportRowDecisions(flow);
        const saved = await api(`/imports/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { config, rowDecisions },
        });
        state.importFlow.config = config;
        state.importFlow.batch = objectFrom(saved, "importBatch", "batch") || state.importFlow.batch;
      }

      let result = null;
      let appliedTotal = 0;
      let previousRemaining = Number.POSITIVE_INFINITY;
      for (let pass = 0; pass < 100; pass += 1) {
        setFormStatus(form, `Applying resumable batch ${pass + 1}…`);
        result = await api(`/imports/${encodeURIComponent(id)}/apply`, { method: "POST", body });
        appliedTotal += Number(first(result, "applied")) || 0;
        const failed = Number(first(result, "failed")) || 0;
        const remaining = Number(first(result, "remaining")) || 0;
        const batch = objectFrom(result, "importBatch", "batch");
        const applied = normalizedState(first(batch, "status", "state")) === "applied" || remaining === 0;
        if (applied) {
          result.appliedTotal = appliedTotal;
          state.importFlow = { ...state.importFlow, batch, step: "applied", result };
          renderImportWizard();
          await loadIntegrationData();
          return;
        }
        if (failed > 0 || remaining >= previousRemaining) {
          state.importFlow = { ...state.importFlow, batch, result };
          await openImportBatch(id, Number(flow.rowsOffset || 0));
          const current = elements().detail?.querySelector("[data-import-apply]");
          setFormStatus(current, failed > 0
            ? `${failed} row${failed === 1 ? "" : "s"} could not be applied. Review the row errors, then resume or rollback.`
            : "Import progress stopped. Review the batch, then resume or rollback.", "error");
          await loadIntegrationData();
          return;
        }
        previousRemaining = remaining;
      }
      throw new Error("The import paused after 100 batches. Reopen it from history to resume.");
    } catch (error) {
      setFormStatus(form, error.message || "The import could not be applied.", "error");
    } finally {
      if (form.isConnected) disableForm(form, false);
    }
  }

  async function openImportBatch(id, offset = 0) {
    if (!id) return;
    const wizard = elements().detail?.querySelector("[data-import-wizard]");
    if (wizard) wizard.innerHTML = notice("Loading import rows…");
    try {
      const rowsPayload = await api(`/imports/${encodeURIComponent(id)}/rows?limit=250&offset=${Math.max(0, offset)}`);
      const returnedBatch = rowsPayload?.importBatch || rowsPayload?.batch;
      const batch = returnedBatch && typeof returnedBatch === "object"
        ? returnedBatch
        : state.imports.find((item) => importBatchId(item) === String(id)) || { id };
      const config = objectFrom(batch, "config");
      const suppliedMapping = first(batch, "mapping", "columnMapping", "column_mapping")
        || first(rowsPayload, "mapping", "columnMapping", "column_mapping")
        || {};
      const columns = importColumns(rowsPayload);
      const mapping = importMappingObject({ mapping: suppliedMapping }, columns);
      const statusValue = normalizedState(first(batch, "status", "state"));
      state.importFlow = {
        step: statusValue === "applied" ? "applied" : statusValue === "rolled_back" ? "closed" : "review",
        id: String(id),
        batch,
        filename: first(batch, "filename", "fileName", "file_name"),
        config,
        mapping,
        columns,
        preview: [],
        rowsPayload,
        rowsOffset: Math.max(0, offset),
        rows: listFrom(rowsPayload, "rows", "records", "items"),
        candidates: listFrom(rowsPayload, "candidates"),
        summary: objectFrom(rowsPayload, "summary", "counts"),
        result: statusValue === "applied" ? { importBatch: batch } : null,
      };
      renderImportWizard();
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      elements().detail?.querySelector("[data-import-wizard]")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    } catch (error) {
      if (wizard) wizard.innerHTML = `${notice(error.message || "Import rows could not be loaded.", "error")}<button class="button" type="button" data-import-reset>Return to importer</button>`;
    }
  }

  async function rollbackImport(id) {
    if (!id || !confirm("Rollback this import batch? Batch-owned records will be deactivated or voided; later independent activity will remain.")) return;
    const output = elements().detail?.querySelector(`[data-import-result="${selectorEscape(String(id))}"]`);
    try {
      if (output) output.textContent = "Rolling back…";
      const payload = await api(`/imports/${encodeURIComponent(id)}/rollback`, { method: "POST", body: {} });
      if (output) output.textContent = integrationResultSummary(payload);
      if (state.importFlow?.id === String(id)) {
        state.importFlow = null;
        renderImportWizard();
      }
      await loadIntegrationData();
    } catch (error) {
      if (output) output.textContent = error.message || "Rollback failed.";
      else alert(error.message || "Rollback failed.");
    }
  }

  async function downloadImportExceptions(id) {
    if (!id) return;
    const output = elements().detail?.querySelector(`[data-import-result="${selectorEscape(String(id))}"]`);
    try {
      if (output) output.textContent = "Preparing exceptions…";
      const blob = await apiBlob(`/imports/${encodeURIComponent(id)}/exceptions.csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `construct-people-import-${String(id).replace(/[^a-z0-9_-]/gi, "-")}-exceptions.csv`;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (output) output.textContent = "Exceptions downloaded.";
    } catch (error) {
      if (output) output.textContent = error.message || "Exceptions could not be downloaded.";
      else alert(error.message || "Exceptions could not be downloaded.");
    }
  }

  window.PeopleManager = {
    isManagedView,
    render,
    unmount,
  };
})();
