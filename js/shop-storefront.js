import {
  SOURCE_ORDER,
  SOURCES,
  PLACEHOLDER_PRODUCTS,
  getColorHex,
  getPresentation,
  getTypeLabel,
} from "/shared/storefront-config.js";

const CART_STORAGE_KEY = "sixwell-shopify-cart-id";

function tokenColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const MERCH_COLOR = tokenColor("--color-merch", "#F08F15");
const ABOUT_COLOR = tokenColor("--color-about", "#FCB867");

function readableSourceInk(color) {
  return "#0e0e0e";
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function moneyText(money) {
  if (!money) return "price on request";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currencyCode || "USD",
    maximumFractionDigits: Number.isInteger(money.amount) ? 0 : 2,
  }).format(Number(money.amount));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = [payload.error, payload.detail].filter(Boolean).join(" ");
    throw new Error(message || "Request failed.");
  }
  return payload;
}

export async function loadCatalog() {
  const payload = await api("/api/shop/catalog");
  return payload.products || [];
}

export async function getProductByHandle(handle) {
  const payload = await api(`/api/shop/product?handle=${encodeURIComponent(handle)}`);
  return payload.product;
}

export function getStoredCartId() {
  return window.localStorage.getItem(CART_STORAGE_KEY);
}

export function setStoredCartId(cartId) {
  if (!cartId) {
    window.localStorage.removeItem(CART_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(CART_STORAGE_KEY, cartId);
}

export async function createCart() {
  const payload = await api("/api/shop/cart/create", { method: "POST", body: "{}" });
  return payload.cart;
}

export async function getCart(cartId) {
  const payload = await api(`/api/shop/cart?cartId=${encodeURIComponent(cartId)}`);
  return payload.cart;
}

export async function addCartLines(cartId, lines) {
  const payload = await api("/api/shop/cart/lines/add", {
    method: "POST",
    body: JSON.stringify({ cartId, lines }),
  });
  return payload.cart;
}

export async function updateCartLines(cartId, lines) {
  const payload = await api("/api/shop/cart/lines/update", {
    method: "POST",
    body: JSON.stringify({ cartId, lines }),
  });
  return payload.cart;
}

export async function removeCartLines(cartId, lineIds) {
  const payload = await api("/api/shop/cart/lines/remove", {
    method: "POST",
    body: JSON.stringify({ cartId, lineIds }),
  });
  return payload.cart;
}

export function goToCheckout(checkoutUrl) {
  window.location.assign(checkoutUrl);
}

function summarizeOptions(selectedOptions = []) {
  return selectedOptions
    .map((option) => option.value)
    .filter(Boolean)
    .join(" · ");
}

function resolveOptionValues(product) {
  const values = { size: [], color: [], finish: [] };
  for (const option of product.options || []) {
    const key = normalizeKey(option.name);
    if (key.includes("size")) values.size = option.values || [];
    else if (key.includes("color")) values.color = option.values || [];
    else if (key.includes("finish")) values.finish = option.values || [];
  }
  if (!values.color.length) {
    const presentation = getPresentation(product.handle);
    if (presentation.defaultColorway) {
      values.color = [presentation.defaultColorway];
    }
  }
  return values;
}

function renderProductGallery(product, options) {
  const images = (product.images && product.images.length ? product.images : []).filter((image) => image?.url);
  const fallbackImage = product.heroImage
    ? [{ url: product.heroImage, altText: product.heroImageAlt || product.title }]
    : [];
  const galleryImages = images.length ? images : fallbackImage;

  if (!galleryImages.length) return;

  const heroImgEl =
    options.heroImgEl ||
    options.heroImageContainer?.querySelector("#productHeroImage") ||
    options.heroImageContainer?.querySelector("img");

  const placeholder = options.heroImageContainer?.querySelector(".img-placeholder");

  const setActiveImage = (image, thumbButton = null) => {
    if (!heroImgEl) return;
    heroImgEl.src = image.url;
    heroImgEl.alt = image.altText || product.title;
    if (placeholder) placeholder.remove();
    if (options.galleryContainer) {
      options.galleryContainer.querySelectorAll(".gallery-thumb").forEach((button) => {
        button.classList.toggle("active", button === thumbButton);
      });
    }
  };

  setActiveImage(galleryImages[0]);

  if (!options.galleryContainer) return;

  options.galleryContainer.innerHTML = galleryImages
    .map(
      (image, index) => `
        <button
          class="gallery-thumb${index === 0 ? " active" : ""}"
          type="button"
          data-gallery-index="${index}"
          aria-label="view image ${index + 1}">
          <img src="${image.url}" alt="${image.altText || product.title}">
        </button>
      `
    )
    .join("");

  options.galleryContainer.querySelectorAll(".gallery-thumb").forEach((button, index) => {
    button.addEventListener("click", () => setActiveImage(galleryImages[index], button));
  });
}

export function resolveVariantBySelections(product, selections) {
  const normalizedSelections = Object.fromEntries(
    Object.entries(selections).map(([key, value]) => [normalizeKey(key), normalizeKey(value)])
  );

  return (
    product.variants.find((variant) =>
      variant.selectedOptions.every((option) => {
        const optionName = normalizeKey(option.name);
        const selectedValue = normalizedSelections[optionName];
        if (!selectedValue) return false;
        return normalizeKey(option.value) === selectedValue;
      })
    ) || null
  );
}

export function createCartController(elements) {
  const state = { cart: null };

  function setCount(totalQuantity) {
    elements.cartCount.textContent = String(totalQuantity || 0);
  }

  function renderCart() {
    const cart = state.cart;
    setCount(cart?.totalQuantity || 0);
    if (elements.checkoutStatusEl) elements.checkoutStatusEl.textContent = "";

    if (!cart || !cart.lines || cart.lines.length === 0) {
      elements.drawerItems.innerHTML = `<p class="drawer-empty">cart is empty</p>`;
      elements.subtotalEl.textContent = "$0";
      elements.checkoutBtn.disabled = true;
      return;
    }

    elements.checkoutBtn.disabled = false;
    elements.subtotalEl.textContent = moneyText(cart.subtotal);
    elements.drawerItems.innerHTML = cart.lines
      .map((line) => {
        const variant = summarizeOptions(line.selectedOptions);
        const href = line.pagePath || "#";
        return `
          <div class="drawer-item">
            <div class="drawer-item-thumb">
              ${line.image ? `<img src="${line.image}" alt="${line.imageAlt || line.title}">` : line.handle || ""}
            </div>
            <div class="drawer-item-info">
              <span class="drawer-item-name">${line.pagePath ? `<a href="${href}" style="color:inherit">${line.title}</a>` : line.title}</span>
              <span class="drawer-item-cat">
                <span class="drawer-cat-dot" style="background:${line.sourceColor}"></span>
                <span style="color:${line.sourceColor}; opacity:0.75">${line.sourceLabel}</span>
              </span>
              ${variant ? `<span class="drawer-item-variant">${variant}</span>` : ""}
              <div class="drawer-item-qty">
                <button class="qty-btn" type="button" data-minus="${line.id}" aria-label="decrease">&minus;</button>
                <span class="qty-num">${line.quantity}</span>
                <button class="qty-btn" type="button" data-plus="${line.id}" aria-label="increase">+</button>
              </div>
            </div>
            <div class="drawer-item-right">
              <span class="drawer-item-price">${moneyText({
                amount: Number(line.price?.amount || 0) * Number(line.quantity || 0),
                currencyCode: line.price?.currencyCode || "USD",
              })}</span>
              <button class="drawer-item-remove" type="button" data-remove="${line.id}">remove</button>
            </div>
          </div>
        `;
      })
      .join("");

    elements.drawerItems.querySelectorAll("[data-plus]").forEach((button) => {
      button.addEventListener("click", () => {
        const line = cart.lines.find((entry) => entry.id === button.dataset.plus);
        if (line) controller.changeLineQuantity(line.id, line.quantity + 1);
      });
    });
    elements.drawerItems.querySelectorAll("[data-minus]").forEach((button) => {
      button.addEventListener("click", () => {
        const line = cart.lines.find((entry) => entry.id === button.dataset.minus);
        if (line) controller.changeLineQuantity(line.id, line.quantity - 1);
      });
    });
    elements.drawerItems.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        controller.removeLine(button.dataset.remove);
      });
    });
  }

  function openDrawer() {
    elements.drawer.classList.add("open");
    elements.overlay.classList.add("open");
    elements.drawer.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    elements.drawer.classList.remove("open");
    elements.overlay.classList.remove("open");
    elements.drawer.setAttribute("aria-hidden", "true");
  }

  async function ensureCart() {
    let cartId = getStoredCartId();
    if (cartId) {
      try {
        const cart = await getCart(cartId);
        state.cart = cart;
        renderCart();
        return cart;
      } catch {
        setStoredCartId("");
      }
    }

    const cart = await createCart();
    setStoredCartId(cart.id);
    state.cart = cart;
    renderCart();
    return cart;
  }

  async function refreshCart() {
    const cartId = getStoredCartId();
    if (!cartId) {
      state.cart = null;
      renderCart();
      return null;
    }
    try {
      const cart = await getCart(cartId);
      state.cart = cart;
      renderCart();
      return cart;
    } catch {
      setStoredCartId("");
      state.cart = null;
      renderCart();
      return null;
    }
  }

  async function addVariant(variantId, quantity = 1) {
    let cart = await ensureCart();
    try {
      cart = await addCartLines(cart.id, [{ variantId, quantity }]);
    } catch {
      setStoredCartId("");
      cart = await createCart();
      setStoredCartId(cart.id);
      cart = await addCartLines(cart.id, [{ variantId, quantity }]);
    }
    state.cart = cart;
    renderCart();
    openDrawer();
    pulseCount();
    return cart;
  }

  async function changeLineQuantity(lineId, quantity) {
    const cartId = getStoredCartId();
    if (!cartId) return;
    state.cart =
      quantity <= 0
        ? await removeCartLines(cartId, [lineId])
        : await updateCartLines(cartId, [{ lineId, quantity }]);
    renderCart();
  }

  async function removeLine(lineId) {
    const cartId = getStoredCartId();
    if (!cartId) return;
    state.cart = await removeCartLines(cartId, [lineId]);
    renderCart();
  }

  function pulseCount() {
    elements.cartCount.classList.remove("pulse");
    void elements.cartCount.offsetWidth;
    elements.cartCount.classList.add("pulse");
  }

  elements.cartToggle.addEventListener("click", openDrawer);
  elements.drawerClose.addEventListener("click", closeDrawer);
  elements.overlay.addEventListener("click", closeDrawer);
  elements.checkoutBtn.type = "button";
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
  elements.checkoutBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!state.cart?.checkoutUrl) {
      if (elements.checkoutStatusEl) {
        elements.checkoutStatusEl.textContent = "checkout is unavailable right now. please try again in a moment.";
      }
      return;
    }
    goToCheckout(state.cart.checkoutUrl);
  });

  const controller = {
    addVariant,
    changeLineQuantity,
    closeDrawer,
    openDrawer,
    refreshCart,
    renderCart,
    removeLine,
    state,
  };

  renderCart();
  return controller;
}

export async function initMerchCartOnlyPage() {
  const cart = createCartController({
    cartToggle: document.getElementById("cartToggle"),
    cartCount: document.getElementById("cartCount"),
    checkoutBtn: document.getElementById("checkoutBtn"),
    drawer: document.getElementById("cartDrawer"),
    drawerClose: document.getElementById("drawerClose"),
    drawerItems: document.getElementById("drawerItems"),
    checkoutStatusEl: document.getElementById("checkoutStatus"),
    overlay: document.getElementById("cartOverlay"),
    subtotalEl: document.getElementById("subtotal"),
  });

  await cart.refreshCart();
}

function optionMarkup(values, type, handle, selectedValue, productId) {
  if (!values.length) return "";
  if (type === "color") {
    return `
      <div class="card-colors" id="colors-${productId}">
        ${values
          .map(
            (value) => `
              <button
                class="color-swatch${normalizeKey(selectedValue) === normalizeKey(value) ? " selected" : ""}"
                style="background:${getColorHex(value, handle)}"
                data-option="color"
                data-value="${value}"
                data-pid="${productId}"
                title="${value}"></button>
            `
          )
          .join("")}
        <span class="color-label" id="clabel-${productId}">${selectedValue || ""}</span>
      </div>
    `;
  }

  const pillClass = type === "finish" ? "finish-pill" : "size-pill";
  const wrapperClass = type === "finish" ? "card-finish" : "card-sizes";
  return `
    <div class="${wrapperClass}" id="${type}-${productId}">
      ${values
        .map(
          (value) => `
            <button
              class="${pillClass}${normalizeKey(selectedValue) === normalizeKey(value) ? " selected" : ""}"
              data-option="${type}"
              data-value="${value}"
              data-pid="${productId}">${value}</button>
          `
        )
        .join("")}
    </div>
  `;
}

export async function initMerchCatalogPage() {
  const cart = createCartController({
    cartToggle: document.getElementById("cartToggle"),
    cartCount: document.getElementById("cartCount"),
    checkoutBtn: document.getElementById("checkoutBtn"),
    drawer: document.getElementById("cartDrawer"),
    drawerClose: document.getElementById("drawerClose"),
    drawerItems: document.getElementById("drawerItems"),
    checkoutStatusEl: document.getElementById("checkoutStatus"),
    overlay: document.getElementById("cartOverlay"),
    subtotalEl: document.getElementById("subtotal"),
  });

  await cart.refreshCart();

  const sourceRowEl = document.getElementById("sourceRow");
  const typeRowEl = document.getElementById("typeRow");
  const grid = document.getElementById("productGrid");
  const introDesc = document.getElementById("introDesc");
  const introAbove = document.getElementById("introAbove");
  const merchWord = document.getElementById("merchWord");
  const merchDot = document.getElementById("merchDot");

  const selections = {};
  let products = [];
  let activeFilter = "all";
  let activeTypeFilter = "all";

  function makeChip(label, count, isActive, srcColor) {
    const button = document.createElement("button");
    button.className = `chip${isActive ? " active" : ""}`;
    button.style.setProperty("--src-color", srcColor || "var(--accent)");
    button.innerHTML = `<span class="chip-label">${label}</span><span class="chip-count">${count}</span>`;
    return button;
  }

  function setHeroState(key) {
    const color = key === "all" ? MERCH_COLOR : SOURCES[key]?.color || MERCH_COLOR;
    document.documentElement.style.setProperty("--title-color", color);
  }

  function renderFilters() {
    sourceRowEl.innerHTML = "";
    const allButton = makeChip("all", products.length, activeFilter === "all", "var(--accent)");
    allButton.addEventListener("click", () => setFilter("all"));
    sourceRowEl.appendChild(allButton);

    for (const sourceKey of SOURCE_ORDER) {
      const source = SOURCES[sourceKey];
      const count = products.filter((product) => product.sourceVenture === sourceKey).length;
      if (!count) continue;
      const button = makeChip(source.label, count, activeFilter === sourceKey, source.color);
      button.addEventListener("click", () => setFilter(sourceKey));
      sourceRowEl.appendChild(button);
    }
  }

  function renderTypeFilters() {
    typeRowEl.innerHTML = "";
    if (activeFilter === "all") return;

    const visibleProducts = products.filter((product) => product.sourceVenture === activeFilter);
    const counts = new Map();
    visibleProducts.forEach((product) => {
      counts.set(product.productType, (counts.get(product.productType) || 0) + 1);
    });
    if (counts.size <= 1) return;

    const allButton = makeChip("all", visibleProducts.length, activeTypeFilter === "all", "var(--accent)");
    allButton.addEventListener("click", () => setTypeFilter("all"));
    typeRowEl.appendChild(allButton);

    for (const [typeKey, count] of counts.entries()) {
      const button = makeChip(getTypeLabel(typeKey), count, activeTypeFilter === typeKey, "var(--accent)");
      button.addEventListener("click", () => setTypeFilter(typeKey));
      typeRowEl.appendChild(button);
    }
  }

  function setFilter(key) {
    activeFilter = key;
    activeTypeFilter = "all";
    setHeroState(key);
    if (key === "all") {
      introAbove.classList.remove("visible");
      introDesc.textContent = "everything sellable from the construct";
      introDesc.style.color = "";
    } else {
      introAbove.classList.add("visible");
      introDesc.textContent = SOURCES[key]?.statement || "";
      introDesc.style.color = SOURCES[key]?.color || "";
    }
    renderFilters();
    renderTypeFilters();
    renderGrid();
  }

  function setTypeFilter(key) {
    activeTypeFilter = key;
    renderTypeFilters();
    renderGrid();
  }

  function getSelection(handle, optionKey, values) {
    const selection = selections[handle] || {};
    if (selection[optionKey]) return selection[optionKey];
    return values.length === 1 ? values[0] : null;
  }

  function renderGrid() {
    let visibleProducts = products;
    if (activeFilter !== "all") {
      visibleProducts = visibleProducts.filter((product) => product.sourceVenture === activeFilter);
    }
    if (activeTypeFilter !== "all") {
      visibleProducts = visibleProducts.filter((product) => product.productType === activeTypeFilter);
    }

    if (!visibleProducts.length) {
      grid.innerHTML = `<p class="drawer-empty">no products matched this filter</p>`;
      return;
    }

    grid.innerHTML = visibleProducts
      .map((product) => {
        const source = SOURCES[product.sourceVenture] || { color: ABOUT_COLOR, label: product.sourceLabel };
        const optionValues = resolveOptionValues(product);
        const selection = selections[product.handle] || {};
        const selectedSize = selection.size || getSelection(product.handle, "size", optionValues.size);
        const selectedColor = selection.color || getSelection(product.handle, "color", optionValues.color);
        const selectedFinish = selection.finish || getSelection(product.handle, "finish", optionValues.finish);
        selections[product.handle] = {
          size: selectedSize,
          color: selectedColor,
          finish: selectedFinish,
        };

        const cardUrl = product.pagePath || "#";
        const sourceMark = source.logo
          ? `<img class="cat-logo" src="${source.logo}" alt="${source.logoAlt || source.label}" loading="lazy">`
          : `<span class="cat-dot"></span>`;
        const imageHtml = product.heroImage
          ? `<img src="${product.heroImage}" alt="${product.heroImageAlt || product.title}">`
          : `<span class="card-number">${product.catalogNumber || ""}</span>`;

        let selectorsHtml = "";
        let ctaHtml = "";

        if (product.productType === "painting") {
          selectorsHtml = `
            <p class="card-dims">${[product.medium, product.dimensions, product.year].filter(Boolean).join(" &middot; ")}</p>
          `;
          ctaHtml = `
            <a class="card-acquire" href="/art/acquisitioninquiry">
              <span>inquire to acquire</span>
              <span class="arrow">&rarr;</span>
            </a>
          `;
        } else {
          selectorsHtml += optionMarkup(optionValues.color, "color", product.handle, selectedColor, product.handle);
          selectorsHtml += optionMarkup(optionValues.size, "size", product.handle, selectedSize, product.handle);
          if (optionValues.size.length > 1) {
            selectorsHtml += `<p class="size-required" id="req-${product.handle}">select a size</p>`;
          }
          selectorsHtml += optionMarkup(optionValues.finish, "finish", product.handle, selectedFinish, product.handle);
          const ctaLabel = product.availableForSale ? "add to cart" : product.isPlaceholder ? "coming soon" : "sold out";
          ctaHtml = `
            <button class="card-add"${product.availableForSale ? "" : " disabled"} data-add="${product.handle}">
              <span>${ctaLabel}</span>
              <span class="arrow">&rarr;</span>
            </button>
          `;
        }

        return `
          <article class="card" style="--src-color:${source.color}">
            <a class="card-frame" href="${cardUrl}" aria-label="view ${product.title}">
              <span class="card-plaque">N&deg; ${product.catalogNumber || ""}</span>
              ${imageHtml}
              ${product.editionText ? `<span class="card-edition">${product.editionText}</span>` : ""}
            </a>
            <div class="card-cat">
              ${sourceMark}
              <span class="cat-label" style="--label-color:${source.color}; --label-ink:${readableSourceInk(source.color)}">${source.label}</span>
            </div>
            <div class="card-meta">
              <h3 class="card-name"><a href="${cardUrl}" style="color:inherit">${product.title}</a></h3>
              <span class="card-price">${moneyText(product.price)}</span>
            </div>
            ${selectorsHtml}
            ${ctaHtml}
          </article>
        `;
      })
      .join("");

    grid.querySelectorAll("[data-option]").forEach((button) => {
      button.addEventListener("click", () => {
        const handle = button.dataset.pid;
        const optionName = button.dataset.option;
        const optionValue = button.dataset.value;
        selections[handle] = selections[handle] || {};
        selections[handle][optionName] =
          normalizeKey(selections[handle][optionName]) === normalizeKey(optionValue)
            ? null
            : optionValue;
        renderGrid();
      });
    });

    grid.querySelectorAll("[data-add]").forEach((button) => {
      button.addEventListener("click", async () => {
        const product = products.find((entry) => entry.handle === button.dataset.add);
        const selection = selections[product.handle] || {};
        const optionValues = resolveOptionValues(product);
        if (optionValues.size.length > 1 && !selection.size) {
          const prompt = document.getElementById(`req-${product.handle}`);
          if (prompt) prompt.classList.add("visible");
          return;
        }

        const variant = resolveVariantBySelections(product, {
          size: selection.size || optionValues.size[0],
          color: selection.color || optionValues.color[0],
          finish: selection.finish || optionValues.finish[0],
        });
        if (!variant || !variant.availableForSale) return;
        await cart.addVariant(variant.id, 1);
      });
    });
  }

  try {
    grid.innerHTML = `<p class="drawer-empty">loading merch...</p>`;
    products = await loadCatalog();
    const liveHandles = new Set(products.map((p) => p.handle));
    for (const placeholder of PLACEHOLDER_PRODUCTS) {
      if (!liveHandles.has(placeholder.handle)) products.push(placeholder);
    }
    renderFilters();
    renderTypeFilters();
    renderGrid();
    setHeroState("all");
    const initFilter = new URLSearchParams(window.location.search).get("filter");
    if (initFilter && SOURCES[initFilter]) setFilter(initFilter);
  } catch (error) {
    grid.innerHTML = `<p class="drawer-empty">shop is temporarily unavailable: ${error.message || "unknown error"}</p>`;
    console.error(error);
  }
}

export async function initMerchProductPage(options) {
  const cart = createCartController({
    cartToggle: document.getElementById("cartToggle"),
    cartCount: document.getElementById("cartCount"),
    checkoutBtn: document.getElementById("checkoutBtn"),
    drawer: document.getElementById("cartDrawer"),
    drawerClose: document.getElementById("drawerClose"),
    drawerItems: document.getElementById("drawerItems"),
    checkoutStatusEl: document.getElementById("checkoutStatus"),
    overlay: document.getElementById("cartOverlay"),
    subtotalEl: document.getElementById("subtotal"),
  });
  await cart.refreshCart();

  const product = await getProductByHandle(options.handle);
  if (!product) throw new Error(`No Shopify product found for handle ${options.handle}.`);

  const source = SOURCES[product.sourceVenture] || { color: ABOUT_COLOR, label: product.sourceLabel };
  const optionValues = resolveOptionValues(product);
  const selection = {
    size: optionValues.size.length === 1 ? optionValues.size[0] : null,
    color: optionValues.color.length === 1 ? optionValues.color[0] : null,
    finish: optionValues.finish.length === 1 ? optionValues.finish[0] : null,
  };

  if (options.titleEl) options.titleEl.innerHTML = product.title.replace(". ", ".<br>");
  if (options.priceEl) options.priceEl.textContent = moneyText(product.price);
  if (options.editionEl && product.editionText) options.editionEl.textContent = product.editionText;
  if (options.sourceLabelEl) {
    options.sourceLabelEl.textContent = source.label;
    options.sourceLabelEl.style.setProperty("--label-color", source.color);
    options.sourceLabelEl.style.setProperty("--label-ink", readableSourceInk(source.color));
  }
  if (options.sourceDotEl) options.sourceDotEl.style.background = source.color;
  renderProductGallery(product, options);
  if (options.priceNoteEl && product.priceNote) options.priceNoteEl.textContent = product.priceNote;
  if (options.originThumbEl && product.originThumb) options.originThumbEl.src = product.originThumb;
  if (options.originLinkEl && product.originPath) options.originLinkEl.href = product.originPath;
  if (options.originTitleEl && product.originTitle) options.originTitleEl.textContent = product.originTitle;
  if (options.originMetaEl && product.originMeta) options.originMetaEl.textContent = product.originMeta;
  if (options.statusEl) options.statusEl.textContent = "";

  if (options.sizeContainer) {
    options.sizeContainer.innerHTML = optionValues.size
      .map(
        (value) =>
          `<button class="size-pill${normalizeKey(selection.size) === normalizeKey(value) ? " selected" : ""}" data-size="${value}">${value}</button>`
      )
      .join("");
    if (options.sizeValueEl) options.sizeValueEl.textContent = selection.size || "";
    options.sizeContainer.querySelectorAll(".size-pill").forEach((button) => {
      button.addEventListener("click", () => {
        selection.size =
          normalizeKey(selection.size) === normalizeKey(button.dataset.size)
            ? null
            : button.dataset.size;
        if (options.sizeValueEl) options.sizeValueEl.textContent = selection.size || "";
        options.sizeContainer.querySelectorAll(".size-pill").forEach((pill) => {
          pill.classList.toggle(
            "selected",
            normalizeKey(pill.dataset.size) === normalizeKey(selection.size)
          );
        });
        if (options.sizeRequiredEl) options.sizeRequiredEl.classList.remove("visible");
      });
    });
  }

  if (options.finishContainer) {
    options.finishContainer.innerHTML = optionValues.finish
      .map(
        (value) =>
          `<button class="finish-pill${normalizeKey(selection.finish) === normalizeKey(value) ? " selected" : ""}" data-finish="${value}">${value}</button>`
      )
      .join("");
    if (options.finishValueEl) options.finishValueEl.textContent = selection.finish || "";
    options.finishContainer.querySelectorAll(".finish-pill").forEach((button) => {
      button.addEventListener("click", () => {
        selection.finish =
          normalizeKey(selection.finish) === normalizeKey(button.dataset.finish)
            ? null
            : button.dataset.finish;
        if (options.finishValueEl) options.finishValueEl.textContent = selection.finish || "";
        options.finishContainer.querySelectorAll(".finish-pill").forEach((pill) => {
          pill.classList.toggle(
            "selected",
            normalizeKey(pill.dataset.finish) === normalizeKey(selection.finish)
          );
        });
        if (options.finishRequiredEl) options.finishRequiredEl.classList.remove("visible");
      });
    });
  }

  if (options.colorContainer) {
    options.colorContainer.innerHTML = optionValues.color
      .map(
        (value) => `
          <button class="color-swatch${normalizeKey(selection.color) === normalizeKey(value) ? " selected" : ""}"
                  style="background:${getColorHex(value, product.handle)}"
                  data-color="${value}"
                  title="${value}"></button>
        `
      )
      .join("");
    if (options.colorLabelEl) options.colorLabelEl.textContent = selection.color || "";
    options.colorContainer.querySelectorAll(".color-swatch").forEach((button) => {
      button.addEventListener("click", () => {
        selection.color =
          normalizeKey(selection.color) === normalizeKey(button.dataset.color)
            ? null
            : button.dataset.color;
        if (options.colorLabelEl) options.colorLabelEl.textContent = selection.color || "";
        options.colorContainer.querySelectorAll(".color-swatch").forEach((swatch) => {
          swatch.classList.toggle(
            "selected",
            normalizeKey(swatch.dataset.color) === normalizeKey(selection.color)
          );
        });
      });
    });
  }

  if (options.addButtonEl) {
    if (!product.availableForSale) {
      options.addButtonEl.disabled = true;
      options.addButtonEl.querySelector("span").textContent = "sold out";
      if (options.statusEl) options.statusEl.textContent = "currently unavailable";
      return;
    }

    options.addButtonEl.addEventListener("click", async () => {
      if (optionValues.size.length > 1 && !selection.size) {
        options.sizeRequiredEl?.classList.add("visible");
        return;
      }
      if (optionValues.finish.length > 1 && !selection.finish) {
        options.finishRequiredEl?.classList.add("visible");
        return;
      }
      if (optionValues.color.length > 1 && !selection.color) {
        if (options.statusEl) options.statusEl.textContent = "select a colorway";
        return;
      }

      const variant = resolveVariantBySelections(product, {
        size: selection.size || optionValues.size[0],
        finish: selection.finish || optionValues.finish[0],
        color: selection.color || optionValues.color[0],
      });

      if (!variant) {
        if (options.statusEl) options.statusEl.textContent = "that combination isn't available";
        return;
      }
      if (!variant.availableForSale) {
        if (options.statusEl) options.statusEl.textContent = "that variant is sold out";
        return;
      }

      if (options.statusEl) options.statusEl.textContent = "";
      await cart.addVariant(variant.id, 1);
    });
  }
}
