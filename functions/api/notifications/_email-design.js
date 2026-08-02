export const EMAIL_DESIGN_NODES = Object.freeze(["tattoo", "art", "events", "studio"]);

export const EMAIL_DESIGN_ROLES = Object.freeze([
  "canvas",
  "panel",
  "title",
  "supporting",
  "descriptor",
  "signatureMark",
]);

const COLOR_ROLES = Object.freeze(["canvas", "panel", "title", "supporting", "descriptor"]);
const OPAQUE_ROLES = new Set(["canvas", "panel"]);
const THEME_NODES = Object.freeze({
  tattoo: "tattoo",
  construct_art: "art",
  construct_event: "events",
  construct_studio: "studio",
});

const DEFAULT_NODE_OVERRIDES = Object.freeze(Object.fromEntries(
  EMAIL_DESIGN_NODES.map((node) => [node, Object.freeze(Object.fromEntries(
    EMAIL_DESIGN_ROLES.map((role) => [role, null]),
  ))]),
));

export const DEFAULT_EMAIL_DESIGN_PROFILE = Object.freeze({
  version: 1,
  global: Object.freeze({
    canvas: Object.freeze({ hex: "#0E0E0E", opacity: 1 }),
    panel: Object.freeze({ hex: "#151515", opacity: 1 }),
    title: Object.freeze({ hex: "#FBD19D", opacity: 1 }),
    supporting: Object.freeze({ hex: "#FBD19D", opacity: 0.66 }),
    descriptor: Object.freeze({ hex: "#FCB867", opacity: 0.3 }),
    signatureMark: Object.freeze({ mode: "node-accent" }),
  }),
  nodes: DEFAULT_NODE_OVERRIDES,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateColor(role, input, location, errors) {
  if (!exactKeys(input, ["hex", "opacity"])) {
    errors.push(`${location} must contain only hex and opacity.`);
    return null;
  }
  const hex = String(input.hex || "");
  if (!/^#[0-9A-F]{6}$/.test(hex)) errors.push(`${location}.hex must be canonical uppercase #RRGGBB.`);
  const opacity = input.opacity;
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    errors.push(`${location}.opacity must be a number from 0 to 1.`);
  }
  if (OPAQUE_ROLES.has(role) && opacity !== 1) errors.push(`${location} must remain fully opaque.`);
  return { hex, opacity };
}

function validateSignature(input, location, errors) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push(`${location} must be a signature color setting.`);
    return null;
  }
  if (input.mode === "node-accent") {
    if (!exactKeys(input, ["mode"])) errors.push(`${location} node-accent mode cannot include other fields.`);
    return { mode: "node-accent" };
  }
  if (input.mode === "custom") {
    if (!exactKeys(input, ["mode", "color"])) errors.push(`${location} custom mode must contain only mode and color.`);
    return { mode: "custom", color: validateColor("signatureMark", input.color, `${location}.color`, errors) };
  }
  errors.push(`${location}.mode must be node-accent or custom.`);
  return null;
}

function validateRoles(input, location, nullable, errors) {
  if (!exactKeys(input, EMAIL_DESIGN_ROLES)) {
    errors.push(`${location} must contain exactly the supported design roles.`);
    return null;
  }
  const output = {};
  COLOR_ROLES.forEach((role) => {
    if (nullable && input[role] === null) output[role] = null;
    else output[role] = validateColor(role, input[role], `${location}.${role}`, errors);
  });
  if (nullable && input.signatureMark === null) output.signatureMark = null;
  else output.signatureMark = validateSignature(input.signatureMark, `${location}.signatureMark`, errors);
  return output;
}

export function validateEmailDesignProfile(input) {
  const errors = [];
  if (!exactKeys(input, ["version", "global", "nodes"])) {
    return { ok: false, errors: ["Profile must contain only version, global, and nodes."] };
  }
  if (input.version !== 1) errors.push("Profile version must be 1.");
  if (!exactKeys(input.nodes, EMAIL_DESIGN_NODES)) errors.push("Profile nodes must be tattoo, art, events, and studio.");
  const profile = {
    version: 1,
    global: validateRoles(input.global, "global", false, errors),
    nodes: {},
  };
  EMAIL_DESIGN_NODES.forEach((node) => {
    profile.nodes[node] = validateRoles(input.nodes?.[node], `nodes.${node}`, true, errors);
  });
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], profile };
}

export function defaultEmailDesignProfile() {
  return clone(DEFAULT_EMAIL_DESIGN_PROFILE);
}

export function emailDesignNodeForTheme(themeId) {
  return THEME_NODES[themeId] || "tattoo";
}

export function colorToEmailCss(color) {
  if (color.opacity === 1) return color.hex;
  const red = Number.parseInt(color.hex.slice(1, 3), 16);
  const green = Number.parseInt(color.hex.slice(3, 5), 16);
  const blue = Number.parseInt(color.hex.slice(5, 7), 16);
  const opacity = Number.isInteger(color.opacity * 100)
    ? color.opacity.toFixed(2)
    : color.opacity.toFixed(3).replace(/0+$/, "");
  return `rgba(${red},${green},${blue},${opacity})`;
}

export function resolveEmailDesign(profileInput, themeId, accentBright) {
  const validation = validateEmailDesignProfile(profileInput || defaultEmailDesignProfile());
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  const profile = validation.profile;
  const node = emailDesignNodeForTheme(themeId);
  const overrides = profile.nodes[node];
  const selected = {};
  COLOR_ROLES.forEach((role) => {
    selected[role] = colorToEmailCss(overrides[role] || profile.global[role]);
  });
  const signature = overrides.signatureMark || profile.global.signatureMark;
  selected.signatureMark = signature.mode === "custom" ? colorToEmailCss(signature.color) : accentBright;
  return { ...selected, node };
}
