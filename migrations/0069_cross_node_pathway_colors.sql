PRAGMA foreign_keys = ON;

-- Homepage pathways inherit their owning node's color unless they explicitly
-- lead into another medium. Preserve that cross-node identity in managed nav.
UPDATE construct_pathways
SET color = CASE id
  WHEN 'path-tattoos-02' THEN '#FCB467'
  WHEN 'path-art-01' THEN '#FFE7CA'
  WHEN 'path-art-02' THEN '#FCB467'
  WHEN 'path-merch-02' THEN '#6E0404'
  WHEN 'path-merch-03' THEN '#0039BD'
  WHEN 'path-merch-04' THEN '#005D25'
  WHEN 'path-events-05' THEN '#6D3D15'
  WHEN 'path-archive-01' THEN '#6E0404'
  WHEN 'path-archive-02' THEN '#0039BD'
  WHEN 'path-archive-03' THEN '#F08000'
  WHEN 'path-archive-04' THEN '#005D25'
  WHEN 'path-archive-05' THEN '#A22F8D'
  WHEN 'path-archive-06' THEN '#FFE7CA'
  WHEN 'path-archive-07' THEN '#00857A'
  WHEN 'path-archive-08' THEN '#FCB467'
  ELSE color
END,
updated_at = datetime('now')
WHERE id IN (
  'path-tattoos-02',
  'path-art-01',
  'path-art-02',
  'path-merch-02',
  'path-merch-03',
  'path-merch-04',
  'path-events-05',
  'path-archive-01',
  'path-archive-02',
  'path-archive-03',
  'path-archive-04',
  'path-archive-05',
  'path-archive-06',
  'path-archive-07',
  'path-archive-08'
);
