import { handleMerchCatalog } from "../merch/_lib.js";

export async function onRequestGet(context) {
  return handleMerchCatalog(context.request, context.env);
}
