import { initMerchProductPage } from "/js/shop-storefront.js";

initMerchProductPage({
  handle: document.body.dataset.productHandle,
  addButtonEl: document.getElementById("addToCartBtn"),
  checkoutBtn: document.getElementById("checkoutBtn"),
  colorContainer: null,
  editionEl: document.getElementById("editionText"),
  finishContainer: document.getElementById("finishPills"),
  finishRequiredEl: document.getElementById("finishRequired"),
  finishValueEl: document.getElementById("finishVal"),
  heroImgEl: document.getElementById("productHeroImage"),
  originLinkEl: document.getElementById("originLink"),
  originMetaEl: document.getElementById("originMeta"),
  originThumbEl: document.getElementById("originThumb"),
  originTitleEl: document.getElementById("originTitle"),
  priceEl: document.getElementById("productPrice"),
  priceNoteEl: document.getElementById("priceNote"),
  sizeContainer: document.getElementById("sizePills"),
  sizeRequiredEl: document.getElementById("sizeRequired"),
  sizeValueEl: document.getElementById("sizeVal"),
  sourceDotEl: document.getElementById("sourceDot"),
  sourceLabelEl: document.getElementById("sourceLabel"),
  statusEl: document.getElementById("purchaseStatus"),
  titleEl: document.getElementById("productTitle"),
}).catch((error) => {
  console.error(error);
  const statusEl = document.getElementById("purchaseStatus");
  if (statusEl) statusEl.textContent = "shop connection unavailable";
});
