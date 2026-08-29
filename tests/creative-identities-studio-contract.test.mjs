import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");

test("Creative Identities Studio coordinates package publication and derives public visibility from publication state", async () => {
  const [manager, css, studio, identitySeed] = await Promise.all([
    read("studio/creative-identities-manager.js"),
    read("studio/creative-identities-manager.css"),
    read("studio/submissions/index.html"),
    read("migrations/0187_creative_identities.sql"),
  ]);

  assert.match(studio, /href="\/studio\/creative-identities-manager\.css[^\"]*"/);
  assert.match(manager, /const LEGEND_APPEARANCE_ENDPOINT\s*=\s*"\/api\/admin\/legend\/archive-appearances"/);
  assert.match(manager, /record\?\.current_symbol\s*\|\|\s*record\?\.currentSymbol/);
  assert.match(manager, /Array\.isArray\(symbol\.archive_appearances\)[\s\S]*?symbol\.archiveAppearances/);
  assert.match(manager, /support\.legendAppearances[\s\S]*?symbol_entity_id[\s\S]*?symbolEntityId/);
  assert.match(manager, /symbolIds\.has\(symbolId\)\s*\|\|\s*Boolean\(featuredRecordId\s*&&\s*recordId\s*===\s*featuredRecordId\)/);
  assert.match(manager, /linkedThreads\.flatMap[\s\S]*?thread\.members[\s\S]*?thread\.entities/);
  assert.match(manager, /optionalList\(api,\s*LEGEND_APPEARANCE_ENDPOINT,\s*"appearances"\)/);
  assert.match(manager, /legendAppearanceError:\s*legendAppearances\.error/);

  assert.match(manager, /data-identity-legend-appearances data-current-symbol-id=/);
  assert.match(manager, /data-featured-record-id=/);
  assert.match(manager, /Legend appearance review/);
  assert.match(manager, /linked Origin Thread symbols, and the featured origin record/);
  assert.match(manager, /data-legend-appearance-row data-appearance-id=/);
  assert.match(manager, /data-legend-appearance-title[^>]*maxlength="300"/);
  assert.doesNotMatch(manager, /<input data-legend-appearance-title[^>]*\brequired\b/, "appearance review must not block the separate identity-profile submit");
  assert.match(manager, /data-legend-appearance-caption[^>]*maxlength="3000"/);
  assert.match(manager, /data-legend-appearance-role[\s\S]*?option\("variant",\s*"Visual variant"[\s\S]*?option\("appearance",\s*"Documented appearance"/);
  assert.match(manager, /data-legend-appearance-publication[\s\S]*?\["draft",\s*"published",\s*"archived"\]/);
  assert.doesNotMatch(manager, /data-legend-appearance-visible|name="visibility"|name="public_visible"/, "publication-backed records must not expose a second visibility control");
  assert.match(manager, /Setting an appearance to published automatically makes it publicly visible\./);
  assert.match(manager, /data-legend-appearance-order type="number" min="0" step="1"/);
  assert.match(manager, /type="button" data-legend-appearance-save>Save Legend appearance<\/button>/);
  assert.match(manager, /data-legend-appearance-status aria-live="polite"/);

  const saveStart = manager.indexOf("async function saveLegendAppearance(button)");
  const saveEnd = manager.indexOf("\n\n  try {", saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart, "appearance save handler must remain isolated inside the identity manager");
  const saveHandler = manager.slice(saveStart, saveEnd);
  for (const field of ["title", "caption", "appearance_role", "publication_state", "sort_order"]) {
    assert.match(saveHandler, new RegExp(`\\b${field}:`));
  }
  assert.match(saveHandler, /payload\.public_visible\s*=\s*payload\.publication_state\s*===\s*"published"/);
  assert.match(saveHandler, /api\(`\$\{LEGEND_APPEARANCE_ENDPOINT\}\/\$\{encodeURIComponent\(appearanceId\)\}`,[\s\S]*?method:\s*"PATCH"[\s\S]*?body:\s*JSON\.stringify\(payload\)/);
  assert.match(saveHandler, /if \(!payload\.title\)[\s\S]*?titleInput\?\.focus\(\)/);
  assert.match(saveHandler, /catch \(error\)[\s\S]*?Legend appearance could not be saved/);
  assert.match(saveHandler, /finally[\s\S]*?button\.disabled\s*=\s*false/);
  assert.doesNotMatch(saveHandler, /await load\(\)|\brender\(\)/, "appearance saves must not discard unsaved identity-profile fields");

  assert.match(manager, /Legend appearances could not be refreshed\./);
  assert.match(manager, /The appearances returned with the identity remain editable\./);
  assert.match(manager, /The identity editor remains available; reload before publication review\./);
  assert.match(manager, /<form class="cm-form" data-identity-form/);
  assert.match(manager, /creating\s*\?\s*"Create private identity draft"\s*:\s*"Save identity"/);
  assert.match(manager, /Publication includes public visibility/);
  assert.match(manager, /published means public, while draft and archived remain private/);
  assert.match(manager, /function profilePublicationOptions\(current\)[\s\S]*?current === "published" \? \["published", "draft", "archived"\] : \["draft", "archived"\]/, "ordinary profile editing must route first publication through the coordinated action");
  assert.match(manager, /<\/form>\s*\$\{legendAppearanceReviewSection\(record, support, \{ creating \}\)\}/, "appearance controls must remain outside the identity-profile form");
  assert.match(manager, /if \(saveAppearance\)\s*\{\s*await saveLegendAppearance\(saveAppearance\);\s*return;/);

  assert.match(manager, /function identityPublicationReviewPanel\(record, review/);
  assert.match(manager, /data-identity-publication-panel[\s\S]*?tabindex="-1"/);
  assert.match(manager, /Publish identity and linked history/);
  assert.match(manager, /No separate visibility step is required\./);
  assert.match(manager, /data-identity-publication-status aria-live="polite"/);
  assert.match(manager, /async function refreshPublicationReview\(key[\s\S]*?`\$\{IDENTITY_ENDPOINT\}\/\$\{encodeURIComponent\(key\)\}\/publication-review`/);
  assert.match(manager, /async function publishIdentityPackage\(button\)[\s\S]*?`\$\{IDENTITY_ENDPOINT\}\/\$\{encodeURIComponent\(key\)\}\/publish-package`[\s\S]*?method:\s*"POST"/);
  assert.match(manager, /publishIdentityPackage\(publishPackage\)/);
  assert.match(manager, /await refreshPublicationReview\(state\.editingKey\)/);

  const profileSubmitStart = manager.indexOf('root.addEventListener("submit"');
  const profileSubmitEnd = manager.indexOf("\n}\n\nfunction catalogueLists", profileSubmitStart);
  assert.ok(profileSubmitStart >= 0 && profileSubmitEnd > profileSubmitStart);
  const profileSubmit = manager.slice(profileSubmitStart, profileSubmitEnd);
  assert.match(profileSubmit, /payload\.public_visible\s*=\s*payload\.publication_state\s*===\s*"published"/);
  assert.doesNotMatch(profileSubmit, /data\.get\("visibility"\)|data\.get\("public_visible"\)/);

  assert.match(identitySeed, /'legend-appearance-thoughtpuppet-early-puppet','identity-thoughtpuppet',[\s\S]*?'archive-record-thought-puppet-puppet-thoughts'/);
  assert.match(identitySeed, /'legend-appearance-six-well-cover-signature','identity-six-well',[\s\S]*?'archive-record-thought-puppet-puppet-thoughts'/);
  assert.match(identitySeed, /'archive-timeline-thoughtpuppet','identity-thoughtpuppet',[\s\S]*?'origin-thread-thoughtpuppet-origins','archive-record-thought-puppet-puppet-thoughts'/);

  assert.match(css, /\.ci-appearance-review\s*\{[^}]*border:5px solid/);
  assert.match(css, /\.ci-appearance-row\s*\{[^}]*gap:14px[^}]*border:5px solid/);
  assert.match(css, /\.ci-appearance-row\[data-review-state="published"\]\s*\{[^}]*border-color:var\(--accent\)/);
  assert.match(css, /\.ci-appearance-fields label\s*\{[^}]*display:grid/);
  assert.match(css, /\.ci-appearance-fields \.wide\s*\{[^}]*grid-column:1\/-1/);
  assert.match(css, /\.ci-publication-review\s*\{[^}]*border:5px solid/);
  assert.match(css, /\.ci-publication-review\[data-review-state="ready"\][^\{]*\{[^}]*border-color:var\(--accent\)/);
  assert.match(css, /\.ci-publication-component\s*\{[^}]*gap:6px[^}]*border:5px solid/);
  assert.match(css, /@media\(max-width:800px\)[\s\S]*?\.ci-appearance-review,[\s\S]*?\.ci-appearance-row\{padding:14px\}/);
});
