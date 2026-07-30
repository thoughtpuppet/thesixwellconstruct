import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { handleConstructApi } from "../functions/api/construct/_lib.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4175);
const host = process.env.HOST || "127.0.0.1";
const token = process.env.SWC_PREVIEW_ADMIN_TOKEN || "browser-colors-token";

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    const statement = this.database.prepare(this.sql);
    if (statement.sourceSQL.trimStart().toUpperCase().startsWith("SELECT")) {
      return { results: statement.all(...this.values) };
    }
    const result = statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class LocalD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const name of readdirSync(path.join(root, "migrations")).filter((value) => value.endsWith(".sql")).sort()) {
  sqlite.exec(readFileSync(path.join(root, "migrations", name), "utf8"));
}

const environment = {
  SUBMISSIONS_DB: new LocalD1(sqlite),
  SUBMISSIONS_ADMIN_TOKEN: token,
};

function localRequest(route, { method = "GET", body, admin = false } = {}) {
  return new Request(`http://${host}:${port}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(admin ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function api(route, body, method = "POST") {
  const response = await handleConstructApi(localRequest(route, { method, body, admin: true }), environment);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${route}: ${payload.error || response.statusText}`);
  return payload;
}

async function profile(sourceType, sourceId, srgbHex, lab, oklch) {
  return api("/api/admin/archive-color-materials/profiles", {
    source_type: sourceType,
    source_id: sourceId,
    srgb_hex: srgbHex,
    lab_l: lab[0],
    lab_a: lab[1],
    lab_b: lab[2],
    oklch_l: oklch[0],
    oklch_c: oklch[1],
    oklch_h: oklch[2],
    reference_method: "manual-digital",
    notes: "Representative browser-preview value.",
  });
}

async function seed() {
  const state = sqlite.prepare(`
    SELECT aos.id AS state_id, aov.entity_id, ad.archive_slug
    FROM archive_object_states aos
    JOIN archive_object_versions aov ON aov.id = aos.version_id
    JOIN archive_dossiers ad ON ad.entity_id = aov.entity_id
    JOIN content_entities ce ON ce.id = ad.entity_id
    WHERE aos.publication_state = 'published'
      AND aos.public_visible = 1
      AND aov.publication_state = 'published'
      AND aov.public_visible = 1
      AND ad.state = 'published'
      AND ad.public_visible = 1
      AND ce.visibility = 'public'
    ORDER BY aos.id
    LIMIT 1
  `).get();
  if (!state) throw new Error("The migrations did not produce a representative published Archive state.");

  sqlite.prepare(`
    INSERT INTO media_assets(
      id, source_url, original_filename, mime_type, width, height, alt_text, privacy,
      consent_status, state, public_presentation, created_by, created_at, updated_at
    ) VALUES(
      'browser-palette-source', '/favicon-v2.svg', 'browser-palette-source.svg', 'image/svg+xml',
      512, 512, 'Representative source artwork for palette map testing', 'public',
      'not-required', 'active', 'inline', 'preview', datetime('now'), datetime('now')
    )
  `).run();

  const pigment = await api("/api/admin/archive-color-materials/materials", {
    id: "browser-pigment-pb29",
    name: "Ultramarine pigment PB29",
    slug: "browser-ultramarine-pigment",
    material_kind: "raw-pigment",
    pigment_code: "PB29",
    medium_scope: "shared",
    notes: "Representative raw pigment.",
    publication_state: "published",
    public_visible: true,
  });
  const paint = await api("/api/admin/archive-color-materials/materials", {
    id: "browser-paint-ultramarine",
    name: "Studio Heavy Body Ultramarine",
    slug: "browser-heavy-body-ultramarine",
    material_kind: "art-paint",
    brand: "Example Color",
    product_line: "Studio Heavy Body",
    product_name: "Artist Acrylic",
    color_name: "Ultramarine Blue",
    product_code: "HB-140",
    medium_scope: "art",
    notes: "Representative ready-made paint.",
    publication_state: "published",
    public_visible: true,
  });
  const formulation = await api("/api/admin/archive-color-materials/formulations", {
    id: "browser-paint-ultramarine-v1",
    material_id: paint.record.id,
    normalized_finish: "satin",
    finish_label: "Low sheen",
    opacity: "transparent",
    optical_effects: [],
  });
  await api("/api/admin/archive-color-materials/declared-pigments", {
    id: "browser-declared-pb29",
    formulation_id: formulation.record.id,
    pigment_material_id: pigment.record.id,
    normalized_pigment_code: "PB29",
    bottle_wording: "Pigment: PB29",
    source_type: "bottle-label",
    source_url: "https://example.com/product-label",
    observed_at: "2026-07-30",
  });
  const formulationProfile = await profile(
    "material-formulation",
    formulation.record.id,
    "#315A7A",
    [38, 2, -24],
    [0.48, 0.09, 250],
  );
  await api(`/api/admin/archive-color-materials/formulations/${formulation.record.id}`, {
    publication_state: "published",
    public_visible: true,
  }, "PATCH");

  const recipe = await api("/api/admin/archive-color-materials/recipes", {
    id: "browser-recipe-blue",
    name: "Browser Mixed Blue",
    slug: "browser-mixed-blue",
    medium_scope: "art",
    notes: "Representative authored color recipe.",
    publication_state: "published",
    public_visible: true,
  });
  const recipeVersion = await api("/api/admin/archive-color-materials/recipe-versions", {
    id: "browser-recipe-blue-v1",
    recipe_id: recipe.record.id,
    resulting_finish: "satin",
    instructions: "Fold three parts ready-made ultramarine with one part dry PB29 until uniform.",
  });
  await api("/api/admin/archive-color-materials/recipe-components", {
    id: "browser-recipe-component-paint",
    recipe_version_id: recipeVersion.record.id,
    formulation_id: formulation.record.id,
    quantity_value: 3,
    quantity_unit: "parts",
    sort_order: 1,
  });
  await api("/api/admin/archive-color-materials/recipe-components", {
    id: "browser-recipe-component-pigment",
    recipe_version_id: recipeVersion.record.id,
    raw_pigment_material_id: pigment.record.id,
    quantity_value: 1,
    quantity_unit: "parts",
    approximate: true,
    quantity_note: "Scant",
    sort_order: 2,
  });
  const recipeProfile = await profile(
    "recipe-version",
    recipeVersion.record.id,
    "#183F78",
    [27, 8, -35],
    [0.38, 0.13, 258],
  );
  await api(`/api/admin/archive-color-materials/recipe-versions/${recipeVersion.record.id}`, {
    publication_state: "published",
    public_visible: true,
  }, "PATCH");

  const family = await api("/api/admin/archive-color-materials/families", {
    id: "browser-family-blue",
    name: "Blues",
    slug: "blues",
    description: "Artist-confirmed blue colorants.",
    swatch_hex: "#315A7A",
    publication_state: "published",
    public_visible: true,
  });
  await api(`/api/admin/archive-color-materials/family-assignments/${recipeProfile.record.id}`, {
    profile_id: recipeProfile.record.id,
    family_id: family.record.id,
  });
  await api(`/api/admin/archive-color-materials/family-assignments/${formulationProfile.record.id}`, {
    profile_id: formulationProfile.record.id,
    family_id: family.record.id,
  });

  const tool = await api("/api/admin/archive-color-materials/materials", {
    id: "browser-palette-knife",
    name: "Flexible palette knife",
    slug: "browser-palette-knife",
    material_kind: "tool",
    brand: "Example Tools",
    product_name: "No. 4 mixing knife",
    medium_scope: "art",
    publication_state: "published",
    public_visible: true,
  });
  const colorUsage = await api(`/api/admin/archive-dossiers/${state.state_id}/palette-materials/colors`, {
    id: "browser-color-usage",
    recipe_version_id: recipeVersion.record.id,
    usage_status: "applied",
    technique: "Glaze and scumble",
    layer_order: 2,
    public_label: "Browser Mixed Blue",
    public_swatch_hex: "#183F78",
    usage_notes: "Representative usage.",
    publication_state: "published",
    public_visible: true,
  });
  await api(`/api/admin/archive-dossiers/${state.state_id}/palette-materials/materials`, {
    id: "browser-tool-usage",
    material_id: tool.record.id,
    usage_role: "Mixing",
    usage_notes: "Used to fold the recipe without whipping in air.",
    publication_state: "published",
    public_visible: true,
  });

  sqlite.prepare(`
    INSERT INTO appointments(
      id, booking_type_id, status, client_name, client_email, client_phone, start_at, end_at,
      deposit_cents, currency, created_at, updated_at
    ) VALUES(
      'browser-private-session', 'tattoo_quarter', 'confirmed', 'Private Preview Client',
      'private-preview@example.test', '555-0118', '2026-08-10T14:00:00Z', '2026-08-10T15:30:00Z',
      5000, 'USD', datetime('now'), datetime('now')
    )
  `).run();
  await api(`/api/admin/archive-dossiers/${state.state_id}/palette-materials/sessions`, {
    id: "browser-session-ref",
    appointment_id: "browser-private-session",
    session_order: 1,
    studio_label: "Session 1 · linework",
    notes: "Private representative session note.",
  });

  const map = await api(`/api/admin/archive-dossiers/${state.state_id}/palette-materials/maps`, {
    id: "browser-palette-map",
    source_media_id: "browser-palette-source",
    title: "Layered blue placement",
    description: "Representative reviewed placement map.",
    width: 512,
    height: 512,
    overlay_opacity: 0.62,
    publication_state: "published",
    public_visible: true,
  });
  await api(`/api/admin/archive-dossiers/${state.state_id}/palette-materials/regions`, {
    id: "browser-region-upper",
    map_id: map.record.id,
    color_usage_id: colorUsage.record.id,
    label: "Upper blue field",
    geometry_type: "polygon",
    geometry: { points: "42,40 454,52 390,248 72,220", matrix: [1, 0, 0, 1, 0, 0] },
    layer_order: 1,
  });
  await api(`/api/admin/archive-dossiers/${state.state_id}/palette-materials/regions`, {
    id: "browser-region-lower",
    map_id: map.record.id,
    color_usage_id: colorUsage.record.id,
    label: "Lower blue field",
    geometry_type: "ellipse",
    geometry: { cx: 270, cy: 360, rx: 142, ry: 92, matrix: [0.98, 0.18, -0.18, 0.98, 66, -42] },
    layer_order: 2,
  });

  return {
    archiveSlug: state.archive_slug,
    stateId: state.state_id,
    colorSlug: recipe.record.slug,
    materialSlug: paint.record.slug,
    mapId: map.record.id,
  };
}

const seedRecord = await seed();

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

function dynamicFile(pathname) {
  const parts = pathname.replace(/\/+$/g, "").split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "archive" && ["colors", "materials", "records"].includes(parts[1])) {
    return path.join(root, "archive", parts[1], "index.html");
  }
  return null;
}

async function staticFile(pathname) {
  const dynamic = dynamicFile(pathname);
  if (dynamic) return dynamic;
  const decoded = decodeURIComponent(pathname);
  const candidate = path.resolve(root, `.${decoded}`);
  if (!candidate.startsWith(root)) return null;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return path.join(candidate, "index.html");
    if (info.isFile()) return candidate;
  } catch {
    if (!path.extname(candidate)) {
      try {
        const index = path.join(candidate, "index.html");
        if ((await stat(index)).isFile()) return index;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function sendResponse(nodeResponse, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  nodeResponse.writeHead(response.status, headers);
  response.arrayBuffer().then((buffer) => nodeResponse.end(Buffer.from(buffer)));
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  try {
    if (url.pathname === "/tools/archive-colors-materials-import-check/") {
      const markup = `<!doctype html><html><head><meta charset="utf-8"><title>Palette import check</title></head>
        <body><h1>Palette import check</h1><textarea id="source" hidden>&lt;svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50" preserveAspectRatio="xMidYMid meet"&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;style&gt;path{fill:red}&lt;/style&gt;&lt;g transform="translate(5 7) rotate(10)"&gt;&lt;path id="safe-path" d="M10 20 L60 40 Z" onclick="alert(2)" style="fill:url(http://evil.test/a)"/&gt;&lt;/g&gt;&lt;a href="https://evil.test/"&gt;&lt;rect id="linked-shape" x="20" y="25" width="15" height="10"/&gt;&lt;/a&gt;&lt;foreignObject&gt;&lt;div xmlns="http://www.w3.org/1999/xhtml"&gt;unsafe&lt;/div&gt;&lt;/foreignObject&gt;&lt;image href="https://evil.test/pixel.png"/&gt;&lt;/svg&gt;</textarea><pre id="result">Running…</pre>
        <script src="/studio/archive-colors-materials.js?v=1"></script><script>
          const records=window.ArchiveColorMaterialsStudio.importSvgGeometry(document.querySelector("#source").value,[0,0,512,512]);
          const serialized=JSON.stringify(records);
          document.querySelector("#result").textContent=JSON.stringify({count:records.length,types:records.map(record=>record.geometry_type),labels:records.map(record=>record.label),matrices:records.map(record=>record.geometry.matrix),hasExecutable:/script|onclick|style|evil\\.test|foreignObject|image|href/i.test(serialized)},null,2);
        </script></body></html>`;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(markup);
      return;
    }
    if (url.pathname === "/tools/archive-colors-materials-mobile-preview/") {
      const target = url.searchParams.get("path") || "/archive/colors-materials/";
      const safeTarget = target.startsWith("/") && !target.startsWith("//") ? target : "/archive/colors-materials/";
      const markup = `<!doctype html><html><head><meta charset="utf-8"><title>390px preview</title><style>html,body{margin:0;background:#333}iframe{display:block;width:390px;height:844px;border:0;background:#0e0e0e}</style></head><body><iframe title="390px preview" src="${safeTarget.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></body></html>`;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(markup);
      return;
    }
    if (url.pathname === "/api/analytics/events") {
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return;
    }
    if (url.pathname === "/api/admin/submissions") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ submissions: [], count: 0 }));
      return;
    }
    if (url.pathname === "/api/admin/booking/appointments") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ appointments: [], count: 0 }));
      return;
    }
    if (url.pathname === "/api/admin/events") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ events: [], count: 0 }));
      return;
    }
    if (url.pathname === "/api/admin/media/browser-palette-source/file") {
      const source = await readFile(path.join(root, "favicon-v2.svg"));
      response.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" });
      response.end(source);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const apiRequest = new Request(url, {
        method: request.method,
        headers: request.headers,
        ...(body === undefined ? {} : { body }),
      });
      sendResponse(response, await handleConstructApi(apiRequest, environment));
      return;
    }
    const file = await staticFile(url.pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const source = await readFile(file);
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(file).toLowerCase()) || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(source);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end(error?.stack || error?.message || String(error));
  }
}).listen(port, host, () => {
  console.log(`Archive colors/materials preview: http://${host}:${port}/archive/colors-materials/`);
  console.log(`Studio: http://${host}:${port}/studio/submissions/`);
  console.log(`Admin token: ${token}`);
  console.log(JSON.stringify(seedRecord));
});
