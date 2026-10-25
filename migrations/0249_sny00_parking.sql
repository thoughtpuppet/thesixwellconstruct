UPDATE events SET
  arrival_notes=replace(arrival_notes,
    'You may park on the street alongside the building.',
    'Street parking is available in front of the building, all along Nelson Street, and on Centennial.'),
  updated_at=datetime('now')
WHERE id='evt_sny_00' AND slug='sny-00'
  AND instr(arrival_notes,'You may park on the street alongside the building.')>0;
