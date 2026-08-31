#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA_ROOT = path.join(REPO, "assets");
const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".mp4", ".mov", ".webm", ".wav", ".mp3", ".m4a", ".ogg", ".pdf", ".doc", ".docx", ".txt"]);
const SITE_PREFIXES = ["assets/entry-room/", "assets/audio/", "assets/home-ghost/", "assets/previews/", "assets/events/"];
const ARCHIVE_EXCLUDED_PREFIXES = ["assets/events/"];
const ARCHIVE_EXCLUDED_FILES = new Set([
  "assets/entry-room/ring-ripple-reference.mov",
  "assets/entry-room/ring-ripple-reference.mp4",
]);
const KNOWN_PROVENANCE = new Map([
  ["assets/gallery/peer-amid/avery peer amid black.png", {
    importSource: "user-provided-original",
    storageKey: "gallery/masters/peer-amid/f063b9839fe6cfbc1908edbaa907971849ddf950bbd38ac1adec7c59f24dbde8.png",
    originalSourcePath: "E:\\From HP All-In-One\\Photos (8)\\avery peer amid black.png",
    filesystemCreatedAt: "2026-03-18T21:46:52.000Z",
    filesystemModifiedAt: "2019-06-11T23:21:42.000Z",
    editingSoftware: "Adobe XMP Core 5.6-c142 79.160924, 2017/07/13-01:06:39",
    metadataEvidence: {
      xmpPacketPresent: true,
      embeddedArtworkDatePresent: false,
      embeddedColorProfilePresent: false,
      dateLayerNote: "Filesystem and embedded metadata are retained as evidence only; no artwork date was inferred.",
    },
  }],
  ["assets/gallery/peer-amid/avery peer amid tan no huh.png", {
    importSource: "user-provided-original",
    storageKey: "gallery/masters/peer-amid/291c661aadc94bd6c55a70db5926c82faad94394b98e21c6f7be268e0f84280d.png",
    originalSourcePath: "E:\\From HP All-In-One\\Photos (8)\\avery peer amid tan no huh.png",
    filesystemCreatedAt: "2026-03-18T21:46:53.000Z",
    filesystemModifiedAt: "2019-06-11T23:21:41.000Z",
    editingSoftware: "Adobe XMP Core 5.6-c142 79.160924, 2017/07/13-01:06:39",
    metadataEvidence: {
      xmpPacketPresent: true,
      embeddedArtworkDatePresent: false,
      embeddedColorProfilePresent: false,
      dateLayerNote: "Filesystem and embedded metadata are retained as evidence only; no artwork date was inferred.",
    },
  }],
]);
const MIME = new Map([
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"], [".gif", "image/gif"], [".svg", "image/svg+xml"],
  [".mp4", "video/mp4"], [".mov", "video/quicktime"], [".webm", "video/webm"], [".wav", "audio/wav"], [".mp3", "audio/mpeg"], [".m4a", "audio/mp4"], [".ogg", "audio/ogg"],
  [".pdf", "application/pdf"], [".doc", "application/msword"], [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], [".txt", "text/plain"],
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat();
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1], length = buffer.readUInt16BE(offset + 2);
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    if (!length || length < 2) break;
    offset += length + 2;
  }
  return {};
}

function normalizedExifDate(value) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value || "").trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : null;
}

function xmpValue(source, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const attribute = new RegExp(`${escaped}=["']([^"']+)["']`, "i").exec(source);
    if (attribute) return attribute[1].trim();
    const element = new RegExp(`<${escaped}[^>]*>([^<]+)</${escaped}>`, "i").exec(source);
    if (element) return element[1].trim();
  }
  return "";
}

function xmpEvidence(source) {
  if (!source) return {};
  const capture = xmpValue(source,["exif:DateTimeOriginal","photoshop:DateCreated","xmp:CreateDate"]);
  return {
    ...(capture ? { embeddedCaptureAt: normalizedExifDate(capture) || capture } : {}),
    cameraMake: xmpValue(source,["tiff:Make"]),
    cameraModel: xmpValue(source,["tiff:Model"]),
    editingSoftware: xmpValue(source,["xmp:CreatorTool","x:xmptk"]),
    orientation: xmpValue(source,["tiff:Orientation"]),
    colorProfile: xmpValue(source,["photoshop:ICCProfile"]),
    metadataEvidence: { xmpPacketPresent:true, embeddedArtworkDatePresent:Boolean(capture) },
  };
}

function pngEvidence(buffer) {
  const chunks=[];let offset=8,xmp="";
  while(offset+12<=buffer.length){const length=buffer.readUInt32BE(offset),type=buffer.toString("ascii",offset+4,offset+8),start=offset+8,end=start+length;if(end+4>buffer.length)break;chunks.push(type);if(type==="iTXt"||type==="tEXt"){const textValue=buffer.toString("utf8",start,end);if(/(?:XML:com\.adobe\.xmp|<\?xpacket|<x:xmpmeta)/i.test(textValue))xmp=textValue}offset=end+4;if(type==="IEND")break}
  const extracted=xmpEvidence(xmp),hasProfile=chunks.includes("iCCP")||chunks.includes("sRGB")||chunks.includes("gAMA");
  return {...extracted,colorProfile:extracted.colorProfile||(chunks.includes("iCCP")?"Embedded ICC profile":chunks.includes("sRGB")?"sRGB":""),metadataEvidence:{...(extracted.metadataEvidence||{}),pngChunks:chunks.filter(type=>!["IDAT"].includes(type)),embeddedColorProfilePresent:hasProfile}};
}

function jpegExifEvidence(buffer) {
  let offset=2,exif=null,icc=false;
  while(offset+4<buffer.length&&buffer[offset]===0xff){const marker=buffer[offset+1],length=buffer.readUInt16BE(offset+2),start=offset+4,end=offset+2+length;if(length<2||end>buffer.length)break;if(marker===0xe1&&buffer.toString("ascii",start,start+6)==="Exif\0\0")exif=buffer.subarray(start+6,end);if(marker===0xe2&&buffer.toString("ascii",start,start+11)==="ICC_PROFILE")icc=true;offset=end}
  if(!exif)return {colorProfile:icc?"Embedded ICC profile":"",metadataEvidence:{exifPresent:false,embeddedColorProfilePresent:icc}};
  const little=exif.toString("ascii",0,2)==="II",u16=position=>little?exif.readUInt16LE(position):exif.readUInt16BE(position),u32=position=>little?exif.readUInt32LE(position):exif.readUInt32BE(position),typeSize={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};
  const values=new Map();let gpsPresent=false;
  const readValue=(type,count,valueOffset,entryOffset)=>{const bytes=(typeSize[type]||1)*count,position=bytes<=4?entryOffset+8:valueOffset;if(position<0||position+bytes>exif.length)return null;if(type===2)return exif.toString("ascii",position,position+bytes).replace(/\0+$/g,"").trim();if(type===3)return count===1?u16(position):Array.from({length:count},(_,index)=>u16(position+index*2));if(type===4)return count===1?u32(position):Array.from({length:count},(_,index)=>u32(position+index*4));return null};
  const parseIfd=ifdOffset=>{if(!Number.isSafeInteger(ifdOffset)||ifdOffset<0||ifdOffset+2>exif.length)return;const count=u16(ifdOffset);for(let index=0;index<count;index+=1){const entry=ifdOffset+2+index*12;if(entry+12>exif.length)break;const tag=u16(entry),type=u16(entry+2),items=u32(entry+4),pointer=u32(entry+8),value=readValue(type,items,pointer,entry);if(value!==null)values.set(tag,value);if(tag===0x8769)parseIfd(pointer);if(tag===0x8825)gpsPresent=true}};
  if(u16(2)===42)parseIfd(u32(4));
  const orientationLabels={1:"normal",2:"mirror-horizontal",3:"rotate-180",4:"mirror-vertical",5:"mirror-horizontal-rotate-270",6:"rotate-90",7:"mirror-horizontal-rotate-90",8:"rotate-270"},colorSpace=values.get(0xa001);
  return {embeddedCaptureAt:normalizedExifDate(values.get(0x9003)||values.get(0x9004)||values.get(0x0132)),cameraMake:String(values.get(0x010f)||""),cameraModel:String(values.get(0x0110)||""),editingSoftware:String(values.get(0x0131)||""),orientation:orientationLabels[Number(values.get(0x0112))]||String(values.get(0x0112)||""),colorProfile:icc?"Embedded ICC profile":Number(colorSpace)===1?"sRGB":Number(colorSpace)===65535?"Uncalibrated":"",metadataEvidence:{exifPresent:true,gpsPresent,embeddedColorProfilePresent:icc||Boolean(colorSpace)}};
}

function webpDimensions(buffer) {
  if(buffer.length<30||buffer.toString("ascii",0,4)!=="RIFF"||buffer.toString("ascii",8,12)!=="WEBP")return{};const type=buffer.toString("ascii",12,16);if(type==="VP8X")return{width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)};if(type==="VP8L"){const bits=buffer.readUInt32LE(21);return{width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1}}return{};
}

function mediaDuration(buffer, extension) {
  if(extension===".wav"&&buffer.toString("ascii",0,4)==="RIFF"){let offset=12,byteRate=0,dataSize=0;while(offset+8<=buffer.length){const type=buffer.toString("ascii",offset,offset+4),size=buffer.readUInt32LE(offset+4);if(type==="fmt "&&size>=12)byteRate=buffer.readUInt32LE(offset+16);if(type==="data"){dataSize=size;break}offset+=8+size+(size%2)}if(byteRate&&dataSize)return Number((dataSize/byteRate).toFixed(3))}
  if([".mp4",".mov",".m4a"].includes(extension)){const marker=buffer.indexOf(Buffer.from("mvhd"));if(marker>=0&&marker+32<buffer.length){const version=buffer[marker+4],timescale=version===1?buffer.readUInt32BE(marker+24):buffer.readUInt32BE(marker+16),duration=version===1?Number(buffer.readBigUInt64BE(marker+28)):buffer.readUInt32BE(marker+20);if(timescale&&duration)return Number((duration/timescale).toFixed(3))}}
  return null;
}

function technicalEvidence(buffer, extension) {
  if(extension===".png")return pngEvidence(buffer);
  if([".jpg",".jpeg"].includes(extension))return jpegExifEvidence(buffer);
  return {};
}

function svgDimensions(buffer) {
  const source = buffer.toString("utf8", 0, Math.min(buffer.length, 65536));
  const viewBox = source.match(/\bviewBox\s*=\s*["']\s*[-.\d]+[ ,]+[-.\d]+[ ,]+([.\d]+)[ ,]+([.\d]+)/i);
  const width = source.match(/\bwidth\s*=\s*["']([.\d]+)(?:px)?["']/i), height = source.match(/\bheight\s*=\s*["']([.\d]+)(?:px)?["']/i);
  return { width: Number(width?.[1] || viewBox?.[1]) || null, height: Number(height?.[1] || viewBox?.[2]) || null };
}

function dimensions(buffer, extension) {
  if (extension === ".png" && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (extension === ".gif" && buffer.length >= 10) return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  if ([".jpg", ".jpeg"].includes(extension)) return jpegDimensions(buffer);
  if (extension === ".webp") return webpDimensions(buffer);
  if (extension === ".svg") return svgDimensions(buffer);
  return {};
}

function quoted(value) { return `'${String(value ?? "").replaceAll("'", "''")}'`; }
function nullable(value) { return value === null || value === undefined || value === "" ? "NULL" : Number.isFinite(Number(value)) ? String(Number(value)) : quoted(value); }
function titleFromFilename(filename) { return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function identityPredicate(record) {
  const locator = record.storageKey
    ? `existing.storage_key=${quoted(record.storageKey)}`
    : `lower(replace(existing.source_url,'\\','/'))=lower(${quoted(record.sourceUrl)})`;
  return `(${locator} OR catalogue.sha256=${quoted(record.sha256)})`;
}
function locatorOrder(record) {
  return record.storageKey ? `existing.storage_key=${quoted(record.storageKey)}` : `lower(replace(existing.source_url,'\\','/'))=lower(${quoted(record.sourceUrl)})`;
}

async function inventory() {
  const files = (await walk(MEDIA_ROOT)).filter((file) => SUPPORTED.has(path.extname(file).toLowerCase())).sort((left,right) => left.localeCompare(right));
  const records = [];
  for (const absolute of files) {
    const buffer = await readFile(absolute), extension = path.extname(absolute).toLowerCase(), relative = path.relative(REPO, absolute).split(path.sep).join("/"), provenance = KNOWN_PROVENANCE.get(relative) || {}, sourceUrl = provenance.storageKey ? "" : `/${relative}`;
    const normalizedRelative=relative.toLowerCase(),hash = createHash("sha256").update(buffer).digest("hex"), sourceClass = SITE_PREFIXES.some((prefix) => normalizedRelative.startsWith(prefix)) ? "site_asset" : "creative";
    const archiveCatalogueEligible = !ARCHIVE_EXCLUDED_FILES.has(normalizedRelative) && !ARCHIVE_EXCLUDED_PREFIXES.some((prefix)=>normalizedRelative.startsWith(prefix));
    records.push({ relative, sourceUrl, storageKey:provenance.storageKey||"", filename: path.basename(absolute), extension: extension.slice(1), mimeType: MIME.get(extension), byteSize: buffer.length, sha256: hash, sourceClass, archiveCatalogueEligible, durationSeconds:mediaDuration(buffer,extension), ...dimensions(buffer, extension), ...technicalEvidence(buffer,extension) });
  }
  return records;
}

function sql(records) {
  const lines = [
    "-- Generated by tools/media-catalogue-backfill.mjs.",
    "-- Repository files are registered once by source URL or SHA-256; creative files become private Gallery drafts.",
    "",
    "-- Existing source-URL identities remain distinct even when two repository paths contain",
    "-- identical bytes. The canonical row retains the checksum after the import completes.",
    "DROP INDEX IF EXISTS idx_media_catalogue_sha256;",
    "",
  ];
  for (const record of records) {
    const mediaId = `media-repo-${record.sha256.slice(0, 24)}`, title = titleFromFilename(record.filename);
    const provenance = KNOWN_PROVENANCE.get(record.relative) || {};
    const repositoryAliases = records.filter((candidate) => candidate.sha256 === record.sha256).map((candidate) => candidate.relative);
    const rawMetadata = {
      repositoryPath: record.relative,
      ...(repositoryAliases.length > 1 ? { repositoryAliases } : {}),
      ...(provenance.originalSourcePath ? { originalSourcePath: provenance.originalSourcePath } : {}),
      ...(provenance.filesystemCreatedAt ? { filesystemCreatedAt: provenance.filesystemCreatedAt } : {}),
      ...(provenance.filesystemModifiedAt ? { filesystemModifiedAt: provenance.filesystemModifiedAt } : {}),
      ...((record.metadataEvidence||provenance.metadataEvidence) ? { metadataEvidence: {...(record.metadataEvidence||{}),...(provenance.metadataEvidence||{})} } : {}),
    };
    const predicate=identityPredicate(record),order=locatorOrder(record),editingSoftware=provenance.editingSoftware||record.editingSoftware||"";
    lines.push(
      `INSERT INTO media_assets(id,source_url,storage_key,original_filename,mime_type,byte_size,width,height,duration_seconds,alt_text,caption,credit,rights_notes,privacy,state,created_by,created_at,updated_at,public_presentation,archive_catalogue_eligible)`,
      `SELECT ${quoted(mediaId)},${quoted(record.sourceUrl)},${quoted(record.storageKey)},${quoted(record.filename)},${quoted(record.mimeType)},${record.byteSize},${nullable(record.width)},${nullable(record.height)},${nullable(record.durationSeconds)},'','','','','internal','active','migration-0203',datetime('now'),datetime('now'),'hidden',${record.archiveCatalogueEligible?1:0}`,
      `WHERE NOT EXISTS(SELECT 1 FROM media_assets existing LEFT JOIN media_catalogue_entries catalogue ON catalogue.media_id=existing.id WHERE ${predicate});`,
      ...(!record.archiveCatalogueEligible ? [
        `UPDATE media_assets SET archive_catalogue_eligible=0 WHERE id=(SELECT existing.id FROM media_assets existing LEFT JOIN media_catalogue_entries catalogue ON catalogue.media_id=existing.id WHERE ${predicate} ORDER BY CASE WHEN ${order} THEN 0 ELSE 1 END LIMIT 1);`,
      ] : [
        `UPDATE media_catalogue_entries SET sha256=${quoted(record.sha256)},source_class=${quoted(record.sourceClass)},original_format=${quoted(record.extension)},import_source=${quoted(provenance.importSource || "repository-backfill")},embedded_capture_at=${nullable(record.embeddedCaptureAt)},camera_make=${quoted(record.cameraMake||"")},camera_model=${quoted(record.cameraModel||"")},editing_software=${quoted(editingSoftware)},orientation=${quoted(record.orientation||"")},color_profile=${quoted(record.colorProfile||"")},raw_metadata_json=${quoted(JSON.stringify(rawMetadata))},updated_by='migration-0203',updated_at=datetime('now')`,
        `WHERE media_id=(SELECT existing.id FROM media_assets existing LEFT JOIN media_catalogue_entries catalogue ON catalogue.media_id=existing.id WHERE ${predicate} ORDER BY CASE WHEN ${order} THEN 0 ELSE 1 END LIMIT 1);`,
      ]),
    );
    if (record.archiveCatalogueEligible && record.sourceClass === "creative") lines.push(
      `INSERT OR IGNORE INTO gallery_entries(media_id,display_media_id,title,accessibility_text,accessibility_status,caption,credit,rights_status,date_precision,state,created_by,updated_by,created_at,updated_at)`,
      `SELECT existing.id,existing.id,${quoted(title)},existing.alt_text,'unreviewed',existing.caption,existing.credit,'unreviewed','unreviewed','draft','migration-0203','migration-0203',datetime('now'),datetime('now') FROM media_assets existing LEFT JOIN media_catalogue_entries catalogue ON catalogue.media_id=existing.id WHERE ${predicate} ORDER BY CASE WHEN ${order} THEN 0 ELSE 1 END LIMIT 1;`,
    );
    lines.push("");
  }
  const peerAmid = [
    "assets/gallery/peer-amid/avery peer amid black.png",
    "assets/gallery/peer-amid/avery peer amid tan no huh.png",
  ];
  if (peerAmid.every((relative) => records.some((record) => record.relative === relative))) {
    const peerRecords = peerAmid.map((relative) => records.find((record) => record.relative === relative));
    const peerLocators = peerRecords.map((record) => record.storageKey
      ? `storage_key=${quoted(record.storageKey)}`
      : `source_url=${quoted(record.sourceUrl)}`);
    lines.push(
      "-- The two supplied Peer Amid exports stay distinct Media Assets. Their set and",
      "-- alternate relationship are private editorial structure, not Archive records.",
      "INSERT OR IGNORE INTO gallery_sets(id,slug,title,summary,set_type,date_precision,state,sort_order,created_by,updated_by,created_at,updated_at)",
      "VALUES('gallery-set-peer-amid-versions','peer-amid-versions','Peer Amid — Versions','','series','undated','draft',0,'migration-0203','migration-0203',datetime('now'),datetime('now'));",
      `INSERT OR IGNORE INTO gallery_set_items(set_id,media_id,sort_order,created_at) SELECT 'gallery-set-peer-amid-versions',id,0,datetime('now') FROM media_assets WHERE ${peerLocators[0]};`,
      `INSERT OR IGNORE INTO gallery_set_items(set_id,media_id,sort_order,created_at) SELECT 'gallery-set-peer-amid-versions',id,1,datetime('now') FROM media_assets WHERE ${peerLocators[1]};`,
      "INSERT OR IGNORE INTO entity_relationships(id,source_entity_id,target_entity_id,relationship_type_id,public_visible,internal_notes,sort_order,created_by,created_at,updated_at)",
      `SELECT 'relationship-peer-amid-black-tan-alternate',source.entity_id,target.entity_id,'rel-alternate-of',0,'Imported together from the two user-supplied Peer Amid originals; editorial review required.',0,'migration-0203',datetime('now'),datetime('now') FROM media_catalogue_entries source JOIN media_assets source_media ON source_media.id=source.media_id AND source_media.${peerLocators[0]} JOIN media_catalogue_entries target JOIN media_assets target_media ON target_media.id=target.media_id AND target_media.${peerLocators[1]};`,
      "",
    );
  }
  lines.push(
    "UPDATE media_catalogue_entries",
    "SET sha256=NULL,",
    "    raw_metadata_json=json_set(COALESCE(raw_metadata_json,'{}'),'$.duplicateOfCatalogueId',(",
    "      SELECT MIN(canonical.catalogue_id)",
    "      FROM media_catalogue_entries canonical",
    "      WHERE canonical.sha256=media_catalogue_entries.sha256",
    "    )),",
    "    updated_at=datetime('now')",
    "WHERE sha256 IS NOT NULL",
    "  AND catalogue_id<>(",
    "    SELECT MIN(canonical.catalogue_id)",
    "    FROM media_catalogue_entries canonical",
    "    WHERE canonical.sha256=media_catalogue_entries.sha256",
    "  );",
    "",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_media_catalogue_sha256",
    "  ON media_catalogue_entries(sha256)",
    "  WHERE sha256 IS NOT NULL;",
  );
  return `${lines.join("\n")}\n`;
}

const records = await inventory();
if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify({ root: "assets", count: records.length, records }, null, 2)}\n`);
else if (process.argv.includes("--r2-manifest")) {
  const privateMasters = records.filter((record) => record.storageKey).map((record) => ({
    localPath: record.relative,
    storageKey: record.storageKey,
    sha256: record.sha256,
    byteSize: record.byteSize,
    mimeType: record.mimeType,
  }));
  process.stdout.write(`${JSON.stringify({ bucketBinding: "SUBMISSION_FILES", count: privateMasters.length, privateMasters }, null, 2)}\n`);
}
else {
  const output = sql(records);
  const writeIndex = process.argv.indexOf("--write");
  if (writeIndex >= 0) {
    const destination = process.argv[writeIndex + 1];
    if (!destination) throw new Error("--write requires a destination path");
    await writeFile(path.resolve(REPO, destination), output, "utf8");
  } else process.stdout.write(output);
}
