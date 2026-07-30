import { db, failure, id, json, readJson, text } from "../_shared/construct.js";

const MATERIAL_KINDS = new Set([
  "raw-pigment","art-paint","tattoo-ink","medium-diluent","additive",
  "finish-topcoat","support-substrate","tool","equipment",
  "needle-cartridge","disposable","aftercare",
]);
const RECIPE_KINDS = new Set(["raw-pigment","art-paint","tattoo-ink","medium-diluent","additive","finish-topcoat"]);
const STATES = new Set(["draft","published","archived"]);
const OPTICAL_EFFECTS = new Set(["metallic","fluorescent","pearlescent","iridescent","interference"]);
const GEOMETRY_TYPES = new Set(["polygon","polyline","path","rect","circle","ellipse"]);

function publicSql(alias) {
  return `${alias}.publication_state='published' AND ${alias}.public_visible=1`;
}

function bool(value) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanSlug(value) {
  return text(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function safePublicUrl(value) {
  const candidate=text(value,2000);
  if(!candidate)return "";
  try {
    const parsed=new URL(candidate);
    return ["http:","https:"].includes(parsed.protocol)?candidate:"";
  } catch {
    return "";
  }
}

function parseJson(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function opticalEffects(value) {
  const values = Array.isArray(value) ? value : parseJson(value);
  return [...new Set(values.map((entry) => text(entry, 40).toLowerCase()).filter((entry) => OPTICAL_EFFECTS.has(entry)))];
}

function publicMaterial(row = {}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    material_kind: row.material_kind,
    materialKind: row.material_kind,
    manufacturer: row.manufacturer || "",
    brand: row.brand || "",
    product_line: row.product_line || "",
    productLine: row.product_line || "",
    product_name: row.product_name || "",
    productName: row.product_name || "",
    model_name: row.model_name || "",
    modelName: row.model_name || "",
    color_name: row.color_name || "",
    colorName: row.color_name || "",
    product_code: row.product_code || "",
    productCode: row.product_code || "",
    medium_scope: row.medium_scope || "shared",
    mediumScope: row.medium_scope || "shared",
    pigment_code: row.pigment_code || "",
    pigmentCode: row.pigment_code || "",
    description: row.description || "",
    archive_route: `/archive/materials/${encodeURIComponent(row.slug)}/`,
    archiveRoute: `/archive/materials/${encodeURIComponent(row.slug)}/`,
  };
}

function publicProfile(row = {}) {
  if (!row.profile_id && !row.srgb_hex) return null;
  return {
    id: row.profile_id || row.id,
    srgb_hex: row.srgb_hex,
    srgbHex: row.srgb_hex,
    lab: { l: Number(row.lab_l), a: Number(row.lab_a), b: Number(row.lab_b) },
    oklch: { l: Number(row.oklch_l), c: Number(row.oklch_c), h: row.oklch_h === null ? null : Number(row.oklch_h) },
    reference_method: row.reference_method,
    referenceMethod: row.reference_method,
    reviewed_at: row.reviewed_at || null,
  };
}

function publicRecipe(row = {}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    medium_scope: row.medium_scope || "shared",
    mediumScope: row.medium_scope || "shared",
    version_id: row.version_id || "",
    versionId: row.version_id || "",
    version_number: Number(row.version_number || 0),
    versionNumber: Number(row.version_number || 0),
    version_label: row.version_label || "",
    resulting_finish: row.resulting_finish || "unspecified",
    resultingFinish: row.resulting_finish || "unspecified",
    finish_label: row.finish_label || "",
    instructions: row.instructions || "",
    color_profile: publicProfile(row),
    colorProfile: publicProfile(row),
    archive_route: `/archive/colors/${encodeURIComponent(row.slug)}/`,
    archiveRoute: `/archive/colors/${encodeURIComponent(row.slug)}/`,
  };
}

async function publicColors(request, env, slug = "") {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env);
  const where = slug ? "AND (r.slug=? OR r.id=?)" : "";
  const statement = database.prepare(`SELECT r.*,v.id version_id,v.version_number,v.version_label,
      v.resulting_finish,v.finish_label,v.instructions,
      cp.id profile_id,cp.srgb_hex,cp.lab_l,cp.lab_a,cp.lab_b,
      cp.oklch_l,cp.oklch_c,cp.oklch_h,cp.reference_method,cp.reviewed_at,
      (SELECT COUNT(DISTINCT aos.version_id)
        FROM archive_color_usages cu
        JOIN archive_object_states aos ON aos.id=cu.state_id
        JOIN archive_object_versions aov ON aov.id=aos.version_id
        JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id
        JOIN content_entities ce ON ce.id=ad.entity_id
        WHERE cu.recipe_version_id=v.id AND ${publicSql("cu")}
          AND ad.state='published' AND ad.public_visible=1 AND ce.visibility='public') usage_count
    FROM archive_color_recipes r
    JOIN archive_color_recipe_versions v ON v.recipe_id=r.id AND ${publicSql("v")}
      AND v.version_number=(SELECT MAX(v2.version_number) FROM archive_color_recipe_versions v2 WHERE v2.recipe_id=r.id AND ${publicSql("v2")})
    LEFT JOIN archive_color_profiles cp ON cp.source_type='recipe-version' AND cp.source_id=v.id
    WHERE ${publicSql("r")} ${where}
    ORDER BY r.name`);
  const result = slug ? await statement.bind(slug, slug).all() : await statement.all();
  const rows = result.results || [];
  if (slug && !rows.length) return failure("Color not found.", 404);
  if (!slug) return json({ colors: rows.map((row) => ({ ...publicRecipe(row), usage_count: Number(row.usage_count || 0) })), count: rows.length }, { cache: "public, max-age=60" });

  const recipe = rows[0];
  const versions = (await database.prepare(`SELECT v.*,cp.id profile_id,cp.srgb_hex,cp.lab_l,cp.lab_a,cp.lab_b,
      cp.oklch_l,cp.oklch_c,cp.oklch_h,cp.reference_method,cp.reviewed_at
    FROM archive_color_recipe_versions v
    LEFT JOIN archive_color_profiles cp ON cp.source_type='recipe-version' AND cp.source_id=v.id
    WHERE v.recipe_id=? AND ${publicSql("v")}
    ORDER BY v.version_number DESC`).bind(recipe.id).all()).results || [];
  const versionIds = versions.map((row) => row.id);
  const components = versionIds.length ? (await database.prepare(`SELECT c.*,
      m.slug material_slug,m.name material_name,m.material_kind,m.brand,m.product_line,m.color_name,m.product_code,
      f.version_number formulation_version,
      nr.slug nested_recipe_slug,nr.name nested_recipe_name,nv.version_number nested_recipe_version
    FROM archive_color_recipe_components c
    LEFT JOIN archive_material_formulations f ON f.id=c.formulation_id
    LEFT JOIN archive_material_definitions m ON m.id=COALESCE(f.material_id,c.raw_pigment_material_id)
    LEFT JOIN archive_color_recipe_versions nv ON nv.id=c.nested_recipe_version_id
    LEFT JOIN archive_color_recipes nr ON nr.id=nv.recipe_id
    WHERE c.recipe_version_id IN (${versionIds.map(() => "?").join(",")})
      AND (
        (c.formulation_id IS NOT NULL AND ${publicSql("f")} AND ${publicSql("m")}) OR
        (c.raw_pigment_material_id IS NOT NULL AND ${publicSql("m")}) OR
        (c.nested_recipe_version_id IS NOT NULL AND ${publicSql("nv")} AND ${publicSql("nr")})
      )
    ORDER BY c.recipe_version_id,c.sort_order,c.created_at`).bind(...versionIds).all()).results || [] : [];
  const families = versionIds.length ? (await database.prepare(`SELECT cpf.profile_id,cf.slug,cf.name,cf.swatch_hex
    FROM archive_color_profile_families cpf
    JOIN archive_color_profiles cp ON cp.id=cpf.profile_id AND cp.source_type='recipe-version'
    JOIN archive_color_families cf ON cf.id=cpf.family_id AND ${publicSql("cf")}
    WHERE cp.source_id IN (${versionIds.map(() => "?").join(",")})
    ORDER BY cf.sort_order,cf.name`).bind(...versionIds).all()).results || [] : [];
  const componentMap = new Map();
  for (const component of components) {
    if (!componentMap.has(component.recipe_version_id)) componentMap.set(component.recipe_version_id, []);
    componentMap.get(component.recipe_version_id).push({
      id: component.id,
      quantity: { value: component.quantity_value, unit: component.quantity_unit, approximate: Boolean(component.approximate), note: component.quantity_note || "" },
      material: component.material_slug ? {
        slug: component.material_slug,
        name: component.material_name,
        kind: component.material_kind,
        brand: component.brand || "",
        line: component.product_line || "",
        color_name: component.color_name || "",
        product_code: component.product_code || "",
        formulation_version: component.formulation_version || null,
        route: `/archive/materials/${encodeURIComponent(component.material_slug)}/`,
      } : null,
      nested_recipe: component.nested_recipe_slug ? {
        slug: component.nested_recipe_slug,
        name: component.nested_recipe_name,
        version: Number(component.nested_recipe_version),
        route: `/archive/colors/${encodeURIComponent(component.nested_recipe_slug)}/`,
      } : null,
    });
  }
  const familyMap = new Map();
  for (const family of families) {
    if (!familyMap.has(family.profile_id)) familyMap.set(family.profile_id, []);
    familyMap.get(family.profile_id).push({ slug: family.slug, name: family.name, swatch_hex: family.swatch_hex });
  }
  return json({
    color: {
      ...publicRecipe(recipe),
      versions: versions.map((version) => ({
        id: version.id,
        version_number: Number(version.version_number),
        version_label: version.version_label || "",
        resulting_finish: version.resulting_finish,
        finish_label: version.finish_label || "",
        instructions: version.instructions || "",
        color_profile: publicProfile(version),
        families: familyMap.get(version.profile_id) || [],
        components: componentMap.get(version.id) || [],
      })),
    },
  }, { cache: "public, max-age=60" });
}

async function publicMaterials(request, env, slug = "") {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env);
  const url = new URL(request.url);
  const kind = text(url.searchParams.get("kind"), 60);
  const medium = text(url.searchParams.get("medium"), 20);
  const conditions = [publicSql("m")];
  const values = [];
  if (slug) {
    conditions.push("(m.slug=? OR m.id=?)");
    values.push(slug, slug);
  }
  if (kind && MATERIAL_KINDS.has(kind)) {
    conditions.push("m.material_kind=?");
    values.push(kind);
  }
  if (medium && ["art","tattoo","shared"].includes(medium)) {
    conditions.push("m.medium_scope IN (?, 'shared')");
    values.push(medium);
  }
  const rows = (await database.prepare(`SELECT m.*,
      (SELECT COUNT(*) FROM archive_material_formulations f WHERE f.material_id=m.id AND ${publicSql("f")}) formulation_count
    FROM archive_material_definitions m
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.material_kind,m.name`).bind(...values).all()).results || [];
  if (slug && !rows.length) return failure("Material not found.", 404);
  if (!slug) return json({ materials: rows.map((row) => ({ ...publicMaterial(row), formulation_count: Number(row.formulation_count || 0) })), count: rows.length }, { cache: "public, max-age=60" });
  const material = rows[0];
  const formulations = (await database.prepare(`SELECT f.*,cp.id profile_id,cp.srgb_hex,cp.lab_l,cp.lab_a,cp.lab_b,
      cp.oklch_l,cp.oklch_c,cp.oklch_h,cp.reference_method,cp.reviewed_at
    FROM archive_material_formulations f
    LEFT JOIN archive_color_profiles cp ON cp.source_type='material-formulation' AND cp.source_id=f.id
    WHERE f.material_id=? AND ${publicSql("f")}
    ORDER BY f.version_number DESC`).bind(material.id).all()).results || [];
  const formulationIds = formulations.map((row) => row.id);
  const declarations = formulationIds.length ? (await database.prepare(`SELECT d.formulation_id,d.normalized_pigment_code,d.bottle_wording,d.source_type,d.source_url,d.observed_at,
      p.slug pigment_slug,p.name pigment_name
    FROM archive_material_declared_pigments d
    LEFT JOIN archive_material_definitions p ON p.id=d.pigment_material_id AND ${publicSql("p")}
    WHERE d.formulation_id IN (${formulationIds.map(() => "?").join(",")})
    ORDER BY d.formulation_id,d.sort_order,d.created_at`).bind(...formulationIds).all()).results || [] : [];
  const declarationMap = new Map();
  for (const declaration of declarations) {
    if (!declarationMap.has(declaration.formulation_id)) declarationMap.set(declaration.formulation_id, []);
    declarationMap.get(declaration.formulation_id).push({
      code: declaration.normalized_pigment_code,
      bottle_wording: declaration.bottle_wording,
      source_type: declaration.source_type,
      source_url: declaration.source_url,
      observed_at: declaration.observed_at,
      pigment: declaration.pigment_slug ? {
        slug: declaration.pigment_slug,
        name: declaration.pigment_name,
        route: `/archive/materials/${encodeURIComponent(declaration.pigment_slug)}/`,
      } : null,
      provenance: "manufacturer-declared",
    });
  }
  return json({
    material: {
      ...publicMaterial(material),
      formulations: formulations.map((formulation) => ({
        id: formulation.id,
        version_number: Number(formulation.version_number),
        version_label: formulation.version_label,
        normalized_finish: formulation.normalized_finish,
        finish_label: formulation.finish_label,
        opacity: formulation.opacity,
        optical_effects: opticalEffects(formulation.optical_effects_json),
        manufacturer_wording: formulation.manufacturer_wording,
        color_profile: publicProfile(formulation),
        declared_pigments: declarationMap.get(formulation.id) || [],
      })),
    },
  }, { cache: "public, max-age=60" });
}

function mapMediaUrl(row) {
  return `/api/construct/media/${encodeURIComponent(row.source_media_id)}`;
}

function mapRegion(row, index = 0) {
  const recipe = row.recipe_slug && row.recipe_name ? {
    slug: row.recipe_slug,
    name: row.recipe_name,
    version: Number(row.recipe_version_number || 0),
    route: `/archive/colors/${encodeURIComponent(row.recipe_slug)}/`,
  } : null;
  const product = row.material_slug && row.material_name ? {
    slug: row.material_slug,
    name: row.material_name,
    brand: row.material_brand || "",
    line: row.material_product_line || "",
    color_name: row.material_color_name || "",
    product_code: row.material_product_code || "",
    version: Number(row.formulation_version_number || 0),
    route: `/archive/materials/${encodeURIComponent(row.material_slug)}/`,
  } : null;
  return {
    id: row.id,
    label: row.label || row.public_label || `Region ${index + 1}`,
    geometry_type: row.geometry_type,
    geometry: parseJson(row.geometry_json, {}),
    layer_order: Number(row.layer_order || 0),
    sort_order: Number(row.sort_order || 0),
    usage: {
      id: row.color_usage_id,
      label: row.public_label || row.recipe_name || row.material_color_name || row.material_name || `Color ${index + 1}`,
      swatch: row.public_swatch_hex || row.srgb_hex || "",
      status: row.usage_status,
      technique: row.technique || "",
      layer_order: Number(row.usage_layer_order || 0),
      recipe,
      product,
      recipe_slug: row.recipe_slug || "",
      material_slug: row.material_slug || "",
    },
  };
}

function geometryMatrixAttribute(geometry={}) {
  if(!Array.isArray(geometry.matrix)||geometry.matrix.length!==6)return"";
  const values=geometry.matrix.map(Number);
  if(values.some(value=>!Number.isFinite(value)))return"";
  return ` transform="matrix(${values.map(value=>Number(value.toFixed(6))).join(" ")})"`;
}

export async function projectPublicPalette(database,{entityId="",stateId="",catalogueId=""}={}) {
  const target=stateId||entityId;
  if(!target)return{eligible:false,blockers:["Archive state or entity is required."],color_usages:[],material_usages:[],palette_maps:[]};
  const gate=await database.prepare(`SELECT aos.id state_id,aos.publication_state state_publication,aos.public_visible state_visible,
      aov.entity_id,aov.publication_state version_publication,aov.public_visible version_visible,
      ad.state dossier_publication,ad.public_visible dossier_visible,ce.visibility entity_visibility,
      COALESCE(ace.catalogue_id,'') catalogue_id
    FROM archive_object_states aos
    JOIN archive_object_versions aov ON aov.id=aos.version_id
    JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id
    JOIN content_entities ce ON ce.id=ad.entity_id
    LEFT JOIN archive_catalogue_entries ace ON ace.entity_id=aov.entity_id
    WHERE ${stateId?"aos.id=?":"aov.entity_id=?"}
    ORDER BY aos.sort_order,aos.state_order LIMIT 1`).bind(target).first();
  if(!gate)return{eligible:false,blockers:["Archive state or dossier was not found."],color_usages:[],material_usages:[],palette_maps:[]};
  const blockers=[];
  if(gate.entity_visibility!=="public")blockers.push("The canonical entity is not public.");
  if(gate.dossier_publication!=="published"||!Number(gate.dossier_visible))blockers.push("The Archive dossier is not published and public.");
  if(stateId&&(gate.version_publication!=="published"||!Number(gate.version_visible)))blockers.push("The Archive version is not published and public.");
  if(stateId&&(gate.state_publication!=="published"||!Number(gate.state_visible)))blockers.push("The creative state is not published and public.");
  const eligible=!blockers.length;
  if(!eligible)return{eligible:false,blockers,color_usages:[],material_usages:[],palette_maps:[]};
  const condition=stateId?"aos.id=?":"aov.entity_id=?";
  const [colorResult,materialResult,mapResult]=await database.batch([
    database.prepare(`SELECT cu.*,aos.state_roman,aos.variant_label,aov.version_number,
        r.name recipe_name,r.slug recipe_slug,rv.version_number recipe_version_number,
        md.name material_name,md.slug material_slug,md.brand,md.product_line,md.color_name,md.product_code,
        mf.version_number formulation_version,cp.srgb_hex
      FROM archive_color_usages cu
      JOIN archive_object_states aos ON aos.id=cu.state_id AND aos.publication_state='published' AND aos.public_visible=1
      JOIN archive_object_versions aov ON aov.id=aos.version_id AND aov.publication_state='published' AND aov.public_visible=1
      JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id AND ad.state='published' AND ad.public_visible=1
      JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
      LEFT JOIN archive_color_recipe_versions rv ON rv.id=cu.recipe_version_id
        AND rv.publication_state='published' AND rv.public_visible=1
      LEFT JOIN archive_color_recipes r ON r.id=rv.recipe_id
        AND r.publication_state='published' AND r.public_visible=1
      LEFT JOIN archive_material_formulations mf ON mf.id=cu.formulation_id
        AND mf.publication_state='published' AND mf.public_visible=1
      LEFT JOIN archive_material_definitions md ON md.id=mf.material_id
        AND md.publication_state='published' AND md.public_visible=1
      LEFT JOIN archive_color_profiles cp ON
        (rv.id IS NOT NULL AND cp.source_type='recipe-version' AND cp.source_id=rv.id)
        OR (mf.id IS NOT NULL AND cp.source_type='material-formulation' AND cp.source_id=mf.id)
      WHERE ${condition} AND cu.publication_state='published' AND cu.public_visible=1
      ORDER BY aov.sort_order,aos.sort_order,cu.layer_order,cu.created_at`).bind(target),
    database.prepare(`SELECT gu.id,gu.state_id,gu.usage_role,gu.technique,gu.quantity_note,gu.notes,
        aos.state_roman,aos.variant_label,aov.version_number,
        m.slug material_slug,m.name material_name,m.material_kind,m.brand,m.product_line,m.product_name,m.model_name,m.product_code,
        f.version_number formulation_version,f.normalized_finish,f.finish_label
      FROM archive_general_material_usages gu
      JOIN archive_object_states aos ON aos.id=gu.state_id AND aos.publication_state='published' AND aos.public_visible=1
      JOIN archive_object_versions aov ON aov.id=aos.version_id AND aov.publication_state='published' AND aov.public_visible=1
      JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id AND ad.state='published' AND ad.public_visible=1
      JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
      JOIN archive_material_definitions m ON m.id=gu.material_id AND m.publication_state='published' AND m.public_visible=1
      LEFT JOIN archive_material_formulations f ON f.id=gu.formulation_id AND f.publication_state='published' AND f.public_visible=1
      WHERE ${condition} AND gu.publication_state='published' AND gu.public_visible=1
      ORDER BY aov.sort_order,aos.sort_order,gu.created_at`).bind(target),
    database.prepare(`SELECT pm.id,pm.state_id,pm.title,pm.overlay_opacity,pm.reviewed_at,
        aos.state_roman,aos.variant_label,aov.version_number,
        (SELECT COUNT(*) FROM archive_palette_regions pr
          JOIN archive_color_usages cu ON cu.id=pr.color_usage_id
          WHERE pr.map_id=pm.id AND cu.publication_state='published' AND cu.public_visible=1) region_count
      FROM archive_palette_maps pm
      JOIN archive_object_states aos ON aos.id=pm.state_id AND aos.publication_state='published' AND aos.public_visible=1
      JOIN archive_object_versions aov ON aov.id=aos.version_id AND aov.publication_state='published' AND aov.public_visible=1
      JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id AND ad.state='published' AND ad.public_visible=1
      JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
      JOIN media_assets m ON m.id=pm.source_media_id AND m.state='active' AND m.privacy='public'
        AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
      WHERE ${condition} AND pm.publication_state='published' AND pm.public_visible=1
      ORDER BY aov.sort_order,aos.sort_order,pm.created_at`).bind(target),
  ]);
  const catalogue=catalogueId||gate.catalogue_id||"";
  const stateLabel=(row)=>`${catalogue}.${Number(row.version_number||1)}/${row.state_roman||"I"}${row.variant_label?`, ${row.variant_label}`:""}`;
  const colorUsages=(colorResult.results||[]).map(usage=>({
    id:usage.id,
    state_id:usage.state_id,
    state_label:stateLabel(usage),
    label:usage.public_label||usage.recipe_name||usage.color_name||usage.material_name||"Documented color",
    swatch:usage.public_swatch_hex||usage.srgb_hex||"",
    usage_status:usage.usage_status,
    technique:usage.technique||"",
    layer_order:Number(usage.layer_order||0),
    quantity_note:usage.quantity_note||"",
    notes:usage.notes||"",
    recipe:usage.recipe_slug&&usage.recipe_version_id&&usage.recipe_name?{
      slug:usage.recipe_slug,name:usage.recipe_name,version:Number(usage.recipe_version_number||0),
      route:`/archive/colors/${encodeURIComponent(usage.recipe_slug)}/`,
    }:null,
    product:usage.material_slug&&usage.material_name?{
      slug:usage.material_slug,name:usage.material_name,brand:usage.brand||"",line:usage.product_line||"",
      color_name:usage.color_name||"",product_code:usage.product_code||"",version:Number(usage.formulation_version||0),
      route:`/archive/materials/${encodeURIComponent(usage.material_slug)}/`,
    }:null,
  }));
  const materialUsages=(materialResult.results||[]).map(usage=>({
    id:usage.id,
    state_id:usage.state_id,
    state_label:stateLabel(usage),
    usage_role:usage.usage_role||"",
    technique:usage.technique||"",
    quantity_note:usage.quantity_note||"",
    notes:usage.notes||"",
    material:{
      slug:usage.material_slug,name:usage.material_name,kind:usage.material_kind,brand:usage.brand||"",
      line:usage.product_line||"",product_name:usage.product_name||"",model_name:usage.model_name||"",
      product_code:usage.product_code||"",formulation_version:usage.formulation_version?Number(usage.formulation_version):null,
      finish:usage.normalized_finish||"",finish_label:usage.finish_label||"",
      route:`/archive/materials/${encodeURIComponent(usage.material_slug)}/`,
    },
  }));
  const paletteMaps=(mapResult.results||[]).map(map=>({
    id:map.id,
    state_id:map.state_id,
    title:map.title||"Palette placement map",
    state_label:stateLabel(map),
    region_count:Number(map.region_count||0),
    reviewed_at:map.reviewed_at,
    data_url:`/api/archive/palette-maps/${encodeURIComponent(map.id)}`,
    svg_download:`/api/archive/palette-maps/${encodeURIComponent(map.id)}.svg`,
  }));
  return{eligible:true,blockers:[],color_usages:colorUsages,material_usages:materialUsages,palette_maps:paletteMaps};
}

async function publicPaletteMap(request, env, mapId, svg = false) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const database = db(env);
  const map = await database.prepare(`SELECT pm.*,m.source_url,m.width media_width,m.height media_height
    FROM archive_palette_maps pm
    JOIN archive_object_states aos ON aos.id=pm.state_id AND aos.publication_state='published' AND aos.public_visible=1
    JOIN archive_object_versions aov ON aov.id=aos.version_id AND aov.publication_state='published' AND aov.public_visible=1
    JOIN archive_dossiers ad ON ad.entity_id=aov.entity_id AND ad.state='published' AND ad.public_visible=1
    JOIN content_entities ce ON ce.id=ad.entity_id AND ce.visibility='public'
    JOIN media_assets m ON m.id=pm.source_media_id AND m.state='active' AND m.privacy='public'
      AND m.consent_status IN ('not-required','granted') AND m.public_presentation='inline'
    WHERE (pm.id=? OR pm.state_id=?) AND ${publicSql("pm")}
    ORDER BY pm.reviewed_at DESC LIMIT 1`).bind(mapId, mapId).first();
  if (!map) return failure("Published palette map not found.", 404);
  const rows = (await database.prepare(`SELECT pr.*,cu.public_label,cu.public_swatch_hex,cu.usage_status,cu.technique,
      cu.layer_order usage_layer_order,cp.srgb_hex,
      r.slug recipe_slug,r.name recipe_name,rv.version_number recipe_version_number,
      md.slug material_slug,md.name material_name,md.color_name material_color_name,
      md.brand material_brand,md.product_line material_product_line,md.product_code material_product_code,
      mf.version_number formulation_version_number
    FROM archive_palette_regions pr
    JOIN archive_color_usages cu ON cu.id=pr.color_usage_id AND ${publicSql("cu")}
    LEFT JOIN archive_color_recipe_versions rv ON rv.id=cu.recipe_version_id
      AND rv.publication_state='published' AND rv.public_visible=1
    LEFT JOIN archive_color_recipes r ON r.id=rv.recipe_id
      AND r.publication_state='published' AND r.public_visible=1
    LEFT JOIN archive_material_formulations mf ON mf.id=cu.formulation_id
      AND mf.publication_state='published' AND mf.public_visible=1
    LEFT JOIN archive_material_definitions md ON md.id=mf.material_id
      AND md.publication_state='published' AND md.public_visible=1
    LEFT JOIN archive_color_profiles cp ON
      (rv.id IS NOT NULL AND cp.source_type='recipe-version' AND cp.source_id=rv.id)
      OR (mf.id IS NOT NULL AND cp.source_type='material-formulation' AND cp.source_id=mf.id)
    WHERE pr.map_id=?
    ORDER BY pr.layer_order,pr.sort_order,pr.created_at`).bind(map.id).all()).results || [];
  const regions = rows.map(mapRegion);
  if (!svg) return json({
    map: {
      id: map.id,
      state_id: map.state_id,
      title: map.title,
      source_media_id: map.source_media_id,
      source_url: mapMediaUrl(map),
      width: Number(map.width),
      height: Number(map.height),
      viewBox: [Number(map.viewbox_x), Number(map.viewbox_y), Number(map.width), Number(map.height)],
      overlay_opacity: Number(map.overlay_opacity),
      regions,
      svg_download: `/api/archive/palette-maps/${encodeURIComponent(map.id)}.svg`,
    },
  }, { cache: "public, max-age=60" });
  const labelPoint = (region,index) => {
    const g=region.geometry||{};
    if(Number.isFinite(Number(g.label_x))&&Number.isFinite(Number(g.label_y)))return [Number(g.label_x),Number(g.label_y)];
    if(region.geometry_type==="rect")return [number(g.x)+number(g.width)/2,number(g.y)+number(g.height)/2];
    if(region.geometry_type==="circle"||region.geometry_type==="ellipse")return [number(g.cx),number(g.cy)];
    const values=String(g.points||g.d||"").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)||[];
    return [number(values[0],20+(index*8)),number(values[1],20+(index*8))];
  };
  const shape = (region, index) => {
    const g = region.geometry || {};
    const common = `data-region-id="${escapeXml(region.id)}" fill="${escapeXml(region.usage.swatch || "#777777")}" fill-opacity="${Number(map.overlay_opacity)}" stroke="#ffffff" stroke-width="5" vector-effect="non-scaling-stroke" aria-label="${escapeXml(`${index + 1}. ${region.usage.label}`)}"`;
    let geometryMarkup;
    if (region.geometry_type === "polygon" || region.geometry_type === "polyline") geometryMarkup=`<${region.geometry_type} points="${escapeXml(g.points || "")}" ${common}/>`;
    else if (region.geometry_type === "path") geometryMarkup=`<path d="${escapeXml(g.d || "")}" ${common}/>`;
    else if (region.geometry_type === "rect") geometryMarkup=`<rect x="${number(g.x)}" y="${number(g.y)}" width="${Math.max(0,number(g.width))}" height="${Math.max(0,number(g.height))}" ${common}/>`;
    else if (region.geometry_type === "circle") geometryMarkup=`<circle cx="${number(g.cx)}" cy="${number(g.cy)}" r="${Math.max(0,number(g.r))}" ${common}/>`;
    else geometryMarkup=`<ellipse cx="${number(g.cx)}" cy="${number(g.cy)}" rx="${Math.max(0,number(g.rx))}" ry="${Math.max(0,number(g.ry))}" ${common}/>`;
    const [x,y]=labelPoint(region,index);
    return `<g${geometryMatrixAttribute(g)}>${geometryMarkup}<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="#0e0e0e" stroke="#ffffff" stroke-width="5" paint-order="stroke fill" font-family="sans-serif" font-size="28" font-weight="900">${index+1}</text></g>`;
  };
  const markup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${number(map.viewbox_x)} ${number(map.viewbox_y)} ${number(map.width)} ${number(map.height)}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(map.title || "Palette placement map")}</title>
  <desc id="desc">Reviewed color placement diagram with ${regions.length} selectable regions.</desc>
  ${regions.map(shape).join("\n  ")}
</svg>`;
  return new Response(markup, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-disposition": `attachment; filename="${cleanSlug(map.title || "palette-map") || "palette-map"}.svg"`,
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'none'; sandbox",
    },
  });
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[character]));
}

function normalizeMaterial(body, before = {}) {
  const kind = text(body.material_kind ?? before.material_kind, 60);
  const publication = text(body.publication_state ?? before.publication_state ?? "draft", 20);
  if (!MATERIAL_KINDS.has(kind)) throw new Error("Choose a supported material category.");
  if (!STATES.has(publication)) throw new Error("Choose a valid publication state.");
  return {
    slug: cleanSlug(body.slug ?? before.slug ?? body.name),
    name: text(body.name ?? before.name, 240),
    material_kind: kind,
    manufacturer: text(body.manufacturer ?? before.manufacturer, 240),
    brand: text(body.brand ?? before.brand, 240),
    product_line: text(body.product_line ?? before.product_line, 240),
    product_name: text(body.product_name ?? before.product_name, 240),
    model_name: text(body.model_name ?? before.model_name, 240),
    color_name: text(body.color_name ?? before.color_name, 240),
    product_code: text(body.product_code ?? before.product_code, 120),
    medium_scope: ["art","tattoo","shared"].includes(body.medium_scope ?? before.medium_scope) ? (body.medium_scope ?? before.medium_scope) : "shared",
    pigment_code: text(body.pigment_code ?? before.pigment_code, 120).toUpperCase(),
    description: text(body.description ?? before.description, 4000),
    notes: text(body.notes ?? before.notes, 8000),
    publication_state: publication,
    public_visible: bool(body.public_visible ?? before.public_visible),
  };
}

function normalizeRecipe(body, before = {}) {
  const publication = text(body.publication_state ?? before.publication_state ?? "draft", 20);
  if (!STATES.has(publication)) throw new Error("Choose a valid publication state.");
  return {
    slug: cleanSlug(body.slug ?? before.slug ?? body.name),
    name: text(body.name ?? before.name, 240),
    description: text(body.description ?? before.description, 4000),
    medium_scope: ["art","tattoo","shared"].includes(body.medium_scope ?? before.medium_scope) ? (body.medium_scope ?? before.medium_scope) : "shared",
    publication_state: publication,
    public_visible: bool(body.public_visible ?? before.public_visible),
  };
}

async function completeRecipeVersion(database, versionId, seen = new Set()) {
  if (seen.has(versionId)) return { ok: false, error: "Recipe versions cannot contain circular recipe chains." };
  const nextSeen = new Set(seen);
  nextSeen.add(versionId);
  const version = await database.prepare("SELECT * FROM archive_color_recipe_versions WHERE id=?").bind(versionId).first();
  if (!version) return { ok: false, error: "Recipe version not found." };
  const profile = await database.prepare(
    "SELECT id FROM archive_color_profiles WHERE source_type='recipe-version' AND source_id=?",
  ).bind(versionId).first();
  if (!profile) return { ok: false, error: "A recipe version needs a sourced color profile before publication." };
  const components = (await database.prepare(`SELECT c.*,f.publication_state formulation_state,f.public_visible formulation_public,
      m.material_kind,m.publication_state material_state,m.public_visible material_public,
      nv.publication_state nested_state,nv.public_visible nested_public,
      nr.publication_state nested_recipe_state,nr.public_visible nested_recipe_public
    FROM archive_color_recipe_components c
    LEFT JOIN archive_material_formulations f ON f.id=c.formulation_id
    LEFT JOIN archive_material_definitions m ON m.id=COALESCE(f.material_id,c.raw_pigment_material_id)
    LEFT JOIN archive_color_recipe_versions nv ON nv.id=c.nested_recipe_version_id
    LEFT JOIN archive_color_recipes nr ON nr.id=nv.recipe_id
    WHERE c.recipe_version_id=? ORDER BY c.sort_order`).bind(versionId).all()).results || [];
  if (!components.length) return { ok: false, error: "A published recipe version needs at least one component." };
  for (const component of components) {
    if (component.formulation_id) {
      if (!RECIPE_KINDS.has(component.material_kind)) return { ok: false, error: "This material category cannot be used in a recipe." };
      if (component.formulation_state !== "published" || !Number(component.formulation_public) || component.material_state !== "published" || !Number(component.material_public)) {
        return { ok: false, error: "Every exposed commercial component must use a public, published formulation." };
      }
    } else if (component.raw_pigment_material_id) {
      if (component.material_kind !== "raw-pigment") return { ok: false, error: "Only raw pigments may be attached as raw pigment components." };
      if (component.material_state !== "published" || !Number(component.material_public)) return { ok: false, error: "Every exposed raw pigment component must be public and published." };
    } else if (component.nested_recipe_version_id) {
      if (component.nested_state !== "published" || !Number(component.nested_public) || component.nested_recipe_state !== "published" || !Number(component.nested_recipe_public)) {
        return { ok: false, error: "Every exposed nested recipe must be public and published." };
      }
      const nested = await completeRecipeVersion(database, component.nested_recipe_version_id, nextSeen);
      if (!nested.ok) return nested;
    }
  }
  return { ok: true };
}

async function recipeWouldCycle(database, recipeVersionId, nestedVersionId) {
  if (!nestedVersionId) return false;
  if (recipeVersionId === nestedVersionId) return true;
  const row = await database.prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT nested_recipe_version_id FROM archive_color_recipe_components
      WHERE recipe_version_id=? AND nested_recipe_version_id IS NOT NULL
      UNION
      SELECT c.nested_recipe_version_id
      FROM archive_color_recipe_components c JOIN descendants d ON c.recipe_version_id=d.id
      WHERE c.nested_recipe_version_id IS NOT NULL
    )
    SELECT 1 found FROM descendants WHERE id=? LIMIT 1`).bind(nestedVersionId, recipeVersionId).first();
  return Boolean(row);
}

function ciede2000(left, right) {
  const [L1,a1,b1] = left, [L2,a2,b2] = right;
  const avgL = (L1 + L2) / 2;
  const c1 = Math.sqrt(a1*a1 + b1*b1), c2 = Math.sqrt(a2*a2 + b2*b2);
  const avgC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt((avgC**7) / (avgC**7 + 25**7)));
  const ap1 = (1+g)*a1, ap2 = (1+g)*a2;
  const cp1 = Math.sqrt(ap1*ap1+b1*b1), cp2 = Math.sqrt(ap2*ap2+b2*b2);
  const hp = (a,b) => {
    if (a === 0 && b === 0) return 0;
    const value = Math.atan2(b,a) * 180 / Math.PI;
    return value < 0 ? value + 360 : value;
  };
  const h1 = hp(ap1,b1), h2 = hp(ap2,b2);
  const dL = L2-L1, dC = cp2-cp1;
  let dh = h2-h1;
  if (cp1*cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2*Math.sqrt(cp1*cp2)*Math.sin((dh/2)*Math.PI/180);
  const avgCp = (cp1+cp2)/2;
  let avgH;
  if (cp1*cp2 === 0) avgH = h1+h2;
  else if (Math.abs(h1-h2) <= 180) avgH = (h1+h2)/2;
  else if (h1+h2 < 360) avgH = (h1+h2+360)/2;
  else avgH = (h1+h2-360)/2;
  const t = 1 - .17*Math.cos((avgH-30)*Math.PI/180) + .24*Math.cos(2*avgH*Math.PI/180)
    + .32*Math.cos((3*avgH+6)*Math.PI/180) - .20*Math.cos((4*avgH-63)*Math.PI/180);
  const sl = 1 + .015*(avgL-50)**2/Math.sqrt(20+(avgL-50)**2);
  const sc = 1 + .045*avgCp;
  const sh = 1 + .015*avgCp*t;
  const rt = -2*Math.sqrt((avgCp**7)/(avgCp**7+25**7))
    * Math.sin(60*Math.exp(-(((avgH-275)/25)**2))*Math.PI/180);
  return Math.sqrt((dL/sl)**2+(dC/sc)**2+(dH/sh)**2+rt*(dC/sc)*(dH/sh));
}

async function recomputeNeighbors(database, profileId) {
  const profile = await database.prepare("SELECT id,lab_l,lab_a,lab_b FROM archive_color_profiles WHERE id=?").bind(profileId).first();
  if (!profile) return;
  const others = (await database.prepare("SELECT id,lab_l,lab_a,lab_b FROM archive_color_profiles WHERE id<>?").bind(profileId).all()).results || [];
  const statements = [
    database.prepare("DELETE FROM archive_color_neighbors WHERE profile_id=? OR neighbor_profile_id=?").bind(profileId, profileId),
  ];
  for (const other of others) {
    const distance = ciede2000(
      [Number(profile.lab_l),Number(profile.lab_a),Number(profile.lab_b)],
      [Number(other.lab_l),Number(other.lab_a),Number(other.lab_b)],
    );
    statements.push(
      database.prepare("INSERT INTO archive_color_neighbors(profile_id,neighbor_profile_id,delta_e,computed_at) VALUES(?,?,?,datetime('now'))").bind(profileId,other.id,distance),
      database.prepare("INSERT INTO archive_color_neighbors(profile_id,neighbor_profile_id,delta_e,computed_at) VALUES(?,?,?,datetime('now'))").bind(other.id,profileId,distance),
    );
  }
  await database.batch(statements);
}

async function librarySnapshot(database) {
  const [materials,formulations,declarations,recipes,versions,components,profiles,families,familyAssignments] = await database.batch([
    database.prepare("SELECT * FROM archive_material_definitions ORDER BY material_kind,name"),
    database.prepare("SELECT f.*,m.name material_name,m.slug material_slug,m.material_kind FROM archive_material_formulations f JOIN archive_material_definitions m ON m.id=f.material_id ORDER BY m.name,f.version_number DESC"),
    database.prepare("SELECT * FROM archive_material_declared_pigments ORDER BY formulation_id,sort_order"),
    database.prepare("SELECT * FROM archive_color_recipes ORDER BY name"),
    database.prepare("SELECT v.*,r.name recipe_name,r.slug recipe_slug FROM archive_color_recipe_versions v JOIN archive_color_recipes r ON r.id=v.recipe_id ORDER BY r.name,v.version_number DESC"),
    database.prepare("SELECT * FROM archive_color_recipe_components ORDER BY recipe_version_id,sort_order"),
    database.prepare("SELECT * FROM archive_color_profiles ORDER BY updated_at DESC"),
    database.prepare("SELECT * FROM archive_color_families ORDER BY sort_order,name"),
    database.prepare("SELECT * FROM archive_color_profile_families ORDER BY profile_id,family_id"),
  ]);
  return {
    materials: materials.results || [],
    formulations: formulations.results || [],
    declared_pigments: declarations.results || [],
    recipes: recipes.results || [],
    recipe_versions: versions.results || [],
    recipe_components: components.results || [],
    color_profiles: profiles.results || [],
    color_families: families.results || [],
    family_assignments: familyAssignments.results || [],
  };
}

async function writeRecord(database, table, recordId, values, create = false) {
  const keys = Object.keys(values);
  if (create) {
    await database.prepare(`INSERT INTO ${table}(id,${keys.join(",")},created_at,updated_at) VALUES(?,${keys.map(() => "?").join(",")},datetime('now'),datetime('now'))`).bind(recordId,...keys.map((key) => values[key])).run();
  } else {
    await database.prepare(`UPDATE ${table} SET ${keys.map((key) => `${key}=?`).join(",")},updated_at=datetime('now') WHERE id=?`).bind(...keys.map((key) => values[key]),recordId).run();
  }
  return database.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(recordId).first();
}

async function adminMaterials(request, database, recordId = "") {
  if (request.method === "GET") {
    if (!recordId) return json(await librarySnapshot(database));
    const record = await database.prepare("SELECT * FROM archive_material_definitions WHERE id=? OR slug=?").bind(recordId,recordId).first();
    if (!record) return failure("Material not found.",404);
    return json({ record });
  }
  const body = await readJson(request);
  if (!body) return failure("Send a JSON object.");
  try {
    if (request.method === "POST" && !recordId) {
      const values = normalizeMaterial(body);
      if (!values.slug || !values.name) return failure("Name and slug are required.");
      if(["art-paint","tattoo-ink"].includes(values.material_kind)&&[values.brand,values.product_line,values.product_name,values.color_name,values.product_code].some(Boolean)){
        const duplicate=await database.prepare(`SELECT id,slug,name FROM archive_material_definitions
          WHERE publication_state<>'archived' AND material_kind=?
            AND lower(trim(brand))=lower(trim(?))
            AND lower(trim(product_line))=lower(trim(?))
            AND lower(trim(product_name))=lower(trim(?))
            AND lower(trim(color_name))=lower(trim(?))
            AND lower(trim(product_code))=lower(trim(?))
          LIMIT 1`).bind(values.material_kind,values.brand,values.product_line,values.product_name,values.color_name,values.product_code).first();
        if(duplicate)return json({
          error:`Duplicate product match: ${duplicate.name} (${duplicate.slug}). Add a new formulation version to that record instead of duplicating the product.`,
          duplicate_candidate:duplicate,
        },{status:409});
      }
      const created = await writeRecord(database,"archive_material_definitions",text(body.id,200)||id("material"),{...values,created_by:"studio",updated_by:"studio"},true);
      return json({ record: created },{status:201});
    }
    if (request.method === "PATCH" && recordId) {
      const before = await database.prepare("SELECT * FROM archive_material_definitions WHERE id=?").bind(recordId).first();
      if (!before) return failure("Material not found.",404);
      const values = normalizeMaterial(body,before);
      const updated = await writeRecord(database,"archive_material_definitions",recordId,{...values,updated_by:"studio"});
      return json({ record: updated });
    }
    if (request.method === "DELETE" && recordId) {
      await database.prepare("UPDATE archive_material_definitions SET publication_state='archived',public_visible=0,updated_at=datetime('now') WHERE id=?").bind(recordId).run();
      return json({ ok:true,archived:true });
    }
  } catch (error) {
    return failure(String(error.message || error).includes("UNIQUE") ? "A matching product identity already exists. Review the duplicate before creating another." : error.message,409);
  }
  return failure("Method not allowed.",405);
}

async function adminFormulations(request,database,recordId="") {
  if (request.method === "GET") {
    const rows = (await database.prepare(`SELECT f.*,m.name material_name,m.slug material_slug,m.material_kind
      FROM archive_material_formulations f JOIN archive_material_definitions m ON m.id=f.material_id
      ${recordId ? "WHERE f.id=? OR f.material_id=?" : ""}
      ORDER BY m.name,f.version_number DESC`).bind(...(recordId?[recordId,recordId]:[])).all()).results || [];
    return json({ records:rows,count:rows.length });
  }
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"&&!recordId){
    const material=await database.prepare("SELECT * FROM archive_material_definitions WHERE id=?").bind(text(body.material_id,200)).first();
    if(!material)return failure("Material not found.",404);
    const last=await database.prepare("SELECT COALESCE(MAX(version_number),0) max_version FROM archive_material_formulations WHERE material_id=?").bind(material.id).first();
    const version=Math.max(1,Math.floor(number(body.version_number,Number(last?.max_version||0)+1)));
    const publication=STATES.has(body.publication_state)?body.publication_state:"draft";
    if(publication==="published")return failure("Create the formulation as a draft, add its sourced color profile, then publish it.",409);
    const matchingFinish=await database.prepare(`SELECT f.id,f.version_number,f.normalized_finish,f.finish_label
      FROM archive_material_formulations f
      WHERE f.material_id=? AND f.normalized_finish=?
        AND lower(trim(f.finish_label))=lower(trim(?))
      ORDER BY f.version_number DESC LIMIT 1`).bind(
        material.id,
        ["matte","satin","gloss","unspecified"].includes(body.normalized_finish)?body.normalized_finish:"unspecified",
        text(body.finish_label,240),
      ).first();
    if(matchingFinish&&!bool(body.confirm_distinct_version))return json({
      error:`This product already has formulation version ${matchingFinish.version_number} with the same normalized and manufacturer finish. Confirm that this is an intentional new formulation version.`,
      duplicate_candidate:matchingFinish,
    },{status:409});
    const values={material_id:material.id,version_number:version,version_label:text(body.version_label,120),normalized_finish:["matte","satin","gloss","unspecified"].includes(body.normalized_finish)?body.normalized_finish:"unspecified",finish_label:text(body.finish_label,240),opacity:["opaque","semi-opaque","transparent","unspecified"].includes(body.opacity)?body.opacity:"unspecified",optical_effects_json:JSON.stringify(opticalEffects(body.optical_effects)),manufacturer_wording:text(body.manufacturer_wording,4000),notes:text(body.notes,8000),publication_state:publication,public_visible:bool(body.public_visible),created_by:"studio",updated_by:"studio"};
    try{return json({record:await writeRecord(database,"archive_material_formulations",text(body.id,200)||id("formulation"),values,true)},{status:201})}catch(error){return failure(error.message,409)}
  }
  if(request.method==="PATCH"&&recordId){
    const before=await database.prepare("SELECT * FROM archive_material_formulations WHERE id=?").bind(recordId).first();if(!before)return failure("Formulation not found.",404);
    if(before.publication_state==="published")return failure("Published formulations are immutable. Create the next formulation version.",409);
    const publication=STATES.has(body.publication_state)?body.publication_state:before.publication_state;
    if(publication==="published"){
      const colorBearing=await database.prepare(`SELECT 1 ok
        FROM archive_material_formulations f
        JOIN archive_material_definitions m ON m.id=f.material_id
        WHERE f.id=? AND m.material_kind IN ('art-paint','tattoo-ink')`).bind(recordId).first();
      if(colorBearing&&!await database.prepare(
        "SELECT id FROM archive_color_profiles WHERE source_type='material-formulation' AND source_id=?",
      ).bind(recordId).first())return failure("A color-bearing formulation needs a sourced color profile before publication.",409);
    }
    const values={version_label:text(body.version_label??before.version_label,120),normalized_finish:["matte","satin","gloss","unspecified"].includes(body.normalized_finish)?body.normalized_finish:before.normalized_finish,finish_label:text(body.finish_label??before.finish_label,240),opacity:["opaque","semi-opaque","transparent","unspecified"].includes(body.opacity)?body.opacity:before.opacity,optical_effects_json:JSON.stringify(opticalEffects(body.optical_effects??before.optical_effects_json)),manufacturer_wording:text(body.manufacturer_wording??before.manufacturer_wording,4000),notes:text(body.notes??before.notes,8000),publication_state:publication,public_visible:bool(body.public_visible??before.public_visible),updated_by:"studio"};
    try{return json({record:await writeRecord(database,"archive_material_formulations",recordId,values)})}catch(error){return failure(error.message,409)}
  }
  return failure("Method not allowed.",405);
}

async function adminRecipes(request,database,recordId="") {
  if(request.method==="GET"){
    const rows=(await database.prepare(`SELECT * FROM archive_color_recipes ${recordId?"WHERE id=? OR slug=?":""} ORDER BY name`).bind(...(recordId?[recordId,recordId]:[])).all()).results||[];
    if(recordId&&!rows.length)return failure("Recipe not found.",404);
    return json({records:rows,count:rows.length,record:recordId?rows[0]:undefined});
  }
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  try{
    if(request.method==="POST"&&!recordId){
      const values=normalizeRecipe(body);if(!values.slug||!values.name)return failure("Name and slug are required.");
      return json({record:await writeRecord(database,"archive_color_recipes",text(body.id,200)||id("color"),{...values,created_by:"studio",updated_by:"studio"},true)},{status:201});
    }
    if(request.method==="PATCH"&&recordId){
      const before=await database.prepare("SELECT * FROM archive_color_recipes WHERE id=?").bind(recordId).first();if(!before)return failure("Recipe not found.",404);
      return json({record:await writeRecord(database,"archive_color_recipes",recordId,{...normalizeRecipe(body,before),updated_by:"studio"})});
    }
    if(request.method==="DELETE"&&recordId){await database.prepare("UPDATE archive_color_recipes SET publication_state='archived',public_visible=0,updated_at=datetime('now') WHERE id=?").bind(recordId).run();return json({ok:true,archived:true})}
  }catch(error){return failure(error.message,409)}
  return failure("Method not allowed.",405);
}

async function adminRecipeVersions(request,database,recordId="") {
  if(request.method==="GET"){
    const rows=(await database.prepare(`SELECT v.*,r.name recipe_name,r.slug recipe_slug
      FROM archive_color_recipe_versions v JOIN archive_color_recipes r ON r.id=v.recipe_id
      ${recordId?"WHERE v.id=? OR v.recipe_id=?":""}
      ORDER BY r.name,v.version_number DESC`).bind(...(recordId?[recordId,recordId]:[])).all()).results||[];
    return json({records:rows,count:rows.length});
  }
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"&&!recordId){
    const recipeId=text(body.recipe_id,200),recipe=await database.prepare("SELECT id FROM archive_color_recipes WHERE id=?").bind(recipeId).first();if(!recipe)return failure("Recipe not found.",404);
    const last=await database.prepare("SELECT COALESCE(MAX(version_number),0) max_version FROM archive_color_recipe_versions WHERE recipe_id=?").bind(recipeId).first();
    const publication=STATES.has(body.publication_state)?body.publication_state:"draft";
    const newId=text(body.id,200)||id("recipe-version");
    const values={recipe_id:recipeId,version_number:Math.max(1,Math.floor(number(body.version_number,Number(last?.max_version||0)+1))),version_label:text(body.version_label,120),resulting_finish:["matte","satin","gloss","unspecified"].includes(body.resulting_finish)?body.resulting_finish:"unspecified",finish_label:text(body.finish_label,240),instructions:text(body.instructions,12000),notes:text(body.notes,8000),publication_state:publication,public_visible:bool(body.public_visible),created_by:"studio",updated_by:"studio"};
    if(publication==="published"){
      values.publication_state="draft";values.public_visible=0;
      await writeRecord(database,"archive_color_recipe_versions",newId,values,true);
      const complete=await completeRecipeVersion(database,newId);if(!complete.ok){await database.prepare("DELETE FROM archive_color_recipe_versions WHERE id=?").bind(newId).run();return failure(complete.error,409)}
      await database.prepare("UPDATE archive_color_recipe_versions SET publication_state='published',public_visible=?,updated_at=datetime('now') WHERE id=?").bind(bool(body.public_visible),newId).run();
      return json({record:await database.prepare("SELECT * FROM archive_color_recipe_versions WHERE id=?").bind(newId).first()},{status:201});
    }
    try{return json({record:await writeRecord(database,"archive_color_recipe_versions",newId,values,true)},{status:201})}catch(error){return failure(error.message,409)}
  }
  if(request.method==="PATCH"&&recordId){
    const before=await database.prepare("SELECT * FROM archive_color_recipe_versions WHERE id=?").bind(recordId).first();if(!before)return failure("Recipe version not found.",404);
    if(before.publication_state==="published")return failure("Published recipe versions are immutable. Create the next version.",409);
    const publication=STATES.has(body.publication_state)?body.publication_state:before.publication_state;
    if(publication==="published"){const complete=await completeRecipeVersion(database,recordId);if(!complete.ok)return failure(complete.error,409)}
    const values={version_label:text(body.version_label??before.version_label,120),resulting_finish:["matte","satin","gloss","unspecified"].includes(body.resulting_finish)?body.resulting_finish:before.resulting_finish,finish_label:text(body.finish_label??before.finish_label,240),instructions:text(body.instructions??before.instructions,12000),notes:text(body.notes??before.notes,8000),publication_state:publication,public_visible:bool(body.public_visible??before.public_visible),updated_by:"studio"};
    try{return json({record:await writeRecord(database,"archive_color_recipe_versions",recordId,values)})}catch(error){return failure(error.message,409)}
  }
  return failure("Method not allowed.",405);
}

async function adminRecipeComponents(request,database,recordId="") {
  if(request.method==="GET"){
    const rows=(await database.prepare(`SELECT * FROM archive_color_recipe_components ${recordId?"WHERE id=? OR recipe_version_id=?":""} ORDER BY recipe_version_id,sort_order`).bind(...(recordId?[recordId,recordId]:[])).all()).results||[];
    return json({records:rows,count:rows.length});
  }
  if(request.method==="DELETE"&&recordId){
    const component=await database.prepare("SELECT c.*,v.publication_state FROM archive_color_recipe_components c JOIN archive_color_recipe_versions v ON v.id=c.recipe_version_id WHERE c.id=?").bind(recordId).first();if(!component)return failure("Component not found.",404);if(component.publication_state==="published")return failure("Published recipe components are immutable.",409);
    await database.prepare("DELETE FROM archive_color_recipe_components WHERE id=?").bind(recordId).run();return json({ok:true,deleted:true});
  }
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"&&!recordId){
    const versionId=text(body.recipe_version_id,200),version=await database.prepare("SELECT * FROM archive_color_recipe_versions WHERE id=?").bind(versionId).first();if(!version)return failure("Recipe version not found.",404);if(version.publication_state==="published")return failure("Published recipe versions are immutable.",409);
    const formulationId=text(body.formulation_id,200)||null,rawId=text(body.raw_pigment_material_id,200)||null,nestedId=text(body.nested_recipe_version_id,200)||null;
    if(Number(Boolean(formulationId))+Number(Boolean(rawId))+Number(Boolean(nestedId))!==1)return failure("Choose exactly one commercial formulation, raw pigment, or nested recipe.");
    if(await recipeWouldCycle(database,versionId,nestedId))return failure("Recipe versions cannot contain circular recipe chains.",409);
    if(formulationId){const material=await database.prepare("SELECT m.material_kind FROM archive_material_formulations f JOIN archive_material_definitions m ON m.id=f.material_id WHERE f.id=?").bind(formulationId).first();if(!material)return failure("Formulation not found.",404);if(!RECIPE_KINDS.has(material.material_kind))return failure("Tools, equipment, supports, needles, disposables, and aftercare cannot be recipe ingredients.",409)}
    if(rawId){const pigment=await database.prepare("SELECT material_kind FROM archive_material_definitions WHERE id=?").bind(rawId).first();if(pigment?.material_kind!=="raw-pigment")return failure("Only raw pigments may use the raw pigment ingredient field.",409)}
    const values={recipe_version_id:versionId,formulation_id:formulationId,raw_pigment_material_id:rawId,nested_recipe_version_id:nestedId,quantity_value:nullableNumber(body.quantity_value),quantity_unit:["parts","drops","grams","milliliters","percent","freeform"].includes(body.quantity_unit)?body.quantity_unit:"parts",approximate:bool(body.approximate),quantity_note:text(body.quantity_note,1000),sort_order:Math.floor(number(body.sort_order,0))};
    try{return json({record:await writeRecord(database,"archive_color_recipe_components",text(body.id,200)||id("recipe-component"),values,true)},{status:201})}catch(error){return failure(error.message,409)}
  }
  return failure("Method not allowed.",405);
}

async function adminProfiles(request,database,recordId="") {
  if(request.method==="GET"){const rows=(await database.prepare(`SELECT * FROM archive_color_profiles ${recordId?"WHERE id=? OR source_id=?":""} ORDER BY updated_at DESC`).bind(...(recordId?[recordId,recordId]:[])).all()).results||[];return json({records:rows,count:rows.length})}
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(!["POST","PATCH"].includes(request.method))return failure("Method not allowed.",405);
  const sourceType=["material-formulation","recipe-version"].includes(body.source_type)?body.source_type:null,sourceId=text(body.source_id,200);
  if(request.method==="POST"&&(!sourceType||!sourceId))return failure("A color profile needs a source type and source record.");
  const before=recordId?await database.prepare("SELECT * FROM archive_color_profiles WHERE id=?").bind(recordId).first():null;
  if(recordId&&!before)return failure("Color profile not found.",404);
  if(before){
    const sourceTable=before.source_type==="material-formulation"?"archive_material_formulations":"archive_color_recipe_versions";
    const source=await database.prepare(`SELECT publication_state FROM ${sourceTable} WHERE id=?`).bind(before.source_id).first();
    if(source?.publication_state==="published")return failure("Published color-bearing records have immutable sourced color profiles. Create the next formulation or recipe version.",409);
  }
  const resolvedSourceType=sourceType||before?.source_type,resolvedSourceId=sourceId||before?.source_id;
  const sourceTable=resolvedSourceType==="material-formulation"?"archive_material_formulations":"archive_color_recipe_versions";
  if(!resolvedSourceType||!resolvedSourceId||!await database.prepare(`SELECT id FROM ${sourceTable} WHERE id=?`).bind(resolvedSourceId).first()){
    return failure("A color profile must reference an existing formulation or recipe version.",409);
  }
  const values={source_type:sourceType||before.source_type,source_id:sourceId||before.source_id,srgb_hex:text(body.srgb_hex??before?.srgb_hex,20),lab_l:number(body.lab_l,before?.lab_l),lab_a:number(body.lab_a,before?.lab_a),lab_b:number(body.lab_b,before?.lab_b),oklch_l:number(body.oklch_l,before?.oklch_l),oklch_c:number(body.oklch_c,before?.oklch_c),oklch_h:nullableNumber(body.oklch_h??before?.oklch_h),reference_method:["manual-digital","measured-physical","reviewed-image"].includes(body.reference_method)?body.reference_method:(before?.reference_method||"manual-digital"),source_media_id:text(body.source_media_id??before?.source_media_id,200)||null,notes:text(body.notes??before?.notes,4000),reviewed_at:text(body.reviewed_at??before?.reviewed_at,80)||new Date().toISOString()};
  const profileId=recordId||text(body.id,200)||id("color-profile");
  try{const record=await writeRecord(database,"archive_color_profiles",profileId,values,!recordId);await recomputeNeighbors(database,profileId);return json({record},{status:recordId?200:201})}catch(error){return failure(error.message,409)}
}

async function adminDeclaredPigments(request,database,recordId="") {
  if(request.method==="GET"){
    const rows=(await database.prepare(`SELECT d.*,m.name pigment_name,m.slug pigment_slug
      FROM archive_material_declared_pigments d
      LEFT JOIN archive_material_definitions m ON m.id=d.pigment_material_id
      ${recordId?"WHERE d.id=? OR d.formulation_id=?":""}
      ORDER BY d.formulation_id,d.sort_order,d.created_at`).bind(...(recordId?[recordId,recordId]:[])).all()).results||[];
    return json({records:rows,count:rows.length});
  }
  if(request.method==="DELETE"&&recordId){
    const row=await database.prepare(`SELECT f.publication_state FROM archive_material_declared_pigments d JOIN archive_material_formulations f ON f.id=d.formulation_id WHERE d.id=?`).bind(recordId).first();if(!row)return failure("Pigment declaration not found.",404);if(row.publication_state==="published")return failure("Published formulations and their pigment declarations are immutable.",409);
    await database.prepare("DELETE FROM archive_material_declared_pigments WHERE id=?").bind(recordId).run();return json({ok:true,deleted:true});
  }
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"&&!recordId){
    const formulationId=text(body.formulation_id,200),formulation=await database.prepare("SELECT publication_state FROM archive_material_formulations WHERE id=?").bind(formulationId).first();if(!formulation)return failure("Formulation not found.",404);if(formulation.publication_state==="published")return failure("Published formulations and their pigment declarations are immutable.",409);
    const pigmentId=text(body.pigment_material_id,200)||null;
    if(pigmentId){const pigment=await database.prepare("SELECT material_kind FROM archive_material_definitions WHERE id=?").bind(pigmentId).first();if(pigment?.material_kind!=="raw-pigment")return failure("The normalized pigment link must point to a raw pigment definition.",409)}
    const values={formulation_id:formulationId,pigment_material_id:pigmentId,normalized_pigment_code:text(body.normalized_pigment_code,120).toUpperCase(),bottle_wording:text(body.bottle_wording,1000),source_type:["bottle-label","manufacturer-site","safety-data-sheet","technical-sheet","other"].includes(body.source_type)?body.source_type:"bottle-label",source_media_id:text(body.source_media_id,200)||null,source_url:safePublicUrl(body.source_url),observed_at:text(body.observed_at,80)||null,sort_order:Math.floor(number(body.sort_order,0))};
    if(!values.bottle_wording)return failure("Record the manufacturer wording exactly as observed.");
    return json({record:await writeRecord(database,"archive_material_declared_pigments",text(body.id,200)||id("declared-pigment"),values,true)},{status:201});
  }
  return failure("Method not allowed.",405);
}

async function adminFamilies(request,database,recordId="") {
  if(request.method==="GET"){const rows=(await database.prepare(`SELECT * FROM archive_color_families ${recordId?"WHERE id=? OR slug=?":""} ORDER BY sort_order,name`).bind(...(recordId?[recordId,recordId]:[])).all()).results||[];return json({records:rows,count:rows.length})}
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"&&!recordId){
    const values={slug:cleanSlug(body.slug||body.name),name:text(body.name,240),description:text(body.description,2000),swatch_hex:text(body.swatch_hex,20),publication_state:STATES.has(body.publication_state)?body.publication_state:"draft",public_visible:bool(body.public_visible),sort_order:Math.floor(number(body.sort_order,0))};
    if(!values.slug||!values.name)return failure("Family name and slug are required.");
    try{return json({record:await writeRecord(database,"archive_color_families",text(body.id,200)||id("color-family"),values,true)},{status:201})}catch(error){return failure(error.message,409)}
  }
  if(request.method==="PATCH"&&recordId){
    const before=await database.prepare("SELECT * FROM archive_color_families WHERE id=?").bind(recordId).first();if(!before)return failure("Color family not found.",404);
    const values={slug:cleanSlug(body.slug??before.slug),name:text(body.name??before.name,240),description:text(body.description??before.description,2000),swatch_hex:text(body.swatch_hex??before.swatch_hex,20),publication_state:STATES.has(body.publication_state)?body.publication_state:before.publication_state,public_visible:bool(body.public_visible??before.public_visible),sort_order:Math.floor(number(body.sort_order,before.sort_order))};
    try{return json({record:await writeRecord(database,"archive_color_families",recordId,values)})}catch(error){return failure(error.message,409)}
  }
  return failure("Method not allowed.",405);
}

async function adminFamilyAssignments(request,database,recordId="") {
  if(request.method==="GET"){const rows=(await database.prepare(`SELECT cpf.*,cf.slug family_slug,cf.name family_name
    FROM archive_color_profile_families cpf JOIN archive_color_families cf ON cf.id=cpf.family_id
    ${recordId?"WHERE cpf.profile_id=?":""} ORDER BY cf.sort_order,cf.name`).bind(...(recordId?[recordId]:[])).all()).results||[];return json({records:rows,count:rows.length})}
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  const profileId=text(body.profile_id||recordId,200),familyId=text(body.family_id,200);
  if(request.method==="POST"){
    if(!await database.prepare("SELECT id FROM archive_color_profiles WHERE id=?").bind(profileId).first())return failure("Color profile not found.",404);
    if(!await database.prepare("SELECT id FROM archive_color_families WHERE id=?").bind(familyId).first())return failure("Color family not found.",404);
    await database.prepare("INSERT OR REPLACE INTO archive_color_profile_families(profile_id,family_id,confirmed_by,confirmed_at) VALUES(?,?,'studio',datetime('now'))").bind(profileId,familyId).run();
    return json({record:await database.prepare("SELECT * FROM archive_color_profile_families WHERE profile_id=? AND family_id=?").bind(profileId,familyId).first()},{status:201});
  }
  if(request.method==="DELETE"){await database.prepare("DELETE FROM archive_color_profile_families WHERE profile_id=? AND family_id=?").bind(profileId,familyId).run();return json({ok:true,deleted:true})}
  return failure("Method not allowed.",405);
}

async function adminPrivateAssets(request,database,kind,recordId="") {
  const config=kind==="batches"?{
    table:"archive_material_batches",parent:"formulation_id",
    fields:["formulation_id","lot_number","expiration_date","opened_date","private_notes"],
  }:{
    table:"archive_equipment_assets",parent:"material_id",
    fields:["material_id","serial_number","studio_nickname","acquired_at","retired_at","private_notes"],
  };
  if(request.method==="GET"){
    const rows=(await database.prepare(`SELECT * FROM ${config.table} ${recordId?`WHERE id=? OR ${config.parent}=?`:""} ORDER BY created_at DESC`).bind(...(recordId?[recordId,recordId]:[])).all()).results||[];
    return json({records:rows,count:rows.length});
  }
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(request.method==="POST"&&!recordId){
    const values={};for(const field of config.fields)values[field]=field.endsWith("_date")||field.endsWith("_at")?(text(body[field],80)||null):text(body[field],field==="private_notes"?8000:240);
    if(!values[config.parent])return failure(`${config.parent} is required.`);
    return json({record:await writeRecord(database,config.table,text(body.id,200)||id(kind==="batches"?"material-batch":"equipment-asset"),values,true)},{status:201});
  }
  if(request.method==="DELETE"&&recordId){await database.prepare(`DELETE FROM ${config.table} WHERE id=?`).bind(recordId).run();return json({ok:true,deleted:true})}
  return failure("Method not allowed.",405);
}

function validGeometry(kind, geometry) {
  if (!GEOMETRY_TYPES.has(kind) || !geometry || typeof geometry !== "object") return false;
  const numeric = (value) => Number.isFinite(Number(value));
  if(geometry.matrix!==undefined&&(!Array.isArray(geometry.matrix)||geometry.matrix.length!==6||geometry.matrix.some(value=>!numeric(value))))return false;
  if (kind === "polygon" || kind === "polyline") return typeof geometry.points === "string" && /^[-+0-9.,\s]+$/.test(geometry.points) && geometry.points.trim().length > 2;
  if (kind === "path") return typeof geometry.d === "string" && geometry.d.length <= 24000 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/.test(geometry.d);
  if (kind === "rect") return ["x","y","width","height"].every((key) => numeric(geometry[key])) && number(geometry.width)>0 && number(geometry.height)>0;
  if (kind === "circle") return ["cx","cy","r"].every((key) => numeric(geometry[key])) && number(geometry.r)>0;
  return ["cx","cy","rx","ry"].every((key) => numeric(geometry[key])) && number(geometry.rx)>0 && number(geometry.ry)>0;
}

async function adminDossierPalette(request,database,stateId="",part="",recordId="") {
  if(!stateId)return failure("Archive state is required.");
  const state=await database.prepare(`SELECT aos.*,aov.entity_id
    FROM archive_object_states aos JOIN archive_object_versions aov ON aov.id=aos.version_id
    WHERE aos.id=?`).bind(stateId).first();
  if(!state)return failure("Archive state not found.",404);
  if(request.method==="GET"&&!part){
    const [colors,general,maps,regions,sessions,appointments]=await database.batch([
      database.prepare(`SELECT cu.*,r.name recipe_name,r.slug recipe_slug,rv.version_number,
          md.name material_name,md.slug material_slug,md.brand,md.color_name,mf.version_number formulation_version,
          cp.srgb_hex,session_ref.studio_label session_label,session_ref.session_order
        FROM archive_color_usages cu
        LEFT JOIN archive_color_recipe_versions rv ON rv.id=cu.recipe_version_id
        LEFT JOIN archive_color_recipes r ON r.id=rv.recipe_id
        LEFT JOIN archive_material_formulations mf ON mf.id=cu.formulation_id
        LEFT JOIN archive_material_definitions md ON md.id=mf.material_id
        LEFT JOIN archive_color_profiles cp ON
          (cp.source_type='recipe-version' AND cp.source_id=cu.recipe_version_id)
          OR (cp.source_type='material-formulation' AND cp.source_id=cu.formulation_id)
        LEFT JOIN archive_tattoo_session_refs session_ref ON session_ref.id=cu.tattoo_session_ref_id
        WHERE cu.state_id=? ORDER BY cu.layer_order,cu.created_at`).bind(stateId),
      database.prepare(`SELECT gu.*,m.name material_name,m.slug material_slug,m.material_kind,m.brand,m.model_name,
          session_ref.studio_label session_label,session_ref.session_order
        FROM archive_general_material_usages gu JOIN archive_material_definitions m ON m.id=gu.material_id
        LEFT JOIN archive_tattoo_session_refs session_ref ON session_ref.id=gu.tattoo_session_ref_id
        WHERE gu.state_id=? ORDER BY gu.created_at`).bind(stateId),
      database.prepare("SELECT * FROM archive_palette_maps WHERE state_id=? ORDER BY created_at").bind(stateId),
      database.prepare(`SELECT pr.* FROM archive_palette_regions pr
        JOIN archive_palette_maps pm ON pm.id=pr.map_id
        WHERE pm.state_id=? ORDER BY pr.map_id,pr.layer_order,pr.sort_order,pr.created_at`).bind(stateId),
      database.prepare(`SELECT session_ref.*,appointment.start_at,appointment.end_at,appointment.status,
          appointment.client_name,booking_type.label booking_type_label
        FROM archive_tattoo_session_refs session_ref
        JOIN appointments appointment ON appointment.id=session_ref.appointment_id
        JOIN booking_types booking_type ON booking_type.id=appointment.booking_type_id
        WHERE session_ref.state_id=?
        ORDER BY session_ref.session_order,appointment.start_at`).bind(stateId),
      database.prepare(`SELECT appointment.id,appointment.start_at,appointment.end_at,appointment.status,
          appointment.client_name,booking_type.label booking_type_label
        FROM appointments appointment
        JOIN booking_types booking_type ON booking_type.id=appointment.booking_type_id
        WHERE booking_type.venture='tattooing'
        ORDER BY appointment.start_at DESC LIMIT 250`),
    ]);
    return json({
      state,
      colors:colors.results||[],
      materials:general.results||[],
      maps:maps.results||[],
      regions:regions.results||[],
      tattoo_sessions:sessions.results||[],
      appointment_candidates:appointments.results||[],
    });
  }
  if(part==="preview"&&request.method==="GET"){
    const projection=await projectPublicPalette(database,{stateId});
    return json({
      state_id:stateId,
      eligible:projection.eligible,
      blockers:projection.blockers,
      payload:{
        color_usages:projection.color_usages,
        material_usages:projection.material_usages,
        palette_maps:projection.palette_maps,
      },
    });
  }
  const body=await readJson(request);if(!body)return failure("Send a JSON object.");
  if(part==="sessions"){
    if(request.method==="POST"&&!recordId){
      const appointmentId=text(body.appointment_id,200);
      const appointment=await database.prepare(`SELECT appointment.id,appointment.start_at
        FROM appointments appointment
        JOIN booking_types booking_type ON booking_type.id=appointment.booking_type_id
        WHERE appointment.id=? AND booking_type.venture='tattooing'`).bind(appointmentId).first();
      if(!appointment)return failure("Choose a Tattoo appointment for this Archive state.",409);
      const values={
        state_id:stateId,
        appointment_id:appointmentId,
        session_order:Math.max(1,Math.floor(number(body.session_order,1))),
        studio_label:text(body.studio_label,240),
        occurred_at:text(body.occurred_at,80)||appointment.start_at||null,
        notes:text(body.notes,4000),
      };
      try{return json({record:await writeRecord(database,"archive_tattoo_session_refs",text(body.id,200)||id("tattoo-session-ref"),values,true)},{status:201})}
      catch(error){return failure(String(error.message||error).includes("UNIQUE")?"That Tattoo appointment is already linked to this creative state.":error.message,409)}
    }
    if(request.method==="DELETE"&&recordId){
      await database.prepare("DELETE FROM archive_tattoo_session_refs WHERE id=? AND state_id=?").bind(recordId,stateId).run();
      return json({ok:true,deleted:true});
    }
  }
  if(part==="colors"){
    if(request.method==="POST"&&!recordId){
      const formulationId=text(body.formulation_id,200)||null,recipeVersionId=text(body.recipe_version_id,200)||null;if(Number(Boolean(formulationId))+Number(Boolean(recipeVersionId))!==1)return failure("Choose one direct product formulation or one recipe version.");
      if(formulationId){const colorant=await database.prepare(`SELECT m.material_kind FROM archive_material_formulations f JOIN archive_material_definitions m ON m.id=f.material_id WHERE f.id=?`).bind(formulationId).first();if(!colorant)return failure("Product formulation not found.",404);if(!["art-paint","tattoo-ink"].includes(colorant.material_kind))return failure("Only color-bearing paint or tattoo-ink products may be attached as direct color usages.",409)}
      if(recipeVersionId&&!await database.prepare("SELECT id FROM archive_color_recipe_versions WHERE id=?").bind(recipeVersionId).first())return failure("Recipe version not found.",404);
      const sessionRefId=text(body.tattoo_session_ref_id,200)||null;
      if(sessionRefId&&!await database.prepare("SELECT id FROM archive_tattoo_session_refs WHERE id=? AND state_id=?").bind(sessionRefId,stateId).first())return failure("The Tattoo session must belong to this Archive creative state.",409);
      const values={state_id:stateId,formulation_id:formulationId,recipe_version_id:recipeVersionId,tattoo_session_ref_id:sessionRefId,usage_status:["intended","applied","observed","retouched"].includes(body.usage_status)?body.usage_status:"applied",technique:text(body.technique,1000),layer_order:Math.floor(number(body.layer_order,0)),quantity_note:text(body.quantity_note,1000),notes:text(body.notes,4000),public_label:text(body.public_label,240),public_swatch_hex:text(body.public_swatch_hex,20),publication_state:STATES.has(body.publication_state)?body.publication_state:"draft",public_visible:bool(body.public_visible)};
      return json({record:await writeRecord(database,"archive_color_usages",text(body.id,200)||id("color-usage"),values,true)},{status:201});
    }
    if(request.method==="PATCH"&&recordId){
      const before=await database.prepare("SELECT * FROM archive_color_usages WHERE id=? AND state_id=?").bind(recordId,stateId).first();if(!before)return failure("Color usage not found.",404);
      const sessionRefId=text(body.tattoo_session_ref_id??before.tattoo_session_ref_id,200)||null;
      if(sessionRefId&&!await database.prepare("SELECT id FROM archive_tattoo_session_refs WHERE id=? AND state_id=?").bind(sessionRefId,stateId).first())return failure("The Tattoo session must belong to this Archive creative state.",409);
      const values={tattoo_session_ref_id:sessionRefId,usage_status:["intended","applied","observed","retouched"].includes(body.usage_status)?body.usage_status:before.usage_status,technique:text(body.technique??before.technique,1000),layer_order:Math.floor(number(body.layer_order,before.layer_order)),quantity_note:text(body.quantity_note??before.quantity_note,1000),notes:text(body.notes??before.notes,4000),public_label:text(body.public_label??before.public_label,240),public_swatch_hex:text(body.public_swatch_hex??before.public_swatch_hex,20),publication_state:STATES.has(body.publication_state)?body.publication_state:before.publication_state,public_visible:bool(body.public_visible??before.public_visible)};
      return json({record:await writeRecord(database,"archive_color_usages",recordId,values)});
    }
  }
  if(part==="materials"&&request.method==="POST"&&!recordId){
    const materialId=text(body.material_id,200),material=await database.prepare("SELECT id FROM archive_material_definitions WHERE id=?").bind(materialId).first();if(!material)return failure("Material not found.",404);
    const formulationId=text(body.formulation_id,200)||null,batchId=text(body.batch_id,200)||null,assetId=text(body.equipment_asset_id,200)||null;
    if(formulationId&&!await database.prepare("SELECT id FROM archive_material_formulations WHERE id=? AND material_id=?").bind(formulationId,materialId).first())return failure("The selected formulation does not belong to this material.",409);
    if(batchId&&!await database.prepare(`SELECT b.id FROM archive_material_batches b JOIN archive_material_formulations f ON f.id=b.formulation_id WHERE b.id=? AND f.material_id=?`).bind(batchId,materialId).first())return failure("The private batch does not belong to this material.",409);
    if(assetId&&!await database.prepare("SELECT id FROM archive_equipment_assets WHERE id=? AND material_id=?").bind(assetId,materialId).first())return failure("The private equipment asset does not belong to this equipment definition.",409);
    const sessionRefId=text(body.tattoo_session_ref_id,200)||null;
    if(sessionRefId&&!await database.prepare("SELECT id FROM archive_tattoo_session_refs WHERE id=? AND state_id=?").bind(sessionRefId,stateId).first())return failure("The Tattoo session must belong to this Archive creative state.",409);
    const values={state_id:stateId,material_id:materialId,formulation_id:formulationId,batch_id:batchId,equipment_asset_id:assetId,tattoo_session_ref_id:sessionRefId,usage_role:text(body.usage_role,240),technique:text(body.technique,1000),quantity_note:text(body.quantity_note,1000),notes:text(body.notes,4000),publication_state:STATES.has(body.publication_state)?body.publication_state:"draft",public_visible:bool(body.public_visible)};
    return json({record:await writeRecord(database,"archive_general_material_usages",text(body.id,200)||id("material-usage"),values,true)},{status:201});
  }
  if(part==="maps"){
    if(request.method==="POST"&&!recordId){
      const mediaId=text(body.source_media_id,200),media=await database.prepare("SELECT id,width,height,mime_type FROM media_assets WHERE id=?").bind(mediaId).first();if(!media)return failure("Source media not found.",404);if(!String(media.mime_type||"").startsWith("image/"))return failure("Placement maps require an image source.",409);
      const publication=STATES.has(body.publication_state)?body.publication_state:"draft";
      if(publication==="published"){const eligible=await database.prepare("SELECT 1 ok FROM media_assets WHERE id=? AND state='active' AND privacy='public' AND consent_status IN ('not-required','granted') AND public_presentation='inline' AND mime_type LIKE 'image/%'").bind(mediaId).first();if(!eligible)return failure("The source image must be publicly eligible before this map can publish.",409)}
      const values={state_id:stateId,source_media_id:mediaId,title:text(body.title,240),width:Math.max(1,number(body.width,media.width||1)),height:Math.max(1,number(body.height,media.height||1)),viewbox_x:number(body.viewbox_x,0),viewbox_y:number(body.viewbox_y,0),overlay_opacity:Math.min(1,Math.max(0,number(body.overlay_opacity,.55))),publication_state:publication,public_visible:bool(body.public_visible),reviewed_at:publication==="published"?(text(body.reviewed_at,80)||new Date().toISOString()):null};
      return json({record:await writeRecord(database,"archive_palette_maps",text(body.id,200)||id("palette-map"),values,true)},{status:201});
    }
    if(request.method==="PATCH"&&recordId){
      const before=await database.prepare("SELECT * FROM archive_palette_maps WHERE id=? AND state_id=?").bind(recordId,stateId).first();if(!before)return failure("Palette map not found.",404);
      const publication=STATES.has(body.publication_state)?body.publication_state:before.publication_state;
      if(publication==="published"){const eligible=await database.prepare("SELECT 1 ok FROM media_assets WHERE id=? AND state='active' AND privacy='public' AND consent_status IN ('not-required','granted') AND public_presentation='inline' AND mime_type LIKE 'image/%'").bind(before.source_media_id).first();if(!eligible)return failure("The source image is no longer publicly eligible. Review a new map/image pairing.",409)}
      const values={title:text(body.title??before.title,240),overlay_opacity:Math.min(1,Math.max(0,number(body.overlay_opacity,before.overlay_opacity))),publication_state:publication,public_visible:bool(body.public_visible??before.public_visible),reviewed_at:publication==="published"?(text(body.reviewed_at??before.reviewed_at,80)||new Date().toISOString()):null};
      return json({record:await writeRecord(database,"archive_palette_maps",recordId,values)});
    }
  }
  if(part==="regions"&&request.method==="POST"){
    const mapId=text(body.map_id,200),map=await database.prepare("SELECT id FROM archive_palette_maps WHERE id=? AND state_id=?").bind(mapId,stateId).first();if(!map)return failure("Palette map not found.",404);
    const usageId=text(body.color_usage_id,200),usage=await database.prepare("SELECT id FROM archive_color_usages WHERE id=? AND state_id=?").bind(usageId,stateId).first();if(!usage)return failure("Assign every imported or drawn region to a color usage.",409);
    const kind=text(body.geometry_type,30),geometry=body.geometry;if(!validGeometry(kind,geometry))return failure("Only reviewed polygon, polyline, path, rectangle, circle, or ellipse geometry is accepted.",409);
    const values={map_id:mapId,color_usage_id:usageId,label:text(body.label,240),geometry_type:kind,geometry_json:JSON.stringify(geometry),layer_order:Math.floor(number(body.layer_order,0)),sort_order:Math.floor(number(body.sort_order,0))};
    return json({record:await writeRecord(database,"archive_palette_regions",text(body.id,200)||id("palette-region"),values,true)},{status:201});
  }
  if(part==="regions"&&request.method==="DELETE"&&recordId){await database.prepare("DELETE FROM archive_palette_regions WHERE id=? AND map_id IN (SELECT id FROM archive_palette_maps WHERE state_id=?)").bind(recordId,stateId).run();return json({ok:true,deleted:true})}
  if(part==="regions-sync"&&request.method==="POST"){
    const mapId=text(body.map_id,200),map=await database.prepare("SELECT id FROM archive_palette_maps WHERE id=? AND state_id=?").bind(mapId,stateId).first();if(!map)return failure("Palette map not found.",404);
    if(!Array.isArray(body.regions)||body.regions.length>500)return failure("Send no more than 500 reviewed regions.");
    const usageIds=[...new Set(body.regions.map(region=>text(region.color_usage_id,200)).filter(Boolean))];
    if(usageIds.length){
      const found=(await database.prepare(`SELECT id FROM archive_color_usages WHERE state_id=? AND id IN (${usageIds.map(()=>"?").join(",")})`).bind(stateId,...usageIds).all()).results||[];
      if(found.length!==usageIds.length)return failure("Every region must be assigned to a color usage from this creative state.",409);
    }
    for(const region of body.regions){if(!validGeometry(text(region.geometry_type,30),region.geometry))return failure("Only reviewed polygon, polyline, path, rectangle, circle, or ellipse geometry is accepted.",409)}
    const statements=[database.prepare("DELETE FROM archive_palette_regions WHERE map_id=?").bind(mapId)];
    body.regions.forEach((region,index)=>statements.push(database.prepare(`INSERT INTO archive_palette_regions(id,map_id,color_usage_id,label,geometry_type,geometry_json,layer_order,sort_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).bind(text(region.id,200)||id("palette-region"),mapId,text(region.color_usage_id,200),text(region.label,240),text(region.geometry_type,30),JSON.stringify(region.geometry),Math.floor(number(region.layer_order,index)),Math.floor(number(region.sort_order,index)))));
    await database.batch(statements);
    return json({ok:true,count:body.regions.length});
  }
  return failure("Method not allowed.",405);
}

export async function handleArchiveColorMaterialsPublic(request, env, path) {
  if (path === "/api/archive/colors") return publicColors(request,env);
  const color = path.match(/^\/api\/archive\/colors\/([^/]+)$/);
  if (color) return publicColors(request,env,decodeURIComponent(color[1]));
  if (path === "/api/archive/materials") return publicMaterials(request,env);
  const material = path.match(/^\/api\/archive\/materials\/([^/]+)$/);
  if (material) return publicMaterials(request,env,decodeURIComponent(material[1]));
  const map = path.match(/^\/api\/archive\/palette-maps\/([^/.]+)(\.svg)?$/);
  if (map) return publicPaletteMap(request,env,decodeURIComponent(map[1]),Boolean(map[2]));
  return null;
}

export async function handleArchiveColorMaterialsAdmin(request, env, path) {
  const database=db(env);
  const material=path.match(/^\/api\/admin\/archive-color-materials\/materials(?:\/([^/]+))?$/);
  if(material)return adminMaterials(request,database,material[1]?decodeURIComponent(material[1]):"");
  const formulation=path.match(/^\/api\/admin\/archive-color-materials\/formulations(?:\/([^/]+))?$/);
  if(formulation)return adminFormulations(request,database,formulation[1]?decodeURIComponent(formulation[1]):"");
  const recipe=path.match(/^\/api\/admin\/archive-color-materials\/recipes(?:\/([^/]+))?$/);
  if(recipe)return adminRecipes(request,database,recipe[1]?decodeURIComponent(recipe[1]):"");
  const version=path.match(/^\/api\/admin\/archive-color-materials\/recipe-versions(?:\/([^/]+))?$/);
  if(version)return adminRecipeVersions(request,database,version[1]?decodeURIComponent(version[1]):"");
  const component=path.match(/^\/api\/admin\/archive-color-materials\/recipe-components(?:\/([^/]+))?$/);
  if(component)return adminRecipeComponents(request,database,component[1]?decodeURIComponent(component[1]):"");
  const profile=path.match(/^\/api\/admin\/archive-color-materials\/profiles(?:\/([^/]+))?$/);
  if(profile)return adminProfiles(request,database,profile[1]?decodeURIComponent(profile[1]):"");
  const declared=path.match(/^\/api\/admin\/archive-color-materials\/declared-pigments(?:\/([^/]+))?$/);
  if(declared)return adminDeclaredPigments(request,database,declared[1]?decodeURIComponent(declared[1]):"");
  const family=path.match(/^\/api\/admin\/archive-color-materials\/families(?:\/([^/]+))?$/);
  if(family)return adminFamilies(request,database,family[1]?decodeURIComponent(family[1]):"");
  const assignment=path.match(/^\/api\/admin\/archive-color-materials\/family-assignments(?:\/([^/]+))?$/);
  if(assignment)return adminFamilyAssignments(request,database,assignment[1]?decodeURIComponent(assignment[1]):"");
  const privateAsset=path.match(/^\/api\/admin\/archive-color-materials\/(batches|equipment-assets)(?:\/([^/]+))?$/);
  if(privateAsset)return adminPrivateAssets(request,database,privateAsset[1],privateAsset[2]?decodeURIComponent(privateAsset[2]):"");
  if(path==="/api/admin/archive-color-materials"&&request.method==="GET")return json(await librarySnapshot(database));
  const dossier=path.match(/^\/api\/admin\/archive-dossiers\/([^/]+)\/palette-materials(?:\/(colors|materials|maps|regions|regions-sync|sessions|preview))?(?:\/([^/]+))?$/);
  if(dossier)return adminDossierPalette(request,database,decodeURIComponent(dossier[1]),dossier[2]||"",dossier[3]?decodeURIComponent(dossier[3]):"");
  return null;
}

export { ciede2000 };
