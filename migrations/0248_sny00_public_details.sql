UPDATE events SET
  details=replace(details,' A site presentation may be included if ready.',''),
  updated_at=datetime('now')
WHERE id='evt_sny_00' AND slug='sny-00'
  AND instr(details,' A site presentation may be included if ready.')>0;
