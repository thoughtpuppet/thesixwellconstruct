(() => {
  const app = document.querySelector("[data-color-material-app]");
  if (!app) return;
  const view = document.body.dataset.colorMaterialView || "library";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const label = (value) => String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const safeUrl = (value) => {
    const candidate = String(value || "").trim();
    if (!candidate) return "";
    try {
      const url = new URL(candidate, location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  const error = (title, body) => `<section class="archive-reference-empty" role="alert"><h1>${esc(title)}</h1><p>${esc(body)}</p><p><a class="archive-button" href="/archive/colors-materials/">Return to Colors &amp; Materials</a></p></section>`;
  async function get(url) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const problem = new Error(payload.error || "The reference library did not answer.");
      problem.status = response.status;
      throw problem;
    }
    return payload;
  }
  function slugFromPath(kind) {
    const parts = location.pathname.split("/").filter(Boolean);
    const index = parts.indexOf(kind);
    return index >= 0 ? decodeURIComponent(parts[index + 1] || "") : "";
  }
  function swatch(profile, fallback = "") {
    const color = profile?.srgb_hex || profile?.srgbHex || fallback;
    return color ? `<span class="archive-swatch" style="--swatch:${esc(color)}" role="img" aria-label="Reference swatch ${esc(color)}"></span>` : "";
  }
  function colorCard(color) {
    return `<a class="archive-reference-card" href="${esc(color.archive_route)}" data-reference-search="${esc(`${color.name} ${color.description} ${color.medium_scope}`.toLowerCase())}"><div>${swatch(color.color_profile)}<span class="archive-reference-kicker">Named color · Version ${Number(color.version_number || 0)}</span><h3>${esc(color.name)}</h3><p>${esc(color.description || "A published authored color recipe.")}</p></div><div class="archive-reference-meta"><span>${esc(label(color.medium_scope))}</span><span>${Number(color.usage_count || 0)} public uses</span><span>${esc(label(color.resulting_finish))}</span></div></a>`;
  }
  function materialCard(material) {
    return `<a class="archive-reference-card" href="${esc(material.archive_route)}" data-reference-kind="${esc(material.material_kind)}" data-reference-search="${esc(`${material.name} ${material.brand} ${material.product_line} ${material.color_name} ${material.product_code} ${material.material_kind}`.toLowerCase())}"><div>${swatch(material.color_profile)}<span class="archive-reference-kicker">${esc(label(material.material_kind))}</span><h3>${esc(material.name)}</h3><p>${esc([material.brand, material.product_line, material.color_name || material.model_name].filter(Boolean).join(" · ") || material.description || "Published Archive reference.")}</p></div><div class="archive-reference-meta"><span>${esc(label(material.medium_scope))}</span>${material.product_code ? `<span>${esc(material.product_code)}</span>` : ""}${material.normalized_finish && material.normalized_finish !== "unspecified" ? `<span>${esc(label(material.normalized_finish))}</span>` : ""}</div></a>`;
  }
  function familyButton(family) {
    return `<button class="archive-color-family" type="button" data-visual-color="${esc(family.slug)}" aria-haspopup="dialog"><span class="archive-color-family-swatch" style="--swatch:${esc(family.swatch_hex)}" aria-hidden="true"></span><span class="archive-color-family-copy"><strong>${esc(family.name)}</strong><span>${Number(family.count || 0)} ${Number(family.count || 0) === 1 ? "work" : "works"}</span></span></button>`;
  }
  function descriptorCard(descriptor) {
    return `<article class="archive-descriptor-card"><span class="archive-reference-kicker">${esc(label(descriptor.kind))}</span><h3>${esc(descriptor.name)}</h3><p>${Number(descriptor.count || 0)} documented ${Number(descriptor.count || 0) === 1 ? "work" : "works"}</p><div class="archive-reference-meta"><span>${Number(descriptor.painting_count || 0)} paintings</span><span>${Number(descriptor.tattoo_count || 0)} tattoos</span><span>${Number(descriptor.flash_count || 0)} flash</span><span>${Number(descriptor.merch_count || 0)} merch</span></div></article>`;
  }
  function workCard(work) {
    const image = safeUrl(work.image);
    return `<a class="archive-color-work" href="${esc(safeUrl(work.route) || "/archive/")}">${image ? `<img src="${esc(image)}" alt="${esc(work.title)}" loading="lazy">` : '<span class="archive-color-work-placeholder" aria-hidden="true"></span>'}<span class="archive-color-work-copy"><span class="archive-reference-kicker">${esc(label(work.type))} · ${esc(label(work.strength))}</span><strong>${esc(work.title)}</strong>${work.date_label ? `<span>${esc(work.date_label)}</span>` : ""}</span></a>`;
  }

  async function library() {
    try {
      const [visualPayload, descriptorPayload, colorsPayload, materialsPayload] = await Promise.all([
        get("/api/archive/visual-color-families"),
        get("/api/archive/work-descriptors"),
        get("/api/archive/colors"),
        get("/api/archive/materials"),
      ]);
      const visualFamilies = visualPayload.families || [];
      const descriptors = descriptorPayload.descriptors || [];
      const colors = colorsPayload.colors || [];
      const materials = materialsPayload.materials || [];
      app.innerHTML = `<header class="archive-reference-hero site-hero site-hero--landing"><div><span class="archive-kicker">Archive reference library</span><h1 class="hero-title">Colors &amp; Materials</h1></div><p class="hero-descriptor">Named mixtures, direct products, declared pigments, finishes, tools, supports, and other reviewed evidence shared across Art and Tattoo.</p></header>
        <section class="archive-reference-section archive-visual-family-section" aria-labelledby="visual-families-title"><header class="archive-reference-section-head"><div><span class="archive-reference-kicker">General color use</span><h2 id="visual-families-title">Visual color families</h2></div><span class="archive-reference-count">${visualFamilies.length} active families</span></header><p class="archive-reference-section-copy">Broad color presence across published paintings, tattoos, flash, and merch. Exact mixtures and products remain documented separately.</p><div class="archive-color-family-grid">${visualFamilies.map(familyButton).join("") || '<div class="archive-reference-empty"><p>No visual color families are public yet.</p></div>'}</div></section>
        <section class="archive-reference-section" aria-labelledby="work-descriptors-title"><header class="archive-reference-section-head"><div><span class="archive-reference-kicker">Reviewed facts</span><h2 id="work-descriptors-title">Mediums &amp; supports</h2></div><span class="archive-reference-count">${descriptors.length} documented terms</span></header><div class="archive-descriptor-grid">${descriptors.map(descriptorCard).join("") || '<div class="archive-reference-empty"><p>No reviewed medium or support facts are public yet.</p></div>'}</div></section>
        <section class="archive-reference-section archive-documented-library" aria-labelledby="documented-library-title"><header class="archive-reference-section-head"><div><span class="archive-reference-kicker">Exact documentation</span><h2 id="documented-library-title">Documented recipe &amp; material library</h2></div></header><form class="archive-reference-tools" data-reference-tools><label>Search documented recipes &amp; materials<input type="search" name="q" autocomplete="off" placeholder="Color, brand, pigment, tool…"></label><label>Material category<select name="kind"><option value="">All categories</option>${[...new Set(materials.map((item) => item.material_kind))].sort().map((kind) => `<option value="${esc(kind)}">${esc(label(kind))}</option>`).join("")}</select></label></form></section>
        <section class="archive-reference-section" aria-labelledby="named-colors-title"><header class="archive-reference-section-head"><h2 id="named-colors-title">Named colors</h2><span class="archive-reference-count" data-color-count>${colors.length} published</span></header><div class="archive-reference-grid" data-color-grid>${colors.map(colorCard).join("") || '<div class="archive-reference-empty"><p>No named colors are public yet.</p></div>'}</div></section>
        <section class="archive-reference-section" aria-labelledby="materials-title"><header class="archive-reference-section-head"><h2 id="materials-title">Materials &amp; equipment</h2><span class="archive-reference-count" data-material-count>${materials.length} published</span></header><div class="archive-reference-grid" data-material-grid>${materials.map(materialCard).join("") || '<div class="archive-reference-empty"><p>No material definitions are public yet.</p></div>'}</div></section>
        <dialog class="archive-color-dialog" data-color-dialog aria-labelledby="color-dialog-title"><div class="archive-color-dialog-shell"><header class="archive-color-dialog-head"><div class="archive-color-dialog-title"><span class="archive-color-dialog-swatch" data-dialog-swatch aria-hidden="true"></span><div><span class="archive-reference-kicker">Reviewed visual family</span><h2 id="color-dialog-title" data-dialog-title>Color family</h2><p data-dialog-count></p></div></div><button class="archive-button" type="button" data-dialog-close>Close</button></header><nav class="archive-color-dialog-filters" aria-label="Filter works by type" data-dialog-filters></nav><div class="archive-color-dialog-results" data-dialog-results aria-live="polite"></div></div></dialog>`;

      const form = app.querySelector("[data-reference-tools]");
      const filter = () => {
        const query = form.q.value.trim().toLowerCase();
        const kind = form.kind.value;
        let colorCount = 0;
        let materialCount = 0;
        app.querySelectorAll("[data-color-grid] .archive-reference-card").forEach((card) => {
          card.hidden = Boolean(query && !card.dataset.referenceSearch.includes(query));
          if (!card.hidden) colorCount += 1;
        });
        app.querySelectorAll("[data-material-grid] .archive-reference-card").forEach((card) => {
          card.hidden = Boolean((query && !card.dataset.referenceSearch.includes(query)) || (kind && card.dataset.referenceKind !== kind));
          if (!card.hidden) materialCount += 1;
        });
        app.querySelector("[data-color-count]").textContent = `${colorCount} shown`;
        app.querySelector("[data-material-count]").textContent = `${materialCount} shown`;
      };
      form.addEventListener("input", filter);
      form.addEventListener("change", filter);

      const dialog = app.querySelector("[data-color-dialog]");
      const familyMap = new Map(visualFamilies.map((family) => [family.slug, family]));
      let returnFocus = null;
      let suppressCloseHistory = false;
      let requestSerial = 0;
      const stateFromUrl = () => {
        const params = new URLSearchParams(location.search);
        const slug = params.get("visual_color") || "";
        const type = ["all", "painting", "tattoo", "flash", "merch"].includes(params.get("work_type")) ? params.get("work_type") : "all";
        return { slug, type };
      };
      const updateUrl = (slug, type, mode = "push") => {
        const url = new URL(location.href);
        if (slug) {
          url.searchParams.set("visual_color", slug);
          url.searchParams.set("work_type", type || "all");
        } else {
          url.searchParams.delete("visual_color");
          url.searchParams.delete("work_type");
        }
        history[mode === "replace" ? "replaceState" : "pushState"]({}, "", url);
      };
      const hideDialog = (restore = true) => {
        requestSerial += 1;
        if (dialog.open) {
          suppressCloseHistory = true;
          dialog.close();
          suppressCloseHistory = false;
        }
        if (restore && returnFocus?.isConnected) returnFocus.focus();
      };
      const closeFromControl = () => {
        updateUrl("", "all", "push");
        hideDialog(true);
      };
      const renderFilters = (slug, type) => {
        const choices = [["all", "All"], ["painting", "Paintings"], ["tattoo", "Tattoos"], ["flash", "Flash"], ["merch", "Merch"]];
        const host = dialog.querySelector("[data-dialog-filters]");
        host.innerHTML = choices.map(([value, name]) => `<button type="button" data-dialog-filter="${value}" aria-pressed="${String(value === type)}">${name}</button>`).join("");
        host.querySelectorAll("[data-dialog-filter]").forEach((button) => button.addEventListener("click", () => openFamily(slug, button.dataset.dialogFilter, "push")));
      };
      const openFamily = async (slug, type = "all", historyMode = "none") => {
        const family = familyMap.get(slug);
        if (!family) {
          if (historyMode === "none" && slug) updateUrl("", "all", "replace");
          hideDialog(false);
          return;
        }
        if (historyMode !== "none") updateUrl(slug, type, historyMode);
        const serial = ++requestSerial;
        dialog.querySelector("[data-dialog-swatch]").style.setProperty("--swatch", family.swatch_hex);
        dialog.querySelector("[data-dialog-title]").textContent = family.name;
        dialog.querySelector("[data-dialog-count]").textContent = `${Number(family.count || 0)} reviewed ${Number(family.count || 0) === 1 ? "work" : "works"}`;
        renderFilters(slug, type);
        const results = dialog.querySelector("[data-dialog-results]");
        results.innerHTML = '<div class="archive-loading" role="status"><span class="archive-loading-mark" aria-hidden="true"></span><p>Opening reviewed works…</p></div>';
        if (!dialog.open) dialog.showModal();
        try {
          const payload = await get(`/api/archive/visual-color-families/${encodeURIComponent(slug)}/works?type=${encodeURIComponent(type)}`);
          if (serial !== requestSerial) return;
          dialog.querySelector("[data-dialog-count]").textContent = `${Number(payload.count || 0)} reviewed ${Number(payload.count || 0) === 1 ? "work" : "works"}`;
          results.innerHTML = payload.works?.length ? `<div class="archive-color-work-grid">${payload.works.map(workCard).join("")}</div>` : '<div class="archive-reference-empty"><p>No reviewed works match this filter.</p></div>';
        } catch (problem) {
          if (serial !== requestSerial) return;
          results.innerHTML = `<div class="archive-reference-empty" role="alert"><p>${esc(problem.message)}</p></div>`;
        }
      };
      app.querySelectorAll("[data-visual-color]").forEach((button) => button.addEventListener("click", () => {
        returnFocus = button;
        openFamily(button.dataset.visualColor, "all", "push");
      }));
      dialog.querySelector("[data-dialog-close]").addEventListener("click", closeFromControl);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeFromControl();
      });
      dialog.addEventListener("close", () => {
        if (suppressCloseHistory) return;
        const state = stateFromUrl();
        if (state.slug) updateUrl("", "all", "push");
        if (returnFocus?.isConnected) returnFocus.focus();
      });
      window.addEventListener("popstate", () => {
        const state = stateFromUrl();
        if (state.slug) openFamily(state.slug, state.type, "none");
        else hideDialog(true);
      });
      const initial = stateFromUrl();
      if (initial.slug) openFamily(initial.slug, initial.type, "none");
    } catch (problem) {
      app.innerHTML = error("The library could not be opened.", problem.message);
    }
  }

  function componentMarkup(component) {
    const quantity = component.quantity || {};
    const unit = Number(quantity.value) === 1 && quantity.unit === "parts" ? "part" : quantity.unit;
    const amount = [quantity.approximate ? "Approximately" : "", quantity.value, unit, quantity.note].filter((value) => value !== "" && value !== null && value !== undefined).join(" ");
    const item = component.material || component.nested_recipe;
    return `<li><span class="archive-provenance-label">${esc(amount || "Amount documented in studio")}</span><div><a href="${esc(item?.route || "#")}"><strong>${esc(item?.name || "Component")}</strong></a>${item?.brand ? `<p>${esc([item.brand, item.line, item.color_name, item.product_code].filter(Boolean).join(" · "))}</p>` : ""}${component.nested_recipe ? `<p>Frozen nested recipe · Version ${Number(component.nested_recipe.version || 0)}</p>` : ""}</div></li>`;
  }
  async function colorDetail() {
    const slug = slugFromPath("colors");
    if (!slug) {
      app.innerHTML = error("No color was named.", "Choose a published color from the reference library.");
      return;
    }
    try {
      const { color } = await get(`/api/archive/colors/${encodeURIComponent(slug)}`);
      document.title = `${color.name} · Colors · Archive · the six.well construct`;
      document.querySelector("[data-reference-breadcrumb]").textContent = color.name;
      const current = color.versions?.[0] || {};
      app.innerHTML = `<article class="archive-reference-detail"><header class="archive-reference-intro site-hero site-hero--supporting"><div class="archive-reference-title-row">${swatch(current.color_profile)}<div><span class="archive-kicker">Named color</span><h1 class="hero-title">${esc(color.name)}</h1></div></div><div class="archive-reference-intro-copy"><p class="hero-descriptor">${esc(color.description || "A versioned authored color in the public Archive.")}</p><div class="archive-actions"><a class="archive-button" href="/archive/?color=${encodeURIComponent(color.slug)}&match=lineage">All uses across versions</a><a class="archive-button" href="/archive/?color=${encodeURIComponent(color.slug)}&match=similar">Perceptually similar colors</a></div></div></header><div class="archive-reference-ledger">${(color.versions || []).map((version) => `<section class="archive-reference-version"><header><div><span class="archive-reference-kicker">Immutable recipe version</span><h2>Version ${Number(version.version_number)}${version.version_label ? ` · ${esc(version.version_label)}` : ""}</h2></div>${swatch(version.color_profile)}</header><div class="archive-reference-meta"><span>${esc(label(version.resulting_finish))}</span>${version.finish_label ? `<span>${esc(version.finish_label)}</span>` : ""}${(version.families || []).map((family) => `<a href="/archive/?color_family=${encodeURIComponent(family.slug)}">${esc(family.name)}</a>`).join("")}</div>${version.instructions ? `<div class="archive-prose"><h3>Method</h3><p>${esc(version.instructions)}</p></div>` : ""}<h3>Formula</h3><ol class="archive-component-list">${(version.components || []).map(componentMarkup).join("")}</ol></section>`).join("")}</div></article>`;
    } catch (problem) {
      app.innerHTML = error(problem.status === 404 ? "This color is not public." : "The color could not be opened.", problem.message);
    }
  }
  async function materialDetail() {
    const slug = slugFromPath("materials");
    if (!slug) {
      app.innerHTML = error("No material was named.", "Choose a published material from the reference library.");
      return;
    }
    try {
      const { material } = await get(`/api/archive/materials/${encodeURIComponent(slug)}`);
      document.title = `${material.name} · Materials · Archive · the six.well construct`;
      document.querySelector("[data-reference-breadcrumb]").textContent = material.name;
      const pigmentEvidence = (material.declared_pigments || []).map((declaration) => {
        const source = safeUrl(declaration.source_url);
        return `<li><span class="archive-provenance-label">Manufacturer-listed pigment</span><div><strong>${esc(declaration.code || declaration.bottle_wording)}</strong><p>${esc(declaration.bottle_wording)}</p><p>${esc(label(declaration.source_type))}${declaration.observed_at ? ` · Observed ${esc(declaration.observed_at)}` : ""}${source ? ` · <a href="${esc(source)}">Source</a>` : ""}</p></div></li>`;
      }).join("");
      app.innerHTML = `<article class="archive-reference-detail"><header class="archive-reference-intro site-hero site-hero--supporting"><div class="archive-reference-title-row">${swatch(material.color_profile)}<div><span class="archive-kicker">${esc(label(material.material_kind))}</span><h1 class="hero-title">${esc(material.name)}</h1></div></div><div class="archive-reference-intro-copy"><p class="hero-descriptor">${esc(material.description || [material.brand, material.product_line, material.color_name || material.model_name].filter(Boolean).join(" · ") || "A published Archive material reference.")}</p><div class="archive-actions"><a class="archive-button" href="/archive/?material=${encodeURIComponent(material.slug)}">Find public uses</a>${material.pigment_code ? `<a class="archive-button" href="/archive/?pigment=${encodeURIComponent(material.pigment_code)}&presence=any">Find ${esc(material.pigment_code)}</a>` : ""}</div></div></header><div class="archive-reference-ledger"><section class="archive-reference-version"><header><div><span class="archive-reference-kicker">Premade ${material.material_kind === "tattoo-ink" ? "tattoo ink" : "paint or material"}</span><h2>${esc([material.brand, material.product_line, material.color_name || material.product_name].filter(Boolean).join(" · ") || material.name)}</h2></div>${swatch(material.color_profile)}</header><div class="archive-reference-meta"><span>${esc(label(material.normalized_finish))}</span>${material.finish_label ? `<span>${esc(material.finish_label)}</span>` : ""}<span>${esc(label(material.opacity))}</span>${(material.optical_effects || []).map((effect) => `<span>${esc(label(effect))}</span>`).join("")}</div>${material.manufacturer_wording ? `<div class="archive-prose"><h3>Manufacturer wording</h3><p>${esc(material.manufacturer_wording)}</p></div>` : ""}<h3>Manufacturer-listed pigments</h3>${pigmentEvidence ? `<ul class="archive-declaration-list">${pigmentEvidence}</ul>` : "<p>No manufacturer pigment declaration has been published for this product.</p>"}</section></div></article>`;
    } catch (problem) {
      app.innerHTML = error(problem.status === 404 ? "This material is not public." : "The material could not be opened.", problem.message);
    }
  }
  if (view === "library") library();
  else if (view === "color") colorDetail();
  else materialDetail();
})();
