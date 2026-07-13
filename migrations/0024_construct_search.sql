PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS search_documents (
  entity_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, node_id TEXT, slug TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'published',
  collection_labels TEXT NOT NULL DEFAULT '', theme_labels TEXT NOT NULL DEFAULT '', person_labels TEXT NOT NULL DEFAULT '', place_labels TEXT NOT NULL DEFAULT '',
  date_label TEXT NOT NULL DEFAULT '', route TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES content_entities(id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(entity_id UNINDEXED,title,summary,body,collection_labels,theme_labels,person_labels,place_labels,content='search_documents',content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS search_documents_ai AFTER INSERT ON search_documents BEGIN INSERT INTO search_documents_fts(rowid,entity_id,title,summary,body,collection_labels,theme_labels,person_labels,place_labels) VALUES(new.rowid,new.entity_id,new.title,new.summary,new.body,new.collection_labels,new.theme_labels,new.person_labels,new.place_labels); END;
CREATE TRIGGER IF NOT EXISTS search_documents_ad AFTER DELETE ON search_documents BEGIN INSERT INTO search_documents_fts(search_documents_fts,rowid,entity_id,title,summary,body,collection_labels,theme_labels,person_labels,place_labels) VALUES('delete',old.rowid,old.entity_id,old.title,old.summary,old.body,old.collection_labels,old.theme_labels,old.person_labels,old.place_labels); END;
CREATE TRIGGER IF NOT EXISTS search_documents_au AFTER UPDATE ON search_documents BEGIN INSERT INTO search_documents_fts(search_documents_fts,rowid,entity_id,title,summary,body,collection_labels,theme_labels,person_labels,place_labels) VALUES('delete',old.rowid,old.entity_id,old.title,old.summary,old.body,old.collection_labels,old.theme_labels,old.person_labels,old.place_labels); INSERT INTO search_documents_fts(rowid,entity_id,title,summary,body,collection_labels,theme_labels,person_labels,place_labels) VALUES(new.rowid,new.entity_id,new.title,new.summary,new.body,new.collection_labels,new.theme_labels,new.person_labels,new.place_labels); END;
CREATE TABLE IF NOT EXISTS search_index_failures (id TEXT PRIMARY KEY,entity_id TEXT,operation TEXT NOT NULL,error_message TEXT NOT NULL,payload_json TEXT NOT NULL DEFAULT '{}',resolved_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_search_documents_filters ON search_documents(entity_type,node_id,state,date_label);

INSERT OR REPLACE INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,theme_labels,date_label,route,updated_at)
SELECT f.id,'flash_item','tattooing',f.slug,f.title,f.description,'',f.state,'','',f.legacy_path,f.updated_at FROM flash_items f WHERE f.state IN ('available','reserved','placed','retired');
INSERT OR REPLACE INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,date_label,route,updated_at)
SELECT a.id,'art_work','art',a.slug,a.title,a.statement,'',a.state,a.year,a.legacy_path,a.updated_at FROM art_works a WHERE a.state='published';
INSERT OR REPLACE INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,date_label,route,updated_at)
SELECT r.id,'archive_record','archive',r.slug,r.title,r.summary,r.body,r.state,r.date_or_period,'/archive/managed-preview/?record='||r.slug,r.updated_at FROM archive_records r WHERE r.state='published';
INSERT OR REPLACE INTO search_documents(entity_id,entity_type,node_id,slug,title,summary,body,state,theme_labels,route,updated_at)
SELECT v.id,'visual_symbol','tattooing',v.slug,v.name,v.meaning,'',v.state,replace(replace(v.themes_json,'[',''),']',''),'/tattoos/build-managed-preview/?symbol='||v.slug,v.updated_at FROM visual_symbols v WHERE v.state='published';
