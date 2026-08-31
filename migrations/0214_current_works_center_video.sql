-- Make the creator-supplied studio loop the managed Current Works center media.
-- The checked-in MP4 is a silent H.264 derivative of the supplied HEVC MOV;
-- source and derivative evidence remain separate in the catalogue metadata.

INSERT OR IGNORE INTO media_assets
  (id,source_url,storage_key,original_filename,mime_type,byte_size,width,height,duration_seconds,alt_text,caption,credit,rights_notes,privacy,state,created_by,created_at,updated_at,public_presentation)
VALUES
  ('media-current-works-center-loop-7c051cf30035','/assets/video/current-works/current-works-center-loop.mp4','','current-works-center-loop.mp4','video/mp4',2074131,720,1280,14.57,'Artist gesturing toward paintings installed inside a studio','','','Creator-supplied source; public Current Works loop derivative. Source audio intentionally omitted for reliable muted autoplay.','public','active','migration-0214',datetime('now'),datetime('now'),'inline');

UPDATE media_catalogue_entries
SET source_class='creative',
    sha256='7c051cf300358ce800589cd7e5a0d45702697d989bbe9706bd85ab8d36325b90',
    original_format='mov',
    import_source='user-supplied-source-derivative',
    embedded_capture_at='2024-01-24T20:19:36',
    embedded_capture_timezone='-05:00',
    editing_software='FFmpeg 6.1.1 derivative',
    orientation='portrait',
    color_profile='BT.709',
    metadata_review_state='reviewed',
    raw_metadata_json='{"repositoryPath":"assets/video/current-works/current-works-center-loop.mp4","derivative":{"sha256":"7c051cf300358ce800589cd7e5a0d45702697d989bbe9706bd85ab8d36325b90","format":"mp4","videoCodec":"H.264 High","width":720,"height":1280,"durationSeconds":14.57,"framesPerSecond":24,"audio":"omitted","fastStart":true},"sourceEvidence":{"originalFilename":"1-export.mov","sha256":"06f02c2f0728ecbcef1d73e3102be63b51a034c14ee37e9764a05b1ea72770ac","byteSize":19166114,"container":"QuickTime","videoCodec":"HEVC Main","audioCodec":"AAC LC","width":1080,"height":1920,"durationSeconds":14.57,"embeddedCaptureAt":"2024-01-24T20:19:36-05:00","containerCreationAt":"2026-08-31T22:05:27Z","filesystemCreationUtc":"2026-08-31T22:06:31Z","filesystemModifiedUtc":"2026-08-31T22:06:31Z"}}',
    updated_by='migration-0214',
    updated_at=datetime('now')
WHERE media_id='media-current-works-center-loop-7c051cf30035';

INSERT OR IGNORE INTO media_assets
  (id,source_url,storage_key,original_filename,mime_type,byte_size,width,height,duration_seconds,alt_text,caption,credit,rights_notes,privacy,state,created_by,created_at,updated_at,public_presentation)
VALUES
  ('media-current-works-center-poster-bf7b20b0d50e','/assets/images/current-works/current-works-center-loop-poster.jpg','','current-works-center-loop-poster.jpg','image/jpeg',96628,720,1280,NULL,'Artist gesturing toward paintings installed inside a studio','','','Poster derivative generated from the creator-supplied Current Works source video.','public','active','migration-0214',datetime('now'),datetime('now'),'inline');

UPDATE media_catalogue_entries
SET source_class='site_asset',
    sha256='bf7b20b0d50e17c53ad52a44b801692f0f54ecc2aa00e222f4ca248d78ae9040',
    original_format='jpg',
    import_source='video-poster-derivative',
    embedded_capture_at='2024-01-24T20:19:36',
    embedded_capture_timezone='-05:00',
    editing_software='FFmpeg 6.1.1 derivative',
    orientation='portrait',
    color_profile='BT.709',
    metadata_review_state='reviewed',
    raw_metadata_json='{"repositoryPath":"assets/images/current-works/current-works-center-loop-poster.jpg","sha256":"bf7b20b0d50e17c53ad52a44b801692f0f54ecc2aa00e222f4ca248d78ae9040","width":720,"height":1280,"sourceMediaId":"media-current-works-center-loop-7c051cf30035","sourceTimestampSeconds":0.7}',
    updated_by='migration-0214',
    updated_at=datetime('now')
WHERE media_id='media-current-works-center-poster-bf7b20b0d50e';

DELETE FROM entity_media
WHERE entity_id='current-project-artpill'
  AND role='current-fragment'
  AND media_id IN (
    SELECT media_id FROM entity_media
    WHERE entity_id='current-project-artpill' AND role='primary'
  );

UPDATE entity_media
SET role='current-fragment',sort_order=sort_order+1
WHERE entity_id='current-project-artpill'
  AND role='primary'
  AND media_id<>'media-current-works-center-loop-7c051cf30035';

DELETE FROM entity_media
WHERE entity_id='current-project-artpill'
  AND media_id='media-current-works-center-loop-7c051cf30035';

INSERT INTO entity_media
  (entity_id,media_id,role,sort_order,public_visible,alt_text_override,caption_override,created_at)
VALUES
  ('current-project-artpill','media-current-works-center-loop-7c051cf30035','primary',1,1,'Artist gesturing toward paintings installed inside a studio','',datetime('now'));

UPDATE about_current_projects
SET collage_slot=0,updated_at=datetime('now')
WHERE collage_slot=1 AND id<>'current-project-artpill' AND state<>'archived';

UPDATE about_current_projects
SET collage_slot=1,focal_x=50,focal_y=43,updated_at=datetime('now')
WHERE id='current-project-artpill';

UPDATE content_entities
SET updated_by='migration-0214',updated_at=datetime('now')
WHERE id IN ('current-project-artpill','media-catalogue-media-current-works-center-loop-7c051cf30035','media-catalogue-media-current-works-center-poster-bf7b20b0d50e');
