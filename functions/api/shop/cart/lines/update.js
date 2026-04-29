import { badRequest, json, readJsonBody, serverError, updateCartLines } from "../../_lib.js";

export async function onRequestPost(context) {
  const body = await readJsonBody(context.request);
  if (!body?.cartId || !Array.isArray(body.lines) || body.lines.length === 0) {
    return badRequest("Expected cartId and a non-empty lines array.");
  }

  try {
    const cart = await updateCartLines(
      context.env,
      body.cartId,
      body.lines.map((line) => ({
        id: line.lineId,
        quantity: Number(line.quantity || 0),
      }))
    );
    return json({ cart });
  } catch (error) {
    return serverError("Unable to update Shopify cart lines.", {
      detail: error.message,
    });
  }
}
