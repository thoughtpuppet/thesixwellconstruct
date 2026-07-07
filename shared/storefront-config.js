export const DEFAULT_MERCH_QUERY = "tag:construct-merch";

function tokenColor(name, fallback) {
  if (typeof window === "undefined" || !window.getComputedStyle) return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export const SOURCES = {
  "six.well": {
    label: "six.well clothing",
    color: tokenColor("--color-merch", "#F08F15"),
    statement: "garments from the construct's own hand",
    logo: "/assets/brand/six-well-clothing.svg.svg",
    logoAlt: "Six.Well Clothing logo",
  },
  thoughtpuppet: {
    label: "thoughtpuppet",
    color: tokenColor("--color-art", "#0039BD"),
    statement: "objects that carry the paintings outward",
  },
  "art.pill": {
    label: "art.pill Tattoo Supply",
    color: tokenColor("--color-tattooing", "#6E0404"),
    statement: "materials behind the marks",
    logo: "/assets/brand/art-pill-tattoo-house.svg.svg",
    logoAlt: "art.pill Tattoo House logo",
  },
};

export const SOURCE_ORDER = ["six.well", "thoughtpuppet", "art.pill"];

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
    pagePath: null,
    sourceVenture: "six.well",
    productType: "apparel",
    editionText: "coming soon",
  },
  "lostmarbles-hoodie": {
    catalogNumber: "05",
    pagePath: "/merch/lostmarbles-hoodie.html",
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
    pagePath: "/merch/marbles-print.html",
    sourceVenture: "thoughtpuppet",
    productType: "print",
    editionText: "edition of 50",
    heroImage: "/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg",
    priceNote: "giclee archival print. ships flat.",
    originTitle: "AM I LOSING MY MARBLES OR HIDING THEM?",
    originPath: "/merch/am-i-losing-my-marbles.html",
    originThumb: "/assets/paintings/am-i-losing-my-marbles-or-hiding-them.jpg",
    originMeta: "acrylic on canvas · 2023",
    relatedHandles: ["lostmarbles-hoodie"],
  },
  "am-i-losing-my-marbles": {
    catalogNumber: "08",
    pagePath: "/merch/am-i-losing-my-marbles.html",
    sourceVenture: "thoughtpuppet",
    productType: "painting",
    medium: "acrylic on canvas",
    dimensions: "36 × 48 in",
    year: "2023",
  },
  "maze-puffer-jacket": {
    catalogNumber: "09",
    pagePath: null,
    sourceVenture: "art.pill",
    productType: "apparel",
    heroImage: "/assets/flash/IMG_8898.jpg",
    heroImageAlt: "MAZE Puffer Jacket — placeholder",
    editionText: "coming soon",
    defaultColorway: "black",
    swatchHexes: { black: "#1a1a1a" },
  },
};

export const PLACEHOLDER_PRODUCTS = [
  {
    id: "placeholder-six-well-clothing",
    handle: "six-well-clothing",
    title: "SIX.WELL CLOTHING",
    tags: [],
    productType: "apparel",
    sourceVenture: "six.well",
    sourceLabel: "six.well clothing",
    price: null,
    availableForSale: false,
    options: [],
    variants: [],
    images: [],
    catalogNumber: "01",
    editionText: "coming soon",
    pagePath: null,
    isPlaceholder: true,
  },
  {
    id: "placeholder-maze-puffer",
    handle: "maze-puffer-jacket",
    title: "MAZE Puffer Jacket",
    tags: [],
    productType: "apparel",
    sourceVenture: "art.pill",
    sourceLabel: "art.pill Tattoo Supply",
    price: null,
    availableForSale: false,
    options: [{ name: "Color", values: ["Black"] }],
    variants: [],
    images: [],
    heroImage: "/assets/flash/IMG_8898.jpg",
    heroImageAlt: "MAZE Puffer Jacket — placeholder",
    catalogNumber: "09",
    editionText: "coming soon",
    pagePath: null,
    isPlaceholder: true,
  },
];

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
    .replace(/\s+/g, " ");
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
  return presentation.sourceVenture || fromTag || null;
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
