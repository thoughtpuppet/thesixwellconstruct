export const KINMARKING_FIRST_EDITION_SLUG = "kinmarking-01-oral-histories-and-tattooing";
export const KINMARKING_FIRST_EDITION_LEGACY_SLUG = "kinmarking-01-skin-as-archive";

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
