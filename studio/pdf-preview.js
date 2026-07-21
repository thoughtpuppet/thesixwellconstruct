(function () {
  const root = document.querySelector("[data-pdf-preview]");
  if (!root) return;
  const TOKEN_KEY = "swc_submissions_admin_token";
  const token = localStorage.getItem(TOKEN_KEY) || "";
  const make = (tag, className = "", label = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label) node.textContent = label;
    return node;
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
  const set = (object, path, value) => {
    const parts = path.split(".");
    const leaf = parts.pop();
    let cursor = object;
    parts.forEach((part) => { cursor[part] ||= {}; cursor = cursor[part]; });
    cursor[leaf] = value;
  };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const headers = () => ({ Accept: "application/json", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) });

  let catalog = [];
  let definition = null;
  let content = null;
  let savedContent = null;
  let revision = 0;
  let publishedRevision = 0;
  let source = "working";
  let previewTimer = 0;
  let previewUrl = "";
  let previewBlob = null;

  const status = make("div", "pdf-preview-status", token ? "Loading PDF templates" : "Studio admin token required - open Studio and unlock it first");
  const toolbar = make("div", "pdf-toolbar");
  const templateControl = make("label", "pdf-control");
  templateControl.append(make("span", "", "Template"));
  const templateSelect = document.createElement("select");
  templateControl.append(templateSelect);
  toolbar.append(templateControl);
  const layout = make("div", "pdf-layout");
  const editor = make("section", "pdf-editor");
  const form = make("form", "pdf-form");
  const actions = make("div", "pdf-actions");
  const output = make("section", "pdf-output");
  const sourceControls = make("div", "pdf-source-controls");
  const sourceGroup = make("div", "pdf-source-group");
  const workingButton = make("button", "is-active", "Working Copy");
  const liveButton = make("button", "", "Live Version");
  const downloadButton = make("button", "", "Download Sample PDF");
  [workingButton, liveButton, downloadButton].forEach((button) => { button.type = "button"; });
  sourceGroup.append(workingButton, liveButton);
  sourceControls.append(sourceGroup, downloadButton);
  const frame = make("div", "pdf-frame");
  const iframe = document.createElement("iframe");
  iframe.title = "Rendered client brief PDF preview";
  frame.append(iframe);
  const saveButton = make("button", "", "Save Draft");
  const discardButton = make("button", "", "Discard Changes");
  const publishButton = make("button", "", "Publish");
  const historyButton = make("button", "", "Revision History");
  [saveButton, discardButton, publishButton, historyButton].forEach((button) => { button.type = "button"; });
  const actionStatus = make("div", "pdf-action-status", "Ready");
  const history = make("div", "pdf-history");
  history.hidden = true;
  actions.append(saveButton, discardButton, publishButton, historyButton, actionStatus);
  editor.append(form, actions, history);
  output.append(sourceControls, frame);
  layout.append(editor, output);
  root.append(status, toolbar, layout);

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  }
  function setAction(message, tone = "") {
    actionStatus.textContent = message;
    actionStatus.classList.toggle("is-error", tone === "error");
    actionStatus.classList.toggle("is-success", tone === "success");
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { cache: "no-store", ...options, headers: { ...headers(), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status}).`);
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return payload;
  }
  function selectedKey() { return templateSelect.value; }
  function activePreviewContent() {
    if (source === "working") return content;
    return definition?.published?.content || definition?.defaultContent;
  }
  function updateActions() {
    const dirty = Boolean(content && savedContent && !same(content, savedContent));
    saveButton.disabled = !dirty;
    discardButton.disabled = !dirty && !definition?.draft;
    publishButton.disabled = dirty || !definition?.draft;
    downloadButton.disabled = !previewBlob;
  }
  function replacePreview(blob) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewBlob = blob;
    previewUrl = URL.createObjectURL(blob);
    iframe.src = previewUrl;
    updateActions();
  }
  async function renderPreview() {
    const selectedContent = activePreviewContent();
    if (!selectedContent) return;
    setStatus(source === "working" ? "Rendering working-copy PDF" : "Rendering live PDF");
    try {
      const response = await fetch("/api/admin/brief-templates/preview", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ templateKey: selectedKey(), content: selectedContent }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `PDF preview failed (${response.status}).`);
      }
      replacePreview(await response.blob());
      setStatus(`${source === "working" ? "Working copy" : "Live version"} rendered with fixed sample data`);
    } catch (error) {
      previewBlob = null;
      iframe.removeAttribute("src");
      updateActions();
      const message = /quickAction|RPC receiver/i.test(error.message)
        ? "PDF rendering requires the remote Cloudflare Browser binding. Editing remains available locally."
        : error.message;
      setStatus(message, true);
    }
  }
  function schedulePreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, 650);
  }
  function inputFor(field) {
    const wrap = make("label", "pdf-field");
    wrap.append(make("span", "", field.label));
    const control = field.type === "textarea" ? document.createElement("textarea") : field.type === "select" ? document.createElement("select") : document.createElement("input");
    if (field.type === "select") {
      (field.options || []).forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        control.append(option);
      });
    } else if (field.type !== "textarea") {
      control.type = "text";
    }
    control.value = get(content, field.path) || "";
    control.addEventListener("input", () => {
      set(content, field.path, control.value);
      source = "working";
      workingButton.classList.add("is-active");
      liveButton.classList.remove("is-active");
      updateActions();
      schedulePreview();
    });
    wrap.append(control);
    return wrap;
  }
  function renderForm() {
    form.replaceChildren(...(definition?.schema?.fields || []).map(inputFor));
    updateActions();
  }
  async function loadDefinition() {
    if (!selectedKey()) return;
    setStatus("Loading PDF template");
    try {
      definition = await api(`/api/admin/brief-templates/${encodeURIComponent(selectedKey())}`);
      const selected = definition.draft?.content || definition.published?.content || definition.defaultContent;
      content = clone(selected);
      savedContent = clone(selected);
      revision = Number(definition.draft?.revision || definition.published?.revision || 0);
      publishedRevision = Number(definition.published?.revision || 0);
      source = "working";
      workingButton.classList.add("is-active");
      liveButton.classList.remove("is-active");
      history.hidden = true;
      renderForm();
      await renderPreview();
    } catch (error) {
      setStatus(error.message, true);
    }
  }
  async function loadCatalog() {
    if (!token) return;
    try {
      const payload = await api("/api/admin/brief-templates");
      catalog = payload.templates || [];
      templateSelect.replaceChildren(...catalog.map((entry) => {
        const option = document.createElement("option");
        option.value = entry.templateKey;
        option.textContent = `${entry.label} - ${entry.status}`;
        return option;
      }));
      await loadDefinition();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  templateSelect.addEventListener("change", loadDefinition);
  workingButton.addEventListener("click", async () => {
    source = "working";
    workingButton.classList.add("is-active");
    liveButton.classList.remove("is-active");
    await renderPreview();
  });
  liveButton.addEventListener("click", async () => {
    source = "published";
    liveButton.classList.add("is-active");
    workingButton.classList.remove("is-active");
    await renderPreview();
  });
  saveButton.addEventListener("click", async () => {
    setAction("Saving draft");
    try {
      const payload = await api(`/api/admin/brief-templates/${encodeURIComponent(selectedKey())}/draft`, {
        method: "PUT",
        body: JSON.stringify({ content, baseRevision: revision }),
      });
      definition.draft = payload.draft;
      revision = Number(payload.draft.revision);
      savedContent = clone(payload.draft.content);
      updateActions();
      setAction(`Draft revision ${revision} saved`, "success");
    } catch (error) {
      setAction(error.status === 409 ? "Stale draft - reload before saving" : error.message, "error");
    }
  });
  discardButton.addEventListener("click", async () => {
    const dirty = !same(content, savedContent);
    if (dirty) {
      content = clone(savedContent);
      renderForm();
      await renderPreview();
      setAction("Unsaved changes discarded", "success");
      return;
    }
    if (!definition?.draft) return;
    if (!window.confirm("Discard this saved PDF template draft? The live version will not change.")) return;
    try {
      await api(`/api/admin/brief-templates/${encodeURIComponent(selectedKey())}/discard`, {
        method: "POST",
        body: JSON.stringify({ revision: definition.draft.revision }),
      });
      await loadDefinition();
      setAction("Saved draft discarded", "success");
    } catch (error) {
      setAction(error.message, "error");
    }
  });
  publishButton.addEventListener("click", async () => {
    if (!definition?.draft || !window.confirm("Publish this PDF template for future Build or Maze submissions? Existing PDFs remain unchanged.")) return;
    setAction("Publishing PDF template");
    try {
      const payload = await api(`/api/admin/brief-templates/${encodeURIComponent(selectedKey())}/publish`, {
        method: "POST",
        body: JSON.stringify({ revision: definition.draft.revision }),
      });
      definition.published = payload.published;
      definition.draft = null;
      publishedRevision = Number(payload.published.revision);
      revision = publishedRevision;
      savedContent = clone(payload.published.content);
      content = clone(savedContent);
      renderForm();
      setAction(`Revision ${publishedRevision} is live for future PDFs`, "success");
    } catch (error) {
      setAction(error.status === 409 ? "Draft changed elsewhere - reload before publishing" : error.message, "error");
    }
  });
  historyButton.addEventListener("click", async () => {
    if (!history.hidden) { history.hidden = true; return; }
    setAction("Loading revision history");
    try {
      const payload = await api(`/api/admin/brief-templates/${encodeURIComponent(selectedKey())}/history`);
      history.replaceChildren(...(payload.history || []).map((entry) => {
        const row = make("div", "pdf-history-row");
        row.append(make("span", "", `Revision ${entry.revision} - ${entry.status} - ${new Date(entry.updated_at).toLocaleString()}`));
        const restore = make("button", "", "Restore as Draft");
        restore.type = "button";
        restore.addEventListener("click", async () => {
          try {
            await api(`/api/admin/brief-templates/${encodeURIComponent(selectedKey())}/restore`, {
              method: "POST",
              body: JSON.stringify({ revision: entry.revision, baseRevision: revision }),
            });
            await loadDefinition();
            setAction(`Revision ${entry.revision} restored as a new draft`, "success");
          } catch (error) {
            setAction(error.message, "error");
          }
        });
        row.append(restore);
        return row;
      }));
      history.hidden = false;
      setAction("Revision history loaded", "success");
    } catch (error) {
      setAction(error.message, "error");
    }
  });
  downloadButton.addEventListener("click", () => {
    if (!previewBlob) return;
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(previewBlob);
    anchor.download = `${selectedKey()}-sample.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  });
  window.addEventListener("beforeunload", () => { if (previewUrl) URL.revokeObjectURL(previewUrl); });
  loadCatalog();
})();
