export function effectiveTattooSpecialSalesClose(terms = {}) {
  // An empty sales close means the offer has no sales deadline. Null means
  // there is no active parent campaign, so the request keeps its own terms.
  if (terms.sales_closes_at === "" || terms.campaign_sales_closes_at === "") return "";
  const candidates = [
    terms.sales_closes_at,
    terms.campaign_sales_closes_at,
  ].filter(Boolean);
  let effective = "";
  let effectiveMs = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const timestamp = new Date(candidate).getTime();
    if (Number.isFinite(timestamp) && timestamp > effectiveMs) {
      effective = candidate;
      effectiveMs = timestamp;
    }
  }
  return effective;
}
