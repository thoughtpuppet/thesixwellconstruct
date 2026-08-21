import { isPageVisibilityHomePath } from "/shared/page-visibility.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function effectiveLabel(page) {
  if (page.homeOnly) return "Hidden · home-only";
  if (page.hidden && page.inherited) return `Hidden by ${page.sourcePath}`;
  if (page.hidden) return page.scope === "descendants" ? "Hidden · descendants" : "Hidden";
  if (page.sourcePath && page.visibility === "public") return page.inherited ? `Public via ${page.sourcePath}` : "Public override";
  return "Public";
}

function pageCard(page, homeOnly) {
  const isHome = isPageVisibilityHomePath(page.path);
  const disabled = isHome || homeOnly;
  const action = page.hidden ? "public" : "hidden";
  const actionLabel = page.hidden ? "Show page" : "Hide page";
  const selectedScope = page.sourcePath === page.path ? page.scope : "exact";
  return `
    <article class="cm-visibility-card${page.hidden ? " is-hidden" : ""}" data-page-path="${escapeHtml(page.path)}">
      <div class="cm-visibility-card-head">
        <div>
          <h3>${escapeHtml(page.label)}</h3>
          <code>${escapeHtml(page.path)}</code>
        </div>
        <span class="cm-visibility-badge">${escapeHtml(effectiveLabel(page))}</span>
      </div>
      <div class="cm-visibility-controls">
        <label>Scope
          <select data-visibility-scope${disabled ? " disabled" : ""}>
            <option value="exact"${selectedScope === "exact" ? " selected" : ""}>Exact page</option>
            <option value="descendants"${selectedScope === "descendants" ? " selected" : ""}>Include descendants</option>
          </select>
        </label>
        <button class="button${page.hidden ? "" : " danger-button"}" type="button" data-visibility-set="${action}"${disabled ? " disabled" : ""}>${isHome ? "Always public" : homeOnly ? "Home-only mode" : actionLabel}</button>
      </div>
    </article>`;
}

export async function mountPageVisibility(root, api, setStudioStatus = () => {}) {
  let payload = null;

  function announce(message) {
    const output = root.querySelector("[data-visibility-status]");
    if (output) output.textContent = message;
    setStudioStatus(message);
  }

  function paint() {
    root.innerHTML = `
      <section class="construct-manager cm-visibility-manager">
        <div class="cm-head">
          <div>
            <span class="cm-section-index">Site control</span>
            <h2>Public Visibility</h2>
            <p class="cm-summary">Control which deployed public pages resolve for visitors. Changes are live immediately; record publication, navigation, search, APIs, assets, and private links remain separate.</p>
          </div>
          <div class="cm-head-actions">
            <button class="button" type="button" data-visibility-reload>Reload</button>
            <button class="button danger-button" type="button" data-visibility-home-only${payload.homeOnly ? " disabled" : ""}>${payload.homeOnly ? "Home-only mode on" : "Hide all except home"}</button>
            <button class="button" type="button" data-visibility-show-all>Show all pages</button>
          </div>
        </div>
        <p class="cm-visibility-status" data-visibility-status aria-live="polite">${payload.homeOnly ? "Home-only mode is active." : "Visibility state loaded from D1."}</p>
        <div class="cm-visibility-grid">${payload.pages.map((page) => pageCard(page, payload.homeOnly)).join("")}</div>
      </section>`;

    const shell = root.querySelector(".cm-visibility-manager");
    shell.addEventListener("click", async (event) => {
      const reload = event.target.closest("[data-visibility-reload]");
      const homeOnly = event.target.closest("[data-visibility-home-only]");
      const showAll = event.target.closest("[data-visibility-show-all]");
      const setButton = event.target.closest("[data-visibility-set]");
      if (!reload && !homeOnly && !showAll && !setButton) return;
      const button = reload || homeOnly || showAll || setButton;
      button.disabled = true;
      try {
        if (reload) {
          announce("Reloading visibility state…");
          payload = await api("/api/admin/site-visibility");
          paint();
          announce("Visibility state reloaded.");
          return;
        }
        let body;
        let message;
        if (homeOnly) {
          body = { action: "home-only", enabled: true };
          message = "Only Home is public now.";
        } else if (showAll) {
          body = { action: "show-all" };
          message = "All registered pages are public now.";
        } else {
          const card = setButton.closest("[data-page-path]");
          const visibility = setButton.dataset.visibilitySet;
          const scope = card.querySelector("[data-visibility-scope]").value;
          body = { action: "set", path: card.dataset.pagePath, visibility, scope };
          message = `${card.dataset.pagePath} is ${visibility}${scope === "descendants" ? " with descendant scope" : ""} now.`;
        }
        announce("Saving live visibility…");
        payload = await api("/api/admin/site-visibility", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        paint();
        announce(message);
      } catch (error) {
        button.disabled = false;
        announce(error.message || "Page visibility could not be saved.");
      }
    });
  }

  root.innerHTML = '<section class="construct-manager"><div class="cm-notice">Loading public visibility…</div></section>';
  try {
    payload = await api("/api/admin/site-visibility");
    paint();
  } catch (error) {
    root.innerHTML = `<section class="construct-manager"><div class="cm-notice" data-kind="error">${escapeHtml(error.message || "Public visibility is unavailable.")}</div></section>`;
    setStudioStatus(error.message || "Public visibility is unavailable.");
  }
}
