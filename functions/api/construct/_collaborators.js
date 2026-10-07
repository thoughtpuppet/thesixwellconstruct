import { db, failure, json } from "../_shared/construct.js";

export const COLLABORATOR_PUBLIC_SQL = `
  SELECT cp.entity_id id,cp.slug,cp.kind_label,cp.description_label,cp.pronouns,cp.sort_order,cp.updated_at,
    ce.entity_type,COALESCE(pe.name,org.name) name,
    COALESCE(pe.bio,org.description,'') bio,
    COALESCE(org.website_url,'') website_url
  FROM collaborator_profiles cp
  JOIN content_entities ce ON ce.id=cp.entity_id AND ce.visibility='public'
  LEFT JOIN people pe ON ce.entity_type='person' AND pe.id=ce.id
  LEFT JOIN organizations org ON ce.entity_type='organization' AND org.id=ce.id
  WHERE cp.public_visible=1
    AND ((ce.entity_type='person' AND pe.state='published' AND pe.privacy='public')
      OR (ce.entity_type='organization' AND org.state='published'))`;

export async function publicCollaborators(request, env, slug = "") {
  if (!["GET", "HEAD"].includes(request.method)) return failure("Method not allowed.", 405);
  const database = db(env);
  const records = (await database.prepare(`${COLLABORATOR_PUBLIC_SQL} ORDER BY cp.sort_order,name LIMIT 250`).all()).results || [];
  const profile = slug ? records.find(record => record.slug === slug) : null;
  if (slug && !profile) return failure("Collaborator not found.", 404);
  if (!records.length) return json({ records: [], count: 0 });
  const ids = records.map(record => record.id);
  const placeholders = ids.map(() => "?").join(",");
  const [mediaResult, relationResult, creditResult, linkResult] = await Promise.all([
    database.prepare(`SELECT em.entity_id,em.alt_text_override,m.alt_text,m.width,m.height,
      COALESCE(NULLIF(m.source_url,''),'/api/construct/media/'||m.id) url
      FROM entity_media em JOIN media_assets m ON m.id=em.media_id
      WHERE em.entity_id IN (${placeholders}) AND em.role='primary' AND em.public_visible=1
        AND m.privacy='public' AND m.state='active' AND m.public_presentation='inline'
        AND m.mime_type LIKE 'image/%'
      ORDER BY em.sort_order,em.media_id`).bind(...ids).all(),
    database.prepare(`SELECT er.source_entity_id,er.target_entity_id,rt.forward_label,rt.reverse_label
      FROM entity_relationships er JOIN relationship_types rt ON rt.id=er.relationship_type_id
      WHERE er.public_visible=1 AND rt.public_visible=1
        AND er.source_entity_id IN (${placeholders}) AND er.target_entity_id IN (${placeholders})
      ORDER BY er.sort_order,er.id`).bind(...ids,...ids).all(),
    database.prepare(`SELECT credit.entity_id,credit.edition_number,credit.role,credit.route,ev.title
      FROM collaborator_credits credit
      JOIN events ev ON ev.id=credit.event_id AND ev.publication_state IN ('announced','published')
      JOIN content_entities ce ON ce.id=ev.id AND ce.visibility='public'
      WHERE credit.public_visible=1 AND credit.entity_id IN (${placeholders})
      ORDER BY credit.edition_number,ev.title`).bind(...ids).all(),
    database.prepare(`SELECT entity_id,label,url FROM collaborator_links
      WHERE public_visible=1 AND entity_id IN (${placeholders})
      ORDER BY sort_order,label`).bind(...ids).all(),
  ]);
  const byId = new Map(records.map(record => [record.id, record]));
  const publicRecords = records.map(record => {
    const media = (mediaResult.results || []).find(item => item.entity_id === record.id);
    const affiliations = (relationResult.results || []).flatMap(relation => {
      const outgoing = relation.source_entity_id === record.id;
      if (!outgoing && relation.target_entity_id !== record.id) return [];
      const related = byId.get(outgoing ? relation.target_entity_id : relation.source_entity_id);
      return related ? [{ name: related.name, route: `/about/collaborators/${encodeURIComponent(related.slug)}/`, label: outgoing ? relation.forward_label : relation.reverse_label }] : [];
    });
    return {
      id: record.id, slug: record.slug, name: record.name, entityType: record.entity_type,
      kindLabel: record.kind_label || (record.entity_type === "person" ? "Individual" : "Organization"), descriptionLabel: record.description_label, pronouns: record.pronouns, bio: record.bio,
      websiteUrl: record.website_url, route: `/about/collaborators/${encodeURIComponent(record.slug)}/`,
      image: media ? { url: media.url, width: media.width, height: media.height, alt: media.alt_text_override || media.alt_text || `Portrait of ${record.name}` } : null,
      affiliations,
      links: (linkResult.results || []).filter(link => link.entity_id === record.id).map(link => ({ label: link.label, url: link.url })),
      credits: (creditResult.results || []).filter(credit => credit.entity_id === record.id).map(credit => ({ title: credit.title, editionNumber: credit.edition_number, role: credit.role, route: credit.route })),
    };
  });
  return json(slug ? { record: publicRecords.find(record => record.id === profile.id) } : { records: publicRecords, count: publicRecords.length });
}

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const safeUrl = value => /^(?:\/(?!\/)|https:\/\/)/i.test(String(value || "")) ? escapeHtml(value) : "";
function portrait(record, eager = false) {
  if (!record.image || !safeUrl(record.image.url)) return "";
  return `<img class="collaborator-portrait" src="${safeUrl(record.image.url)}" alt="${escapeHtml(record.image.alt)}"${record.image.width ? ` width="${Number(record.image.width)}"` : ""}${record.image.height ? ` height="${Number(record.image.height)}"` : ""} loading="${eager ? "eager" : "lazy"}">`;
}
function creditLinks(record) {
  return record.credits.map(credit => `<a class="text-link" href="${safeUrl(credit.route)}">${escapeHtml(credit.title)} ${escapeHtml(credit.editionNumber)} · ${escapeHtml(credit.role)}</a>`).join("");
}
export function renderCollaborators(payload) {
  if (payload.record) {
    const record = payload.record;
    return `<article class="collaborator-profile" aria-labelledby="collaborator-profile-name">
      ${portrait(record, true)}<div class="collaborator-profile-copy">
      <span class="band-kicker collaborator-kind">${escapeHtml(record.kindLabel)}</span>
      <h2 class="band-title section-title" id="collaborator-profile-name">${escapeHtml(record.name)}</h2>
      ${record.descriptionLabel ? `<p class="collaborator-description meta-copy">${escapeHtml(record.descriptionLabel)}</p>` : ""}
    ${record.pronouns ? `<p class="collaborator-pronouns">${escapeHtml(record.pronouns)}</p>` : ""}
      <p class="collaborator-bio" data-live-edit-owner="managed" data-live-edit-label="Collaborator biography" data-live-edit-owner-href="/studio/submissions/#archive/${record.entityType === "person" ? "people" : "organizations"}">${escapeHtml(record.bio)}</p>
      ${record.affiliations.length ? `<div class="collaborator-affiliations"><h3>Relationships</h3><ul>${record.affiliations.map(related => `<li>${escapeHtml(related.label)} <a href="${safeUrl(related.route)}">${escapeHtml(related.name)}</a></li>`).join("")}</ul></div>` : ""}
      ${record.credits.length ? `<div class="collaborator-projects"><h3>Collaboration within the Construct</h3><div class="link-row">${creditLinks(record)}</div><p>The first KINMARKING edition is being developed through conversation between oral history and tattooing.</p></div>` : ""}
      ${(record.links || []).some(link => safeUrl(link.url)) ? `<div class="collaborator-work"><h3>Explore their work</h3><ul>${record.links.filter(link => safeUrl(link.url)).map(link => `<li><a href="${safeUrl(link.url)}">${escapeHtml(link.label)}</a></li>`).join("")}</ul></div>` : ""}
      ${safeUrl(record.websiteUrl) ? `<div class="link-row"><a class="text-link" href="${safeUrl(record.websiteUrl)}">Visit ${escapeHtml(record.name)}</a></div>` : ""}
      </div></article>`;
  }
  const records = payload.records || [];
  if (!records.length) return '<p class="collaborator-empty">No collaborator profiles are public yet.</p>';
  return `<div class="collaborator-directory">${records.map(record => `<article class="collaborator-card">
    <a class="collaborator-portrait-link" href="${safeUrl(record.route)}" aria-label="Read about ${escapeHtml(record.name)}">${portrait(record)}</a>
    <div class="collaborator-card-copy"><span class="band-kicker collaborator-kind">${escapeHtml(record.kindLabel)}</span>
    <h2 class="section-title"><a href="${safeUrl(record.route)}">${escapeHtml(record.name)}</a></h2>
      ${record.descriptionLabel ? `<p class="collaborator-description meta-copy">${escapeHtml(record.descriptionLabel)}</p>` : ""}
    ${record.pronouns ? `<p class="collaborator-pronouns">${escapeHtml(record.pronouns)}</p>` : ""}
    <p>${escapeHtml(record.bio.split(/(?<=\.)\s+/)[0])}</p>
    <div class="link-row"><a class="text-link" href="${safeUrl(record.route)}">Read profile</a></div>
    </div></article>`).join("")}</div>`;
}

export function renderCollaboratorsDocument(template, payload) {
  const record = payload.record;
  return template
    .replace('<h1 class="hero-title" data-collaborators-title data-live-edit-owner="managed">Collaborators.</h1>', `<h1 class="hero-title" data-collaborators-title data-live-edit-owner="managed">${escapeHtml(record?.name || "Collaborators.")}</h1>`)
    .replace('<section class="collaborators-content" data-collaborators-content aria-label="Collaborator profiles"></section>', `<section class="collaborators-content" data-collaborators-content aria-label="Collaborator profiles">${renderCollaborators(payload)}</section>`)
    .replace('<body data-venture="about">', `<body data-venture="about"${record ? ` data-construct-entity="${escapeHtml(record.id)}"` : ""}>`);
}
