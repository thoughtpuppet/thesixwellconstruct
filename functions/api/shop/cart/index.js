import { badRequest, fetchCartById, json, serverError } from "../_lib.js";

export async function onRequestGet(context) {
  const cartId = new URL(context.request.url).searchParams.get("cartId");
  if (!cartId) {
    return badRequest("Missing required query parameter: cartId");
  }

  try {
    const cart = await fetchCartById(context.env, cartId);
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
