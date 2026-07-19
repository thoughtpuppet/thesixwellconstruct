ALTER TABLE visual_symbols
ADD COLUMN build_guidance_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE visual_symbol_composition_rules (
  id TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('reading', 'tension')),
  interpretation TEXT NOT NULL,
  symbol_set_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retired')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE visual_symbol_composition_rule_members (
  rule_id TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  member_order INTEGER NOT NULL,
  PRIMARY KEY (rule_id, symbol_id),
  UNIQUE (rule_id, member_order),
  FOREIGN KEY (rule_id) REFERENCES visual_symbol_composition_rules(id) ON DELETE CASCADE,
  FOREIGN KEY (symbol_id) REFERENCES visual_symbols(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_visual_symbol_composition_rules_active_set
ON visual_symbol_composition_rules(rule_type, symbol_set_key)
WHERE state IN ('draft', 'published');

CREATE INDEX idx_visual_symbol_composition_rules_state_sort
ON visual_symbol_composition_rules(state, sort_order, id);

CREATE INDEX idx_visual_symbol_composition_members_symbol
ON visual_symbol_composition_rule_members(symbol_id, rule_id);
