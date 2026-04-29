import { initMerchProductPage } from "/js/shop-storefront.js";

initMerchProductPage({
  handle: document.body.dataset.productHandle,
  addButtonEl: document.getElementById("addBtn"),
  colorContainer: document.getElementById("colorRow"),
  colorLabelEl: document.getElementById("colorLabel"),
  editionEl: document.getElementById("productEdition"),
  finishContainer: null,
  heroImgEl: document.getElementById("productHeroImage"),
  heroImageContainer: document.querySelector(".product-image"),
  originLinkEl: document.getElementById("originLink"),
  originMetaEl: document.getElementById("originMeta"),
  originThumbEl: document.getElementById("originThumb"),
  originTitleEl: document.getElementById("originTitle"),
  priceEl: document.getElementById("productPrice"),
  sizeContainer: document.getElementById("sizeGrid"),
  sizeRequiredEl: document.getElementById("sizeRequired"),
  sizeValueEl: null,
  sourceDotEl: document.getElementById("sourceDot"),
  sourceLabelEl: document.getElementById("sourceLabel"),
  statusEl: document.getElementById("purchaseStatus"),
  titleEl: document.getElementById("productName"),
}).catch((error) => {
  console.error(error);
  const statusEl = document.getElementById("purchaseStatus");
  if (statusEl) statusEl.textContent = "shop connection unavailable";
});
