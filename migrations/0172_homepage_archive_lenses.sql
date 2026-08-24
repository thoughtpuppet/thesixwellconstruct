-- Reframe the homepage Archive pathways as ways of reading the record rather
-- than a second copy of the Construct's medium nodes.

UPDATE construct_pathways
SET name = CASE id
    WHEN 'path-archive-01' THEN 'Records'
    WHEN 'path-archive-02' THEN 'Collections'
    WHEN 'path-archive-03' THEN 'Origin Threads'
    WHEN 'path-archive-04' THEN 'Making Practices'
    WHEN 'path-archive-05' THEN 'Colors & Materials'
    WHEN 'path-archive-06' THEN 'Blackboards'
    WHEN 'path-archive-07' THEN 'Timelines'
  END,
  route = CASE id
    WHEN 'path-archive-01' THEN '/archive/'
    WHEN 'path-archive-02' THEN '/archive/collections/'
    WHEN 'path-archive-03' THEN '/archive/origin-threads/'
    WHEN 'path-archive-04' THEN '/archive/?record_type=practice'
    WHEN 'path-archive-05' THEN '/archive/colors-materials/'
    WHEN 'path-archive-06' THEN '/archive/blackboards/'
    WHEN 'path-archive-07' THEN '/archive/timelines/'
  END,
  color = '#6D3D15',
  state = 'published',
  homepage_enabled = 1,
  sort_order = CAST(substr(id, -2) AS INTEGER),
  updated_at = datetime('now')
WHERE id IN (
  'path-archive-01','path-archive-02','path-archive-03','path-archive-04',
  'path-archive-05','path-archive-06','path-archive-07'
);

UPDATE construct_pathways
SET homepage_enabled = 0,
    color = '#6D3D15',
    updated_at = datetime('now')
WHERE id = 'path-archive-08';
