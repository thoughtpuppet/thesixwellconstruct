const destinations = Object.freeze({
  breakdown: "/about/#connections",
  mediums: "/about/#modes-mediums",
  identities: "/about/#creative-identities",
  founder: "/about/saieldauhnsolehman/",
  "contact-press": "/about/#contact",
  "visual-language": "/about/legend/#sources-of-visual-language",
  "ways-in": "/about/",
});

const supersededMaps = new Set([
  "/about/construct-connections-organic.html",
  "/about/construct-connections-organic",
  "/about/construct-connections-organic/",
  "/construct-map",
  "/construct-map/",
  "/construct-map/index.html",
  "/sixwellconstruct/bible",
  "/sixwellconstruct/bible/",
  "/sixwellconstruct/bible/index.html",
  "/sixwellconstruct/bible/v1-tabbed",
  "/sixwellconstruct/bible/v1-tabbed/",
  "/sixwellconstruct/bible/v1-tabbed.html",
]);

// Retired orientation pages lead to About; identity profiles keep their routes.
export function aboutSectionRedirect(pathname) {
  if (supersededMaps.has(pathname)) return "/about/";
  const match = String(pathname).match(/^\/about\/([^/]+)(?:\/index\.html|\/)?$/);
  return match ? destinations[match[1]] || "" : "";
}

export function aboutRedirectUrl(requestUrl) {
  const source = new URL(requestUrl);
  const destination = aboutSectionRedirect(source.pathname);
  if (!destination) return null;
  const target = new URL(destination, source);
  target.search = source.search;
  return target;
}
