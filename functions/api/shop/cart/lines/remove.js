import { badRequest, json, readJsonBody, removeCartLines, serverError } from "../../_lib.js";

export async function onRequestPost(context) {
  const body = await readJsonBody(context.request);
  if (!body?.cartId || !Array.isArray(body.lineIds) || body.lineIds.length === 0) {
    return badRequest("Expected cartId and a non-empty lineIds array.");
  }

  try {
    const cart = await removeCartLines(context.env, body.cartId, body.lineIds);
    return json({ cart });
  } catch (error) {
    return serverError("Unable to remove Shopify cart lines.", {
      detail: error.message,
    });
  }
}
