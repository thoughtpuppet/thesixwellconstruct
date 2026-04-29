import { fetchCatalog, json, serverError } from "./_lib.js";

export async function onRequestGet(context) {
  try {
    const products = await fetchCatalog(context.env);
    return json({ products });
  } catch (error) {
    return serverError("Unable to load Shopify catalog.", {
      detail: error.message,
    });
  }
}
