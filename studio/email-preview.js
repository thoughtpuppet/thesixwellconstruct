(function () {
  const TOKEN_KEY = "swc_submissions_admin_token";

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function option(select, value, label) {
    const entry = document.createElement("option");
    entry.value = value;
    entry.textContent = label;
    select.appendChild(entry);
  }

  function titleCase(value) {
    return String(value || "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function init(root) {
    const allowedBrands = new Set(
      String(root.dataset.brands || "")
        .split(",")
        .map((brand) => brand.trim())
        .filter(Boolean),
    );
    const token = localStorage.getItem(TOKEN_KEY) || "";
    let catalog = [];
    let filtered = [];
    let activeTab = "html";
    let viewport = "desktop";

    const status = createElement("div", "email-preview-status", "Loading production templates");
    const toolbar = createElement("div", "email-preview-toolbar");
    const templateControl = createElement("div", "email-preview-control");
    const templateLabel = createElement("label", "", "Template");
    const templateSelect = createElement("select");
    const brandControl = createElement("div", "email-preview-control");
    const brandLabel = createElement("label", "", "Brand");
    const brandSelect = createElement("select");
    const stageControl = createElement("div", "email-preview-control");
    const stageLabel = createElement("label", "", "Journey stage");
    const stageSelect = createElement("select");
    const modeRow = createElement("div", "email-preview-toolbar");
    const viewportControl = createElement("div", "email-preview-control");
    const viewportLabel = createElement("label", "", "Viewport");
    const viewportButtons = createElement("div", "email-preview-viewport");
    const desktopButton = createElement("button", "is-active", "Desktop");
    desktopButton.type = "button";
    const mobileButton = createElement("button", "", "Mobile");
    mobileButton.type = "button";
    const tabControl = createElement("div", "email-preview-control");
    const tabLabel = createElement("label", "", "Format");
    const tabButtons = createElement("div", "email-preview-tabs");
    const htmlButton = createElement("button", "is-active", "Rendered HTML");
    htmlButton.type = "button";
    const textButton = createElement("button", "", "Plain text");
    textButton.type = "button";
    const meta = createElement("div", "email-preview-meta");
    const subjectRow = createElement("div", "email-preview-meta-row");
    const subjectLabel = createElement("strong", "", "Subject");
    const subjectValue = createElement("span");
    const preheaderRow = createElement("div", "email-preview-meta-row");
    const preheaderLabel = createElement("strong", "", "Preheader");
    const preheaderValue = createElement("span");
    const stage = createElement("div", "email-preview-stage");
    const frame = createElement("div", "email-preview-frame");
    const iframe = document.createElement("iframe");
    iframe.title = "Rendered transactional email preview";
    iframe.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    const plainText = createElement("pre", "email-preview-text");
    plainText.hidden = true;

    templateControl.append(templateLabel, templateSelect);
    brandControl.append(brandLabel, brandSelect);
    stageControl.append(stageLabel, stageSelect);
    toolbar.append(templateControl, brandControl, stageControl);
    viewportButtons.append(desktopButton, mobileButton);
    viewportControl.append(viewportLabel, viewportButtons);
    tabButtons.append(htmlButton, textButton);
    tabControl.append(tabLabel, tabButtons);
    modeRow.append(viewportControl, tabControl);
    subjectRow.append(subjectLabel, subjectValue);
    preheaderRow.append(preheaderLabel, preheaderValue);
    meta.append(subjectRow, preheaderRow);
    frame.append(iframe, plainText);
    stage.append(frame);
    root.replaceChildren(status, toolbar, modeRow, meta, stage);

    function setStatus(message, error = false) {
      status.textContent = message;
      status.classList.toggle("is-error", error);
    }

    async function api(params = "") {
      const headers = { Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`/api/admin/notifications/preview${params}`, {
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `Preview request failed (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return payload;
    }

    function renderAuthError() {
      const auth = createElement("div", "email-preview-auth");
      const copy = createElement("p", "", "The production email preview endpoint is protected. Open Studio, enter the admin token, then return to this preview.");
      const link = createElement("a", "", "Open Studio");
      link.href = "/studio/submissions/";
      auth.append(copy, link);
      stage.replaceChildren(auth);
      meta.hidden = true;
      modeRow.hidden = true;
    }

    function rebuildFilters() {
      const brands = [...new Set(catalog.map((entry) => entry.brand))];
      const stages = [...new Set(catalog.map((entry) => entry.stage))];
      brandSelect.replaceChildren();
      stageSelect.replaceChildren();
      option(brandSelect, "", "All brands");
      brands.forEach((brand) => option(brandSelect, brand, titleCase(brand)));
      option(stageSelect, "", "All stages");
      stages.forEach((journeyStage) => option(stageSelect, journeyStage, titleCase(journeyStage)));
    }

    function rebuildTemplates(preferredId = "") {
      const brand = brandSelect.value;
      const journeyStage = stageSelect.value;
      filtered = catalog.filter((entry) => (
        (!brand || entry.brand === brand)
        && (!journeyStage || entry.stage === journeyStage)
      ));
      templateSelect.replaceChildren();
      filtered.forEach((entry) => {
        const id = `${entry.templateKey}:${entry.variant}`;
        option(templateSelect, id, `${entry.label} · ${entry.variant || "default"}`);
      });
      const preferredExists = filtered.some((entry) => `${entry.templateKey}:${entry.variant}` === preferredId);
      if (preferredExists) templateSelect.value = preferredId;
      loadSelected();
    }

    async function loadSelected() {
      const selectedId = templateSelect.value;
      const selected = filtered.find((entry) => `${entry.templateKey}:${entry.variant}` === selectedId);
      if (!selected) {
        setStatus("No templates match the selected filters", true);
        subjectValue.textContent = "";
        preheaderValue.textContent = "";
        iframe.srcdoc = "";
        plainText.textContent = "";
        return;
      }
      setStatus(`Rendering ${selected.label}`);
      try {
        const params = new URLSearchParams({
          templateKey: selected.templateKey,
          variant: selected.variant,
        });
        const payload = await api(`?${params}`);
        subjectValue.textContent = payload.subject || "";
        preheaderValue.textContent = payload.preheader || "";
        iframe.srcdoc = payload.html || "";
        plainText.textContent = payload.text || "";
        setStatus(`${payload.theme || selected.brand} · exact production renderer`);
      } catch (error) {
        if (error.status === 401 || error.status === 403) {
          renderAuthError();
          setStatus("Admin authentication required", true);
          return;
        }
        setStatus(error.message, true);
      }
    }

    function setViewport(nextViewport) {
      viewport = nextViewport;
      frame.classList.toggle("is-mobile", viewport === "mobile");
      desktopButton.classList.toggle("is-active", viewport === "desktop");
      mobileButton.classList.toggle("is-active", viewport === "mobile");
    }

    function setTab(nextTab) {
      activeTab = nextTab;
      iframe.hidden = activeTab !== "html";
      plainText.hidden = activeTab !== "text";
      htmlButton.classList.toggle("is-active", activeTab === "html");
      textButton.classList.toggle("is-active", activeTab === "text");
    }

    brandSelect.addEventListener("change", () => rebuildTemplates());
    stageSelect.addEventListener("change", () => rebuildTemplates());
    templateSelect.addEventListener("change", loadSelected);
    desktopButton.addEventListener("click", () => setViewport("desktop"));
    mobileButton.addEventListener("click", () => setViewport("mobile"));
    htmlButton.addEventListener("click", () => setTab("html"));
    textButton.addEventListener("click", () => setTab("text"));

    api()
      .then((payload) => {
        catalog = Array.isArray(payload.templates) ? payload.templates : [];
        if (allowedBrands.size) {
          catalog = catalog.filter((entry) => allowedBrands.has(entry.brand));
        }
        rebuildFilters();
        rebuildTemplates();
        if (!catalog.length) setStatus("No production templates are available", true);
      })
      .catch((error) => {
        if (error.status === 401 || error.status === 403) {
          renderAuthError();
          setStatus("Admin authentication required", true);
          return;
        }
        setStatus(error.message, true);
      });
  }

  document.querySelectorAll("[data-email-preview]").forEach(init);
})();
