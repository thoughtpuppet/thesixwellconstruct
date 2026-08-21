export const PAGE_VISIBILITY_PAGES = Object.freeze([
  { label: "Home", path: "/" },
  { label: "About", path: "/about/" },
  { label: "Archive", path: "/archive/" },
  { label: "Events", path: "/events/" },
  { label: "Film", path: "/film/" },
  { label: "Music", path: "/music/" },
  { label: "Writings", path: "/writings/" },
  { label: "Art Index", path: "/art/" },
  { label: "Acquisition Inquiry", path: "/art/acquisitioninquiry.html" },
  { label: "Homeland Security", path: "/art/homelandsecuritypainting.html" },
  { label: "Lost Marbles Painting", path: "/art/lostmarblespainting.html" },
  { label: "Lust Painting", path: "/art/lustpainting.html" },
  { label: "Paranoia & Fostered Trauma", path: "/art/paranoiafosteredtraumapainting.html" },
  { label: "Sloth Painting", path: "/art/slothpainting.html" },
  { label: "The Frustrations Of Inner Chaos", path: "/art/thefrustrationsofinnercharospainting.html" },
  { label: "Merch Index", path: "/merch/" },
  { label: "Lost Marbles Hoodie", path: "/merch/lostmarbles-hoodie/" },
  { label: "Marbles Print", path: "/merch/marbles-print/" },
  { label: "Tattoos Index", path: "/tattoos/" },
  { label: "Build Your Own", path: "/tattoos/build/" },
  { label: "Maze Studio", path: "/tattoos/build/maze/" },
  { label: "Special Projects", path: "/tattoos/special-projects/" },
  { label: "Special Projects Apply", path: "/tattoos/special-projects/apply/" },
  { label: "Approved", path: "/tattoos/approved/" },
  { label: "Booking", path: "/tattoos/booking/" },
  { label: "Flash", path: "/tattoos/flash/" },
  { label: "Flash Claim", path: "/tattoos/flash/claim/" },
  { label: "Inquire", path: "/tattoos/inquire/" },
  { label: "Portfolio", path: "/tattoos/portfolio/" },
  { label: "Submission Received", path: "/tattoos/submission-received/" },
]);

export const PAGE_VISIBILITY_DEFAULT_RULES = Object.freeze([
  { path: "/film", visibility: "hidden", scope: "exact" },
  { path: "/music", visibility: "hidden", scope: "exact" },
  { path: "/tattoos/build", visibility: "hidden", scope: "descendants" },
  { path: "/tattoos/build/maze", visibility: "public", scope: "exact" },
]);

export const PAGE_VISIBILITY_HOME_PATHS = new Set(["/", "/index", "/home", "/entry-room"]);
export const PAGE_VISIBILITY_ERROR_PATHS = new Set(["/404", "/404.html"]);

export function normalizePageVisibilityPath(pathname) {
  let normalized = String(pathname || "/").split("?")[0].split("#")[0];
  try { normalized = decodeURIComponent(normalized); } catch { /* Keep the original path. */ }
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/index\.html$/i, "/");
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/g, "");
  normalized = (normalized || "/").toLowerCase();
  const htmlAlias = PAGE_VISIBILITY_PAGES.find((page) => {
    const registered = String(page.path || "").toLowerCase().replace(/\/+$/g, "");
    return registered.endsWith(".html") && registered === `${normalized}.html`;
  });
  return htmlAlias ? String(htmlAlias.path).toLowerCase().replace(/\/+$/g, "") : normalized;
}

export function isPageVisibilityHomePath(pathname) {
  return PAGE_VISIBILITY_HOME_PATHS.has(normalizePageVisibilityPath(pathname));
}

export function isPageVisibilityOperationalExemptPath(pathname) {
  const path = normalizePageVisibilityPath(pathname);
  return (
    path === "/api" || path.startsWith("/api/") ||
    path === "/studio" || path.startsWith("/studio/") ||
    /^\/(?:b|o)\/[a-z0-9_-]+$/i.test(path)
  );
}

export function pageVisibilityRegistryPath(pathname) {
  const normalized = normalizePageVisibilityPath(pathname);
  return PAGE_VISIBILITY_PAGES.some((page) => normalizePageVisibilityPath(page.path) === normalized)
    ? normalized
    : "";
}

export function resolvePageVisibility(pathname, rules = [], homeOnly = false) {
  const path = normalizePageVisibilityPath(pathname);
  if (isPageVisibilityHomePath(path) || PAGE_VISIBILITY_ERROR_PATHS.has(path)) {
    return { path, visibility: "public", hidden: false, sourcePath: "", scope: "exact", inherited: false, homeOnly: false };
  }
  if (homeOnly) {
    return { path, visibility: "hidden", hidden: true, sourcePath: "*", scope: "descendants", inherited: true, homeOnly: true };
  }
  const matches = rules
    .map((rule) => ({
      path: normalizePageVisibilityPath(rule?.path),
      visibility: rule?.visibility === "hidden" ? "hidden" : "public",
      scope: rule?.scope === "descendants" ? "descendants" : "exact",
    }))
    .filter((rule) => rule.path !== "/" && (
      path === rule.path || (rule.scope === "descendants" && path.startsWith(`${rule.path}/`))
    ))
    .sort((left, right) => right.path.length - left.path.length);
  const match = matches[0];
  if (!match) {
    return { path, visibility: "public", hidden: false, sourcePath: "", scope: "exact", inherited: false, homeOnly: false };
  }
  return {
    path,
    visibility: match.visibility,
    hidden: match.visibility === "hidden",
    sourcePath: match.path,
    scope: match.scope,
    inherited: match.path !== path,
    homeOnly: false,
  };
}

export function presentPageVisibilityState(rules = PAGE_VISIBILITY_DEFAULT_RULES, homeOnly = false) {
  return PAGE_VISIBILITY_PAGES.map((page) => ({
    ...page,
    path: normalizePageVisibilityPath(page.path),
    ...resolvePageVisibility(page.path, rules, homeOnly),
  }));
}
