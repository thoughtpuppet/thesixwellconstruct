import {
  DEFAULT_MERCH_QUERY,
  deriveProductType,
  deriveSourceVenture,
  getPresentation,
  getSource,
} from "../../../shared/storefront-config.js";

const API_VERSION_FALLBACK = "2025-07";

const MONEY_FIELDS = `
  amount
  currencyCode
`;

const PRODUCT_FIELDS = `
  id
  handle
  title
  tags
  productType
  availableForSale
  featuredImage {
    url
    altText
  }
  images(first: 8) {
    nodes {
      url
      altText
    }
  }
  options {
    name
    values
  }
  priceRange {
    minVariantPrice {
      ${MONEY_FIELDS}
    }
  }
  variants(first: 50) {
    nodes {
      id
      title
      availableForSale
      price {
        ${MONEY_FIELDS}
      }
      image {
        url
        altText
      }
      selectedOptions {
        name
        value
      }
    }
  }
`;

const CART_FIELDS = `
  id
  checkoutUrl
  totalQuantity
  cost {
    subtotalAmount {
      ${MONEY_FIELDS}
    }
  }
  lines(first: 50) {
    nodes {
      id
      quantity
      attributes {
        key
        value
      }
      merchandise {
        ... on ProductVariant {
          id
          title
          availableForSale
          selectedOptions {
            name
            value
          }
          image {
            url
            altText
          }
          price {
            ${MONEY_FIELDS}
          }
          product {
            handle
            title
            tags
            productType
          }
        }
      }
    }
  }
`;

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
    status: init.status || 200,
  });
}

export function badRequest(message, extras = {}) {
  return json({ error: message, ...extras }, { status: 400 });
}

export function serverError(message, extras = {}) {
  return json({ error: message, ...extras }, { status: 500 });
}

export function getShopifyConfig(env) {
  const storeDomain = env.SHOPIFY_STORE_DOMAIN;
  const storefrontAccessToken = env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  const apiVersion = env.SHOPIFY_STOREFRONT_API_VERSION || API_VERSION_FALLBACK;
  const merchQuery = env.SHOPIFY_MERCH_QUERY || DEFAULT_MERCH_QUERY;

  if (!storeDomain || !storefrontAccessToken) {
    throw new Error(
      "Missing Shopify configuration. Expected SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN."
    );
  }

  return {
    storeDomain,
    storefrontAccessToken,
    apiVersion,
    merchQuery,
    endpoint: `https://${storeDomain}/api/${apiVersion}/graphql.json`,
  };
}

export async function storefrontRequest(env, query, variables = {}) {
  const config = getShopifyConfig(env);
  const tokenHeader = config.storefrontAccessToken.startsWith("shpat_")
    ? "Shopify-Storefront-Private-Token"
    : "X-Shopify-Storefront-Access-Token";
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [tokenHeader]: config.storefrontAccessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}

function formatMoney(money) {
  if (!money) return null;
  return {
    amount: Number(money.amount),
    currencyCode: money.currencyCode,
  };
}

function firstImage(product) {
  return product.featuredImage || product.images?.nodes?.[0] || null;
}

export function normalizeProduct(product) {
  const presentation = getPresentation(product.handle);
  const sourceVenture = deriveSourceVenture(product);
  const source = getSource(sourceVenture);
  const productType = deriveProductType(product);
  const minPrice = formatMoney(product.priceRange?.minVariantPrice);

  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    productType,
    sourceVenture,
    sourceLabel: source?.label || sourceVenture || "",
    sourceColor: source?.color || "#FCB867",
    statement: source?.statement || "",
    price: minPrice,
    heroImage: presentation.heroImage || firstImage(product)?.url || null,
    heroImageAlt:
      presentation.heroImageAlt ||
      firstImage(product)?.altText ||
      product.title,
    images: (product.images?.nodes || []).map((image) => ({
      url: image.url,
      altText: image.altText || product.title,
    })),
    editionText:
      presentation.editionText ||
      null,
    tags: product.tags || [],
    availableForSale: Boolean(product.availableForSale),
    options: (product.options || []).map((option) => ({
      name: option.name,
      values: option.values || [],
    })),
    variants: (product.variants?.nodes || []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      availableForSale: Boolean(variant.availableForSale),
      price: formatMoney(variant.price),
      image: variant.image?.url || null,
      imageAlt: variant.image?.altText || product.title,
      selectedOptions: (variant.selectedOptions || []).map((option) => ({
        name: option.name,
        value: option.value,
      })),
    })),
    pagePath: presentation.pagePath || null,
    catalogNumber: presentation.catalogNumber || null,
    priceNote: presentation.priceNote || null,
    originTitle: presentation.originTitle || null,
    originPath: presentation.originPath || null,
    originThumb: presentation.originThumb || null,
    originMeta: presentation.originMeta || null,
    medium: presentation.medium || null,
    dimensions: presentation.dimensions || null,
    year: presentation.year || null,
    relatedHandles: presentation.relatedHandles || [],
  };
}

function normalizeCartLine(line) {
  const variant = line.merchandise;
  const product = variant?.product;
  const normalizedProduct = product ? normalizeProduct(product) : null;

  return {
    id: line.id,
    quantity: line.quantity,
    merchandiseId: variant?.id || null,
    title: product?.title || variant?.title || "",
    variantTitle: variant?.title || "",
    handle: product?.handle || null,
    price: formatMoney(variant?.price),
    image: variant?.image?.url || normalizedProduct?.heroImage || null,
    imageAlt: variant?.image?.altText || product?.title || "",
    selectedOptions: variant?.selectedOptions || [],
    sourceVenture: normalizedProduct?.sourceVenture || null,
    sourceLabel: normalizedProduct?.sourceLabel || "",
    sourceColor: normalizedProduct?.sourceColor || "#FCB867",
    pagePath: normalizedProduct?.pagePath || null,
  };
}

export function normalizeCart(cart) {
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQuantity: cart.totalQuantity || 0,
    subtotal: formatMoney(cart.cost?.subtotalAmount),
    lines: (cart.lines?.nodes || []).map(normalizeCartLine),
  };
}

export async function fetchCatalog(env) {
  const config = getShopifyConfig(env);
  const data = await storefrontRequest(
    env,
    `#graphql
      query CatalogProducts($first: Int!, $query: String) {
        products(first: $first, sortKey: TITLE, query: $query) {
          nodes {
            ${PRODUCT_FIELDS}
          }
        }
      }
    `,
    { first: 50, query: config.merchQuery }
  );

  return (data.products?.nodes || []).map(normalizeProduct);
}

export async function fetchProductByHandle(env, handle) {
  const data = await storefrontRequest(
    env,
    `#graphql
      query ProductByHandle($handle: String!) {
        product(handle: $handle) {
          ${PRODUCT_FIELDS}
        }
      }
    `,
    { handle }
  );

  if (data.product) {
    return normalizeProduct(data.product);
  }

  const fallback = await storefrontRequest(
    env,
    `#graphql
      query ProductSearch($first: Int!, $query: String!) {
        products(first: $first, query: $query) {
          nodes {
            ${PRODUCT_FIELDS}
          }
        }
      }
    `,
    { first: 1, query: `handle:${handle}` }
  );

  return fallback.products?.nodes?.[0]
    ? normalizeProduct(fallback.products.nodes[0])
    : null;
}

export async function fetchCartById(env, cartId) {
  const data = await storefrontRequest(
    env,
    `#graphql
      query CartById($id: ID!) {
        cart(id: $id) {
          ${CART_FIELDS}
        }
      }
    `,
    { id: cartId }
  );

  return data.cart ? normalizeCart(data.cart) : null;
}

function unwrapCartPayload(payload) {
  const firstKey = Object.keys(payload)[0];
  const result = payload[firstKey];
  const errors = [
    ...(result?.userErrors || []).map((error) => error.message),
    ...(result?.warnings || []).map((warning) => warning.message),
  ].filter(Boolean);

  if (result?.userErrors?.length) {
    throw new Error(errors.join("; "));
  }

  return normalizeCart(result.cart);
}

export async function createCart(env) {
  const data = await storefrontRequest(
    env,
    `#graphql
      mutation CartCreate {
        cartCreate {
          cart {
            ${CART_FIELDS}
          }
          userErrors {
            field
            message
          }
          warnings {
            code
            message
          }
        }
      }
    `
  );

  return unwrapCartPayload(data);
}

export async function addCartLines(env, cartId, lines) {
  const data = await storefrontRequest(
    env,
    `#graphql
      mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cartId, lines: $lines) {
          cart {
            ${CART_FIELDS}
          }
          userErrors {
            field
            message
          }
          warnings {
            code
            message
          }
        }
      }
    `,
    { cartId, lines }
  );

  return unwrapCartPayload(data);
}

export async function updateCartLines(env, cartId, lines) {
  const data = await storefrontRequest(
    env,
    `#graphql
      mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cartId, lines: $lines) {
          cart {
            ${CART_FIELDS}
          }
          userErrors {
            field
            message
          }
          warnings {
            code
            message
          }
        }
      }
    `,
    { cartId, lines }
  );

  return unwrapCartPayload(data);
}

export async function removeCartLines(env, cartId, lineIds) {
  const data = await storefrontRequest(
    env,
    `#graphql
      mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
        cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
          cart {
            ${CART_FIELDS}
          }
          userErrors {
            field
            message
          }
          warnings {
            code
            message
          }
        }
      }
    `,
    { cartId, lineIds }
  );

  return unwrapCartPayload(data);
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export { json };
