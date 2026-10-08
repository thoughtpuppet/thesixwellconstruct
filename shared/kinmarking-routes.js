export const KINMARKING_FIRST_EDITION_SLUG = "kinmarking-01-oral-histories-and-tattooing";
export const KINMARKING_FIRST_EDITION_LEGACY_SLUG = "kinmarking-01-skin-as-archive";

export function kinmarkingSessionNumber(slug) {
  if (slug === KINMARKING_FIRST_EDITION_SLUG) return "01";
  return slug.match(/^kinmarking-(\d{2,})$/)?.[1] || "";
}

export function kinmarkingProjectRedirect(pathname) {
  return pathname === "/kinmarking" || pathname === "/kinmarking/" ? "/events/kinmarking/" : "";
}

export function kinmarkingFirstEditionRedirect(pathname) {
  if (!new Set([
    `/events/${KINMARKING_FIRST_EDITION_LEGACY_SLUG}`,
    `/events/${KINMARKING_FIRST_EDITION_LEGACY_SLUG}/`,
    `/events/${KINMARKING_FIRST_EDITION_LEGACY_SLUG}/index.html`,
    `/events/${KINMARKING_FIRST_EDITION_SLUG}`,
    `/events/${KINMARKING_FIRST_EDITION_SLUG}/index.html`,
  ]).has(pathname)) return "";
  return `/events/${KINMARKING_FIRST_EDITION_SLUG}/`;
}
