let activeMountController = null;

const IDENTITY_ENDPOINT = "/api/admin/identities";
const CULTURAL_OBJECT_ENDPOINT = "/api/admin/archive-records/create-cultural-object";
const LEGEND_APPEARANCE_ENDPOINT = "/api/admin/legend/archive-appearances";

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function first(record, ...keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record[key] !== null) return record[key];
  }
  return "";
}

function recordsFrom(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["records", ...keys, "items"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function recordFrom(payload, ...keys) {
  for (const key of ["record", ...keys, "item"]) {
    if (payload?.[key] && typeof payload[key] === "object" && !Array.isArray(payload[key])) return payload[key];
  }
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

function checked(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "public";
}

function safeRoute(value) {
  const route = String(value || "").trim();
  return route.startsWith("/") && !route.startsWith("//") ? route : "";
}

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function identityOrganizationId(record) {
  return String(first(record, "organization_id", "organizationId", "organization_entity_id", "organizationEntityId", "subject_entity_id", "subjectEntityId") || record?.organization?.id || "");
}

function identityKey(record) {
  return identityOrganizationId(record) || String(first(record, "slug", "id", "profile_id", "profileId"));
}

function identityName(record) {
  return String(record?.organization?.name || first(record, "organization_name", "organizationName", "name", "slug") || "Untitled identity");
}

function linkedId(record, relation, ...keys) {
  return String(first(record, ...keys) || record?.[relation]?.id || record?.[relation]?.entity_id || record?.[relation]?.entityId || "");
}

function publicationLabel(record) {
  const state = String(first(record, "publication_state", "publicationState") || "draft");
  const visible = checked(first(record, "public_visible", "publicVisible", "visibility"));
  return `${state} / ${visible ? "public" : "private"}`;
}

function option(value, label, current) {
  return `<option value="${esc(value)}" ${String(value) === String(current) ? "selected" : ""}>${esc(label)}</option>`;
}

function listOptionLabel(record, titleKeys = ["title", "name", "slug"]) {
  const title = first(record, ...titleKeys) || first(record, "id");
  const state = first(record, "publication_state", "publicationState", "state");
  return [title, state].filter(Boolean).join(" · ");
}

async function optionalList(api, path, ...keys) {
  try {
    const payload = await api(path);
    return { records: recordsFrom(payload, ...keys), error: "" };
  } catch (error) {
    return { records: [], error: error.message || `Could not load ${path}.` };
  }
}

function nestedRoute(record, relation) {
  return safeRoute(record?.[relation]?.route || "");
}

function currentSymbol(record) {
  return record?.current_symbol || record?.currentSymbol || null;
}

function identityLegendSymbolIds(record, support = {}) {
  const symbol = currentSymbol(record);
  const ids = new Set([String(first(symbol, "id", "entity_id", "entityId"))].filter(Boolean));
  const knownSymbolIds = new Set((support.symbols || []).map((item) => String(first(item, "id"))).filter(Boolean));
  const threadId = linkedId(record, "origin_thread", "origin_thread_id", "originThreadId");
  const linkedThreads = [
    record?.origin_thread || record?.originThread || null,
    (support.originThreads || []).find((thread) => String(first(thread, "id")) === threadId) || null,
  ].filter(Boolean);
  const threadMembers = linkedThreads.flatMap((thread) => [
    ...(Array.isArray(thread.members) ? thread.members : []),
    ...(Array.isArray(thread.entities) ? thread.entities : []),
  ]);
  threadMembers.forEach((member) => {
    const id = String(first(member, "entity_id", "entityId", "id"));
    const type = String(first(member, "entity_type", "entityType", "type"));
    if (id && (type === "visual_symbol" || knownSymbolIds.has(id))) ids.add(id);
  });
  const profileSymbols = Array.isArray(record?.symbols) ? record.symbols : [];
  profileSymbols.forEach((item) => {
    const id = String(first(item, "id", "entity_id", "entityId"));
    if (id) ids.add(id);
  });
  return ids;
}

function identityLegendArchiveAppearances(record, support = {}) {
  const symbol = currentSymbol(record);
  const symbolIds = identityLegendSymbolIds(record, support);
  const featuredRecordId = linkedId(record, "featured_origin_record", "featured_origin_entity_id", "featuredOriginEntityId", "featured_origin_record_entity_id", "featuredOriginRecordEntityId");
  const nested = Array.isArray(symbol?.archive_appearances)
    ? symbol.archive_appearances
    : Array.isArray(symbol?.archiveAppearances) ? symbol.archiveAppearances : [];
  const managed = (support.legendAppearances || []).filter((appearance) => {
    const symbolId = String(first(appearance, "symbol_entity_id", "symbolEntityId"));
    const recordId = String(first(appearance, "record_entity_id", "recordEntityId"));
    return symbolIds.has(symbolId) || Boolean(featuredRecordId && recordId === featuredRecordId);
  });
  const merged = new Map(managed.map((appearance) => [String(first(appearance, "id")), appearance]));
  nested.forEach((appearance) => {
    const id = String(first(appearance, "id"));
    if (id) merged.set(id, { ...(merged.get(id) || {}), ...appearance });
  });
  return [...merged.values()].sort((left, right) =>
    (Number(first(left, "sort_order", "sortOrder")) || 0) - (Number(first(right, "sort_order", "sortOrder")) || 0)
  );
}

function reviewCard({ label, item, id = "", route = "", openArchiveId = "", empty = "Not linked" }) {
  const itemId = String(id || item?.id || item?.entity_id || item?.entityId || "");
  const title = item?.title || item?.name || item?.archive_slug || item?.slug || itemId || empty;
  const state = item ? String(first(item, "publication_state", "publicationState", "state") || "record") : "missing";
  const visible = item && first(item, "public_visible", "publicVisible") !== ""
    ? checked(first(item, "public_visible", "publicVisible"))
    : null;
  const resolvedRoute = safeRoute(route || item?.route || "");
  return `<article class="ci-review-card" data-review-state="${esc(state)}">
    <span class="cm-section-index">${esc(label)}</span>
    <strong>${esc(title)}</strong>
    <span class="cm-meta">${esc(itemId || empty)}${item ? ` · ${esc(state)}${visible === null ? "" : visible ? " · public" : " · private"}` : ""}</span>
    <div class="cm-actions">
      ${openArchiveId ? `<button class="button" type="button" data-open-archive-record="${esc(openArchiveId)}">Open Archive record</button>` : ""}
      ${resolvedRoute ? `<a class="button" href="${esc(resolvedRoute)}" target="_blank" rel="noopener">Open route</a>` : ""}
    </div>
  </article>`;
}

function legendAppearanceReviewRow(appearance) {
  const appearanceId = String(first(appearance, "id"));
  const symbolId = String(first(appearance, "symbol_entity_id", "symbolEntityId"));
  const symbolName = String(first(appearance, "symbol_name", "symbolName") || symbolId || "Legend symbol");
  const recordId = String(first(appearance, "record_entity_id", "recordEntityId"));
  const recordTitle = String(first(appearance, "record_title", "recordTitle") || recordId || "Archive record");
  const role = String(first(appearance, "appearance_role", "appearanceRole", "role") || "appearance");
  const publication = String(first(appearance, "publication_state", "publicationState") || "draft");
  const visible = checked(first(appearance, "public_visible", "publicVisible"));
  const route = safeRoute(first(appearance, "route"));
  return `<article class="ci-appearance-row" data-legend-appearance-row data-appearance-id="${esc(appearanceId)}" data-review-state="${esc(publication)}">
    <div class="ci-appearance-row-head">
      <div><span class="cm-section-index">${esc(symbolName)} · ${esc(recordTitle)}</span><strong>${esc(symbolId)} · ${esc(appearanceId)}</strong></div>
      <span class="cm-pill" data-legend-appearance-publication-label>${esc(publication)} / ${visible ? "public" : "private"}</span>
    </div>
    <div class="cm-form-grid ci-appearance-fields">
      <label>Public title<input data-legend-appearance-title value="${esc(first(appearance, "title"))}" maxlength="300"></label>
      <label>Legend role<select data-legend-appearance-role>${option("variant", "Visual variant", role)}${option("appearance", "Documented appearance", role)}</select></label>
      <label>Publication state<select data-legend-appearance-publication>${["draft", "published", "archived"].map((value) => option(value, value, publication)).join("")}</select></label>
      <label>Display order<input data-legend-appearance-order type="number" min="0" step="1" value="${esc(first(appearance, "sort_order", "sortOrder") || 0)}"></label>
      <label class="cm-check-field wide"><input data-legend-appearance-visible type="checkbox" ${visible ? "checked" : ""}><span>Publicly visible when the appearance and both linked records are published</span></label>
      <label class="wide">Public caption<textarea data-legend-appearance-caption maxlength="3000">${esc(first(appearance, "caption"))}</textarea></label>
    </div>
    <div class="ci-appearance-record-meta"><span>Canonical record · ${esc(recordId || "not returned")}</span>${route ? `<a href="${esc(route)}" target="_blank" rel="noopener">Open Archive record</a>` : ""}</div>
    <div class="cm-actions">
      <button class="button" type="button" data-legend-appearance-save>Save Legend appearance</button>
      <span class="cm-upload-status" data-legend-appearance-status aria-live="polite"></span>
    </div>
  </article>`;
}

function legendAppearanceReviewSection(record, support, { creating = false } = {}) {
  const symbol = currentSymbol(record);
  const symbolId = String(first(symbol, "id", "entity_id", "entityId"));
  const symbolName = String(first(symbol, "name", "title", "slug") || symbolId || "Current mark");
  const featuredRecordId = linkedId(record, "featured_origin_record", "featured_origin_entity_id", "featuredOriginEntityId", "featured_origin_record_entity_id", "featuredOriginRecordEntityId");
  const appearances = identityLegendArchiveAppearances(record, support);
  const loadError = String(support.legendAppearanceError || "");
  let content = "";
  if (creating) {
    content = '<div class="cm-notice">Create the private identity draft before reviewing appearances for its saved current mark.</div>';
  } else if (!symbolId && !featuredRecordId) {
    content = '<div class="cm-notice">Link and save a current Legend mark or featured origin record before reviewing Archive appearances.</div>';
  } else if (appearances.length) {
    content = `<div class="ci-appearance-list">${appearances.map(legendAppearanceReviewRow).join("")}</div>`;
  } else if (!loadError) {
    content = '<div class="cm-empty">No Archive appearances are recorded for this current mark.</div>';
  }
  const warning = loadError
    ? `<div class="cm-notice" data-kind="error" role="alert"><strong>Legend appearances could not be refreshed.</strong><p>${esc(loadError)}</p><p>${appearances.length ? "The appearances returned with the identity remain editable." : "The identity editor remains available; reload before publication review."}</p></div>`
    : "";
  return `<section class="ci-appearance-review" data-identity-legend-appearances data-current-symbol-id="${esc(symbolId)}" data-featured-record-id="${esc(featuredRecordId)}">
    <div class="ci-section-head">
      <div><span class="cm-section-index">Identity lineage · Archive evidence</span><h4>Legend appearance review</h4><p>Review appearances for ${esc(symbolName)}, linked Origin Thread symbols, and the featured origin record. Publication here is separate from the identity profile’s publication state.</p></div>
    </div>
    ${warning}${content}
  </section>`;
}

function creativeIdentityCard(record) {
  const key = identityKey(record);
  const canonicalRoute = safeRoute(first(record, "canonical_route", "canonicalRoute"));
  const currentSymbol = record.current_symbol || record.currentSymbol || null;
  const originThread = record.origin_thread || record.originThread || null;
  const publiclyAvailable = String(first(record, "publication_state", "publicationState")) === "published"
    && checked(first(record, "public_visible", "publicVisible", "visibility"));
  return `<article class="cm-card ci-identity-card ${String(first(record, "publication_state", "publicationState")) === "draft" ? "is-draft" : ""}">
    <div class="cm-card-head">
      <div>
        <span class="cm-section-index">${esc(first(record, "kind_label", "kindLabel", "public_kind_label", "publicKindLabel") || "Creative identity")}</span>
        <h3>${esc(identityName(record))}</h3>
      </div>
      <span class="cm-pill">${esc(publicationLabel(record))}</span>
    </div>
    <div class="cm-meta">${esc(first(record, "lifecycle_status", "lifecycleStatus") || "forming")} · ${esc(first(record, "origin_date_label", "originDateLabel") || "Origin date not set")}</div>
    <p>${esc(first(record, "current_role", "currentRole", "hero_descriptor", "heroDescriptor") || "No current role has been written yet.")}</p>
    <div class="ci-card-links">
      <span>Timeline · ${record.timeline ? esc(record.timeline.title || record.timeline.slug || "linked") : "not linked"}</span>
      <span>Current mark · ${currentSymbol ? esc(currentSymbol.name || currentSymbol.slug || "linked") : "not linked"}</span>
      <span>Origin Thread · ${originThread ? esc(originThread.title || originThread.slug || "linked") : "not linked"}</span>
    </div>
    <div class="cm-actions">
      <button class="button" type="button" data-identity-edit="${esc(key)}">Edit identity</button>
      ${record.dossier?.entity_id ? `<button class="button" type="button" data-open-archive-record="${esc(record.dossier.entity_id)}">Review dossier</button>` : ""}
      ${canonicalRoute && publiclyAvailable ? `<a class="button" href="${esc(canonicalRoute)}" target="_blank" rel="noopener">Open public route</a>` : ""}
    </div>
  </article>`;
}

function selectOptions(records, current, idKeys, label) {
  return records.map((record) => {
    const id = String(first(record, ...idKeys));
    return id ? option(id, label(record), current) : "";
  }).join("");
}

function identityEditor(record, support, { creating = false } = {}) {
  const organizationId = identityOrganizationId(record);
  const timelineId = linkedId(record, "timeline", "timeline_id", "timelineId");
  const symbolId = linkedId(record, "current_symbol", "current_symbol_id", "currentSymbolId", "current_symbol_entity_id", "currentSymbolEntityId");
  const threadId = linkedId(record, "origin_thread", "origin_thread_id", "originThreadId");
  const featuredId = linkedId(record, "featured_origin_record", "featured_origin_entity_id", "featuredOriginEntityId", "featured_origin_record_entity_id", "featuredOriginRecordEntityId");
  const dossierId = String(record?.dossier?.entity_id || record?.dossier?.entityId || first(record, "dossier_entity_id", "dossierEntityId") || organizationId);
  const key = creating ? "" : identityKey(record);
  const lifecycle = String(first(record, "lifecycle_status", "lifecycleStatus") || "forming");
  const publication = String(first(record, "publication_state", "publicationState") || "draft");
  const publicVisible = checked(first(record, "public_visible", "publicVisible", "visibility"));
  const organizations = creating
    ? support.organizations.filter((item) => !support.usedOrganizationIds?.has(String(first(item, "id"))))
    : support.organizations;
  const organization = record.organization || organizations.find((item) => String(item.id) === organizationId) || null;

  const organizationField = creating
    ? `<label>Organization entity<select name="organization_id" required><option value="">Choose an existing organization</option>${selectOptions(organizations, organizationId, ["id"], (item) => listOptionLabel(item, ["name", "slug"]))}</select><span class="cm-field-note">Creative identities extend an existing organization; they do not create a second brand entity.</span></label>`
    : `<label>Organization entity<input value="${esc(organization?.name || organizationId)}" disabled><input type="hidden" name="organization_id" value="${esc(organizationId)}"><span class="cm-field-note">The canonical organization remains fixed for this profile.</span></label>`;

  const dossierCard = record.dossier
    ? reviewCard({ label: "Archive dossier", item: record.dossier, openArchiveId: dossierId })
    : `<article class="ci-review-card"><span class="cm-section-index">Archive dossier</span><strong>Not prepared</strong><span class="cm-meta">The profile remains a draft until its organization dossier is prepared.</span>${!creating && organizationId ? `<button class="button" type="button" data-identity-prepare-dossier="${esc(organizationId)}">Prepare dossier</button>` : ""}</article>`;

  return `<section class="cm-editor ci-editor">
    <div class="cm-row">
      <div><span class="cm-section-index">About · Creative identity</span><h3>${creating ? "New" : "Edit"} Creative Identity</h3></div>
      <button class="button" type="button" data-identity-close>Close</button>
    </div>
    <form class="cm-form" data-identity-form data-key="${esc(key)}">
      <section class="ci-form-section">
        <div class="ci-section-head"><div><span class="cm-section-index">01 · Profile</span><h4>Public orientation</h4><p>Name the identity, its present role, and the historical language visitors need first.</p></div></div>
        <div class="cm-form-grid">
          ${organizationField}
          <label>Profile slug<input name="slug" value="${esc(first(record, "slug"))}" required placeholder="thoughtpuppet"></label>
          <label>Public kind label<input name="kind_label" value="${esc(first(record, "kind_label", "kindLabel", "public_kind_label", "publicKindLabel"))}" required placeholder="Creative identity"></label>
          <label>Lifecycle<select name="lifecycle_status">${["forming", "active", "dormant", "retired", "evolved"].map((value) => option(value, value, lifecycle)).join("")}</select></label>
          <label>Origin date label<input name="origin_date_label" value="${esc(first(record, "origin_date_label", "originDateLabel"))}" placeholder="Around fall 2023"></label>
          <label>Current role<input name="current_role" value="${esc(first(record, "current_role", "currentRole"))}" placeholder="Painting and visual-language identity"></label>
          <label class="wide">Hero descriptor<textarea name="hero_descriptor" required placeholder="A concise public orientation for the identity.">${esc(first(record, "hero_descriptor", "heroDescriptor"))}</textarea></label>
          <label class="wide">Origin body<textarea name="origin_body" placeholder="How the identity began, written with honest date precision.">${esc(first(record, "origin_body", "originBody"))}</textarea></label>
          <label class="wide">Return / evolution body<textarea name="return_body" placeholder="How the identity changed, paused, returned, or became active again.">${esc(first(record, "return_body", "returnBody"))}</textarea></label>
        </div>
      </section>

      <section class="ci-form-section">
        <div class="ci-section-head"><div><span class="cm-section-index">02 · Connected record</span><h4>Lineage and current mark</h4><p>Choose canonical linked records. The profile points to them; it does not copy their identity or history.</p></div></div>
        <div class="cm-form-grid">
          <label>Timeline<select name="timeline_id"><option value="">Not linked</option>${selectOptions(support.timelines, timelineId, ["id"], (item) => listOptionLabel(item))}</select></label>
          <label>Current Legend mark<select name="current_symbol_id"><option value="">Not linked</option>${selectOptions(support.symbols, symbolId, ["id"], (item) => listOptionLabel(item, ["name", "slug"]))}</select></label>
          <label>Origin Thread<select name="origin_thread_id"><option value="">Not linked</option>${selectOptions(support.originThreads, threadId, ["id"], (item) => listOptionLabel(item))}</select></label>
          <label>Featured origin record<select name="featured_origin_entity_id"><option value="">Not linked</option>${selectOptions(support.dossiers, featuredId, ["entity_id", "entityId", "id"], (item) => listOptionLabel(item, ["entity_title", "entityTitle", "title", "archive_slug", "archiveSlug"]))}</select></label>
          <label class="wide">Dossier entity<input name="dossier_entity_id" value="${esc(dossierId)}" readonly><span class="cm-field-note">The dossier belongs to the canonical organization and is reviewed separately.</span></label>
        </div>
        <div class="ci-review-grid">
          ${dossierCard}
          ${reviewCard({ label: "Timeline", item: record.timeline || null, id: timelineId, route: nestedRoute(record, "timeline") })}
          ${reviewCard({ label: "Current mark", item: record.current_symbol || record.currentSymbol || null, id: symbolId, route: nestedRoute(record, record.current_symbol ? "current_symbol" : "currentSymbol") })}
          ${reviewCard({ label: "Origin Thread", item: record.origin_thread || record.originThread || null, id: threadId, route: nestedRoute(record, record.origin_thread ? "origin_thread" : "originThread") })}
          ${reviewCard({ label: "Featured origin record", item: record.featured_origin_record || record.featuredOriginRecord || null, id: featuredId, openArchiveId: featuredId })}
        </div>
      </section>

      <section class="ci-form-section">
        <div class="ci-section-head"><div><span class="cm-section-index">03 · Publication</span><h4>Lifecycle is not publication</h4><p>An active identity may remain private. Publishing requires a public organization and eligible linked records; the backend checks every gate again.</p></div></div>
        <div class="cm-form-grid">
          <label>Publication state<select name="publication_state">${["draft", "published", "archived"].map((value) => option(value, value, publication)).join("")}</select></label>
          <label>Display order<input name="sort_order" type="number" min="0" step="1" value="${esc(first(record, "sort_order", "sortOrder") || 0)}"></label>
          <label class="cm-check-field wide"><input name="public_visible" type="checkbox" ${publicVisible ? "checked" : ""}><span>Include this profile on public Creative Identity surfaces</span></label>
        </div>
        ${creating ? '<div class="cm-notice">New identities are always created as private drafts. Reopen the saved profile to review every linked record before publishing.</div>' : ""}
      </section>

      <div class="cm-actions">
        <button class="button" type="submit">${creating ? "Create private identity draft" : "Save identity"}</button>
        <span class="cm-upload-status" data-identity-status aria-live="polite"></span>
      </div>
    </form>
    ${legendAppearanceReviewSection(record, support, { creating })}
  </section>`;
}

function supportWarning(support) {
  const failures = support.failures.filter(Boolean);
  return failures.length ? `<div class="cm-notice" data-kind="error"><strong>Some linked-record choices are unavailable.</strong><p>${esc(failures.join(" "))}</p><p>The identity profiles already loaded remain editable; missing selectors should be retried before publication.</p></div>` : "";
}

export async function mountCreativeIdentities(root, api, setStatus = () => {}) {
  activeMountController?.abort();
  const controller = new AbortController();
  activeMountController = controller;
  const state = {
    records: [],
    support: { organizations: [], timelines: [], symbols: [], originThreads: [], dossiers: [], legendAppearances: [], legendAppearanceError: "", usedOrganizationIds: new Set(), failures: [] },
    editingKey: "",
    creating: false,
  };

  root.innerHTML = '<section class="construct-manager ci-manager"><div class="cm-head"><div><h2>Creative Identities</h2><p class="cm-summary">Loading identity profiles and linked records…</p></div></div><div class="cm-notice">Loading…</div></section>';

  async function load() {
    const [identityPayload, organizations, timelines, symbols, originThreads, dossiers, legendAppearances] = await Promise.all([
      api(IDENTITY_ENDPOINT),
      optionalList(api, "/api/admin/organizations"),
      optionalList(api, "/api/admin/archive-timelines", "timelines"),
      optionalList(api, "/api/admin/legend"),
      optionalList(api, "/api/admin/archive-origin-threads", "origin_threads"),
      optionalList(api, "/api/admin/archive-dossiers", "dossiers"),
      optionalList(api, LEGEND_APPEARANCE_ENDPOINT, "appearances"),
    ]);
    state.records = recordsFrom(identityPayload, "identities");
    state.support = {
      organizations: organizations.records,
      timelines: timelines.records,
      symbols: symbols.records,
      originThreads: originThreads.records,
      dossiers: dossiers.records,
      legendAppearances: legendAppearances.records,
      legendAppearanceError: legendAppearances.error,
      usedOrganizationIds: new Set(state.records.map(identityOrganizationId).filter(Boolean)),
      failures: [organizations.error, timelines.error, symbols.error, originThreads.error, dossiers.error],
    };
  }

  function render() {
    const editing = state.creating ? {} : state.records.find((record) => identityKey(record) === state.editingKey);
    root.innerHTML = `<section class="construct-manager ci-manager">
      <div class="cm-head">
        <div><span class="cm-section-index">About · Managed profiles</span><h2>Creative Identities</h2><p class="cm-summary">Organization-rooted profiles connect public brand language to the Archive timeline, current Legend mark, origin dossier, and Origin Thread without duplicating any of those records.</p></div>
        <div class="cm-head-actions"><button class="button" type="button" data-identity-new>New Creative Identity</button><button class="button" type="button" data-identity-reload>Reload</button></div>
      </div>
      ${supportWarning(state.support)}
      ${state.creating || editing ? identityEditor(editing || {}, state.support, { creating: state.creating }) : ""}
      <div class="cm-grid ci-identity-grid">${state.records.length ? state.records.map(creativeIdentityCard).join("") : '<div class="cm-empty">No Creative Identity profiles yet. Create one from an existing organization entity.</div>'}</div>
    </section>`;
  }

  function rememberLegendAppearance(saved) {
    const appearanceId = String(first(saved, "id"));
    if (!appearanceId) return;
    const replace = (records) => {
      const list = Array.isArray(records) ? records : [];
      const index = list.findIndex((appearance) => String(first(appearance, "id")) === appearanceId);
      if (index < 0) return [...list, saved];
      const next = [...list];
      next[index] = { ...next[index], ...saved };
      return next;
    };
    state.support.legendAppearances = replace(state.support.legendAppearances);
    state.records.forEach((profile) => {
      const symbol = currentSymbol(profile);
      if (!symbol) return;
      if (Array.isArray(symbol.archive_appearances)) symbol.archive_appearances = replace(symbol.archive_appearances);
      if (Array.isArray(symbol.archiveAppearances)) symbol.archiveAppearances = replace(symbol.archiveAppearances);
    });
  }

  async function saveLegendAppearance(button) {
    const row = button.closest("[data-legend-appearance-row]");
    const output = row?.querySelector("[data-legend-appearance-status]");
    const appearanceId = String(row?.dataset.appearanceId || "");
    if (!row || !output || !appearanceId) {
      setStatus("Legend appearance is missing its canonical ID");
      return;
    }
    const titleInput = row.querySelector("[data-legend-appearance-title]");
    const payload = {
      title: String(titleInput?.value || "").trim(),
      caption: String(row.querySelector("[data-legend-appearance-caption]")?.value || "").trim(),
      appearance_role: String(row.querySelector("[data-legend-appearance-role]")?.value || "appearance"),
      publication_state: String(row.querySelector("[data-legend-appearance-publication]")?.value || "draft"),
      public_visible: Boolean(row.querySelector("[data-legend-appearance-visible]")?.checked),
      sort_order: Number(row.querySelector("[data-legend-appearance-order]")?.value) || 0,
    };
    if (!payload.title) {
      output.textContent = "A public title is required.";
      titleInput?.focus();
      return;
    }
    button.disabled = true;
    output.textContent = "Saving Legend appearance…";
    try {
      const response = await api(`${LEGEND_APPEARANCE_ENDPOINT}/${encodeURIComponent(appearanceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = recordFrom(response, "appearance");
      rememberLegendAppearance(saved);
      const publication = String(first(saved, "publication_state", "publicationState") || payload.publication_state);
      const visible = first(saved, "public_visible", "publicVisible") === ""
        ? payload.public_visible
        : checked(first(saved, "public_visible", "publicVisible"));
      row.dataset.reviewState = publication;
      const label = row.querySelector("[data-legend-appearance-publication-label]");
      if (label) label.textContent = `${publication} / ${visible ? "public" : "private"}`;
      output.textContent = "Legend appearance saved.";
      setStatus("Legend appearance saved");
    } catch (error) {
      output.textContent = error.message || "Legend appearance could not be saved.";
      setStatus(output.textContent);
    } finally {
      button.disabled = false;
    }
  }

  try {
    await load();
    if (controller.signal.aborted) return;
    render();
    setStatus("Creative Identities ready");
  } catch (error) {
    if (controller.signal.aborted) return;
    root.innerHTML = `<section class="construct-manager ci-manager"><div class="cm-notice" data-kind="error" role="alert"><strong>Creative Identities could not be loaded.</strong><p>${esc(error.message)}</p><button class="button" type="button" data-identity-reload>Try again</button></div></section>`;
    setStatus(error.message);
  }

  root.addEventListener("click", async (event) => {
    const reload = event.target.closest("[data-identity-reload]");
    const create = event.target.closest("[data-identity-new]");
    const edit = event.target.closest("[data-identity-edit]");
    const close = event.target.closest("[data-identity-close]");
    const prepareDossier = event.target.closest("[data-identity-prepare-dossier]");
    const saveAppearance = event.target.closest("[data-legend-appearance-save]");
    if (!reload && !create && !edit && !close && !prepareDossier && !saveAppearance) return;
    if (saveAppearance) {
      await saveLegendAppearance(saveAppearance);
      return;
    }
    if (reload) {
      reload.disabled = true;
      try { await load(); render(); setStatus("Creative Identities reloaded"); } catch (error) { setStatus(error.message); }
      return;
    }
    if (create) {
      state.creating = true;
      state.editingKey = "";
      render();
      root.querySelector("[data-identity-form]")?.scrollIntoView({ block: "start" });
      return;
    }
    if (edit) {
      state.creating = false;
      state.editingKey = edit.dataset.identityEdit;
      render();
      root.querySelector("[data-identity-form]")?.scrollIntoView({ block: "start" });
      return;
    }
    if (close) {
      state.creating = false;
      state.editingKey = "";
      render();
      return;
    }
    if (prepareDossier) {
      prepareDossier.disabled = true;
      try {
        await api(`/api/admin/entities/${encodeURIComponent(prepareDossier.dataset.identityPrepareDossier)}/archive-dossier`, { method: "POST" });
        await load();
        render();
        setStatus("Identity dossier prepared");
      } catch (error) {
        prepareDossier.disabled = false;
        setStatus(error.message);
      }
    }
  }, { signal: controller.signal });

  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-identity-form]");
    if (!form) return;
    event.preventDefault();
    const output = form.querySelector("[data-identity-status]");
    const submit = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    const organizationId = String(data.get("organization_id") || "").trim();
    const payload = {
      organization_id: organizationId,
      slug: String(data.get("slug") || "").trim(),
      kind_label: String(data.get("kind_label") || "").trim(),
      lifecycle_status: String(data.get("lifecycle_status") || "forming"),
      origin_date_label: String(data.get("origin_date_label") || "").trim(),
      hero_descriptor: String(data.get("hero_descriptor") || "").trim(),
      current_role: String(data.get("current_role") || "").trim(),
      origin_body: String(data.get("origin_body") || "").trim(),
      return_body: String(data.get("return_body") || "").trim(),
      timeline_id: String(data.get("timeline_id") || "").trim() || null,
      current_symbol_id: String(data.get("current_symbol_id") || "").trim() || null,
      origin_thread_id: String(data.get("origin_thread_id") || "").trim() || null,
      featured_origin_entity_id: String(data.get("featured_origin_entity_id") || "").trim() || null,
      publication_state: String(data.get("publication_state") || "draft"),
      public_visible: form.elements.public_visible.checked,
      sort_order: Number(data.get("sort_order")) || 0,
    };
    if (!payload.organization_id || !payload.slug || !payload.kind_label || !payload.hero_descriptor) {
      output.textContent = "Organization, slug, public kind label, and hero descriptor are required.";
      return;
    }
    submit.disabled = true;
    output.textContent = state.creating ? "Creating private draft…" : "Saving…";
    try {
      const key = form.dataset.key;
      const response = await api(key ? `${IDENTITY_ENDPOINT}/${encodeURIComponent(key)}` : IDENTITY_ENDPOINT, {
        method: key ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = recordFrom(response, "identity");
      state.creating = false;
      state.editingKey = identityKey(saved) || key || organizationId;
      await load();
      render();
      setStatus(key ? "Creative Identity saved" : "Private Creative Identity draft created");
    } catch (error) {
      submit.disabled = false;
      output.textContent = error.message;
      setStatus(error.message);
    }
  }, { signal: controller.signal });
}

function catalogueLists(payload) {
  return {
    media: Array.isArray(payload?.media) ? payload.media : recordsFrom(payload, "catalogue_media", "catalogueMedia"),
    objectTypes: Array.isArray(payload?.object_types) ? payload.object_types : Array.isArray(payload?.objectTypes) ? payload.objectTypes : recordsFrom(payload, "types"),
  };
}

function objectTypeOptions(objectTypes, media) {
  const mediaLabels = new Map(media.map((item) => [String(first(item, "id")), String(first(item, "label", "name", "id"))]));
  const groups = new Map();
  objectTypes.forEach((item) => {
    const mediumId = String(first(item, "medium_id", "mediumId") || "other");
    if (!groups.has(mediumId)) groups.set(mediumId, []);
    groups.get(mediumId).push(item);
  });
  return [...groups].map(([mediumId, types]) => `<optgroup label="${esc(mediaLabels.get(mediumId) || mediumId)}">${types.map((item) => option(first(item, "id"), first(item, "label", "name", "id"), "")).join("")}</optgroup>`).join("");
}

function defaultRecordType(mediumId) {
  return ({ art: "artwork", merch: "merchandise", tattoos: "tattoo", film: "film", music: "music", writings: "writing", legend: "symbol", other: "object" })[mediumId] || "object";
}

function creationResult(payload) {
  const record = recordFrom(payload);
  const dossier = payload?.dossier || {};
  const catalogue = payload?.catalogue || {};
  const version = payload?.version || {};
  const state = payload?.state || {};
  const entityId = first(record, "id", "entity_id", "entityId") || first(dossier, "entity_id", "entityId");
  return `<section class="ci-create-result" aria-live="polite">
    <span class="cm-section-index">Private draft created</span>
    <h3>${esc(first(record, "title", "name") || entityId)}</h3>
    <p>The atomic action created one canonical record, its dossier, catalogue identity, Version 1, and State I. Nothing was published.</p>
    <div class="ci-result-grid">
      <div><strong>Record</strong><span>${esc(entityId)}</span></div>
      <div><strong>Dossier</strong><span>${esc(first(dossier, "archive_slug", "archiveSlug", "entity_id", "entityId") || "created")}</span></div>
      <div><strong>Catalogue</strong><span>${esc(first(catalogue, "catalogue_id", "catalogueId") || "assigned")}</span></div>
      <div><strong>Evolution</strong><span>Version ${esc(first(version, "version_number", "versionNumber") || 1)} / State ${esc(first(state, "state_roman", "stateRoman") || "I")}</span></div>
    </div>
    <div class="cm-actions">
      ${entityId ? `<button class="button" type="button" data-open-archive-record="${esc(entityId)}">Open Archive record</button>` : ""}
      <button class="button" type="button" data-object-reset>Create another cultural object</button>
    </div>
  </section>`;
}

export async function mountCulturalObjectCreator(root, api, setStatus = () => {}) {
  activeMountController?.abort();
  const controller = new AbortController();
  activeMountController = controller;
  let catalogue = { media: [], objectTypes: [] };
  let entities = [];
  let resultMarkup = "";

  root.innerHTML = '<section class="construct-manager ci-manager"><div class="cm-head"><div><h2>Archive Records</h2><p class="cm-summary">Loading cultural-object vocabulary…</p></div></div><div class="cm-notice">Loading…</div></section>';

  async function load() {
    const [cataloguePayload, entityPayload] = await Promise.all([
      api("/api/admin/archive-catalogue"),
      api("/api/admin/entities"),
    ]);
    catalogue = catalogueLists(cataloguePayload);
    entities = recordsFrom(entityPayload, "entities");
  }

  function render() {
    const creators = entities.filter((entity) => ["person", "organization"].includes(String(first(entity, "entityType", "entity_type", "type"))));
    root.innerHTML = `<section class="construct-manager ci-manager">
      <div class="cm-head">
        <div><span class="cm-section-index">Archive · Canonical intake</span><h2>Records</h2><p class="cm-summary">Create an independently identifiable cultural object as one private canonical record. The action prepares its dossier, catalogue identity, Version 1, and State I together.</p></div>
        <button class="button" type="button" data-object-reload>Reload vocabulary</button>
      </div>
      <div class="cm-notice"><strong>Draft boundary</strong><p>Creation does not upload media or publish anything. After the record exists, open its dossier to add reviewed state evidence, relationships, provenance, and publication controls.</p></div>
      ${resultMarkup}
      <form class="cm-editor cm-form ci-object-form" data-cultural-object-form>
        <div class="cm-row"><div><span class="cm-section-index">New cultural object</span><h3>Canonical identity</h3></div><span class="cm-pill">private draft</span></div>
        <div class="cm-form-grid">
          <label class="wide">Title<input name="title" required maxlength="300" placeholder="The authored title of the object"></label>
          <label>Slug<input name="slug" required maxlength="160" placeholder="stable-record-slug" data-object-slug></label>
          <label>Cultural object type<select name="cultural_object_type_id" required><option value="">Choose catalogue type</option>${objectTypeOptions(catalogue.objectTypes, catalogue.media)}</select></label>
          <label>Archive room<input name="room" required maxlength="160" placeholder="Art, Objects, Writings…"></label>
          <label>Record type<input name="record_type" required maxlength="120" placeholder="artwork, object, writing…"></label>
          <label>Medium / material description<input name="medium" maxlength="500" placeholder="Digital image, acrylic on panel…"></label>
          <label>Creator entity<select name="creator_entity_id"><option value="">Creator not assigned</option>${selectOptions(creators, "", ["id"], (item) => listOptionLabel(item, ["title", "name", "slug"]))}</select><span class="cm-field-note">Choose an existing Person or Organization so provenance remains reusable.</span></label>
          <label>Date precision<select name="date_precision">${[["undated", "Undated"], ["year", "Year only"], ["approximate", "Approximate"], ["exact", "Exact date"], ["range", "Date range"]].map(([value, label]) => option(value, label, "undated")).join("")}</select></label>
          <label>Visitor-facing date<input name="date_label" maxlength="160" placeholder="Date not yet verified"></label>
          <label class="wide">Summary<textarea name="summary" maxlength="5000" placeholder="A concise orientation to what this object is and why it has its own identity."></textarea></label>
          <label class="wide">Story / body<textarea name="body" maxlength="50000" placeholder="Optional longer context. Process evidence belongs in the dossier after creation."></textarea></label>
        </div>
        <div class="ci-atomic-preview">
          <span>01 · Record</span><span>02 · Dossier</span><span>03 · Catalogue</span><span>04 · Version 1</span><span>05 · State I</span>
        </div>
        <div class="cm-actions"><button class="button" type="submit">Create private cultural object</button><span class="cm-upload-status" data-object-status aria-live="polite"></span></div>
      </form>
    </section>`;
  }

  try {
    await load();
    if (controller.signal.aborted) return;
    render();
    setStatus("Archive record creator ready");
  } catch (error) {
    if (controller.signal.aborted) return;
    root.innerHTML = `<section class="construct-manager ci-manager"><div class="cm-notice" data-kind="error" role="alert"><strong>Archive record creator could not be loaded.</strong><p>${esc(error.message)}</p><button class="button" type="button" data-object-reload>Try again</button></div></section>`;
    setStatus(error.message);
  }

  root.addEventListener("input", (event) => {
    const form = event.target.closest("[data-cultural-object-form]");
    if (!form) return;
    if (event.target.name === "title") {
      const slug = form.elements.slug;
      const previousAuto = slug.dataset.autoValue || "";
      if (!slug.value || slug.value === previousAuto) {
        slug.value = slugify(event.target.value);
        slug.dataset.autoValue = slug.value;
      }
    }
  }, { signal: controller.signal });

  root.addEventListener("change", (event) => {
    const select = event.target.closest('[name="cultural_object_type_id"]');
    if (!select) return;
    const form = select.closest("form");
    const type = catalogue.objectTypes.find((item) => String(first(item, "id")) === select.value);
    const mediumId = String(first(type, "medium_id", "mediumId"));
    const medium = catalogue.media.find((item) => String(first(item, "id")) === mediumId);
    const mediumLabel = String(first(medium, "label", "name", "id") || mediumId);
    if (!form.elements.room.value.trim()) form.elements.room.value = mediumLabel;
    if (!form.elements.record_type.value.trim()) form.elements.record_type.value = defaultRecordType(mediumId);
  }, { signal: controller.signal });

  root.addEventListener("click", async (event) => {
    const reset = event.target.closest("[data-object-reset]");
    const reload = event.target.closest("[data-object-reload]");
    if (reset) {
      resultMarkup = "";
      render();
      return;
    }
    if (reload) {
      reload.disabled = true;
      try { await load(); render(); setStatus("Cultural-object vocabulary reloaded"); } catch (error) { reload.disabled = false; setStatus(error.message); }
    }
  }, { signal: controller.signal });

  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-cultural-object-form]");
    if (!form) return;
    event.preventDefault();
    const output = form.querySelector("[data-object-status]");
    const submit = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    const typeId = String(data.get("cultural_object_type_id") || "");
    const type = catalogue.objectTypes.find((item) => String(first(item, "id")) === typeId);
    const mediumId = String(first(type, "medium_id", "mediumId"));
    const mediumRecord = catalogue.media.find((item) => String(first(item, "id")) === mediumId);
    const selectedCreator = entities.find((item) => String(first(item, "id")) === String(data.get("creator_entity_id") || ""));
    const medium = String(data.get("medium") || "").trim() || String(first(mediumRecord, "label", "name", "id") || mediumId);
    const creatorId = String(data.get("creator_entity_id") || "").trim();
    const creatorLabel = String(first(selectedCreator, "title", "name", "slug") || "");
    const payload = {
      title: String(data.get("title") || "").trim(),
      slug: String(data.get("slug") || "").trim(),
      room: String(data.get("room") || "").trim(),
      record_type: String(data.get("record_type") || "").trim(),
      cultural_object_type_id: typeId,
      medium,
      medium_label: medium,
      creator_entity_id: creatorId || null,
      creator_label: creatorLabel,
      date_precision: String(data.get("date_precision") || "undated"),
      date_label: String(data.get("date_label") || "").trim(),
      summary: String(data.get("summary") || "").trim(),
      body: String(data.get("body") || "").trim(),
    };
    if (!payload.title || !payload.slug || !payload.room || !payload.record_type || !payload.cultural_object_type_id) {
      output.textContent = "Title, slug, Archive room, record type, and cultural object type are required.";
      return;
    }
    submit.disabled = true;
    output.textContent = "Creating the canonical private draft…";
    try {
      const response = await api(CULTURAL_OBJECT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      resultMarkup = creationResult(response);
      render();
      setStatus("Private cultural object created");
      root.querySelector(".ci-create-result")?.scrollIntoView({ block: "start" });
    } catch (error) {
      submit.disabled = false;
      output.textContent = error.message;
      setStatus(error.message);
    }
  }, { signal: controller.signal });
}
