import { initMerchProductPage } from "/js/shop-storefront.js";

function initScrollerControls() {
  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.scrollTarget);
      if (!target) return;
      const direction = button.dataset.scrollDirection === "prev" ? -1 : 1;
      const step = Math.max(160, Math.floor(target.clientWidth * 0.72));
      target.scrollBy({ left: direction * step, behavior: "smooth" });
    });
  });
}

initMerchProductPage({
  handle: document.body.dataset.productHandle,
  addButtonEl: document.getElementById("addBtn"),
  colorContainer: document.getElementById("colorRow"),
  colorLabelEl: document.getElementById("colorLabel"),
  editionEl: document.getElementById("productEdition"),
  finishContainer: null,
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
  sizeValueEl: null,
  sourceDotEl: document.getElementById("sourceDot"),
  sourceLabelEl: document.getElementById("sourceLabel"),
  statusEl: document.getElementById("purchaseStatus"),
  titleEl: document.getElementById("productName"),
})
  .then(() => {
    initScrollerControls();
  })
  .catch((error) => {
  console.error(error);
  const statusEl = document.getElementById("purchaseStatus");
  if (statusEl) statusEl.textContent = `shop connection unavailable: ${error.message || "unknown error"}`;
});
