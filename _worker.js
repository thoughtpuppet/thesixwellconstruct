import {
  addCartLines,
  badRequest,
  createCart,
  fetchCartById,
  fetchCatalog,
  fetchProductByHandle,
  json,
  readJsonBody,
  removeCartLines,
  serverError,
  updateCartLines,
} from "./functions/api/shop/_lib.js";
import { HIDDEN_PUBLIC_PATHS } from "./shared/page-visibility.js";

function notFound(message = "Not found.") {
  return json({ error: message }, { status: 404 });
}

function methodNotAllowed(method, allowed) {
  return json(
    { error: `Method ${method} not allowed.` },
    { status: 405, headers: { allow: allowed.join(", ") } }
  );
}

function isLocalPreview(url) {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  );
}

function isLocalOnlyPath(pathname) {
  return (
    pathname === "/edit-links" ||
    pathname === "/edit-links/" ||
    pathname === "/edit-links.html" ||
    pathname === "/tools/edit-links.html" ||
    pathname === "/page-visibility" ||
    pathname === "/page-visibility/" ||
    pathname === "/page-visibility.html" ||
    pathname === "/tools/page-visibility.html" ||
    pathname === "/tools/live-text-editor.js" ||
    pathname === "/js/live-text-editor.js" ||
    pathname === "/shared/page-visibility.js"
  );
}

function normalizePath(pathname) {
  let normalized = pathname || "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/index\.html$/i, "/");
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/g, "");
  return normalized || "/";
}

function isHiddenPublicPath(pathname) {
  const normalizedPath = normalizePath(pathname);
  return HIDDEN_PUBLIC_PATHS.some((hiddenPath) => {
    const normalizedHidden = normalizePath(hiddenPath);
    return normalizedPath === normalizedHidden;
  });
}

function lineInputs(lines = []) {
  return lines.map((line) => ({
    merchandiseId: line.variantId,
    quantity: Number(line.quantity || 1),
  }));
}

function lineUpdates(lines = []) {
  return lines.map((line) => ({
    id: line.lineId,
    quantity: Number(line.quantity || 0),
  }));
}

async function handleCatalog(env) {
  try {
    const products = await fetchCatalog(env);
    return json({ products });
  } catch (error) {
    return serverError("Unable to load Shopify catalog.", {
      detail: error.message,
    });
  }
}

async function handleProduct(request, env) {
  const handle = new URL(request.url).searchParams.get("handle");
  if (!handle) {
    return badRequest("Missing required query parameter: handle");
  }

  try {
    const product = await fetchProductByHandle(env, handle);
    if (!product) {
      return json({ product: null }, { status: 404 });
    }
    return json({ product });
  } catch (error) {
    return serverError("Unable to load Shopify product.", {
      detail: error.message,
    });
  }
}

async function handleGetCart(request, env) {
  const cartId = new URL(request.url).searchParams.get("cartId");
  if (!cartId) {
    return badRequest("Missing required query parameter: cartId");
  }

  try {
    const cart = await fetchCartById(env, cartId);
    if (!cart) {
      return json({ cart: null }, { status: 404 });
    }
    return json({ cart });
  } catch (error) {
    return serverError("Unable to load Shopify cart.", {
      detail: error.message,
    });
  }
}

async function handleCreateCart(env) {
  try {
    const cart = await createCart(env);
    return json({ cart });
  } catch (error) {
    return serverError("Unable to create Shopify cart.", {
      detail: error.message,
    });
  }
}

async function handleAddLines(request, env) {
  const body = await readJsonBody(request);
  if (!body?.cartId || !Array.isArray(body.lines) || body.lines.length === 0) {
    return badRequest("Expected cartId and a non-empty lines array.");
  }

  try {
    const cart = await addCartLines(env, body.cartId, lineInputs(body.lines));
    return json({ cart });
  } catch (error) {
    return serverError("Unable to add Shopify cart lines.", {
      detail: error.message,
    });
  }
}

async function handleUpdateLines(request, env) {
  const body = await readJsonBody(request);
  if (!body?.cartId || !Array.isArray(body.lines) || body.lines.length === 0) {
    return badRequest("Expected cartId and a non-empty lines array.");
  }

  try {
    const cart = await updateCartLines(env, body.cartId, lineUpdates(body.lines));
    return json({ cart });
  } catch (error) {
    return serverError("Unable to update Shopify cart lines.", {
      detail: error.message,
    });
  }
}

async function handleRemoveLines(request, env) {
  const body = await readJsonBody(request);
  if (!body?.cartId || !Array.isArray(body.lineIds) || body.lineIds.length === 0) {
    return badRequest("Expected cartId and a non-empty lineIds array.");
  }

  try {
    const cart = await removeCartLines(env, body.cartId, body.lineIds);
    return json({ cart });
  } catch (error) {
    return serverError("Unable to remove Shopify cart lines.", {
      detail: error.message,
    });
  }
}

async function handleShopApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (pathname === "/api/shop/catalog") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleCatalog(env);
  }

  if (pathname === "/api/shop/product") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleProduct(request, env);
  }

  if (pathname === "/api/shop/cart") {
    if (method !== "GET") return methodNotAllowed(method, ["GET"]);
    return handleGetCart(request, env);
  }

  if (pathname === "/api/shop/cart/create") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleCreateCart(env);
  }

  if (pathname === "/api/shop/cart/lines/add") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleAddLines(request, env);
  }

  if (pathname === "/api/shop/cart/lines/update") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleUpdateLines(request, env);
  }

  if (pathname === "/api/shop/cart/lines/remove") {
    if (method !== "POST") return methodNotAllowed(method, ["POST"]);
    return handleRemoveLines(request, env);
  }

  return notFound("Unknown shop API route.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isLocalOnlyPath(url.pathname) && !isLocalPreview(url)) {
      return notFound();
    }

    if (!isLocalPreview(url) && isHiddenPublicPath(url.pathname)) {
      return notFound();
    }

    if (url.pathname.startsWith("/api/shop/")) {
      return handleShopApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
