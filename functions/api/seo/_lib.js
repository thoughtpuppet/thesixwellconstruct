import { loadPublicCalendarSearchEvents } from "../calendar/_lib.js";
import { publicPageVisibilityDecisions } from "../site-visibility/_lib.js";

export const PUBLIC_SITE_ORIGIN = "https://thesixwellconstruct.com";

const STATIC_PAGES = Object.freeze([
  ["/", "The Six.Well Construct · Saiel Dauhn Solehman", "The creative ecosystem of Saiel Dauhn Solehman: art, tattooing, clothing, writing, film, sound, events, and an authored living Archive."],
  ["/home/", "The Six.Well Construct · Creative Ecosystem", "Enter the connected creative ecosystem of Saiel Dauhn Solehman across art, tattooing, clothing, writing, film, sound, events, and Archive."],
  ["/about/", "About the Six.Well Construct · Saiel Dauhn Solehman", "The full operating creative ecosystem of Saiel Dauhn Solehman and the relationships between its mediums, projects, records, and public pathways."],
  ["/about/saieldauhnsolehman/", "Saiel Dauhn Solehman · Interdisciplinary Artist in Atlanta", "Saiel Dauhn Solehman, also known as Saiel Solehman, is an Atlanta interdisciplinary artist, systems thinker, scholar, and veteran working across art, tattooing, clothing, writing, film, sound, and events."],
  ["/about/ways-in/", "Ways Into the Six.Well Construct", "Choose a path into Saiel Dauhn Solehman's creative ecosystem through art, tattooing, clothing, writing, film, events, the Legend, or the Archive."],
  ["/about/exhibitions-appearances/", "Exhibitions and Appearances · Saiel Dauhn Solehman", "A public record of exhibitions, appearances, talks, and programs involving interdisciplinary artist Saiel Dauhn Solehman."],
  ["/about/contact-press/", "Contact and Press · Saiel Dauhn Solehman", "Contact and press pathways for Saiel Dauhn Solehman and the Six.Well Construct."],
  ["/currently/", "Current Works and Projects · Saiel Dauhn Solehman", "Current works and active projects across the connected creative practice of Saiel Dauhn Solehman."],
  ["/art/", "Art by Saiel Dauhn Solehman · Paintings and Works", "Artworks and paintings by Atlanta interdisciplinary artist Saiel Dauhn Solehman, including available works and their connected records."],
  ["/gallery/", "Gallery · Original Works by Saiel Dauhn Solehman", "A gallery of original works from the creative ecosystem of Saiel Dauhn Solehman."],
  ["/archive/", "The Living Archive · Saiel Dauhn Solehman and Six.Well", "The authored living Archive connecting works, materials, histories, relationships, and projects across the Six.Well Construct."],
  ["/tattoos/", "Atlanta Tattoo Artist · art.pill Tattoo House", "Original, collaborative, and experimental tattoo work by Saiel Dauhn Solehman at art.pill Tattoo House in Atlanta."],
  ["/about/artpilltattoohouse/", "About art.pill Tattoo House · Atlanta", "art.pill Tattoo House is Saiel Dauhn Solehman's Atlanta tattoo practice for symbolic, surreal, collaborative, and experimental work on the body."],
  ["/tattoos/portfolio/", "Tattoo Portfolio · Saiel Dauhn Solehman · Atlanta", "Tattoo work by Atlanta artist Saiel Dauhn Solehman, including original, collaborative, symbolic, and experimental pieces."],
  ["/tattoos/flash/", "Tattoo Flash · art.pill Tattoo House · Atlanta", "Available and archived tattoo flash from Saiel Dauhn Solehman's visual language at art.pill Tattoo House in Atlanta."],
  ["/tattoos/special-projects/", "Tattoo Special Projects · art.pill Tattoo House", "Artist-led tattoo projects, calls, and experimental formats by Saiel Dauhn Solehman at art.pill Tattoo House in Atlanta."],
  ["/tattoos/inquire/", "Custom Tattoo Inquiry · art.pill Tattoo House · Atlanta", "Start a custom tattoo inquiry with Saiel Dauhn Solehman at art.pill Tattoo House in Atlanta."],
  ["/tattoos/location-parking/", "Location and Parking · art.pill Tattoo House · Atlanta", "Appointment-only arrival and parking information for art.pill Tattoo House at 364 Nelson Street SW, Atlanta, Georgia."],
  ["/merch/", "Six.Well Clothing · Artist-Made Garments and Objects", "Six.Well Clothing is an ongoing clothing-based installation of artist-made garments, editions, prints, and artifacts from the Construct."],
  ["/events/", "Six.Well Events · Creative Programs in Atlanta", "Gatherings, open calls, temporary rooms, and live experiments produced or operated through the Six.Well Construct in Atlanta."],
  ["/calendar/", "Atlanta Creative Calendar · Art, Film, Music and More", "A selective Atlanta creative calendar for art, independent film, poetry, music, technology, lectures, conferences, virtual programs, and experimental events."],
  ["/writings/", "Writing by Saiel Dauhn Solehman · Six.Well Construct", "Writing, inquiry, and authored records by Saiel Dauhn Solehman within the Six.Well Construct."],
]);

export const SEO_STATIC_PAGES = Object.freeze(STATIC_PAGES.map(([path, title, description]) => ({ path, title, description })));

const STATIC_PAGE_MAP = new Map(SEO_STATIC_PAGES.map((page) => [page.path, page]));
const NOINDEX_PATHS = [
  /^\/404(?:\.html)?\/?$/,
  /^\/studio(?:\/|$)/,
  /^\/tools(?:\/|$)/,
  /^\/prototypes(?:\/|$)/,
  /\/(?:[^/]*(?:prototype|preview)[^/]*)(?:\/|$)/i,
  /^\/about\/about-next(?:\.html)?\/?$/,
  /^\/(?:b|o)\/[A-Za-z0-9_-]+\/?$/,
  /\/(?:confirmed|confirmation|submission-received|approved|reschedule)(?:\/|$)/,
  /^\/booking(?:\/|$)/,
  /^\/tattoos\/booking(?:\/|$)/,
  /^\/tattoos\/flash\/claim(?:\/|$)/,
  /^\/tattoos\/special-projects\/apply(?:\/|$)/,
  /^\/calendar\/submit(?:\/|$)/,
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function escapeXml(value) {
  return escapeHtml(value);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function trimDescription(value, fallback = "") {
  const clean = stripMarkup(value || fallback);
  if (clean.length <= 300) return clean;
  const shortened = clean.slice(0, 297).replace(/\s+\S*$/, "").trim();
  return `${shortened}…`;
}

export function canonicalOrigin(env = {}, requestUrl = PUBLIC_SITE_ORIGIN) {
  const configured = String(env.PUBLIC_SITE_URL || PUBLIC_SITE_ORIGIN).trim();
  try {
    const url = new URL(configured || requestUrl);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, "");
  } catch {
    return PUBLIC_SITE_ORIGIN;
  }
}

export function normalizeSeoPath(pathname) {
  let path = String(pathname || "/").split("?")[0].split("#")[0];
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  path = path.replace(/\/index(?:\.html)?$/i, "/");
  if (path === "/home") return "/home/";
  if (path === "/entry-room" || path === "/entry-room/" || path === "/index" || path === "/index.html") return "/";
  if (path !== "/" && !/\/[^/]+\.[^/]+$/.test(path) && !path.endsWith("/")) path += "/";
  return path;
}

export function isNoindexPath(pathname) {
  const path = normalizeSeoPath(pathname);
  return NOINDEX_PATHS.some((pattern) => pattern.test(path));
}

export function canonicalRedirect(request, env = {}) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) return null;
  const url = new URL(request.url);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return null;

  const origin = new URL(canonicalOrigin(env, request.url));
  const productionHost = origin.hostname.toLowerCase();
  const requestHost = url.hostname.toLowerCase();
  const isKnownHost = requestHost === productionHost || requestHost === `www.${productionHost}`;
  const requestedPath = url.pathname;
  let normalizedPath = normalizeSeoPath(requestedPath);
  if (/^\/explore(?:\/|\/index\.html)?$/i.test(requestedPath)) normalizedPath = "/adventure/";
  if (/^\/adventure(?:\/index\.html)?$/i.test(requestedPath)) normalizedPath = "/adventure/";
  if (/^\/legend(?:\/|\/index\.html)?$/i.test(requestedPath)) normalizedPath = "/about/legend/";
  else if (/^\/legend\//i.test(requestedPath)) normalizedPath = normalizeSeoPath(`/about${requestedPath}`);
  const pathChanged = normalizedPath !== url.pathname;
  const hostChanged = requestHost === `www.${productionHost}`;
  const protocolChanged = isKnownHost && url.protocol !== "https:";
  if (!pathChanged && !hostChanged && !protocolChanged) return null;

  if (hostChanged || protocolChanged) {
    url.protocol = "https:";
    url.host = productionHost;
  }
  url.pathname = normalizedPath;
  if (pathChanged || normalizedPath === "/") url.search = "";
  return Response.redirect(url, 308);
}

export function staticSeoPage(pathname) {
  return STATIC_PAGE_MAP.get(normalizeSeoPath(pathname)) || null;
}

function titleFromHtml(html) {
  return stripMarkup(html.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function descriptionFromHtml(html) {
  const explicit = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1]
    || html.match(/<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)?.[1];
  if (explicit) return stripMarkup(explicit);
  const hero = html.match(/<(?:p|div)\s+[^>]*class=["'][^"']*(?:hero-descriptor|hero-lede|section-intro)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div)>/i)?.[1];
  return trimDescription(hero || "The Six.Well Construct, the creative ecosystem of Saiel Dauhn Solehman.");
}

function breadcrumbData(pathname, origin, title) {
  const path = normalizeSeoPath(pathname);
  if (path === "/") return null;
  const segments = path.split("/").filter(Boolean);
  const items = [{ "@type": "ListItem", position: 1, name: "The Six.Well Construct", item: `${origin}/` }];
  let current = "";
  segments.forEach((segment, index) => {
    current += `/${segment}`;
    items.push({
      "@type": "ListItem",
      position: index + 2,
      name: index === segments.length - 1 ? title.split(" · ")[0] : segment.replace(/[-_]+/g, " "),
      item: `${origin}${current}/`,
    });
  });
  return { "@type": "BreadcrumbList", itemListElement: items };
}

export function personStructuredData(origin = PUBLIC_SITE_ORIGIN) {
  return {
    "@type": "Person",
    "@id": `${origin}/about/saieldauhnsolehman/#person`,
    name: "Saiel Dauhn Solehman",
    alternateName: ["Saiel Solehman"],
    url: `${origin}/about/saieldauhnsolehman/`,
    image: `${origin}/assets/Sai%20Solehman%20Sunflower%20Scarf.jpg`,
    homeLocation: { "@type": "City", name: "Atlanta" },
    jobTitle: "Interdisciplinary artist",
    knowsAbout: ["Art", "Tattooing", "Clothing", "Writing", "Film", "Sound", "Events", "Creative systems"],
  };
}

export function chillSeriesStructuredData(origin = PUBLIC_SITE_ORIGIN) {
  return {
    "@type": "TVSeries",
    "@id": "https://www.theblackoutcompany.com/chill-the-series#series",
    name: "Chill. the Series",
    url: "https://www.theblackoutcompany.com/chill-the-series",
    actor: { "@id": `${origin}/about/saieldauhnsolehman/#person` },
    character: { "@type": "Person", name: "Tae “Art Bae”" },
    creditText: "Saiel Solehman as Tae “Art Bae”",
    productionCompany: {
      "@type": "Organization",
      name: "The BlackOUT Company",
      url: "https://www.theblackoutcompany.com/",
    },
  };
}

export function organizationStructuredData(origin = PUBLIC_SITE_ORIGIN) {
  return {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: "The Six.Well Construct",
    url: `${origin}/`,
    founder: { "@id": `${origin}/about/saieldauhnsolehman/#person` },
  };
}

export function tattooParlorStructuredData(origin = PUBLIC_SITE_ORIGIN) {
  return {
    "@type": "TattooParlor",
    "@id": `${origin}/tattoos/#tattoo-parlor`,
    name: "art.pill Tattoo House",
    url: `${origin}/tattoos/`,
    founder: { "@id": `${origin}/about/saieldauhnsolehman/#person` },
    address: {
      "@type": "PostalAddress",
      streetAddress: "364 Nelson Street SW",
      addressLocality: "Atlanta",
      addressRegion: "GA",
      postalCode: "30313",
      addressCountry: "US",
    },
    sameAs: [],
  };
}

function staticStructuredGraph(pathname, origin, title, description, canonical) {
  const path = normalizeSeoPath(pathname);
  const graph = [{
    "@type": "WebPage",
    "@id": `${canonical}#webpage`,
    url: canonical,
    name: title,
    description,
    isPartOf: { "@id": `${origin}/#website` },
  }];
  const breadcrumb = breadcrumbData(path, origin, title);
  if (breadcrumb) graph.push(breadcrumb);
  if (path === "/" || path === "/home/") {
    graph.push({ "@type": "WebSite", "@id": `${origin}/#website`, name: "The Six.Well Construct", url: `${origin}/`, publisher: { "@id": `${origin}/#organization` } });
    graph.push(organizationStructuredData(origin), personStructuredData(origin));
  }
  if (path === "/about/saieldauhnsolehman/") graph.push(personStructuredData(origin), chillSeriesStructuredData(origin));
  if (path === "/tattoos/" || path === "/about/artpilltattoohouse/" || path === "/tattoos/location-parking/") graph.push(tattooParlorStructuredData(origin));
  return { "@context": "https://schema.org", "@graph": graph };
}

function removeManagedHead(html) {
  return String(html)
    .replace(/\s*<title(?:\s[^>]*)?>[\s\S]*?<\/title>/gi, "")
    .replace(/\s*<meta\s+[^>]*(?:name=["'](?:description|robots|twitter:[^"']+)["']|property=["']og:[^"']+["'])[^>]*>/gi, "")
    .replace(/\s*<link\s+[^>]*rel=["']canonical["'][^>]*>/gi, "")
    .replace(/\s*<script\s+[^>]*data-seo-structured-data[^>]*>[\s\S]*?<\/script>/gi, "");
}

function metaContent(html, attribute, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = String(html).match(new RegExp(`<meta\\s+[^>]*${attribute}=["']${escaped}["'][^>]*>`, "i"))?.[0] || "";
  return tag.match(/\scontent=["']([^"']*)["']/i)?.[1] || "";
}

function absoluteSeoUrl(value, origin) {
  if (!value) return "";
  try { return new URL(value, `${origin}/`).toString(); }
  catch { return ""; }
}

function dataAttributesFromTag(html, pattern) {
  const tag = String(html).match(pattern)?.[0] || "";
  return [...tag.matchAll(/\s(data-[A-Za-z0-9_-]+(?:=(?:"[^"]*"|'[^']*'))?)/g)]
    .map((match) => ` ${match[1]}`)
    .join("");
}

export function applySeoDocument(html, options = {}) {
  const pathname = normalizeSeoPath(options.pathname || "/");
  const origin = String(options.origin || PUBLIC_SITE_ORIGIN).replace(/\/+$/, "");
  const registered = staticSeoPage(pathname);
  const title = stripMarkup(options.title || registered?.title || titleFromHtml(html) || "The Six.Well Construct");
  const description = trimDescription(options.description || registered?.description || descriptionFromHtml(html));
  const canonicalPath = normalizeSeoPath(options.canonicalPath || pathname);
  const canonical = options.canonicalUrl || `${origin}${canonicalPath}`;
  const robots = options.robots || (isNoindexPath(pathname) ? "noindex,nofollow,noarchive" : "index,follow,max-image-preview:large");
  const image = absoluteSeoUrl(
    options.image || metaContent(html, "property", "og:image") || metaContent(html, "name", "twitter:image"),
    origin,
  );
  const imageAlt = stripMarkup(
    options.imageAlt || metaContent(html, "property", "og:image:alt") || metaContent(html, "name", "twitter:image:alt"),
  );
  const structuredData = options.structuredData || staticStructuredGraph(pathname, origin, title, description, canonical);
  const titleData = dataAttributesFromTag(html, /<title(?:\s[^>]*)?>/i);
  const descriptionData = dataAttributesFromTag(html, /<meta\s+[^>]*name=["']description["'][^>]*>/i);
  const robotsData = dataAttributesFromTag(html, /<meta\s+[^>]*name=["']robots["'][^>]*>/i);
  const canonicalData = dataAttributesFromTag(html, /<link\s+[^>]*rel=["']canonical["'][^>]*>/i);
  const head = [
    `<title${titleData}>${escapeHtml(title)}</title>`,
    `<meta${descriptionData} name="description" content="${escapeHtml(description)}">`,
    `<meta${robotsData} name="robots" content="${escapeHtml(robots)}">`,
    `<link${canonicalData} rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:type" content="${escapeHtml(options.ogType || "website")}">`,
    `<meta property="og:site_name" content="The Six.Well Construct">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}">` : "",
    image && imageAlt ? `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}">` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : "",
    image && imageAlt ? `<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}">` : "",
    structuredData ? `<script type="application/ld+json" data-seo-structured-data>${safeJson(structuredData)}</script>` : "",
  ].filter(Boolean).join("\n");
  return removeManagedHead(html).replace(/<\/head>/i, `${head}\n</head>`);
}

export async function applySeoResponse(request, env, response, options = {}) {
  const headers = new Headers(response.headers);
  const pathname = options.pathname || new URL(request.url).pathname;
  const robots = options.robots || (isNoindexPath(pathname) ? "noindex,nofollow,noarchive" : "index,follow,max-image-preview:large");
  headers.set("x-robots-tag", robots);
  headers.delete("content-length");
  headers.delete("etag");
  if (request.method === "HEAD") return new Response(null, { status: response.status, headers });
  const html = applySeoDocument(await response.text(), {
    ...options,
    pathname,
    origin: canonicalOrigin(env, request.url),
  });
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

function robotsText(origin) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /studio/",
    "Disallow: /tools/",
    "Disallow: /prototypes/",
    "Disallow: /booking/",
    "Disallow: /tattoos/booking/",
    "Disallow: /tattoos/submission-received/",
    "Disallow: /tattoos/approved/",
    "Disallow: /calendar/submit/",
    "Disallow: /b/",
    "Disallow: /o/",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function handleRobots(request, env) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) return new Response("Method not allowed.", { status: 405, headers: { allow: "GET, HEAD" } });
  const body = request.method === "HEAD" ? null : robotsText(canonicalOrigin(env, request.url));
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}

function calendarTitleSlug(value) {
  return String(value || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96).replace(/-+$/g, "") || "event";
}

async function dynamicSitemapEntries(env) {
  if (!env.SUBMISSIONS_DB) throw new Error("Missing authoritative D1 binding SUBMISSIONS_DB.");
  const db = env.SUBMISSIONS_DB;
  const [merch, events, art, legend, flash, identities, archive, writing, calendarEvents] = await Promise.all([
    db.prepare(`SELECT m.route path,m.updated_at lastmod FROM merch_items m JOIN content_entities ce ON ce.id=m.id
      WHERE m.state='published' AND ce.visibility='public' AND ce.search_visibility=1`).all(),
    db.prepare(`SELECT '/events/'||slug||'/' path,updated_at lastmod FROM events
      WHERE publication_state IN ('announced','published')`).all(),
    db.prepare(`SELECT '/art/'||a.slug||'/' path,a.updated_at lastmod FROM art_works a JOIN content_entities ce ON ce.id=a.id
      WHERE a.state='published' AND a.legacy_path='' AND ce.visibility='public' AND ce.search_visibility=1`).all(),
    db.prepare(`SELECT '/about/legend/'||v.slug||'/' path,v.updated_at lastmod FROM visual_symbols v JOIN content_entities ce ON ce.id=v.id
      WHERE v.state='published' AND ce.visibility='public' AND ce.search_visibility=1`).all(),
    db.prepare(`SELECT '/tattoos/flash/'||f.slug||'/' path,f.updated_at lastmod FROM flash_items f JOIN content_entities ce ON ce.id=f.id
      WHERE f.state NOT IN ('draft','archived') AND ce.visibility='public' AND ce.search_visibility=1`).all(),
    db.prepare(`SELECT '/about/identities/'||slug||'/' path,updated_at lastmod FROM about_identity_profiles
      WHERE publication_state='published' AND visibility='public'`).all(),
    db.prepare(`SELECT '/archive/records/'||d.archive_slug||'/' path,d.updated_at lastmod FROM archive_dossiers d JOIN content_entities ce ON ce.id=d.entity_id
      WHERE d.state='published' AND d.public_visible=1 AND ce.visibility='public' AND ce.search_visibility=1`).all(),
    db.prepare(`SELECT '/writings/mindful-darkness/wrkng/'||w.slug||'/' path,w.published_updated_at lastmod
      FROM writing_entries w JOIN content_entities ce ON ce.id=w.entity_id
      WHERE w.state='published' AND w.is_sample=0 AND ce.visibility='public' AND ce.search_visibility=1`).all(),
    loadPublicCalendarSearchEvents(env),
  ]);
  const rows = [merch, events, art, legend, flash, identities, archive, writing]
    .flatMap((result) => result.results || [])
    .map((row) => ({ path: normalizeSeoPath(row.path), lastmod: row.lastmod || "" }));
  for (const event of calendarEvents || []) {
    if (event.origin === "sixwell" || event.status === "cancelled" || !event.id || !event.title) continue;
    const path = event.detailUrl || `/calendar/events/${calendarTitleSlug(event.title)}--${encodeURIComponent(event.id)}/`;
    if (!path.startsWith("/calendar/events/")) continue;
    rows.push({ path: normalizeSeoPath(path), lastmod: event.lastModified || "" });
  }
  return rows;
}

function validLastmod(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export async function sitemapXml(env, requestUrl = PUBLIC_SITE_ORIGIN) {
  const origin = canonicalOrigin(env, requestUrl);
  const dynamicEntries = await dynamicSitemapEntries(env);
  const candidates = [
    ...SEO_STATIC_PAGES.map((page) => ({ path: page.path, lastmod: "" })),
    ...dynamicEntries,
  ];
  const visibilityDecisions = await publicPageVisibilityDecisions(candidates.map((entry) => entry.path), env, { allowFallback: false });
  const entries = new Map();
  for (const [index, entry] of candidates.entries()) {
    const path = normalizeSeoPath(entry.path);
    if (visibilityDecisions[index].hidden || isNoindexPath(path) || path.includes("?") || path.includes("#")) continue;
    const previous = entries.get(path);
    const nextLastmod = validLastmod(entry.lastmod);
    if (!previous || (!previous.lastmod && nextLastmod)) entries.set(path, { path, lastmod: nextLastmod });
  }
  const body = [...entries.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `  <url><loc>${escapeXml(`${origin}${entry.path}`)}</loc>${entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export async function handleSitemap(request, env) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) return new Response("Method not allowed.", { status: 405, headers: { allow: "GET, HEAD" } });
  try {
    const xml = await sitemapXml(env, request.url);
    return new Response(request.method === "HEAD" ? null : xml, {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  } catch (error) {
    return new Response("Sitemap temporarily unavailable.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-seo-error": String(error?.message || error).slice(0, 160) },
    });
  }
}

export function dynamicStructuredGraph({ type = "CreativeWork", canonicalUrl, title, description, image = "", extra = {}, origin = PUBLIC_SITE_ORIGIN }) {
  const entity = {
    "@type": type,
    "@id": `${canonicalUrl}#entity`,
    url: canonicalUrl,
    name: title,
    description: trimDescription(description),
    ...(image ? { image: new URL(image, `${origin}/`).toString() } : {}),
    ...extra,
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      entity,
      {
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: title,
        description: trimDescription(description),
        mainEntity: { "@id": `${canonicalUrl}#entity` },
      },
    ],
  };
}
