import { createCart, json, serverError } from "../_lib.js";

export async function onRequestPost(context) {
  try {
    const cart = await createCart(context.env);
    return json({ cart });
  } catch (error) {
    return serverError("Unable to create Shopify cart.", {
      detail: error.message,
    });
  }
}
