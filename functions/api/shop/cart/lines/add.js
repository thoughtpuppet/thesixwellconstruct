import { addCartLines, badRequest, json, readJsonBody, serverError } from "../../_lib.js";

export async function onRequestPost(context) {
  const body = await readJsonBody(context.request);
  if (!body?.cartId || !Array.isArray(body.lines) || body.lines.length === 0) {
    return badRequest("Expected cartId and a non-empty lines array.");
  }

  try {
    const cart = await addCartLines(
      context.env,
      body.cartId,
      body.lines.map((line) => ({
        merchandiseId: line.variantId,
        quantity: Number(line.quantity || 1),
      }))
    );
    return json({ cart });
  } catch (error) {
    return serverError("Unable to add Shopify cart lines.", {
      detail: error.message,
    });
  }
}
