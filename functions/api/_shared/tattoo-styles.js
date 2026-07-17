const DEFAULT_STYLE = "unclassified";
const MAX_STYLES = 20;
const MAX_QUERY_IDS = 100;

export class TattooStyleValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TattooStyleValidationError";
    this.status = 422;
  }
}

function normalizedValues(values) {
  if (!Array.isArray(values)) throw new TattooStyleValidationError("Styles must be an array of option keys.");
  const normalized = [];
  const seen = new Set();
  for (const rawValue of values) {
    if (typeof rawValue !== "string") throw new TattooStyleValidationError("Every style must be an option key.");
    const value = rawValue.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  if (normalized.length > 1) {
    const fallbackIndex = normalized.findIndex((value) => value.toLowerCase() === DEFAULT_STYLE);
    if (fallbackIndex !== -1) normalized.splice(fallbackIndex, 1);
  }
  if (!normalized.length) normalized.push(DEFAULT_STYLE);
  if (normalized.length > MAX_STYLES) throw new TattooStyleValidationError(`Choose no more than ${MAX_STYLES} styles.`);
  return normalized;
}

export async function resolveTattooStyleSelection(database, values, { currentValues = [] } = {}) {
  const requested = normalizedValues(values);
  const current = new Set((Array.isArray(currentValues) ? currentValues : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  const result = await database.prepare(`
    SELECT id, value, label, enabled, sort_order
    FROM portfolio_options
    WHERE kind = 'style'
    ORDER BY sort_order, label COLLATE NOCASE
  `).all();
  const byValue = new Map((result.results || []).map((row) => [String(row.value || "").toLowerCase(), row]));
  return requested.map((requestedValue, index) => {
    const row = byValue.get(requestedValue.toLowerCase());
    if (!row) throw new TattooStyleValidationError(`Unknown tattoo style: ${requestedValue}.`);
    if (Number(row.enabled || 0) !== 1 && !current.has(String(row.value || "").toLowerCase())) {
      throw new TattooStyleValidationError(`Tattoo style is disabled: ${row.label || row.value}.`);
    }
    return {
      optionId: row.id,
      value: row.value,
      label: row.label || row.value,
      enabled: Number(row.enabled || 0) === 1,
      isPrimary: index === 0,
      sortOrder: index + 1,
    };
  });
}

export async function loadTattooStyleAssignments(database, entityIds) {
  const ids = [...new Set((Array.isArray(entityIds) ? entityIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
  const grouped = new Map(ids.map((entityId) => [entityId, []]));
  if (!ids.length) return grouped;
  for (let start = 0; start < ids.length; start += MAX_QUERY_IDS) {
    const chunk = ids.slice(start, start + MAX_QUERY_IDS);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await database.prepare(`
      SELECT assignment.entity_id, assignment.is_primary, assignment.sort_order,
        option_row.id AS option_id, option_row.value, option_row.label, option_row.enabled
      FROM tattoo_item_styles assignment
      JOIN portfolio_options option_row
        ON option_row.id = assignment.style_option_id AND option_row.kind = 'style'
      WHERE assignment.entity_id IN (${placeholders})
      ORDER BY assignment.entity_id, assignment.is_primary DESC,
        assignment.sort_order, option_row.sort_order, option_row.label COLLATE NOCASE
    `).bind(...chunk).all();
    for (const row of result.results || []) {
      if (!grouped.has(row.entity_id)) grouped.set(row.entity_id, []);
      grouped.get(row.entity_id).push({
        optionId: row.option_id,
        value: row.value,
        label: row.label || row.value,
        enabled: Number(row.enabled || 0) === 1,
        isPrimary: Number(row.is_primary || 0) === 1,
        sortOrder: Number(row.sort_order || 0),
      });
    }
  }
  return grouped;
}

export function tattooStylePayload(assignments, { fallbackValue = "", fallbackLabel = "" } = {}) {
  const ordered = Array.isArray(assignments) ? assignments : [];
  const primary = ordered.find((entry) => entry.isPrimary) || ordered[0] || null;
  const primaryStyle = primary?.value || fallbackValue;
  const styles = ordered.length ? ordered.map((entry) => entry.value) : (primaryStyle ? [primaryStyle] : []);
  const styleLabels = ordered.length
    ? ordered.map((entry) => entry.label || entry.value)
    : (primaryStyle ? [fallbackLabel || primaryStyle] : []);
  return {
    styles,
    styleLabels,
    primaryStyle,
    primaryStyleLabel: primary?.label || fallbackLabel || primaryStyle,
  };
}

export function replaceTattooStyleAssignmentStatements(database, entityId, assignments) {
  const statements = [database.prepare("DELETE FROM tattoo_item_styles WHERE entity_id = ?").bind(entityId)];
  for (const assignment of assignments || []) {
    statements.push(database.prepare(`
      INSERT INTO tattoo_item_styles(
        entity_id, style_option_id, is_primary, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(entityId, assignment.optionId, assignment.isPrimary ? 1 : 0, Number(assignment.sortOrder || 0)));
  }
  return statements;
}
