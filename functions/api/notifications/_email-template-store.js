function now() {
  return new Date().toISOString();
}

function rowContent(row) {
  if (!row) return null;
  try {
    return { ...row, content: JSON.parse(row.content_json) };
  } catch {
    return null;
  }
}

export function emailTemplateDb(env) {
  return env.SUBMISSIONS_DB || null;
}

export function isTemplateStoreUnavailable(error) {
  return /email_template_revisions|no such table/i.test(String(error?.message || error || ""));
}

async function initializeTemplateStore(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS email_template_revisions (
      id TEXT PRIMARY KEY,
      template_key TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'default',
      revision INTEGER NOT NULL CHECK (revision > 0),
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
      content_json TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'studio',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_by TEXT,
      published_at TEXT,
      UNIQUE(template_key, variant, revision)
    )`,
  ).run();
  await db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS email_template_one_draft
     ON email_template_revisions(template_key, variant) WHERE status = 'draft'`,
  ).run();
  await db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS email_template_one_published
     ON email_template_revisions(template_key, variant) WHERE status = 'published'`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS email_template_history
     ON email_template_revisions(template_key, variant, revision DESC)`,
  ).run();
}

export async function templateRevision(db, templateKey, variant, status = "published") {
  if (!db) return null;
  try {
    const row = await db.prepare(
      `SELECT * FROM email_template_revisions
       WHERE template_key = ? AND variant = ? AND status = ?
       ORDER BY revision DESC LIMIT 1`,
    ).bind(templateKey, variant, status).first();
    return rowContent(row);
  } catch (error) {
    if (isTemplateStoreUnavailable(error)) return null;
    throw error;
  }
}

export async function templateHistory(db, templateKey, variant) {
  if (!db) return [];
  const result = await db.prepare(
    `SELECT id, template_key, variant, revision, status, content_json,
            created_by, created_at, updated_at, published_by, published_at
     FROM email_template_revisions
     WHERE template_key = ? AND variant = ?
     ORDER BY revision DESC`,
  ).bind(templateKey, variant).all();
  return (result.results || []).map(rowContent).filter(Boolean);
}

async function maxRevision(db, templateKey, variant) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(revision), 0) AS revision FROM email_template_revisions WHERE template_key = ? AND variant = ?",
  ).bind(templateKey, variant).first();
  return Number(row?.revision || 0);
}

async function writeTemplateDraft(db, { templateKey, variant, content, baseRevision, actor }) {
  const draft = await templateRevision(db, templateKey, variant, "draft");
  const published = await templateRevision(db, templateKey, variant, "published");
  const expected = draft?.revision || published?.revision || 0;
  if (Number(baseRevision) !== expected) {
    return { conflict: true, expectedRevision: expected, draft };
  }
  const timestamp = now();
  if (draft) {
    await db.prepare(
      `UPDATE email_template_revisions SET content_json = ?, updated_at = ?, created_by = ?
       WHERE id = ? AND status = 'draft' AND revision = ?`,
    ).bind(JSON.stringify(content), timestamp, actor, draft.id, draft.revision).run();
    return templateRevision(db, templateKey, variant, "draft");
  }
  const revision = (await maxRevision(db, templateKey, variant)) + 1;
  await db.prepare(
    `INSERT INTO email_template_revisions
      (id, template_key, variant, revision, status, content_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), templateKey, variant, revision, JSON.stringify(content), actor, timestamp, timestamp).run();
  return templateRevision(db, templateKey, variant, "draft");
}

export async function saveTemplateDraft(db, { templateKey, variant, content, baseRevision, actor = "studio" }) {
  if (!db) throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  const input = { templateKey, variant, content, baseRevision, actor };
  try {
    return await writeTemplateDraft(db, input);
  } catch (error) {
    if (!isTemplateStoreUnavailable(error)) throw error;
    await initializeTemplateStore(db);
    return writeTemplateDraft(db, input);
  }
}

export async function publishTemplateDraft(db, { templateKey, variant, revision, actor = "studio" }) {
  const draft = await templateRevision(db, templateKey, variant, "draft");
  if (!draft || draft.revision !== Number(revision)) {
    return { conflict: true, expectedRevision: draft?.revision || 0, draft };
  }
  const timestamp = now();
  const retire = db.prepare(
    `UPDATE email_template_revisions SET status = 'retired', updated_at = ?
     WHERE template_key = ? AND variant = ? AND status = 'published'`,
  ).bind(timestamp, templateKey, variant);
  const publish = db.prepare(
    `UPDATE email_template_revisions
     SET status = 'published', published_by = ?, published_at = ?, updated_at = ?
     WHERE id = ? AND status = 'draft' AND revision = ?`,
  ).bind(actor, timestamp, timestamp, draft.id, draft.revision);
  if (typeof db.batch === "function") await db.batch([retire, publish]);
  else {
    await retire.run();
    await publish.run();
  }
  return templateRevision(db, templateKey, variant, "published");
}

export async function restoreTemplateRevision(db, { templateKey, variant, revision, baseRevision, actor = "studio" }) {
  const currentDraft = await templateRevision(db, templateKey, variant, "draft");
  const published = await templateRevision(db, templateKey, variant, "published");
  const expected = currentDraft?.revision || published?.revision || 0;
  if (Number(baseRevision) !== expected) return { conflict: true, expectedRevision: expected };
  const source = await db.prepare(
    `SELECT * FROM email_template_revisions WHERE template_key = ? AND variant = ? AND revision = ? LIMIT 1`,
  ).bind(templateKey, variant, Number(revision)).first();
  const parsed = rowContent(source);
  if (!parsed) return null;
  const timestamp = now();
  if (currentDraft) {
    await db.prepare("UPDATE email_template_revisions SET status = 'retired', updated_at = ? WHERE id = ?")
      .bind(timestamp, currentDraft.id).run();
  }
  const nextRevision = (await maxRevision(db, templateKey, variant)) + 1;
  await db.prepare(
    `INSERT INTO email_template_revisions
      (id, template_key, variant, revision, status, content_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), templateKey, variant, nextRevision, JSON.stringify(parsed.content), actor, timestamp, timestamp).run();
  return templateRevision(db, templateKey, variant, "draft");
}
