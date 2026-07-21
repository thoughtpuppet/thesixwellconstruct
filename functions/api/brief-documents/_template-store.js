function now() {
  return new Date().toISOString();
}

function rowContent(row) {
  if (!row) return null;
  try { return { ...row, content: JSON.parse(row.content_json) }; } catch { return null; }
}

export async function documentTemplateRevision(db, templateKey, status = "published") {
  if (!db) return null;
  const row = await db.prepare(
    `SELECT * FROM document_template_revisions
     WHERE template_key=? AND status=? ORDER BY revision DESC LIMIT 1`
  ).bind(templateKey, status).first();
  return rowContent(row);
}

export async function documentTemplateHistory(db, templateKey) {
  const result = await db.prepare(
    `SELECT * FROM document_template_revisions
     WHERE template_key=? ORDER BY revision DESC`
  ).bind(templateKey).all();
  return (result.results || []).map(rowContent).filter(Boolean);
}

async function maxRevision(db, templateKey) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(revision),0) revision FROM document_template_revisions WHERE template_key=?"
  ).bind(templateKey).first();
  return Number(row?.revision || 0);
}

export async function saveDocumentTemplateDraft(db, { templateKey, content, baseRevision, actor = "studio" }) {
  const draft = await documentTemplateRevision(db, templateKey, "draft");
  const published = await documentTemplateRevision(db, templateKey, "published");
  const expected = draft?.revision || published?.revision || 0;
  if (Number(baseRevision) !== expected) return { conflict: true, expectedRevision: expected, draft };
  const timestamp = now();
  if (draft) {
    await db.prepare(
      "UPDATE document_template_revisions SET content_json=?,updated_at=?,created_by=? WHERE id=? AND status='draft'"
    ).bind(JSON.stringify(content), timestamp, actor, draft.id).run();
    return documentTemplateRevision(db, templateKey, "draft");
  }
  const revision = (await maxRevision(db, templateKey)) + 1;
  await db.prepare(
    `INSERT INTO document_template_revisions
     (id,template_key,revision,status,content_json,created_by,created_at,updated_at)
     VALUES(?,?,?,'draft',?,?,?,?)`
  ).bind(crypto.randomUUID(), templateKey, revision, JSON.stringify(content), actor, timestamp, timestamp).run();
  return documentTemplateRevision(db, templateKey, "draft");
}

export async function publishDocumentTemplateDraft(db, { templateKey, revision, actor = "studio" }) {
  const draft = await documentTemplateRevision(db, templateKey, "draft");
  if (!draft || draft.revision !== Number(revision)) {
    return { conflict: true, expectedRevision: draft?.revision || 0, draft };
  }
  const timestamp = now();
  await db.batch([
    db.prepare(
      "UPDATE document_template_revisions SET status='retired',updated_at=? WHERE template_key=? AND status='published'"
    ).bind(timestamp, templateKey),
    db.prepare(
      `UPDATE document_template_revisions
       SET status='published',published_by=?,published_at=?,updated_at=?
       WHERE id=? AND status='draft' AND revision=?`
    ).bind(actor, timestamp, timestamp, draft.id, draft.revision),
  ]);
  return documentTemplateRevision(db, templateKey, "published");
}

export async function discardDocumentTemplateDraft(db, { templateKey, revision }) {
  const draft = await documentTemplateRevision(db, templateKey, "draft");
  if (!draft || draft.revision !== Number(revision)) {
    return { conflict: true, expectedRevision: draft?.revision || 0, draft };
  }
  await db.prepare(
    "UPDATE document_template_revisions SET status='retired',updated_at=? WHERE id=? AND status='draft'"
  ).bind(now(), draft.id).run();
  return { discarded: true, revision: draft.revision };
}

export async function restoreDocumentTemplateRevision(db, { templateKey, revision, baseRevision, actor = "studio" }) {
  const draft = await documentTemplateRevision(db, templateKey, "draft");
  const published = await documentTemplateRevision(db, templateKey, "published");
  const expected = draft?.revision || published?.revision || 0;
  if (Number(baseRevision) !== expected) return { conflict: true, expectedRevision: expected };
  const source = rowContent(await db.prepare(
    "SELECT * FROM document_template_revisions WHERE template_key=? AND revision=? LIMIT 1"
  ).bind(templateKey, Number(revision)).first());
  if (!source) return null;
  const timestamp = now();
  if (draft) {
    await db.prepare("UPDATE document_template_revisions SET status='retired',updated_at=? WHERE id=?")
      .bind(timestamp, draft.id).run();
  }
  const nextRevision = (await maxRevision(db, templateKey)) + 1;
  await db.prepare(
    `INSERT INTO document_template_revisions
     (id,template_key,revision,status,content_json,created_by,created_at,updated_at)
     VALUES(?,?,?,'draft',?,?,?,?)`
  ).bind(crypto.randomUUID(), templateKey, nextRevision, JSON.stringify(source.content), actor, timestamp, timestamp).run();
  return documentTemplateRevision(db, templateKey, "draft");
}
