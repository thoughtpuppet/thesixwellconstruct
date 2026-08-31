-- Avoid D1's LIKE-pattern complexity limit when refreshing activity-subject
-- search fragments. The source identifier is an exact activity-id prefix
-- followed by a colon, so a literal substr comparison is sufficient.

DROP TRIGGER IF EXISTS archive_activity_fragment_update;
CREATE TRIGGER archive_activity_fragment_update
AFTER UPDATE ON entity_activity BEGIN
  DELETE FROM archive_search_fragments WHERE fragment_type='activity' AND source_id=OLD.id;
  DELETE FROM archive_search_fragments
  WHERE fragment_type='activity-subject'
    AND substr(source_id,1,length(OLD.id)+1)=OLD.id||':';
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-activity-'||NEW.id,NEW.entity_id,'activity',NEW.id,NEW.title,
    trim(NEW.summary||' '||NEW.body||' '||NEW.notes||' '||NEW.date_label),'history-'||NEW.id,1,datetime('now')
  FROM archive_dossiers ad JOIN content_entities ce ON ce.id=ad.entity_id
  WHERE ad.entity_id=NEW.entity_id AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public' AND NEW.public_visible=1;
  INSERT OR REPLACE INTO archive_search_fragments(id,dossier_entity_id,fragment_type,source_id,label,body,anchor,public_visible,updated_at)
  SELECT 'archive-fragment-activity-subject-'||eas.activity_id||'-'||eas.subject_entity_id,NEW.entity_id,'activity-subject',eas.activity_id||':'||eas.subject_entity_id,
    COALESCE(o.name,p.name,n.name,pl.name,eas.subject_entity_id),NEW.title,'history-'||NEW.id,1,datetime('now')
  FROM entity_activity_subjects eas
  JOIN archive_dossiers ad ON ad.entity_id=NEW.entity_id
  JOIN content_entities owner ON owner.id=ad.entity_id
  JOIN content_entities subject ON subject.id=eas.subject_entity_id AND subject.visibility='public'
  LEFT JOIN organizations o ON o.id=subject.id AND o.state='published'
  LEFT JOIN people p ON p.id=subject.id AND p.state='published' AND p.privacy='public'
  LEFT JOIN construct_nodes n ON n.id=subject.id AND n.state='published'
  LEFT JOIN places pl ON pl.id=subject.id AND pl.state='published' AND pl.privacy='public'
  WHERE eas.activity_id=NEW.id AND eas.public_visible=1 AND NEW.public_visible=1
    AND ad.state='published' AND ad.public_visible=1 AND owner.visibility='public'
    AND (subject.entity_type<>'organization' OR o.id IS NOT NULL)
    AND (subject.entity_type<>'person' OR p.id IS NOT NULL)
    AND (subject.entity_type<>'construct_node' OR n.id IS NOT NULL)
    AND (subject.entity_type<>'place' OR pl.id IS NOT NULL);
END;

DROP TRIGGER IF EXISTS archive_activity_fragment_delete;
CREATE TRIGGER archive_activity_fragment_delete
AFTER DELETE ON entity_activity BEGIN
  DELETE FROM archive_search_fragments
  WHERE fragment_type IN ('activity','activity-subject')
    AND (
      source_id=OLD.id
      OR substr(source_id,1,length(OLD.id)+1)=OLD.id||':'
    );
END;
