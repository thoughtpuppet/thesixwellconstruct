import { badRequest, fetchProductByHandle, json, serverError } from "./_lib.js";

export async function onRequestGet(context) {
  const handle = new URL(context.request.url).searchParams.get("handle");
  if (!handle) {
    return badRequest("Missing required query parameter: handle");
  }

  try {
    const product = await fetchProductByHandle(context.env, handle);
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
