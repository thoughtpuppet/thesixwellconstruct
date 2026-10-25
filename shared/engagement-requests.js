// One public inquiry contract, shared by the booking hub and the submissions API.
export const ENGAGEMENT_CATEGORIES = Object.freeze({
  appearance: "Appearance",
  speaking: "Speaking / artist talk",
  general_consultation: "General consultation",
  interview: "Interview / press",
  collaboration: "Collaboration",
  other: "Other inquiry",
});

const FIELD_LIMITS = Object.freeze({
  name: 160, email: 254, phone: 80, organization: 200,
  project_title: 200, message: 5000, preferred_dates: 500,
  location: 300, website: 2000, budget: 300,
});

export function normalizeEngagementRequest(input) {
  const category = typeof input.category === "string" ? input.category.trim() : "";
  if (!Object.hasOwn(ENGAGEMENT_CATEGORIES, category)) {
    return { error: "Choose a supported engagement category." };
  }
  const payload = {
    type: "engagement_request",
    source_path: "/booking/",
    subject: `Construct inquiry: ${ENGAGEMENT_CATEGORIES[category]}`,
    category,
  };
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (input[field] != null && typeof input[field] !== "string") {
      return { error: `${field.replaceAll("_", " ")} must be text.` };
    }
    const value = (input[field] || "").trim();
    if (value.length > limit || /[\0]/.test(value)) {
      return { error: `${field.replaceAll("_", " ")} must be ${limit} characters or fewer.` };
    }
    payload[field] = value;
  }
  if (!payload.project_title || !payload.message) {
    return { error: "A project title and request details are required." };
  }
  if (payload.website) {
    try {
      const url = new URL(payload.website);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      return { error: "Use a full http or https website URL." };
    }
  }
  if (input.request_consent !== "yes") {
    return { error: "Please acknowledge that this is an inquiry, with no time reserved." };
  }
  payload.request_consent = "yes";
  // Ignore client-supplied lifecycle, private booking and tattoo-specific fields.
  payload._gotcha = typeof input._gotcha === "string" ? input._gotcha : "";
  payload.idempotencyKey = input.idempotencyKey || input.idempotency_key || "";
  return { payload };
}
