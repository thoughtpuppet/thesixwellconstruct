import { createCartController, resolveVariantBySelections } from "/js/shop-storefront.js";
import { launchAlertMarkup, setupLaunchAlertForms } from "/js/merch-alerts.js";

function readProduct() {
  try { return JSON.parse(document.getElementById("merch-record-data")?.textContent || "{}").product || null; }
  catch { return null; }
}

function money(value) {
  if (!value) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: value.currencyCode || "USD", maximumFractionDigits: 2 }).format(Number(value.amount));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[character]));
}

async function related(product) {
  try {
    const response = await fetch(`/api/connections/${encodeURIComponent(product.id)}`);
    if (!response.ok) return;
    const payload = await response.json();
    const records = payload.connections || payload.records || [];
    if (!records.length) return;
    const grid = document.getElementById("relatedGrid");
    grid.innerHTML = records.map((entry) => {
      const item = entry.entity || entry.target || entry.record || entry;
      const route = item.route || item.canonical_route || item.canonicalRoute || "#";
      return `<a class="related-card" href="${escapeHtml(route)}"><span>${escapeHtml(entry.label || entry.relationship_label || "connected")}</span><strong>${escapeHtml(item.title || item.name || item.id || "Construct record")}</strong></a>`;
    }).join("");
    document.getElementById("productRelated").hidden = false;
  } catch {}
}

async function init() {
  const product = readProduct();
  if (!product) return;
  document.body.dataset.constructEntity = product.id;
  document.body.dataset.productSlug = product.slug;
  document.getElementById("breadcrumbCurrent").textContent = product.title;
  document.getElementById("productTitle").textContent = product.title;
  document.getElementById("productDescriptor").textContent = product.statement || product.description || "A product from Six.Well Merch.";
  document.getElementById("sourceLabel").textContent = product.sourceLabel;
  document.getElementById("catalogNumber").textContent = product.catalogNumber ? `N° ${product.catalogNumber}` : "";
  document.getElementById("productEdition").textContent = product.editionText || "";
  document.getElementById("productPrice").textContent = money(product.price) || product.priceNote || "";
  document.getElementById("shippingNote").textContent = product.shippingNote || "";
  if (product.heroImage) {
    const image = document.getElementById("productImage");
    image.src = product.heroImage; image.alt = product.heroImageAlt || product.title; image.hidden = false;
    document.getElementById("productPlaceholder").hidden = true;
  }
  if (product.description) {
    document.getElementById("productDescription").textContent = product.description;
    document.getElementById("productStory").hidden = false;
  }
  if (product.originTitle || product.originPath) {
    document.getElementById("originTitle").textContent = product.originTitle;
    document.getElementById("originMeta").textContent = product.originMeta || "";
    const link = document.getElementById("originLink"); link.href = product.originPath || "#";
    if (product.originThumb) { const image = document.getElementById("originImage"); image.src = product.originThumb; image.alt = product.originTitle; image.hidden = false; }
    document.getElementById("productOrigin").hidden = false;
  }

  const controls = document.getElementById("commerceControls");
  if (product.availabilityState === "coming_soon" && product.notifyEnabled) {
    document.getElementById("launchAlertSlot").innerHTML = launchAlertMarkup(product);
    setupLaunchAlertForms();
  } else if (product.availabilityState === "available") {
    const cart = createCartController({ cartToggle:document.getElementById("cartToggle"),cartCount:document.getElementById("cartCount"),checkoutBtn:document.getElementById("checkoutBtn"),drawer:document.getElementById("cartDrawer"),drawerClose:document.getElementById("drawerClose"),drawerItems:document.getElementById("drawerItems"),checkoutStatusEl:document.getElementById("checkoutStatus"),overlay:document.getElementById("cartOverlay"),subtotalEl:document.getElementById("subtotal") });
    await cart.refreshCart();
    const selections = {};
    controls.innerHTML = (product.options || []).map((option) => `<fieldset class="option-group"><legend>${escapeHtml(option.name)}</legend><div class="option-row">${(option.values || []).map((value) => `<button class="option-button" type="button" data-option="${escapeHtml(option.name)}" data-value="${escapeHtml(value)}" aria-pressed="false">${escapeHtml(value)}</button>`).join("")}</div></fieldset>`).join("") + `<button class="add-to-cart" id="addToCart" type="button" disabled><span>${product.availableForSale ? "select options" : "sold out"}</span><span aria-hidden="true">→</span></button><p id="commerceStatus" aria-live="polite"></p>`;
    const add = document.getElementById("addToCart");
    controls.querySelectorAll("[data-option]").forEach((button) => button.addEventListener("click", () => {
      controls.querySelectorAll(`[data-option="${CSS.escape(button.dataset.option)}"]`).forEach((candidate) => candidate.setAttribute("aria-pressed","false"));
      button.setAttribute("aria-pressed","true"); selections[button.dataset.option] = button.dataset.value;
      const complete = (product.options || []).every((option) => selections[option.name]);
      const variant = complete ? resolveVariantBySelections(product,selections) : null;
      add.disabled = !variant?.availableForSale; add.dataset.variantId = variant?.id || "";
      add.querySelector("span").textContent = variant?.availableForSale ? `add to cart · ${money(variant.price)}` : complete ? "sold out" : "select options";
    }));
    add.addEventListener("click", async () => { if (!add.dataset.variantId) return; add.disabled = true; try { await cart.addVariant(add.dataset.variantId,1); } catch (error) { document.getElementById("commerceStatus").textContent = error.message; } finally { add.disabled = false; } });
  } else controls.innerHTML = `<p class="product-note">This product is sold out.</p>`;
  related(product);
}

init();
