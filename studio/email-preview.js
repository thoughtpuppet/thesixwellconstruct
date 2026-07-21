(function () {
  const TOKEN_KEY = "swc_submissions_admin_token";
  const make = (tag, className = "", text = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const title = (value) => String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
  const set = (object, path, value) => {
    const parts = path.split(".");
    const leaf = parts.pop();
    let cursor = object;
    parts.forEach((part) => { cursor[part] ||= {}; cursor = cursor[part]; });
    cursor[leaf] = value;
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  function init(root) {
    const allowedBrands = new Set(String(root.dataset.brands || "").split(",").map((v) => v.trim()).filter(Boolean));
    const token = localStorage.getItem(TOKEN_KEY) || "";
    let catalog = [];
    let selected = null;
    let definition = null;
    let content = null;
    let savedContent = null;
    let rendered = null;
    let revision = 0;
    let renderTimer = 0;
    let pendingAction = "";

    const status = make("div", "email-preview-status", "Loading email template manager");
    const filters = make("div", "email-preview-toolbar");
    const editorLayout = make("div", "email-preview-editor-layout");
    const editor = make("section", "email-preview-editor");
    const preview = make("section", "email-preview-output");
    const actions = make("div", "email-preview-actions");
    const form = make("form", "email-preview-form");
    const tokenHelp = make("div", "email-preview-token-help");
    const historyPanel = make("div", "email-preview-history");
    historyPanel.hidden = true;
    const actionHelp = make("p", "email-preview-action-help");
    const actionStatus = make("div", "email-preview-action-status", "Ready");
    actionStatus.setAttribute("role", "status");
    actionStatus.setAttribute("aria-live", "polite");
    const iframe = document.createElement("iframe");
    iframe.title = "Designed email preview";
    iframe.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    const plain = make("pre", "email-preview-text");
    plain.hidden = true;
    const frame = make("div", "email-preview-frame");
    frame.append(iframe, plain);
    const meta = make("div", "email-preview-meta");

    const selectFields = [
      ["template", "Template"], ["brand", "Node / brand"], ["audience", "Audience"],
      ["stage", "Journey stage"], ["publication", "Publication status"],
    ].map(([name, label]) => {
      const wrap = make("label", "email-preview-control");
      wrap.append(make("span", "", label));
      const select = document.createElement("select");
      select.name = name;
      wrap.append(select);
      filters.append(wrap);
      return select;
    });
    const [templateSelect, brandSelect, audienceSelect, stageSelect, publicationSelect] = selectFields;
    const option = (select, value, label) => {
      const node = document.createElement("option"); node.value = value; node.textContent = label; select.append(node);
    };

    const button = (label, action, className = "") => {
      const node = make("button", className, label); node.type = "button"; node.dataset.action = action; return node;
    };
    const saveButton = button("Save Draft", "save", "is-primary");
    const discardButton = button("Discard Changes", "discard");
    const publishButton = button("Publish", "publish");
    const testButton = button("Send Test", "test");
    const historyButton = button("View History", "history");
    actions.append(saveButton, discardButton, publishButton, testButton, historyButton, actionStatus);
    const actionButtons = [saveButton, discardButton, publishButton, testButton, historyButton];
    const actionLabels = {
      save: ["Save Draft", "Saving Draft…"],
      discard: ["Discard Changes", "Discarding…"],
      publish: ["Publish", "Publishing…"],
      test: ["Send Test", "Sending Test…"],
      history: ["View History", "Loading History…"],
    };

    const desktopButton = button("Desktop", "desktop", "is-active");
    const mobileButton = button("Mobile", "mobile");
    const htmlButton = button("Rendered HTML", "html", "is-active");
    const textButton = button("Plain Text", "text");
    const publishedButton = button("Live version", "published");
    const workingButton = button("Working copy", "working", "is-active");
    const displayGroup = (label, buttons) => {
      const group = make("div", "email-preview-display-group");
      const controls = make("div", "email-preview-display-buttons");
      controls.append(...buttons);
      group.append(make("span", "email-preview-display-label", label), controls);
      return group;
    };
    const displayControls = make("div", "email-preview-display");
    displayControls.append(
      displayGroup("Viewport", [desktopButton, mobileButton]),
      displayGroup("Format", [htmlButton, textButton]),
      displayGroup("Preview source", [publishedButton, workingButton]),
    );
    const sourceHelp = make("p", "email-preview-source-help", "Working copy shows the editor, including unsaved changes. Live version shows the copy currently used by outgoing emails; before the first publish, that is the repository default.");
    editor.append(tokenHelp, form, actions, actionHelp, historyPanel);
    preview.append(displayControls, sourceHelp, meta, make("div", "email-preview-stage"));
    preview.lastElementChild.append(frame);
    editorLayout.append(editor, preview);
    root.replaceChildren(status, filters, editorLayout);

    const authHeaders = () => ({ Accept: "application/json", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) });
    async function api(path, options = {}) {
      const response = await fetch(path, { cache: "no-store", ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(payload.error || payload.delivery?.error || `Request failed (${response.status}).`); error.status = response.status; error.payload = payload; throw error; }
      return payload;
    }
    const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle("is-error", error); };
    const setActionStatus = (message, tone = "") => {
      actionStatus.textContent = message;
      actionStatus.classList.toggle("is-success", tone === "success");
      actionStatus.classList.toggle("is-error", tone === "error");
    };
    const startAction = (action, message) => {
      pendingAction = action;
      actions.classList.add("is-busy");
      actions.setAttribute("aria-busy", "true");
      setActionStatus(message);
      updateActions();
    };
    const finishAction = (message, tone) => {
      pendingAction = "";
      actions.classList.remove("is-busy");
      actions.setAttribute("aria-busy", "false");
      setActionStatus(message, tone);
      updateActions();
    };
    const id = (entry) => `${entry.templateKey}:${entry.variant}`;
    const currentEntry = () => catalog.find((entry) => id(entry) === templateSelect.value);
    const filterValueLabel = (key, value) => key === "brand"
      ? ({ tattoo: "Tattoo node", art: "Art node", events: "Events node", studio: "Studio / CRM" })[value] || title(value)
      : title(value);

    function filtersFor(select, key, label) {
      const current = select.value;
      select.replaceChildren(); option(select, "", `All ${label}`);
      [...new Set(catalog.map((entry) => entry[key]).filter(Boolean))].sort().forEach((value) => option(select, value, filterValueLabel(key, value)));
      if ([...select.options].some((entry) => entry.value === current)) select.value = current;
    }
    async function rebuildTemplates(preferred = "") {
      const matches = catalog.filter((entry) => (!brandSelect.value || entry.brand === brandSelect.value)
        && (!audienceSelect.value || entry.audience === audienceSelect.value)
        && (!stageSelect.value || entry.stage === stageSelect.value)
        && (!publicationSelect.value || entry.status === publicationSelect.value));
      templateSelect.replaceChildren();
      matches.forEach((entry) => option(templateSelect, id(entry), `${entry.label} · ${entry.variant}`));
      if (matches.some((entry) => id(entry) === preferred)) templateSelect.value = preferred;
      await loadTemplate();
    }
    function dirty() { return content && savedContent && !same(content, savedContent); }
    function setPreviewSource(source) {
      publishedButton.classList.toggle("is-active", source === "published");
      workingButton.classList.toggle("is-active", source === "working");
    }
    function updateActions() {
      const isDirty = dirty();
      const hasDraft = Boolean(revision);
      const busy = Boolean(pendingAction);
      saveButton.disabled = busy || (!isDirty && hasDraft);
      discardButton.disabled = busy || !isDirty;
      publishButton.disabled = busy || isDirty || !hasDraft;
      testButton.disabled = busy || isDirty || !hasDraft;
      historyButton.disabled = busy;
      publishedButton.disabled = false;

      actionButtons.forEach((button) => {
        const labels = actionLabels[button.dataset.action];
        button.textContent = pendingAction === button.dataset.action ? labels[1] : labels[0];
      });

      saveButton.title = saveButton.disabled ? "This draft is already saved." : hasDraft ? "Save the changes in the working copy." : "Create a private draft from the working copy.";
      discardButton.title = discardButton.disabled ? "There are no unsaved changes to discard." : "Return to the last saved version.";
      publishButton.title = isDirty ? "Save the draft before publishing." : hasDraft ? "Make this draft the live email version." : "Save a draft before publishing.";
      testButton.title = isDirty ? "Save the draft before sending a test." : hasDraft ? "Send this draft to the configured admin inbox." : "Save a draft before sending a test.";
      publishedButton.title = definition?.published ? "Preview the published revision currently used by live emails." : "Preview the repository default currently used by live emails.";
      workingButton.title = "Preview the editor's current working copy.";

      actionHelp.textContent = isDirty
        ? "The working copy has unsaved changes. Save the draft before sending a test or publishing."
        : hasDraft
          ? `Draft revision ${revision} is saved. Send Test delivers only to the configured admin inbox; Publish makes this revision the live email copy.`
          : "Save Draft creates a private revision without changing live emails. Once saved, Send Test and Publish become available.";
    }
    function renderMeta(payload) {
      meta.innerHTML = `<div class="email-preview-meta-row"><strong>Subject</strong><span></span></div><div class="email-preview-meta-row"><strong>Preheader</strong><span></span></div>`;
      meta.children[0].lastElementChild.textContent = payload.subject || "";
      meta.children[1].lastElementChild.textContent = payload.preheader || "";
      iframe.srcdoc = payload.html || "";
      plain.textContent = payload.text || "";
      rendered = payload;
    }
    async function renderUnsaved() {
      if (!selected || !content) return;
      try {
        const payload = await api("/api/admin/notifications/preview", { method: "POST", body: JSON.stringify({ templateKey: selected.templateKey, variant: selected.variant, content }) });
        renderMeta(payload);
        setPreviewSource("working");
        const workingState = dirty()
          ? "unsaved changes"
          : definition?.draft
            ? `saved draft revision ${revision}`
            : definition?.published
              ? `published revision ${definition.published.revision} loaded as a working copy`
              : "code default loaded as a working copy";
        setStatus(`${selected.label} · ${workingState}`);
      } catch (error) {
        setStatus(error.payload?.errors?.join(" ") || error.message, true);
      }
    }
    function queueRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderUnsaved, 180); updateActions(); }
    function buildForm() {
      form.replaceChildren();
      const allowed = definition.schema?.allowedTokens || [];
      tokenHelp.textContent = allowed.length ? `Allowed variables: ${allowed.map((item) => `{{${item}}}`).join("  ")}` : "This template has no editable variables.";
      (definition.schema?.fields || []).forEach((field) => {
        const label = make("label", `email-preview-field${field.policy ? " is-policy" : ""}`);
        label.append(make("span", "", `${field.label}${field.policy ? " · policy copy" : ""}`));
        const control = field.type === "textarea" || field.type === "paragraphs" ? document.createElement("textarea") : document.createElement("input");
        const value = get(content, field.path);
        control.value = Array.isArray(value) ? value.join("\n\n") : value || "";
        control.addEventListener("input", () => { set(content, field.path, field.type === "paragraphs" ? control.value.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean) : control.value); queueRender(); });
        label.append(control); form.append(label);
      });
    }
    async function loadTemplate() {
      selected = currentEntry();
      if (!selected) { editorLayout.hidden = true; setStatus("No templates match the selected filters."); return; }
      editorLayout.hidden = false;
      try {
        const params = new URLSearchParams({ variant: selected.variant });
        definition = await api(`/api/admin/notifications/templates/${encodeURIComponent(selected.templateKey)}?${params}`);
        const active = definition.draft || definition.published;
        revision = definition.draft?.revision || 0;
        content = clone(active?.content || definition.defaultContent);
        savedContent = clone(content);
        setPreviewSource("working");
        buildForm(); updateActions(); await renderUnsaved();
      } catch (error) {
        if ([401, 403].includes(error.status)) setStatus("Admin authentication required. Open Studio and enter the bearer token first.", true);
        else setStatus(error.message, true);
      }
    }
    async function refreshCatalog(preferred = templateSelect.value) {
      const payload = await api("/api/admin/notifications/preview");
      catalog = (payload.templates || []).filter((entry) => !allowedBrands.size || allowedBrands.has(entry.brand));
      filtersFor(brandSelect, "brand", "brands"); filtersFor(audienceSelect, "audience", "audiences"); filtersFor(stageSelect, "stage", "stages"); filtersFor(publicationSelect, "status", "statuses");
      await rebuildTemplates(preferred);
    }

    [brandSelect, audienceSelect, stageSelect, publicationSelect].forEach((select) => select.addEventListener("change", () => rebuildTemplates(templateSelect.value).catch((error) => setStatus(error.message, true))));
    templateSelect.addEventListener("change", () => loadTemplate().catch((error) => setStatus(error.message, true)));
    form.addEventListener("submit", (event) => event.preventDefault());
    actions.addEventListener("click", async (event) => {
      const action = event.target.dataset.action; if (!action || !selected || pendingAction) return;
      const endpoint = `/api/admin/notifications/templates/${encodeURIComponent(selected.templateKey)}`;
      try {
        if (action === "discard") {
          startAction(action, "Discarding unsaved changes…");
          content = clone(savedContent);
          buildForm();
          await renderUnsaved();
          finishAction("Unsaved changes discarded.", "success");
          return;
        }
        if (action === "save") {
          startAction(action, "Saving this draft…");
          const payload = await api(`${endpoint}/draft?variant=${encodeURIComponent(selected.variant)}`, { method: "PUT", body: JSON.stringify({ content, baseRevision: revision || definition.published?.revision || 0 }) });
          revision = payload.draft.revision;
          savedContent = clone(payload.draft.content);
          definition.draft = payload.draft;
          const catalogEntry = currentEntry();
          if (catalogEntry) {
            catalogEntry.status = "draft";
            catalogEntry.draftRevision = revision;
          }
          setStatus(`${selected.label} · saved draft revision ${revision}`);
          finishAction(`Draft saved · revision ${revision}. You can safely send a test now.`, "success");
          return;
        }
        if (action === "publish") {
          if ((definition.schema?.fields || []).some((field) => field.policy) && !confirm("Publish this revision? Policy-marked copy is included in this template.")) return;
          startAction(action, `Publishing revision ${revision}…`);
          await api(`${endpoint}/publish?variant=${encodeURIComponent(selected.variant)}`, { method: "POST", body: JSON.stringify({ revision }) });
          setStatus(`Revision ${revision} published.`);
          await refreshCatalog(id(selected));
          finishAction(`Revision ${revision} is published and live.`, "success");
          return;
        }
        if (action === "test") {
          startAction(action, `Sending test for revision ${revision}…`);
          const payload = await api(`${endpoint}/test?variant=${encodeURIComponent(selected.variant)}`, { method: "POST", body: JSON.stringify({ revision }) });
          const recipient = payload.delivery?.recipient;
          setStatus("Protected test email sent.");
          finishAction(recipient ? `Test sent successfully to ${recipient}.` : "Test sent successfully to the configured admin inbox.", "success");
          return;
        }
        if (action === "history") {
          startAction(action, "Loading revision history…");
          const payload = await api(`${endpoint}/history?variant=${encodeURIComponent(selected.variant)}`);
          historyPanel.hidden = !historyPanel.hidden;
          historyPanel.replaceChildren(...(payload.history || []).map((item) => {
            const row = make("div", "email-preview-history-row", `Revision ${item.revision} · ${item.status} · ${item.updated_at}`);
            const restore = button("Restore as Draft", "restore"); restore.dataset.revision = item.revision; row.append(restore); return row;
          }));
          finishAction(historyPanel.hidden ? "Revision history closed." : "Revision history loaded.", "success");
        }
      } catch (error) {
        const message = error.payload?.errors?.join(" ") || error.message;
        setStatus(message, true);
        finishAction(`${title(action)} failed: ${message}`, "error");
      }
    });
    historyPanel.addEventListener("click", async (event) => {
      if (event.target.dataset.action !== "restore") return;
      try {
        const endpoint = `/api/admin/notifications/templates/${encodeURIComponent(selected.templateKey)}/restore?variant=${encodeURIComponent(selected.variant)}`;
        await api(endpoint, { method: "POST", body: JSON.stringify({ revision: Number(event.target.dataset.revision), baseRevision: revision || definition.published?.revision || 0 }) });
        historyPanel.hidden = true; await refreshCatalog(id(selected));
      } catch (error) { setStatus(error.message, true); }
    });
    displayControls.addEventListener("click", async (event) => {
      const action = event.target.dataset.action; if (!action) return;
      if (action === "desktop" || action === "mobile") { frame.classList.toggle("is-mobile", action === "mobile"); }
      if (action === "html" || action === "text") { iframe.hidden = action === "text"; plain.hidden = action === "html"; }
      if (action === "working") await renderUnsaved();
      if (action === "published") {
        const params = new URLSearchParams({ templateKey: selected.templateKey, variant: selected.variant, source: action });
        try {
          const payload = await api(`/api/admin/notifications/preview?${params}`);
          renderMeta(payload);
          setPreviewSource("published");
          const liveState = Number(payload.revision || 0)
            ? `published revision ${payload.revision} · live email version`
            : "repository default · live email fallback";
          setStatus(`${selected.label} · ${liveState}`);
        } catch (error) { setStatus(error.message, true); }
      }
      [...displayControls.querySelectorAll("button")].forEach((button) => {
        if (["desktop", "mobile"].includes(action) && ["desktop", "mobile"].includes(button.dataset.action)) button.classList.toggle("is-active", button.dataset.action === action);
        if (["html", "text"].includes(action) && ["html", "text"].includes(button.dataset.action)) button.classList.toggle("is-active", button.dataset.action === action);
      });
    });
    refreshCatalog().catch((error) => setStatus(error.status === 401 ? "Admin authentication required. Open Studio and enter the bearer token first." : error.message, true));
  }
  document.querySelectorAll("[data-email-preview]").forEach(init);
})();
