import { initMerchProductPage, renderProductGallery } from "/js/shop-storefront.js";
import { launchAlertMarkup, setupLaunchAlertForms } from "/js/merch-alerts.js";
import { SOURCES, canonicalSourceKey } from "/shared/storefront-config.js";

const SOURCE_TOKENS = {
  thoughtpuppet: "var(--color-art, #0039bd)",
  "art.pill": "var(--color-tattooing, #6e0404)",
  "six.well": "var(--color-merch, #f08f00)",
};

const SOURCE_BRIGHT_TOKENS = {
  thoughtpuppet: "var(--color-art-bright, #2054FF)",
  "art.pill": "var(--color-tattooing-bright, #BE281F)",
  "six.well": "var(--color-merch-bright, #FF9933)",
};

function readEmbeddedProduct() {
  try {
    return JSON.parse(document.getElementById("merch-record-data")?.textContent || "{}").product || null;
  } catch {
    return null;
  }
}

async function readProduct() {
  const embedded = readEmbeddedProduct();
  if (embedded) return embedded;
  const requested = location.pathname.split("/").filter(Boolean).at(-1) || "";
  const slug = requested === "lostmarbleshoodie" ? "lostmarbles-hoodie" : requested;
  if (!slug) return null;
  const response = await fetch(`/api/shop/items/${encodeURIComponent(slug)}`);
  if (!response.ok) return null;
  return (await response.json()).product || null;
}

function money(value) {
  if (!value) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: value.currencyCode || "USD",
    maximumFractionDigits: Number.isInteger(Number(value.amount)) ? 0 : 2,
  }).format(Number(value.amount));
}

function sourceFor(product) {
  const key = canonicalSourceKey(product.sourceVenture || product.sourceLabel);
  return { key, ...(SOURCES[key] || SOURCES["six.well"]) };
}

function showOrigin(product) {
  const section = document.getElementById("productOrigin");
  if (!product.originTitle && !product.originPath) return;
  document.getElementById("originTitle").textContent = product.originTitle || product.title;
  document.getElementById("originMeta").textContent = product.originMeta || "";
  const link = document.getElementById("originLink");
  link.href = product.originPath || "#";
  link.querySelector("span").textContent = "open the source work";
  const image = document.getElementById("originThumb");
  if (product.originThumb) {
    image.src = product.originThumb;
    image.alt = product.originTitle || product.title;
  } else {
    image.hidden = true;
  }
  section.hidden = false;
}

async function showRelated(product) {
  const section = document.getElementById("productRelated");
  if (!section || !window.ConstructConnections || !product.id) return;
  await window.ConstructConnections.mount({ host: section, entityId: product.id, title: "Connections to Other Domains", embedded: true });
}

function hydrateBase(product) {
  const source = sourceFor(product);
  document.body.dataset.productSlug = product.slug;
  document.body.dataset.constructEntity = product.id || "";
  document.documentElement.style.setProperty("--src-color", SOURCE_TOKENS[source.key] || SOURCE_TOKENS["six.well"]);
  document.documentElement.style.setProperty("--src-color-bright", SOURCE_BRIGHT_TOKENS[source.key] || SOURCE_BRIGHT_TOKENS["six.well"]);
  document.getElementById("sourceLabel").textContent = product.sourceLabel || source.label;
  document.getElementById("sourceDot").style.background = source.color;
  const breadcrumbSource = document.getElementById("breadcrumbSource");
  breadcrumbSource.textContent = product.sourceLabel || source.label;
  breadcrumbSource.href = `/merch/?filter=${encodeURIComponent(source.key)}`;
  document.getElementById("breadcrumbCurrent").textContent = product.title;
  document.getElementById("productName").textContent = product.title;
  document.getElementById("productPrice").textContent = money(product.price) || product.priceNote || "";
  document.getElementById("productEdition").textContent = product.editionText || "";
  document.getElementById("productDescription").textContent = product.description || product.statement || "";
  document.getElementById("catalogNumber").textContent = product.catalogNumber ? `N° ${product.catalogNumber}` : "";
  document.getElementById("imageEdition").textContent = product.editionText || "";
  document.getElementById("shippingNote").textContent = product.shippingNote || "";
  const image = document.getElementById("productHeroImage");
  const placeholder = document.getElementById("productImagePlaceholder");
  if (product.heroImage) {
    image.src = product.heroImage;
    image.alt = product.heroImageAlt || product.title;
    image.hidden = false;
    placeholder.hidden = true;
  } else {
    image.hidden = true;
    image.alt = "";
    placeholder.hidden = false;
    placeholder.textContent = product.title;
  }
  renderProductGallery(product, {
    galleryContainer: document.getElementById("productGallery"),
    heroImgEl: image,
    heroImageContainer: document.querySelector(".product-image"),
  });
  showOrigin(product);
  if (product.slug === "lostmarbles-hoodie") {
    const archive = document.getElementById("productArchive");
    document.getElementById("archiveLink").href = "/archive/records/lostmarbles-hoodie/";
    archive.hidden = false;
  }
}

async function hydrateCommerce(product) {
  const controls = document.getElementById("commerceControls");
  const alertSlot = document.getElementById("launchAlertSlot");
  if (product.availabilityState === "coming_soon") {
    controls.hidden = true;
    if (product.notifyEnabled) {
      alertSlot.innerHTML = launchAlertMarkup(product);
      setupLaunchAlertForms(alertSlot);
    }
    return;
  }
  alertSlot.innerHTML = "";
  controls.hidden = false;
  if (!product.shopifyHandle) {
    controls.innerHTML = '<p class="product-note">This product is currently unavailable.</p>';
    return;
  }
  await initMerchProductPage({
    handle: product.shopifyHandle,
    product,
    addButtonEl: document.getElementById("addBtn"),
    colorContainer: document.getElementById("colorRow"),
    colorLabelEl: document.getElementById("colorLabel"),
    editionEl: document.getElementById("productEdition"),
    galleryContainer: document.getElementById("productGallery"),
    heroImgEl: document.getElementById("productHeroImage"),
    heroImageContainer: document.querySelector(".product-image"),
    originLinkEl: document.getElementById("originLink"),
    originMetaEl: document.getElementById("originMeta"),
    originThumbEl: document.getElementById("originThumb"),
    originTitleEl: document.getElementById("originTitle"),
    priceEl: document.getElementById("productPrice"),
    sizeContainer: document.getElementById("sizeGrid"),
    sizeRequiredEl: document.getElementById("sizeRequired"),
    sourceDotEl: document.getElementById("sourceDot"),
    sourceLabelEl: document.getElementById("sourceLabel"),
    statusEl: document.getElementById("purchaseStatus"),
    titleEl: document.getElementById("productName"),
  });
}

async function init() {
  const product = await readProduct();
  if (!product) return;
  hydrateBase(product);
  await Promise.all([hydrateCommerce(product), showRelated(product)]);
}

init().catch((error) => {
  console.error(error);
  const status = document.getElementById("purchaseStatus");
  if (status) status.textContent = "Product details are temporarily unavailable.";
});
