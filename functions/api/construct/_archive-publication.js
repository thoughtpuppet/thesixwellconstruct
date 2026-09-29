// Shared publication predicates for Archive detail and retrospective attachments.
export function publicIdentityProfileLinkGateSql(profileAlias="profile"){
  return `(
    EXISTS(
      SELECT 1 FROM organizations eligible_identity_organization
      JOIN content_entities eligible_identity_owner ON eligible_identity_owner.id=eligible_identity_organization.id AND eligible_identity_owner.visibility='public'
      WHERE eligible_identity_organization.id=${profileAlias}.organization_id AND eligible_identity_organization.state='published'
    )
    AND EXISTS(SELECT 1 FROM archive_dossiers eligible_identity_dossier WHERE eligible_identity_dossier.entity_id=${profileAlias}.organization_id AND eligible_identity_dossier.state='published' AND eligible_identity_dossier.public_visible=1)
    AND (${profileAlias}.timeline_id IS NULL OR EXISTS(SELECT 1 FROM archive_timelines eligible_identity_timeline WHERE eligible_identity_timeline.id=${profileAlias}.timeline_id AND eligible_identity_timeline.subject_entity_id=${profileAlias}.organization_id AND eligible_identity_timeline.state='published' AND eligible_identity_timeline.public_visible=1))
    AND (${profileAlias}.current_symbol_id IS NULL OR EXISTS(SELECT 1 FROM visual_symbols eligible_identity_symbol JOIN content_entities eligible_identity_symbol_entity ON eligible_identity_symbol_entity.id=eligible_identity_symbol.id AND eligible_identity_symbol_entity.visibility='public' WHERE eligible_identity_symbol.id=${profileAlias}.current_symbol_id AND eligible_identity_symbol.state='published'))
    AND (${profileAlias}.origin_thread_id IS NULL OR EXISTS(SELECT 1 FROM archive_origin_threads eligible_identity_origin JOIN archive_origin_thread_entities eligible_identity_member ON eligible_identity_member.thread_id=eligible_identity_origin.id AND eligible_identity_member.entity_id=${profileAlias}.organization_id WHERE eligible_identity_origin.id=${profileAlias}.origin_thread_id AND eligible_identity_origin.state='published' AND eligible_identity_origin.public_visible=1))
    AND (${profileAlias}.featured_origin_entity_id IS NULL OR EXISTS(
      SELECT 1 FROM archive_records eligible_identity_featured
      JOIN content_entities eligible_identity_featured_entity ON eligible_identity_featured_entity.id=eligible_identity_featured.id AND eligible_identity_featured_entity.visibility='public'
      JOIN archive_dossiers eligible_identity_featured_dossier ON eligible_identity_featured_dossier.entity_id=eligible_identity_featured.id AND eligible_identity_featured_dossier.state='published' AND eligible_identity_featured_dossier.public_visible=1
      WHERE eligible_identity_featured.id=${profileAlias}.featured_origin_entity_id AND eligible_identity_featured.state='published'
    ))
  )`;
}

export function archiveIdentityProfilePublicSql(entityAlias = "ce") {
  return `(${entityAlias}.entity_type<>'organization' OR EXISTS(
      SELECT 1 FROM about_identity_profiles public_identity_profile
      WHERE public_identity_profile.organization_id=${entityAlias}.id
        AND public_identity_profile.publication_state='published'
        AND public_identity_profile.visibility='public'
        AND ${publicIdentityProfileLinkGateSql("public_identity_profile")}
    ) OR EXISTS(
      SELECT 1 FROM archive_timelines public_identity_timeline
      WHERE public_identity_timeline.subject_entity_id=${entityAlias}.id
        AND public_identity_timeline.presentation_mode='editorial'
        AND public_identity_timeline.state='published'
        AND public_identity_timeline.public_visible=1
    ))`;
}

export function archiveCanonicalOwnerPublicSql(entityAlias="ce"){
  return `(${entityAlias}.entity_type<>'archive_record' OR EXISTS(
    SELECT 1 FROM archive_records public_archive_owner
    WHERE public_archive_owner.id=${entityAlias}.id AND public_archive_owner.state='published'
  ))`;
}

export function archiveMaterialPublicStateSql(materialAlias="am"){
  return `(
    ${materialAlias}.state_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM archive_catalogue_entries material_catalogue WHERE material_catalogue.entity_id=${materialAlias}.dossier_entity_id)
    OR EXISTS(
      SELECT 1 FROM archive_object_states material_public_state
      JOIN archive_object_versions material_public_version ON material_public_version.id=material_public_state.version_id
      WHERE material_public_state.id=${materialAlias}.state_id
        AND material_public_version.entity_id=${materialAlias}.dossier_entity_id
        AND material_public_state.publication_state='published' AND material_public_state.public_visible=1
        AND material_public_version.publication_state='published' AND material_public_version.public_visible=1
    )
  )`;
}
