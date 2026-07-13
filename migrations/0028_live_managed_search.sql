PRAGMA foreign_keys = ON;

DELETE FROM search_documents
WHERE entity_type = 'flash_item'
  AND entity_id NOT IN (SELECT id FROM flash_items WHERE state IN ('available','reserved','placed','retired'));
DELETE FROM search_documents
WHERE entity_type = 'art_work'
  AND entity_id NOT IN (SELECT id FROM art_works WHERE state = 'published');
DELETE FROM search_documents
WHERE entity_type = 'archive_record'
  AND entity_id NOT IN (SELECT id FROM archive_records WHERE state = 'published');
DELETE FROM search_documents
WHERE entity_type = 'visual_symbol'
  AND entity_id NOT IN (SELECT id FROM visual_symbols WHERE state = 'published');

INSERT OR REPLACE INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,theme_labels,date_label,route,updated_at)
SELECT f.id,'flash_item','tattooing',f.slug,f.title,f.description,'',f.state,'','',COALESCE(NULLIF(f.legacy_path,''),'/tattoos/flash/'),f.updated_at
FROM flash_items f WHERE f.state IN ('available','reserved','placed','retired');

INSERT OR REPLACE INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,date_label,route,updated_at)
SELECT a.id,'art_work','art',a.slug,a.title,a.statement,'',a.state,a.year,COALESCE(NULLIF(a.legacy_path,''),'/art/?work='||a.slug),a.updated_at
FROM art_works a WHERE a.state='published';

INSERT OR REPLACE INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,date_label,route,updated_at)
SELECT r.id,'archive_record','archive',r.slug,r.title,r.summary,r.body,r.state,r.date_or_period,'/archive/?record='||r.slug,r.updated_at
FROM archive_records r WHERE r.state='published';

INSERT OR REPLACE INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,theme_labels,route,updated_at)
SELECT v.id,'visual_symbol',NULL,v.slug,v.name,v.meaning,'',v.state,replace(replace(replace(v.themes_json,'[',''),']',''),'"',''),'/legend/?symbol='||v.slug,v.updated_at
FROM visual_symbols v WHERE v.state='published';
