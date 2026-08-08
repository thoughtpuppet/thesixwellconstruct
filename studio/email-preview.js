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
    let mode = "copy";
    let designDefinition = null;
    let designProfile = null;
    let savedDesignProfile = null;
    let designRevision = 0;
    let designPreviews = [];

    const status = make("div", "email-preview-status", "Loading email template manager");
    const modeControls = make("div", "email-preview-mode");
    const filters = make("div", "email-preview-toolbar");
    const designToolbar = make("div", "email-preview-toolbar email-design-toolbar");
    designToolbar.hidden = true;
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
    const stage = make("div", "email-preview-stage");
    stage.append(frame);

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
    const copyModeButton = button("Template Copy", "mode-copy", "is-active");
    const designModeButton = button("Design System", "mode-design");
    modeControls.append(copyModeButton, designModeButton);
    const designScopeWrap = make("label", "email-preview-control");
    designScopeWrap.append(make("span", "", "Design scope"));
    const designScopeSelect = document.createElement("select");
    [["global", "Global defaults"], ["tattoo", "Tattoo node"], ["art", "Art node"], ["events", "Events node"], ["studio", "Studio node"]]
      .forEach(([value, label]) => option(designScopeSelect, value, label));
    designScopeWrap.append(designScopeSelect);
    const nodeAccent = make("div", "email-design-accent");
    designToolbar.append(designScopeWrap, nodeAccent);

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
    const viewportGroup = displayGroup("Viewport", [desktopButton, mobileButton]);
    const formatGroup = displayGroup("Format", [htmlButton, textButton]);
    const sourceGroup = displayGroup("Preview source", [publishedButton, workingButton]);
    displayControls.append(
      viewportGroup,
      formatGroup,
      sourceGroup,
    );
    const sourceHelp = make("p", "email-preview-source-help", "Working copy shows the editor, including unsaved changes. Live version shows the copy currently used by outgoing emails; before the first publish, that is the repository default.");
    editor.append(tokenHelp, form, actions, actionHelp, historyPanel);
    preview.append(displayControls, sourceHelp, meta, stage);
    editorLayout.append(editor, preview);
    root.replaceChildren(status, modeControls, filters, designToolbar, editorLayout);

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
    function dirty() {
      return mode === "design"
        ? designProfile && savedDesignProfile && !same(designProfile, savedDesignProfile)
        : content && savedContent && !same(content, savedContent);
    }
    function setPreviewSource(source) {
      publishedButton.classList.toggle("is-active", source === "published");
      workingButton.classList.toggle("is-active", source === "working");
    }
    function updateActions() {
      const isDirty = dirty();
      const activeRevision = mode === "design" ? designRevision : revision;
      const hasDraft = Boolean(activeRevision);
      const busy = Boolean(pendingAction);
      saveButton.disabled = busy || (!isDirty && hasDraft);
      discardButton.disabled = busy || !isDirty;
      publishButton.disabled = busy || isDirty || !hasDraft;
      testButton.disabled = busy || isDirty || !hasDraft;
      historyButton.disabled = busy;
      publishedButton.disabled = false;

      actionButtons.forEach((button) => {
        const labels = actionLabels[button.dataset.action];
        const normal = mode === "design"
          ? ({ save: "Save Batch Draft", discard: "Discard Changes", publish: "Publish Batch", test: "Send Batch Test", history: "View History" })[button.dataset.action]
          : labels[0];
        button.textContent = pendingAction === button.dataset.action ? labels[1] : normal;
      });

      saveButton.title = saveButton.disabled ? "This draft is already saved." : hasDraft ? "Save the changes in the working copy." : "Create a private draft from the working copy.";
      discardButton.title = discardButton.disabled ? "There are no unsaved changes to discard." : "Return to the last saved version.";
      publishButton.title = isDirty ? "Save the draft before publishing." : hasDraft ? "Make this draft the live email version." : "Save a draft before publishing.";
      testButton.title = isDirty ? "Save the draft before sending a test." : hasDraft ? "Send this draft to the configured admin inbox." : "Save a draft before sending a test.";
      publishedButton.title = (mode === "design" ? designDefinition?.published : definition?.published) ? "Preview the published revision currently used by live emails." : "Preview the repository default currently used by live emails.";
      workingButton.title = "Preview the editor's current working copy.";

      actionHelp.textContent = isDirty
        ? "The working copy has unsaved changes. Save the draft before sending a test or publishing."
        : hasDraft
          ? mode === "design"
            ? `Batch draft revision ${activeRevision} is saved. The current scope controls whether Send Batch Test delivers one or four separately rendered messages.`
            : `Draft revision ${activeRevision} is saved. Send Test delivers only to the configured admin inbox; Publish makes this revision the live email copy.`
          : mode === "design"
            ? "Save Batch Draft creates one private design revision for every node without changing live emails."
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
    function clearRenderedPreview() {
      rendered = null;
      meta.replaceChildren();
      iframe.srcdoc = "";
      plain.textContent = "";
      if (mode === "design") stage.replaceChildren();
      else if (!stage.contains(frame)) stage.replaceChildren(frame);
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
        clearRenderedPreview();
        setStatus(error.payload?.errors?.join(" ") || error.message, true);
      }
    }
    function queueRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(mode === "design" ? renderDesignUnsaved : renderUnsaved, 180);
      updateActions();
    }

    const DESIGN_ROLES = [
      ["canvas", "Opaque canvas", "The full email background. Opacity is fixed at 100%."],
      ["panel", "Opaque panel", "Inset notice and policy panels. Opacity is fixed at 100%."],
      ["title", "Title / primary text", "Headlines, primary labels, and the top brand line."],
      ["supporting", "Supporting copy", "Body paragraphs, greetings, and supporting values."],
      ["descriptor", "Small descriptors", "Classification, detail labels, URLs, and footer copy."],
      ["signatureMark", "Ending-signature mark", "The small final brand mark only; the top brand line remains title color."],
    ];

    function designRoleTarget(role) {
      const scope = designScopeSelect.value;
      return scope === "global" ? designProfile.global[role] : designProfile.nodes[scope][role];
    }

    function setDesignRole(role, value) {
      const scope = designScopeSelect.value;
      if (scope === "global") designProfile.global[role] = value;
      else designProfile.nodes[scope][role] = value;
    }

    function colorControls(role, initial, disabled = false) {
      const controls = make("div", "email-design-color-controls");
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = initial.hex;
      picker.disabled = disabled;
      picker.setAttribute("aria-label", `${title(role)} color picker`);
      const hex = document.createElement("input");
      hex.type = "text";
      hex.value = initial.hex;
      hex.maxLength = 7;
      hex.pattern = "#[0-9A-F]{6}";
      hex.disabled = disabled;
      hex.setAttribute("aria-label", `${title(role)} canonical hex color`);
      controls.append(picker, hex);
      let opacity = null;
      if (!['canvas', 'panel'].includes(role)) {
        opacity = document.createElement("input");
        opacity.type = "number";
        opacity.min = "0";
        opacity.max = "1";
        opacity.step = "0.01";
        opacity.value = initial.opacity;
        opacity.disabled = disabled;
        opacity.setAttribute("aria-label", `${title(role)} opacity`);
        controls.append(opacity);
      } else {
        controls.append(make("span", "email-design-opaque", "100% opaque"));
      }
      const commit = (nextHex, nextOpacity) => {
        const canonical = String(nextHex || "").toUpperCase();
        if (!/^#[0-9A-F]{6}$/.test(canonical)) return;
        const color = { hex: canonical, opacity: ['canvas', 'panel'].includes(role) ? 1 : Number(nextOpacity) };
        setDesignRole(role, role === "signatureMark" ? { mode: "custom", color } : color);
        picker.value = canonical;
        hex.value = canonical;
        queueRender();
      };
      picker.addEventListener("input", () => commit(picker.value, opacity?.value ?? 1));
      hex.addEventListener("input", () => commit(hex.value, opacity?.value ?? 1));
      opacity?.addEventListener("input", () => commit(hex.value, opacity.value));
      return controls;
    }

    function buildDesignForm() {
      form.replaceChildren();
      tokenHelp.textContent = "Batch roles affect presentation only. Template wording, typography, spacing, borders, width, and node accents remain unchanged.";
      const scope = designScopeSelect.value;
      const node = designDefinition?.nodes?.find((entry) => entry.node === scope);
      nodeAccent.textContent = scope === "global" ? "Node accents remain code-owned" : `Node accent · ${node?.accent || ""}`;
      nodeAccent.style.setProperty("--email-node-accent", node?.accent || "#FCB467");
      DESIGN_ROLES.forEach(([role, labelText, description]) => {
        const roleCard = make("fieldset", "email-design-role");
        const legend = make("legend", "", labelText);
        roleCard.append(legend, make("p", "", description));
        let current = designRoleTarget(role);
        if (scope !== "global") {
          const inherit = make("label", "email-design-inherit");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = current === null;
          inherit.append(checkbox, make("span", "", "Use global"));
          roleCard.append(inherit);
          checkbox.addEventListener("change", () => {
            setDesignRole(role, checkbox.checked ? null : clone(designProfile.global[role]));
            buildDesignForm(); queueRender();
          });
          current ||= designProfile.global[role];
        }
        const inherited = scope !== "global" && designRoleTarget(role) === null;
        if (role === "signatureMark") {
          const signature = make("div", "email-design-signature");
          const select = document.createElement("select");
          option(select, "node-accent", "Use node bright accent");
          option(select, "custom", "Custom color");
          select.value = current.mode;
          select.disabled = inherited;
          signature.append(select);
          if (current.mode === "custom") signature.append(colorControls(role, current.color, inherited));
          select.addEventListener("change", () => {
            setDesignRole(role, select.value === "custom" ? { mode: "custom", color: { hex: "#FBD19D", opacity: 1 } } : { mode: "node-accent" });
            buildDesignForm(); queueRender();
          });
          roleCard.append(signature);
        } else {
          roleCard.append(colorControls(role, current, inherited));
        }
        form.append(roleCard);
      });
    }

    function renderDesignPreviewCards(previews) {
      designPreviews = previews;
      meta.replaceChildren(...previews.map((item) => {
        const row = make("div", "email-preview-meta-row");
        row.append(make("strong", "", item.label), make("span", "", `${item.subject} · ${item.copySource} copy`));
        return row;
      }));
      stage.replaceChildren(...previews.map((item) => {
        const card = make("article", "email-design-preview-card");
        card.append(make("h3", "", `${item.label} representative`));
        const previewFrame = make("div", `email-preview-frame${mobileButton.classList.contains("is-active") ? " is-mobile" : ""}`);
        const previewIframe = document.createElement("iframe");
        previewIframe.title = `${item.label} designed email preview`;
        previewIframe.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
        previewIframe.srcdoc = item.html || "";
        previewFrame.append(previewIframe); card.append(previewFrame); return card;
      }));
    }

    async function renderDesign(profile, source = "working") {
      const payload = await api("/api/admin/notifications/design/preview", {
        method: "POST",
        body: JSON.stringify({ profile, scope: designScopeSelect.value }),
      });
      renderDesignPreviewCards(payload.previews || []);
      setPreviewSource(source);
    }

    async function renderDesignUnsaved() {
      if (!designProfile) return;
      try {
        await renderDesign(designProfile, "working");
        setStatus(`${designScopeSelect.options[designScopeSelect.selectedIndex].text} · ${dirty() ? "unsaved design changes" : designRevision ? `saved batch draft revision ${designRevision}` : "repository defaults loaded as a working copy"}`);
      } catch (error) {
        clearRenderedPreview();
        setStatus(error.payload?.errors?.join(" ") || error.message, true);
      }
    }
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
      clearRenderedPreview();
      setStatus(`Loading ${selected.label} working copy`);
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
        clearRenderedPreview();
        if ([401, 403].includes(error.status)) setStatus("Admin authentication required. Open Studio and enter the bearer token first.", true);
        else setStatus(error.message, true);
      }
    }
    async function loadDesign() {
      try {
        designDefinition = await api("/api/admin/notifications/design");
        const active = designDefinition.draft || designDefinition.published;
        designRevision = designDefinition.draft?.revision || 0;
        designProfile = clone(active?.profile || designDefinition.defaultProfile);
        savedDesignProfile = clone(designProfile);
        buildDesignForm(); updateActions(); await renderDesignUnsaved();
      } catch (error) {
        clearRenderedPreview();
        if ([401, 403].includes(error.status)) setStatus("Admin authentication required. Open Studio and enter the bearer token first.", true);
        else setStatus(error.message, true);
      }
    }

    async function setMode(nextMode) {
      if (nextMode === mode) return;
      if (dirty() && !window.confirm("Switch editor modes and discard the current unsaved changes?")) return;
      mode = nextMode;
      copyModeButton.classList.toggle("is-active", mode === "copy");
      designModeButton.classList.toggle("is-active", mode === "design");
      filters.hidden = mode === "design";
      designToolbar.hidden = mode !== "design";
      formatGroup.hidden = mode === "design";
      plain.hidden = true;
      htmlButton.classList.add("is-active");
      textButton.classList.remove("is-active");
      historyPanel.hidden = true;
      if (mode === "design") {
        await loadDesign();
      } else {
        stage.replaceChildren(frame);
        await loadTemplate();
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
    modeControls.addEventListener("click", (event) => {
      if (event.target.dataset.action === "mode-copy") setMode("copy");
      if (event.target.dataset.action === "mode-design") setMode("design");
    });
    designScopeSelect.addEventListener("change", () => {
      buildDesignForm();
      renderDesignUnsaved();
    });
    form.addEventListener("submit", (event) => event.preventDefault());

    async function handleDesignAction(action) {
      if (action === "discard") {
        startAction(action, "Discarding unsaved design changesâ€¦");
        designProfile = clone(savedDesignProfile);
        buildDesignForm(); await renderDesignUnsaved();
        finishAction("Unsaved design changes discarded.", "success");
        return;
      }
      if (action === "save") {
        startAction(action, "Saving the batch design draftâ€¦");
        const payload = await api("/api/admin/notifications/design/draft", {
          method: "PUT",
          body: JSON.stringify({ profile: designProfile, baseRevision: designRevision || designDefinition.published?.revision || 0 }),
        });
        designRevision = payload.draft.revision;
        savedDesignProfile = clone(payload.draft.profile);
        designDefinition.draft = payload.draft;
        finishAction(`Batch design draft saved · revision ${designRevision}.`, "success");
        setStatus(`Design System · saved batch draft revision ${designRevision}`);
        return;
      }
      if (action === "publish") {
        if (!confirm("Publish this complete email design profile for Tattoo, Art, Events, and Studio?")) return;
        const publishingRevision = designRevision;
        startAction(action, `Publishing batch revision ${publishingRevision}â€¦`);
        await api("/api/admin/notifications/design/publish", { method: "POST", body: JSON.stringify({ revision: publishingRevision }) });
        await loadDesign();
        finishAction(`Batch design revision ${publishingRevision} is published and live.`, "success");
        return;
      }
      if (action === "test") {
        startAction(action, `Sending ${designScopeSelect.value === "global" ? "four" : "one"} design test email${designScopeSelect.value === "global" ? "s" : ""}â€¦`);
        const payload = await api("/api/admin/notifications/design/test", {
          method: "POST",
          body: JSON.stringify({ revision: designRevision, scope: designScopeSelect.value }),
        });
        finishAction(`${payload.deliveries?.length || 0} design test email${payload.deliveries?.length === 1 ? "" : "s"} sent to ${payload.recipient}.`, "success");
        setStatus("Protected design test batch sent.");
        return;
      }
      if (action === "history") {
        startAction(action, "Loading design revision historyâ€¦");
        const payload = await api("/api/admin/notifications/design/history");
        historyPanel.hidden = !historyPanel.hidden;
        historyPanel.replaceChildren(...(payload.history || []).map((item) => {
          const row = make("div", "email-preview-history-row", `Batch revision ${item.revision} · ${item.status} · ${item.updated_at}`);
          const restore = button("Restore as Draft", "restore");
          restore.dataset.revision = item.revision;
          row.append(restore);
          return row;
        }));
        finishAction(historyPanel.hidden ? "Design revision history closed." : "Design revision history loaded.", "success");
      }
    }

    actions.addEventListener("click", async (event) => {
      const action = event.target.dataset.action; if (!action || pendingAction || (mode === "copy" && !selected)) return;
      if (mode === "design") {
        try {
          await handleDesignAction(action);
        } catch (error) {
          const message = error.payload?.errors?.join(" ") || error.message;
          setStatus(message, true);
          finishAction(`${title(action)} failed: ${message}`, "error");
        }
        return;
      }
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
        if (mode === "design") {
          const payload = await api("/api/admin/notifications/design/restore", {
            method: "POST",
            body: JSON.stringify({ revision: Number(event.target.dataset.revision), baseRevision: designRevision || designDefinition.published?.revision || 0 }),
          });
          designRevision = payload.draft.revision;
          designProfile = clone(payload.draft.profile);
          savedDesignProfile = clone(payload.draft.profile);
          designDefinition.draft = payload.draft;
          historyPanel.hidden = true;
          buildDesignForm(); await renderDesignUnsaved(); updateActions();
          setActionStatus(`Revision ${event.target.dataset.revision} restored as batch draft ${designRevision}.`, "success");
          return;
        }
        const endpoint = `/api/admin/notifications/templates/${encodeURIComponent(selected.templateKey)}/restore?variant=${encodeURIComponent(selected.variant)}`;
        await api(endpoint, { method: "POST", body: JSON.stringify({ revision: Number(event.target.dataset.revision), baseRevision: revision || definition.published?.revision || 0 }) });
        historyPanel.hidden = true; await refreshCatalog(id(selected));
      } catch (error) { setStatus(error.message, true); }
    });
    displayControls.addEventListener("click", async (event) => {
      const action = event.target.dataset.action; if (!action) return;
      if (action === "desktop" || action === "mobile") {
        stage.querySelectorAll(".email-preview-frame").forEach((item) => item.classList.toggle("is-mobile", action === "mobile"));
      }
      if (action === "html" || action === "text") { iframe.hidden = action === "text"; plain.hidden = action === "html"; }
      if (action === "working") await (mode === "design" ? renderDesignUnsaved() : renderUnsaved());
      if (action === "published") {
        if (mode === "design") {
          try {
            const liveProfile = designDefinition.published?.profile || designDefinition.defaultProfile;
            await renderDesign(liveProfile, "published");
            setStatus(designDefinition.published
              ? `Design System · published batch revision ${designDefinition.published.revision} · live email version`
              : "Design System · repository fallback profile · live email version");
          } catch (error) { setStatus(error.message, true); }
          return;
        }
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
