(() => {
  const root = document.getElementById("detailPane");
  if (!root) return;
  root.dataset.adminCollapseReady = "true";

  // Studio-wide contract: semantic sections and native details inside the
  // detail pane are collapsible automatically. Future panels only need to use
  // <section> or <details>; data-admin-section-title can supply a custom label.
  const sectionSelector = [
    "section:not(#detailPane):not([data-collapse-section])",
    ".review-card",
    ".assist-panel",
    ".session-plan-editor",
    ".appt-day-panel",
    ".cm-media-drop",
    ".portfolio-drop",
  ].join(",");
  const customSelector = "[data-collapse-section],.detail-section";
  const storagePrefix = "swc-studio-section:";
  let controlSequence = 0;

  function normalized(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";
  }

  function directChild(element, selectors) {
    return [...element.children].find((child) => child.matches(selectors)) || null;
  }

  function sectionTitle(element) {
    if (element.dataset.adminSectionTitle) return element.dataset.adminSectionTitle;
    const heading = element.querySelector("h1,h2,h3,h4");
    if (heading?.textContent.trim()) return heading.textContent.trim();
    const named = element.querySelector(".review-card-header,.appt-day-label,.section-toggle,.detail-section-toggle");
    if (named?.textContent.trim()) return named.textContent.trim();
    const firstLabel = element.querySelector("label,strong");
    if (firstLabel?.textContent.trim()) return firstLabel.textContent.trim();
    if (element.getAttribute("aria-label")) return element.getAttribute("aria-label");
    if (element.classList.contains("portfolio-drop")) return "Portfolio uploads";
    if (element.classList.contains("cm-media-drop")) return "Media upload";
    if (element.classList.contains("assist-panel")) return "Client communication";
    if (element.classList.contains("appt-day-panel")) return "Day details";
    return "Section";
  }

  function contextKey(element) {
    const tab = document.querySelector(".tab.is-active")?.dataset.tab || "console";
    const subview = document.querySelector(".subnav-btn.is-active")?.dataset.subview || "main";
    const record = element.closest("[data-portfolio-card],[data-record],[data-id]");
    const recordId = record?.dataset.portfolioCard || record?.dataset.record || record?.dataset.id || "";
    const explicit = element.dataset.adminCollapseKey
      || element.id
      || element.dataset.optionGroup
      || element.dataset.angleManager
      || normalized(sectionTitle(element));
    return `${storagePrefix}${normalized(tab)}:${normalized(subview)}:${normalized(recordId)}:${normalized(explicit)}`;
  }

  function storedState(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function rememberState(key, open) {
    try { localStorage.setItem(key, open ? "open" : "closed"); } catch {}
  }

  function collapseButton(title) {
    const button = document.createElement("button");
    button.className = "admin-collapse-toggle";
    button.type = "button";
    button.innerHTML = '<span class="admin-collapse-label">Collapse</span>';
    button.dataset.adminCollapseControl = "";
    button.setAttribute("aria-label", `Collapse ${title}`);
    button.setAttribute("aria-expanded", "true");
    return button;
  }

  function buildHeading(element, title, button) {
    const reusable = directChild(element, ".review-card-header,.portfolio-head,.cm-head,.appt-day-header,.detail-head,.cm-row");
    if (reusable) {
      reusable.classList.add("admin-collapse-heading");
      reusable.append(button);
      return reusable;
    }

    const existingHeading = directChild(element, "h1,h2,h3,h4");
    const titledContainer = !existingHeading
      ? [...element.children].find((child) => !child.matches("form") && child.querySelector("h1,h2,h3,h4"))
      : null;
    const heading = document.createElement("div");
    heading.className = "admin-collapse-heading";
    if (existingHeading) heading.append(existingHeading);
    else if (titledContainer) heading.append(titledContainer);
    else {
      const label = document.createElement("strong");
      label.textContent = title;
      heading.append(label);
    }
    heading.append(button);
    element.prepend(heading);
    return heading;
  }

  function setGenericState(element, body, button, title, key, collapsed, persist = false) {
    element.dataset.adminCollapsed = String(collapsed);
    body.hidden = collapsed;
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${title}`);
    const label = button.querySelector(".admin-collapse-label");
    if (label) label.textContent = collapsed ? "Expand" : "Collapse";
    if (persist) rememberState(key, !collapsed);
  }

  function enhanceSection(element) {
    if (!(element instanceof Element) || !element.matches(sectionSelector)) return;
    if (element.querySelector(":scope > .admin-collapse-heading > [data-admin-collapse-control]")) return;

    const staleBody = directChild(element, ".admin-collapse-body");
    if (staleBody) staleBody.replaceWith(...staleBody.childNodes);
    const staleGeneratedHeading = directChild(element, ".admin-collapse-heading");
    if (staleGeneratedHeading && !staleGeneratedHeading.matches(".review-card-header,.portfolio-head,.cm-head,.appt-day-header,.detail-head,.cm-row")) {
      staleGeneratedHeading.replaceWith(...staleGeneratedHeading.childNodes);
    }

    const title = sectionTitle(element);
    const key = element.dataset.adminCollapseStorageKey || contextKey(element);
    element.dataset.adminCollapseStorageKey = key;
    const button = collapseButton(title);
    const heading = buildHeading(element, title, button);
    const body = document.createElement("div");
    body.className = "admin-collapse-body";
    body.id = `admin-section-body-${++controlSequence}`;
    [...element.childNodes].filter((node) => node !== heading).forEach((node) => body.append(node));
    element.append(body);
    button.setAttribute("aria-controls", body.id);

    const stored = storedState(key);
    const collapsed = stored === "closed" || (stored === null && element.dataset.adminDefault === "closed");
    setGenericState(element, body, button, title, key, collapsed);
    button.addEventListener("click", () => setGenericState(element, body, button, title, key, element.dataset.adminCollapsed !== "true", true));
  }

  function enhanceDetails(details) {
    if (!(details instanceof HTMLDetailsElement) || details.dataset.adminDetailsReady === "true") return;
    const summary = details.querySelector(":scope > summary");
    if (!summary) return;
    details.dataset.adminDetailsReady = "true";
    details.classList.add("admin-native-section");
    const key = contextKey(details);
    const stored = storedState(key);
    if (stored) details.open = stored === "open";
    summary.setAttribute("aria-expanded", String(details.open));
    details.addEventListener("toggle", () => {
      summary.setAttribute("aria-expanded", String(details.open));
      rememberState(key, details.open);
    });
  }

  function syncCustomState(section, button, body, openClass, persist = false) {
    const open = section.classList.contains(openClass);
    button.setAttribute("aria-expanded", String(open));
    if (!body.id) body.id = `admin-section-body-${++controlSequence}`;
    button.setAttribute("aria-controls", body.id);
    if (persist) rememberState(contextKey(section), open);
  }

  function enhanceCustom(section) {
    if (!(section instanceof Element) || !section.matches(customSelector) || section.dataset.adminCustomReady === "true") return;
    const schedule = section.matches("[data-collapse-section]");
    const button = section.querySelector(schedule ? ":scope > .section-toggle" : ":scope > .detail-section-toggle");
    const body = section.querySelector(schedule ? ":scope > .section-body" : ":scope > .detail-section-body");
    if (!button || !body) return;
    section.dataset.adminCustomReady = "true";
    const key = contextKey(section);
    const stored = storedState(key);
    if (stored) section.classList.toggle("is-open", stored === "open");
    syncCustomState(section, button, body, "is-open");
    button.addEventListener("click", () => queueMicrotask(() => syncCustomState(section, button, body, "is-open", true)));
  }

  function enhanceTree(node = root) {
    if (!(node instanceof Element) && node !== document) return;
    if (node instanceof Element) {
      enhanceSection(node);
      enhanceDetails(node);
      enhanceCustom(node);
    }
    node.querySelectorAll?.(sectionSelector).forEach(enhanceSection);
    node.querySelectorAll?.("details").forEach(enhanceDetails);
    node.querySelectorAll?.(customSelector).forEach(enhanceCustom);
  }

  enhanceTree(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      enhanceSection(mutation.target);
      enhanceDetails(mutation.target);
      enhanceCustom(mutation.target);
      mutation.addedNodes.forEach((node) => enhanceTree(node));
    }
  });
  observer.observe(root, { childList:true, subtree:true });

  window.StudioAdminCollapse = {
    enhance: enhanceTree,
    collapseAll(scope = root) {
      scope.querySelectorAll("[data-admin-collapsed]").forEach((section) => {
        const body = directChild(section, ".admin-collapse-body");
        const button = section.querySelector(":scope > .admin-collapse-heading > [data-admin-collapse-control]");
        if (body && button) setGenericState(section, body, button, sectionTitle(section), section.dataset.adminCollapseStorageKey || contextKey(section), true, true);
      });
    },
    expandAll(scope = root) {
      scope.querySelectorAll("[data-admin-collapsed]").forEach((section) => {
        const body = directChild(section, ".admin-collapse-body");
        const button = section.querySelector(":scope > .admin-collapse-heading > [data-admin-collapse-control]");
        if (body && button) setGenericState(section, body, button, sectionTitle(section), section.dataset.adminCollapseStorageKey || contextKey(section), false, true);
      });
    },
  };
})();
