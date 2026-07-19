const MAX_APPLIED_RULES = 3;
const MAX_SHARED_THEMES = 5;

function clean(value, maximum = 5000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function orderedSelectedSymbols(symbols, selectedIds) {
  const byId = new Map((Array.isArray(symbols) ? symbols : []).map((symbol) => [clean(symbol?.id, 200), symbol]));
  return unique((Array.isArray(selectedIds) ? selectedIds : []).map((value) => clean(value, 200)))
    .map((symbolId) => byId.get(symbolId))
    .filter(Boolean);
}

function normalizedRule(rule) {
  const symbolIds = unique(
    (Array.isArray(rule?.symbolIds) ? rule.symbolIds : Array.isArray(rule?.symbol_ids) ? rule.symbol_ids : [])
      .map((value) => clean(value, 200))
  );
  return {
    id: clean(rule?.id, 200),
    type: clean(rule?.type || rule?.ruleType || rule?.rule_type, 40).toLowerCase(),
    interpretation: clean(rule?.interpretation || rule?.reading, 5000),
    symbolIds,
    sortOrder: Number(rule?.sortOrder ?? rule?.sort_order) || 0,
  };
}

function sharedThemeSummary(symbols) {
  const counts = new Map();
  for (const symbol of symbols) {
    const themes = unique((Array.isArray(symbol?.themes) ? symbol.themes : []).map((theme) => clean(theme, 80).toLowerCase()));
    for (const theme of themes) counts.set(theme, (counts.get(theme) || 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_SHARED_THEMES)
    .map(([theme]) => theme);
}

function openReading(symbols, sharedThemes) {
  if (!symbols.length) return "";
  if (symbols.length === 1) {
    const symbol = symbols[0];
    const meaning = clean(symbol?.meaning, 1200);
    return meaning
      ? `Within the Legend, ${clean(symbol?.name, 200)} carries this core meaning: ${meaning} Your personal description can define how that meaning lives in this piece.`
      : `Within the Legend, ${clean(symbol?.name, 200)} remains open to the meaning you name in your personal description and Design Intent.`;
  }
  const names = symbols.length <= 3
    ? symbols.map((symbol) => clean(symbol?.name, 200)).join(", ")
    : `${symbols.length} selected symbols`;
  const officialMeanings = symbols.length <= 3
    ? symbols
      .map((symbol) => `${clean(symbol?.name, 200)}: ${clean(symbol?.meaning, 360)}`)
      .filter((entry) => !entry.endsWith(": "))
      .join(" ")
    : "";
  if (sharedThemes.length) {
    const meanings = officialMeanings ? ` Their official meanings are: ${officialMeanings}` : "";
    return `Within the Legend, ${names} share themes of ${sharedThemes.join(", ")}.${meanings} That overlap may suggest a relationship, while your personal descriptions and Design Intent define how it lives in the piece.`;
  }
  const meanings = officialMeanings ? ` Their official meanings remain distinct: ${officialMeanings}` : "";
  return `Within the Legend, no fixed relationship has been authored for ${names}.${meanings} The composition remains open; use your personal descriptions and Design Intent to name what connects them.`;
}

export function buildCompositionSnapshot({ symbols = [], rules = [], selectedIds = [] } = {}) {
  const selectedSymbols = orderedSelectedSymbols(symbols, selectedIds);
  const normalizedSelectedIds = selectedSymbols.map((symbol) => clean(symbol.id, 200));
  const selectedSet = new Set(normalizedSelectedIds);
  const matchingRules = (Array.isArray(rules) ? rules : [])
    .map(normalizedRule)
    .filter((rule) =>
      rule.id
      && ["reading", "tension"].includes(rule.type)
      && rule.interpretation
      && rule.symbolIds.length >= 2
      && rule.symbolIds.every((symbolId) => selectedSet.has(symbolId))
    )
    .sort((a, b) => {
      const aExact = a.symbolIds.length === normalizedSelectedIds.length ? 1 : 0;
      const bExact = b.symbolIds.length === normalizedSelectedIds.length ? 1 : 0;
      return bExact - aExact
        || b.symbolIds.length - a.symbolIds.length
        || a.sortOrder - b.sortOrder
        || a.id.localeCompare(b.id);
    });
  const exactRule = matchingRules.find((rule) => rule.symbolIds.length === normalizedSelectedIds.length);
  const applied = (exactRule ? [exactRule] : matchingRules).slice(0, MAX_APPLIED_RULES);
  const sharedThemes = sharedThemeSummary(selectedSymbols);
  const reading = applied.length
    ? applied.length === 1
      ? `One possible reading within the Legend: ${applied[0].interpretation}`
      : `Within the Legend, this composition contains ${applied.length} authored relationships. ${applied.map((rule) => rule.interpretation).join(" ")}`
    : openReading(selectedSymbols, sharedThemes);
  return {
    version: 1,
    selectedSymbolIds: normalizedSelectedIds,
    appliedRules: applied.map((rule) => ({
      id: rule.id,
      type: rule.type,
      interpretation: rule.interpretation,
      symbolIds: [...rule.symbolIds],
      exact: rule.symbolIds.length === normalizedSelectedIds.length,
    })),
    sharedThemes,
    reading,
  };
}

export function relatedSymbolIds(rules = [], symbolId = "") {
  const currentId = clean(symbolId, 200);
  if (!currentId) return [];
  return unique(
    (Array.isArray(rules) ? rules : [])
      .map(normalizedRule)
      .filter((rule) => rule.symbolIds.includes(currentId))
      .flatMap((rule) => rule.symbolIds.filter((id) => id !== currentId))
  );
}

export function normalizeCompositionSnapshot(value) {
  let snapshot = value;
  if (typeof snapshot === "string") {
    try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; }
  }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const selectedSymbolIds = unique(
    (Array.isArray(snapshot.selectedSymbolIds) ? snapshot.selectedSymbolIds : [])
      .slice(0, 12)
      .map((id) => clean(id, 200))
  );
  const appliedRules = (Array.isArray(snapshot.appliedRules) ? snapshot.appliedRules : [])
    .slice(0, MAX_APPLIED_RULES)
    .map(normalizedRule)
    .filter((rule) => rule.id && rule.interpretation && ["reading", "tension"].includes(rule.type))
    .map((rule) => ({
      id: rule.id,
      type: rule.type,
      interpretation: rule.interpretation,
      symbolIds: rule.symbolIds.slice(0, 12),
      exact: Boolean(snapshot.appliedRules?.find((entry) => clean(entry?.id, 200) === rule.id)?.exact),
    }));
  return {
    version: 1,
    selectedSymbolIds,
    appliedRules,
    sharedThemes: unique(
      (Array.isArray(snapshot.sharedThemes) ? snapshot.sharedThemes : [])
        .slice(0, MAX_SHARED_THEMES)
        .map((theme) => clean(theme, 80))
    ),
    reading: clean(snapshot.reading, 8000),
  };
}
