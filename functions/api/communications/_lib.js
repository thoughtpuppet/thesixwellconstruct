import { db, failure, json, readJson, requireStudioAdmin } from "../_shared/construct.js";

export const MANUAL_TEXT_TEMPLATE_DEFINITIONS = [
  {
    key: "opening_tattoo",
    label: "Tattoo opening",
    group: "Opening",
    allowedTokens: ["greeting", "first_name"],
    defaultBody: "{{greeting}} {{first_name}}, this is Sai Solehman of art.pill TATTOO HOUSE.",
  },
  {
    key: "opening_sixwell",
    label: "Six.Well opening",
    group: "Opening",
    allowedTokens: ["greeting", "first_name"],
    defaultBody: "{{greeting}} {{first_name}}, this is the six.well construct.",
  },
  {
    key: "closing_tattoo",
    label: "Tattoo sign-off",
    group: "Closing",
    allowedTokens: [],
    defaultBody: "Thank you for trusting me with your tattoo. If any questions come up, feel free to reach out.",
  },
  {
    key: "event_confirmed",
    label: "Event confirmed",
    group: "Events",
    allowedTokens: ["event_title"],
    defaultBody: "Your spot for {{event_title}} is confirmed and paid. See you there — reply here if anything changes.",
  },
  {
    key: "event_received",
    label: "Event RSVP received",
    group: "Events",
    allowedTokens: ["event_title"],
    defaultBody: "We saw your RSVP for {{event_title}}. Your seat is held once Square payment clears — reply here if you need a hand.",
  },
  {
    key: "studio_confirmed",
    label: "Studio booking confirmed",
    group: "Studio",
    allowedTokens: ["booking_label"],
    defaultBody: "Your {{booking_label}} is confirmed. Keep an eye on your email for arrival details, and reply here if anything changes.",
  },
  {
    key: "studio_received",
    label: "Studio request received",
    group: "Studio",
    allowedTokens: ["booking_label"],
    defaultBody: "We received your {{booking_label}} request and will follow up with next steps. Thank you.",
  },
  {
    key: "tattoo_appointment_confirmed",
    label: "Tattoo appointment confirmed",
    group: "Tattoo",
    allowedTokens: [],
    defaultBody: "Your appointment is confirmed. Keep an eye on your email for studio follow-up before the session.",
  },
  {
    key: "tattoo_special_approved",
    label: "Tattoo Special approved",
    group: "Tattoo",
    allowedTokens: ["booking_url"],
    defaultBody: "Your Tattoo Special request has been approved. Review your approved request and pay the deposit to confirm your appointment here: {{booking_url}}",
  },
  {
    key: "tattoo_consultation_required",
    label: "Consultation required",
    group: "Tattoo",
    allowedTokens: ["booking_url"],
    defaultBody: "Your project needs an in-person consultation before tattoo booking. You can choose a consultation time and place the deposit here: {{booking_url}}",
  },
  {
    key: "tattoo_booking_approved",
    label: "Tattoo approved for booking",
    group: "Tattoo",
    allowedTokens: ["approved_budget_sentence", "booking_url"],
    defaultBody: "Your project has been approved for booking. {{approved_budget_sentence}} Review and agree to the session estimate and budget, choose your appointment, and place the deposit here: {{booking_url}}",
  },
  {
    key: "tattoo_inquiry_received",
    label: "Tattoo inquiry received",
    group: "Tattoo",
    allowedTokens: [],
    defaultBody: "We received your inquiry and will review the project details before sending booking access.",
  },
];

const DEFINITION_BY_KEY = new Map(MANUAL_TEXT_TEMPLATE_DEFINITIONS.map((definition) => [definition.key, definition]));
const TOKEN_PATTERN = /{{\s*([^{}]+?)\s*}}/g;

export function validateManualTextTemplate(templateKey, body) {
  const definition = DEFINITION_BY_KEY.get(String(templateKey || ""));
  if (!definition) return { ok: false, error: "Unknown text template." };
  const source = typeof body === "string" ? body.trim() : "";
  if (!source) return { ok: false, error: "Template text is required." };
  if (source.length > 2000) return { ok: false, error: "Template text must be 2,000 characters or fewer." };
  const unknownTokens = [...source.matchAll(TOKEN_PATTERN)]
    .map((match) => match[1].trim())
    .filter((token) => !definition.allowedTokens.includes(token));
  if (unknownTokens.length) {
    return { ok: false, error: `Unsupported template variable: {{${unknownTokens[0]}}}.` };
  }
  return { ok: true, definition, body: source };
}

function presentTemplate(definition, row) {
  return {
    key: definition.key,
    label: definition.label,
    group: definition.group,
    allowedTokens: definition.allowedTokens,
    defaultBody: definition.defaultBody,
    body: row?.body_text || definition.defaultBody,
    updatedAt: row?.updated_at || "",
  };
}

async function manualTextTemplates(database) {
  const result = await database.prepare(
    "SELECT template_key,body_text,updated_at FROM manual_text_templates ORDER BY template_key"
  ).all();
  const rows = new Map((result.results || []).map((row) => [row.template_key, row]));
  return MANUAL_TEXT_TEMPLATE_DEFINITIONS.map((definition) => presentTemplate(definition, rows.get(definition.key)));
}

export async function handleAdminManualTextTemplates(request, env) {
  const authError = requireStudioAdmin(request, env);
  if (authError) return authError;
  try {
    const database = db(env);
    if (request.method === "GET") {
      return json({ templates: await manualTextTemplates(database) });
    }
    if (request.method !== "PATCH") {
      return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "GET, PATCH" } });
    }
    const payload = await readJson(request);
    if (!payload) return failure("Expected JSON body.");
    const validation = validateManualTextTemplate(payload.templateKey, payload.body);
    if (!validation.ok) return failure(validation.error, 422);
    const timestamp = new Date().toISOString();
    await database.prepare(
      `INSERT INTO manual_text_templates (template_key,body_text,updated_by,updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(template_key) DO UPDATE SET
         body_text=excluded.body_text,
         updated_by=excluded.updated_by,
         updated_at=excluded.updated_at`
    ).bind(validation.definition.key, validation.body, "studio", timestamp).run();
    const row = await database.prepare(
      "SELECT template_key,body_text,updated_at FROM manual_text_templates WHERE template_key=? LIMIT 1"
    ).bind(validation.definition.key).first();
    return json({ ok: true, template: presentTemplate(validation.definition, row) });
  } catch (error) {
    return failure("Unable to manage manual text templates.", 500, { message: error.message });
  }
}
