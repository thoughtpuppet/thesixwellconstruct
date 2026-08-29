const ARCHIVE_DOSSIER_ENTITY_TYPES = new Set([
  "art_work",
  "merch_item",
  "portfolio_item",
  "flash_item",
  "tattoo_design",
  "event",
  "appearance",
  "visual_symbol",
  "writing_work",
  "film_work",
  "music_work",
]);

const SOURCE_SLUG_QUERIES = {
  art_work: "SELECT slug preferred_slug FROM art_works WHERE id=?",
  merch_item: "SELECT COALESCE(NULLIF(slug,''),NULLIF(shopify_handle,'')) preferred_slug FROM merch_items WHERE id=?",
  flash_item: "SELECT slug preferred_slug FROM flash_items WHERE id=?",
  tattoo_design: "SELECT slug preferred_slug FROM tattoo_designs WHERE id=?",
  event: "SELECT slug preferred_slug FROM events WHERE id=?",
  appearance: "SELECT slug preferred_slug FROM artist_appearances WHERE id=?",
  visual_symbol: "SELECT slug preferred_slug FROM visual_symbols WHERE id=?",
  organization: "SELECT slug preferred_slug FROM organizations WHERE id=?",
  archive_record: "SELECT slug preferred_slug FROM archive_records WHERE id=?",
};

function archiveSlug(value) {
  return String(value ?? "").trim().slice(0, 160).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export class ArchiveDossierEnsureError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = "ArchiveDossierEnsureError";
    this.status = status;
  }
}

export function archiveEligibleEntityType(entityType) {
  return ARCHIVE_DOSSIER_ENTITY_TYPES.has(String(entityType || ""));
}

export function archiveDossierRecordType(entityType) {
  return {
    art_work: "artwork",
    merch_item: "merchandise",
    portfolio_item: "tattoo",
    flash_item: "flash",
    tattoo_design: "tattoo-design",
    event: "event",
    appearance: "event",
    visual_symbol: "symbol",
    organization: "creative-identity",
  }[entityType] || String(entityType || "").replace(/_/g, "-");
}

export async function archiveDossierEligibleOwner(database, owner) {
  if (archiveEligibleEntityType(owner?.entity_type)) return true;
  if (owner?.entity_type === "organization" && owner?.id) {
    return Boolean(await database.prepare(
      "SELECT organization_id FROM about_identity_profiles WHERE organization_id=?",
    ).bind(owner.id).first());
  }
  if (owner?.entity_type !== "archive_record" || !owner?.id) return false;
  return Boolean(await database.prepare(
    "SELECT id FROM archive_records WHERE id=? AND record_type='blackboard'",
  ).bind(owner.id).first());
}

export async function archivePreferredSlugForEntity(database, owner, supplied = "") {
  const suppliedSlug = archiveSlug(supplied);
  if (suppliedSlug) return suppliedSlug;
  const query = SOURCE_SLUG_QUERIES[owner?.entity_type];
  if (query) {
    const source = await database.prepare(query).bind(owner.id).first();
    const sourceSlug = archiveSlug(source?.preferred_slug);
    if (sourceSlug) return sourceSlug;
  }
  return archiveSlug(owner?.id) || String(owner?.id || "");
}

function provisionalArchiveSlug(value, entityId) {
  const current = String(value || "").trim();
  if (!current) return true;
  return current === String(entityId || "") || current === archiveSlug(entityId);
}

async function availableArchiveSlug(database, owner, preferredSlug) {
  const base = archiveSlug(preferredSlug) || archiveSlug(owner.id) || String(owner.id);
  const typePrefix = archiveSlug(String(owner.entity_type || "item").replace(/_/g, "-")) || "item";
  const entityPart = archiveSlug(owner.id) || "record";
  const candidates = [...new Set([
    base,
    `${typePrefix}-${base}`,
    `${typePrefix}-${base}-${entityPart}`,
  ].map(archiveSlug).filter(Boolean))];

  for (const candidate of candidates) {
    const occupied = await database.prepare(
      "SELECT entity_id FROM archive_dossiers WHERE archive_slug=? AND entity_id<>?",
    ).bind(candidate, owner.id).first();
    if (!occupied) return candidate;
  }

  for (let suffix = 2; suffix <= 100; suffix += 1) {
    const candidate = archiveSlug(`${typePrefix}-${base}-${entityPart}-${suffix}`);
    const occupied = await database.prepare(
      "SELECT entity_id FROM archive_dossiers WHERE archive_slug=? AND entity_id<>?",
    ).bind(candidate, owner.id).first();
    if (!occupied) return candidate;
  }
  throw new ArchiveDossierEnsureError("A unique Archive slug could not be allocated. Try again.", 409);
}

async function removeOrganizationCatalogue(database, owner) {
  if (owner?.entity_type !== "organization") return;
  await database.prepare(
    "DELETE FROM archive_catalogue_entries WHERE entity_id=?",
  ).bind(owner.id).run();
}

/**
 * Ensures that a canonical creative entity owns one private editable dossier.
 * Existing editorial state is never changed. The sole existing-row refinement
 * permitted is replacing an ID-based provisional slug after the source row has
 * supplied its stable slug.
 */
export async function ensureEditableArchiveDossier(database, entityId, options = {}) {
  const ownerId = String(entityId || "").trim().slice(0, 200);
  if (!ownerId) throw new ArchiveDossierEnsureError("Canonical entity not found.", 404);

  const owner = await database.prepare("SELECT * FROM content_entities WHERE id=?").bind(ownerId).first();
  if (!owner) throw new ArchiveDossierEnsureError("Canonical entity not found.", 404);

  let dossier = await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(ownerId).first();
  const ownerCanCreateDossier = await archiveDossierEligibleOwner(database, owner);
  const isExistingArchiveNativeRecord = Boolean(dossier && owner.entity_type === "archive_record");
  if (!ownerCanCreateDossier && !isExistingArchiveNativeRecord) {
    throw new ArchiveDossierEnsureError("That entity type is not eligible for an Archive dossier.", 409);
  }
  const preferredSlug = await archivePreferredSlugForEntity(database, owner, options.preferredSlug);
  const actor = String(options.actor || "studio").trim().slice(0, 160) || "studio";

  if (dossier) {
    for (let attempt = 0; attempt < 3 && provisionalArchiveSlug(dossier.archive_slug, ownerId) && preferredSlug && !provisionalArchiveSlug(preferredSlug, ownerId); attempt += 1) {
      const refinedSlug = await availableArchiveSlug(database, owner, preferredSlug);
      try {
        await database.prepare(
          "UPDATE archive_dossiers SET archive_slug=?,updated_by=?,updated_at=datetime('now') WHERE entity_id=? AND (archive_slug=? OR archive_slug=? OR trim(archive_slug)='')",
        ).bind(refinedSlug, actor, ownerId, ownerId, archiveSlug(ownerId)).run();
      } catch (error) {
        if (!/UNIQUE constraint failed/i.test(String(error?.message || error))) throw error;
      }
      dossier = await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(ownerId).first();
      if (!dossier) throw new ArchiveDossierEnsureError("Canonical entity not found.", 404);
    }
    await removeOrganizationCatalogue(database, owner);
    return { record: dossier, owner, created: false };
  }

  let created = false;
  let lastError = null;
  for (let attempt = 0; attempt < 2 && !dossier; attempt += 1) {
    const chosenSlug = await availableArchiveSlug(database, owner, preferredSlug);
    try {
      const result = await database.prepare(`INSERT INTO archive_dossiers(
          entity_id,archive_slug,record_type,state,public_visible,published_at,
          created_by,updated_by,created_at,updated_at
        ) VALUES(?,?,?,'draft',0,NULL,?,?,datetime('now'),datetime('now'))
        ON CONFLICT(entity_id) DO NOTHING`).bind(
        ownerId,
        chosenSlug,
        archiveDossierRecordType(owner.entity_type),
        actor,
        actor,
      ).run();
      created = Number(result?.meta?.changes || 0) > 0;
    } catch (error) {
      lastError = error;
      if (!/UNIQUE constraint failed/i.test(String(error?.message || error))) throw error;
    }
    dossier = await database.prepare("SELECT * FROM archive_dossiers WHERE entity_id=?").bind(ownerId).first();
  }

  if (!dossier) {
    if (lastError && !/UNIQUE constraint failed/i.test(String(lastError?.message || lastError))) throw lastError;
    throw new ArchiveDossierEnsureError("The Archive dossier could not be created. Try again.", 409);
  }
  await removeOrganizationCatalogue(database, owner);
  return { record: dossier, owner, created };
}
