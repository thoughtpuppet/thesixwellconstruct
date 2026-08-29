PRAGMA foreign_keys = ON;

-- Curatorial descriptions of the live interactions preserved by a website
-- snapshot. These records describe what the source does and what the maker
-- says it means; they never alter the immutable source package.
CREATE TABLE archive_web_snapshot_behaviors (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  behavior_key TEXT NOT NULL CHECK(behavior_key IN (
    'ring-node-opening',
    'breathing-eyes',
    'node-orbits-pathways',
    'six-living-cultures'
  )),
  title TEXT NOT NULL DEFAULT '',
  evolution_role TEXT NOT NULL DEFAULT 'observed' CHECK(evolution_role IN (
    'introduced','refined','transformed','disabled','restored','observed'
  )),
  interaction_prompt TEXT NOT NULL DEFAULT '',
  observed_behavior TEXT NOT NULL DEFAULT '',
  authored_meaning TEXT NOT NULL DEFAULT '',
  meaning_status TEXT NOT NULL DEFAULT 'pending-interpretation' CHECK(meaning_status IN (
    'curator-authored','code-inferred','pending-interpretation'
  )),
  source_path TEXT NOT NULL DEFAULT '',
  source_symbol TEXT NOT NULL DEFAULT '',
  public_visible INTEGER NOT NULL DEFAULT 0 CHECK(public_visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'studio',
  updated_by TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(snapshot_id,behavior_key),
  FOREIGN KEY(snapshot_id) REFERENCES archive_web_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX idx_archive_web_snapshot_behaviors_snapshot
  ON archive_web_snapshot_behaviors(snapshot_id,sort_order,behavior_key);
CREATE INDEX idx_archive_web_snapshot_behaviors_public
  ON archive_web_snapshot_behaviors(snapshot_id,public_visible,sort_order);

-- State I begins with four separately describable live systems. Only the
-- six-culture meaning is marked curator-authored: it records the maker's own
-- explanation rather than assigning meaning from code inspection.
INSERT OR IGNORE INTO archive_web_snapshot_behaviors
  (id,snapshot_id,behavior_key,title,evolution_role,interaction_prompt,observed_behavior,
   authored_meaning,meaning_status,source_path,source_symbol,public_visible,sort_order,
   created_by,updated_by,created_at,updated_at)
SELECT
  'archive-web-behavior-11cf-ring-' || snapshot.id,snapshot.id,'ring-node-opening','Opening the construct','introduced',
  'Select the central ring, then select a medium node to reveal its pathways.',
  'The central ring deploys nine medium nodes. Selecting a node opens its child pathways around that active node.',
  '','pending-interpretation','index.html','deployNodes; activateNode',0,10,
  'migration','migration',datetime('now'),datetime('now')
FROM archive_web_snapshots snapshot
WHERE snapshot.git_commit_sha='11cf57741bc8c03bfca3412e56090591b9abdcdc';

INSERT OR IGNORE INTO archive_web_snapshot_behaviors
  (id,snapshot_id,behavior_key,title,evolution_role,interaction_prompt,observed_behavior,
   authored_meaning,meaning_status,source_path,source_symbol,public_visible,sort_order,
   created_by,updated_by,created_at,updated_at)
SELECT
  'archive-web-behavior-11cf-eyes-' || snapshot.id,snapshot.id,'breathing-eyes','Breathing eyes','introduced',
  'Let the field run and watch the concentric eyes expand and recede.',
  'Ten concentric eye rings share a nine-second sine breath that changes their radius and opacity.',
  '','pending-interpretation','index.html','drawEyes',0,20,
  'migration','migration',datetime('now'),datetime('now')
FROM archive_web_snapshots snapshot
WHERE snapshot.git_commit_sha='11cf57741bc8c03bfca3412e56090591b9abdcdc';

INSERT OR IGNORE INTO archive_web_snapshot_behaviors
  (id,snapshot_id,behavior_key,title,evolution_role,interaction_prompt,observed_behavior,
   authored_meaning,meaning_status,source_path,source_symbol,public_visible,sort_order,
   created_by,updated_by,created_at,updated_at)
SELECT
  'archive-web-behavior-11cf-orbits-' || snapshot.id,snapshot.id,'node-orbits-pathways','Node orbits and pathways','introduced',
  'Open the construct, then select different medium nodes to compare their pathway arrangements.',
  'Nine top-level nodes orbit a shared center. The active node reveals a second orbit of pathway nodes.',
  '','pending-interpretation','index.html','drawNodes; drawSubnodes',0,30,
  'migration','migration',datetime('now'),datetime('now')
FROM archive_web_snapshots snapshot
WHERE snapshot.git_commit_sha='11cf57741bc8c03bfca3412e56090591b9abdcdc';

INSERT OR IGNORE INTO archive_web_snapshot_behaviors
  (id,snapshot_id,behavior_key,title,evolution_role,interaction_prompt,observed_behavior,
   authored_meaning,meaning_status,source_path,source_symbol,public_visible,sort_order,
   created_by,updated_by,created_at,updated_at)
SELECT
  'archive-web-behavior-11cf-cultures-' || snapshot.id,snapshot.id,'six-living-cultures','Six living cultures','introduced',
  'Watch the six dots inside the central ring before opening the construct.',
  'Six amber dots rotate around the ring while each vibrates radially. When the construct opens, those six positions become six medium nodes.',
  'The six dots in the central ring represent live cultures in a six-well petri dish. Their vibration and orbit make the cultures visibly alive; when the Construct opens, those cultures become six medium nodes.',
  'curator-authored','index.html','drawRing; deployNodes',0,40,
  'migration','migration',datetime('now'),datetime('now')
FROM archive_web_snapshots snapshot
WHERE snapshot.git_commit_sha='11cf57741bc8c03bfca3412e56090591b9abdcdc';
