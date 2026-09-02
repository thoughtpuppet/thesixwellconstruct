INSERT INTO construct_utility_links
  (id,label,route,color,state,sort_order,created_at,updated_at)
VALUES
  ('utility-atl-creative-calendar','ATL Creative Calendar','/calendar/','#F8B468','published',20,datetime('now'),datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  label=excluded.label,
  route=excluded.route,
  color=excluded.color,
  state=excluded.state,
  sort_order=excluded.sort_order,
  updated_at=excluded.updated_at;
