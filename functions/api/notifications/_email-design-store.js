import { validateEmailDesignProfile } from "./_email-design.js";

function now() {
  return new Date().toISOString();
}

function rowProfile(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.profile_json);
    const validation = validateEmailDesignProfile(parsed);
    return validation.ok ? { ...row, profile: validation.profile } : null;
  } catch {
    return null;
  }
}

export function isEmailDesignStoreUnavailable(error) {
  return /email_design_revisions|no such table/i.test(String(error?.message || error || ""));
}

async function initializeEmailDesignStore(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS email_design_revisions (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL UNIQUE CHECK (revision > 0),
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
      profile_json TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'studio',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_by TEXT,
      published_at TEXT
    )`,
  ).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS email_design_one_draft ON email_design_revisions(status) WHERE status = 'draft'").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS email_design_one_published ON email_design_revisions(status) WHERE status = 'published'").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS email_design_history ON email_design_revisions(revision DESC)").run();
}

export async function emailDesignRevision(db, status = "published") {
  if (!db) return null;
  try {
    const row = await db.prepare(
      "SELECT * FROM email_design_revisions WHERE status = ? ORDER BY revision DESC LIMIT 1",
    ).bind(status).first();
    return rowProfile(row);
  } catch (error) {
    if (isEmailDesignStoreUnavailable(error)) return null;
    throw error;
  }
}

export async function emailDesignHistory(db) {
  if (!db) return [];
  try {
    const result = await db.prepare(
      `SELECT id, revision, status, profile_json, created_by, created_at, updated_at, published_by, published_at
       FROM email_design_revisions ORDER BY revision DESC`,
    ).all();
    return (result.results || []).map(rowProfile).filter(Boolean);
  } catch (error) {
    if (isEmailDesignStoreUnavailable(error)) return [];
    throw error;
  }
}

async function maxRevision(db) {
  const row = await db.prepare("SELECT COALESCE(MAX(revision), 0) AS revision FROM email_design_revisions").first();
  return Number(row?.revision || 0);
}

async function writeDraft(db, { profile, baseRevision, actor }) {
  const draft = await emailDesignRevision(db, "draft");
  const published = await emailDesignRevision(db, "published");
  const expected = draft?.revision || published?.revision || 0;
  if (Number(baseRevision) !== expected) return { conflict: true, expectedRevision: expected, draft };
  const timestamp = now();
  if (draft) {
    await db.prepare(
      "UPDATE email_design_revisions SET profile_json = ?, updated_at = ?, created_by = ? WHERE id = ? AND status = 'draft' AND revision = ?",
    ).bind(JSON.stringify(profile), timestamp, actor, draft.id, draft.revision).run();
    return emailDesignRevision(db, "draft");
  }
  const revision = (await maxRevision(db)) + 1;
  await db.prepare(
    `INSERT INTO email_design_revisions
      (id, revision, status, profile_json, created_by, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), revision, JSON.stringify(profile), actor, timestamp, timestamp).run();
  return emailDesignRevision(db, "draft");
}

export async function saveEmailDesignDraft(db, { profile, baseRevision, actor = "studio" }) {
  if (!db) throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  const validation = validateEmailDesignProfile(profile);
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  const input = { profile: validation.profile, baseRevision, actor };
  try {
    return await writeDraft(db, input);
  } catch (error) {
    if (!isEmailDesignStoreUnavailable(error)) throw error;
    await initializeEmailDesignStore(db);
    return writeDraft(db, input);
  }
}

export async function publishEmailDesignDraft(db, { revision, actor = "studio" }) {
  const draft = await emailDesignRevision(db, "draft");
  if (!draft || draft.revision !== Number(revision)) {
    return { conflict: true, expectedRevision: draft?.revision || 0, draft };
  }
  if (typeof db.batch !== "function") throw new Error("Atomic D1 batch support is required to publish an email design.");
  const timestamp = now();
  await db.batch([
    db.prepare("UPDATE email_design_revisions SET status = 'retired', updated_at = ? WHERE status = 'published'").bind(timestamp),
    db.prepare(
      `UPDATE email_design_revisions SET status = 'published', published_by = ?, published_at = ?, updated_at = ?
       WHERE id = ? AND status = 'draft' AND revision = ?`,
    ).bind(actor, timestamp, timestamp, draft.id, draft.revision),
  ]);
  return emailDesignRevision(db, "published");
}

export async function restoreEmailDesignRevision(db, { revision, baseRevision, actor = "studio" }) {
  const currentDraft = await emailDesignRevision(db, "draft");
  const published = await emailDesignRevision(db, "published");
  const expected = currentDraft?.revision || published?.revision || 0;
  if (Number(baseRevision) !== expected) return { conflict: true, expectedRevision: expected };
  const source = rowProfile(await db.prepare("SELECT * FROM email_design_revisions WHERE revision = ? LIMIT 1").bind(Number(revision)).first());
  if (!source) return null;
  if (typeof db.batch !== "function") throw new Error("Atomic D1 batch support is required to restore an email design.");
  const timestamp = now();
  const nextRevision = (await maxRevision(db)) + 1;
  const statements = [];
  if (currentDraft) {
    statements.push(db.prepare("UPDATE email_design_revisions SET status = 'retired', updated_at = ? WHERE id = ?").bind(timestamp, currentDraft.id));
  }
  statements.push(db.prepare(
    `INSERT INTO email_design_revisions
      (id, revision, status, profile_json, created_by, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), nextRevision, JSON.stringify(source.profile), actor, timestamp, timestamp));
  await db.batch(statements);
  return emailDesignRevision(db, "draft");
}
