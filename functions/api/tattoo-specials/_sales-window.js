export function effectiveTattooSpecialSalesClose(terms = {}) {
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
