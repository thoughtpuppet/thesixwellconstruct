export const DEFAULT_MERCH_QUERY = "tag:construct-merch";

function tokenColor(name, fallback) {
  if (typeof window === "undefined" || !window.getComputedStyle) return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export const SOURCES = {
  "six.well": {
    label: "six.well clothing",
    color: tokenColor("--color-merch", "#F08F00"),
    brightColor: tokenColor("--color-merch-bright", "#FF9933"),
    statement: "garments from the construct's own hand",
    logo: "/assets/brand/six-well-clothing.svg.svg",
    logoAlt: "Six.Well Clothing logo",
  },
  thoughtpuppet: {
    label: "thoughtpuppet",
    color: tokenColor("--color-art", "#0039BD"),
    brightColor: tokenColor("--color-art-bright", "#2054FF"),
    statement: "objects that carry the paintings outward",
  },
  "art.pill": {
    label: "art.pill Tattoo Supply",
    color: tokenColor("--color-tattooing", "#6E0404"),
    brightColor: tokenColor("--color-tattooing-bright", "#BE281F"),
    statement: "materials behind the marks",
    logo: "/assets/brand/art-pill-tattoo-house.svg.svg",
    logoAlt: "art.pill Tattoo House logo",
  },
  greenfield: {
    label: "GREEN[FIELD]",
    color: tokenColor("--color-events", "#005D25"),
    brightColor: tokenColor("--color-events-bright", "#2E8B57"),
    statement: "event artifacts from the construct's live gathering field",
  },
};

export const SOURCE_ORDER = ["six.well", "thoughtpuppet", "art.pill", "greenfield"];

const SOURCE_ALIASES = {
  "six well": "six.well",
  sixwell: "six.well",
  "six.well clothing": "six.well",
  "six well clothing": "six.well",
  clothing: "six.well",
  merch: "six.well",
  artpill: "art.pill",
  "art pill": "art.pill",
  "art.pill tattoo house": "art.pill",
  "art.pill tattoo supply": "art.pill",
  "art pill tattoo house": "art.pill",
  "art pill tattoo supply": "art.pill",
  "green[field]": "greenfield",
  "green field": "greenfield",
  tattooing: "art.pill",
  tattoo: "art.pill",
  art: "thoughtpuppet",
  "art making": "thoughtpuppet",
};

export const TYPE_LABELS = {
  apparel: "apparel",
  print: "prints",
  painting: "paintings",
  supply: "supply",
  other: "other",
};

export const COLOR_SWATCHS = {
  black: "#1a1a1a",
  slate: "#4a4a5a",
  bone: "#e8e4d8",
  beige: "#d9c6a1",
  ash: "#6b6b6b",
  ecru: "#c8c0a8",
  marbles: "#2a2a2a",
};

export const PRODUCT_PRESENTATION = {
  "six-well-clothing": {
    catalogNumber: "01",
    pagePath: "/merch/six-well-clothing/",
    sourceVenture: "six.well",
    productType: "apparel",
    editionText: "coming soon",
  },
  "lostmarbles-hoodie": {
    catalogNumber: "05",
    pagePath: "/merch/lostmarbles-hoodie/",
    sourceVenture: "thoughtpuppet",
    productType: "apparel",
    editionText: "limited edition - 30 pieces",
    defaultColorway: "beige",
    swatchHexes: { beige: "#d9c6a1" },
    originTitle: "AM I LOSING MY MARBLES OR HIDING THEM?",
    originPath: "/art/lostmarblespainting.html",
    originThumb: "/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg",
    originMeta: "2023 · acrylic on wood panel",
    relatedHandles: ["marbles-print"],
  },
  "marbles-print": {
    catalogNumber: "06",
    pagePath: "/merch/marbles-print/",
    sourceVenture: "thoughtpuppet",
    productType: "print",
    editionText: "edition of 50",
    heroImage: "/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg",
    priceNote: "giclee archival print. ships flat.",
    originTitle: "AM I LOSING MY MARBLES OR HIDING THEM?",
    originPath: "/art/lostmarblespainting.html",
    originThumb: "/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg",
    originMeta: "acrylic on canvas · 2023",
    relatedHandles: ["lostmarbles-hoodie"],
  },
  "maze-puffer-jacket": {
    catalogNumber: "09",
    pagePath: "/merch/maze-puffer-jacket/",
    sourceVenture: "art.pill",
    productType: "apparel",
    heroImage: "/assets/flash/IMG_8898.jpg",
    heroImageAlt: "MAZE Puffer Jacket — placeholder",
    editionText: "coming soon",
    defaultColorway: "black",
    swatchHexes: { black: "#1a1a1a" },
  },
};

function readTagValue(tags, prefixes) {
  for (const prefix of prefixes) {
    const match = tags.find((tag) => tag.toLowerCase().startsWith(prefix));
    if (match) return match.slice(prefix.length);
  }
  return null;
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function canonicalSourceKey(value) {
  const raw = String(value || "").trim();
  if (SOURCES[raw]) return raw;
  const normalized = normalizeKey(raw);
  if (SOURCES[normalized]) return normalized;
  return SOURCE_ALIASES[normalized] || raw || null;
}

export function getPresentation(handle) {
  return PRODUCT_PRESENTATION[handle] || {};
}

export function getSource(sourceKey) {
  return SOURCES[sourceKey] || null;
}

export function deriveSourceVenture(product) {
  const presentation = getPresentation(product.handle);
  const fromTag = readTagValue(product.tags || [], ["venture:", "source:"]);
  return canonicalSourceKey(presentation.sourceVenture || fromTag || product.sourceVenture || product.sourceLabel);
}

export function deriveProductType(product) {
  const presentation = getPresentation(product.handle);
  const fromTag = readTagValue(product.tags || [], ["merch:type:", "type:"]);
  const normalized = normalizeKey(fromTag || product.productType);
  if (normalized.includes("print")) return "print";
  if (normalized.includes("paint")) return "painting";
  if (normalized.includes("apparel")) return "apparel";
  if (normalized.includes("hoodie")) return "apparel";
  if (normalized.includes("shirt")) return "apparel";
  if (normalized.includes("tee")) return "apparel";
  if (normalized.includes("cap")) return "apparel";
  if (normalized.includes("supply")) return "supply";
  return presentation.productType || "other";
}

export function getColorHex(colorName, productHandle) {
  const presentation = getPresentation(productHandle);
  const normalized = normalizeKey(colorName);
  return (
    (presentation.swatchHexes && presentation.swatchHexes[normalized]) ||
    COLOR_SWATCHS[normalized] ||
    "#1a1a1a"
  );
}

export function getTypeLabel(typeKey) {
  return TYPE_LABELS[typeKey] || TYPE_LABELS.other;
}
