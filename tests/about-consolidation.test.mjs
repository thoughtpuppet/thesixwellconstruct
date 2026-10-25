import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import worker from "../_worker.js";
import { aboutSectionRedirect } from "../shared/about-routes.js";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("retired About indexes redirect to available sections and preserve query strings", async () => {
  const targets = {
    breakdown: "/about/#connections",
    mediums: "/about/#modes-mediums",
    identities: "/about/#creative-identities",
    founder: "/about/saieldauhnsolehman/",
    "contact-press": "/about/#contact",
    "visual-language": "/about/legend/#sources-of-visual-language",
    "ways-in": "/about/",
  };
  const index = await read("about/index.html");
  const legend = await read("about/legend/index.html");
  for (const [slug, target] of Object.entries(targets)) {
    const fallback = await read(`about/${slug}/index.html`);
    assert.ok(fallback.includes(`href="${target}"`), slug);
    for (const suffix of ["", "/", "/index.html"]) {
      const request = new Request(`https://example.test/about/${slug}${suffix}?from=old-link`);
      const response = await worker.fetch(request, { ASSETS: { fetch: () => new Response("unused") } });
      assert.equal(response.status, 308, request.url);
      const location = new URL(response.headers.get("location"));
      assert.equal(`${location.pathname}${location.hash}`, target);
      assert.equal(location.search, "?from=old-link");
      if (location.hash) assert.ok((location.pathname === "/about/" ? index : legend).includes(`id="${location.hash.slice(1)}"`));
    }
  }
  for (const route of ["/about/collaborators/", "/about/exhibitions-appearances/", "/about/identities/thoughtpuppet/", "/about/legend/apple/"]) {
    assert.equal(aboutSectionRedirect(route), "", route);
  }
});

test("superseded maps and Bible pages are removed and their old links redirect to About", async () => {
  for (const file of [
    "about/construct-connections-organic.html",
    "construct-map/index.html",
    "sixwellconstruct/bible/index.html",
    "sixwellconstruct/bible/v1-tabbed.html",
  ]) {
    await assert.rejects(read(file), { code: "ENOENT" });
  }
  for (const path of [
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
  ]) {
    const response = await worker.fetch(new Request(`http://www.thesixwellconstruct.com${path}?from=old-link`), {
      ASSETS: { fetch() { throw new Error("Removed page assets must not be requested."); } },
    });
    assert.equal(response.status, 308, path);
    assert.equal(response.headers.get("location"), "https://thesixwellconstruct.com/about/?from=old-link", path);
  }
});

test("identity histories use published matching timelines and fail closed for hidden or unresolved destinations", async () => {
  const script = await read("js/about-history-links.js");
  const names = ["ThoughtPuppet", "Six.Well Clothing", "art.pill Tattoo House", "Sloth99", "Mindful Darkness"];
  const containers = new Map(names.map((name) => [name, { children: [], replaceChildren(link) { this.children = [link]; } }]));
  const identities = names.map((name) => ({ dataset: { identityHistory: name }, querySelector: () => containers.get(name) }));
  const run = async (catalogAvailable) => {
    for (const container of containers.values()) container.children = [];
    const document = {
      querySelectorAll: () => identities,
      createElement: () => ({ setAttribute(name, value) { this[name] = value; } }),
    };
    const fetch = async (url) => {
      if (url === "/api/archive/timelines") return {
        ok: catalogAvailable,
        json: async () => ({ records: [
          { title: "ThoughtPuppet", canonical_route: "/archive/timelines/thoughtpuppet/" },
          { title: "SIX.WELL CLOTHING", canonical_route: "/archive/timelines/six-well-clothing/" },
          { title: "Sloth99", canonical_route: "https://other.example/history" },
          { title: "Mindful Darkness", canonical_route: "/archive/timelines/mindful-darkness/" },
        ] }),
      };
      if (url.includes("mindful-darkness")) throw new Error("Visibility unavailable");
      const hidden = url.includes("six-well-clothing");
      return { ok: true, json: async () => ({ visibility: hidden ? "hidden" : "public", hidden }) };
    };
    await vm.runInNewContext(script, { document, fetch });
  };
  await run(true);
  assert.equal(containers.get("ThoughtPuppet").children[0].href, "/archive/timelines/thoughtpuppet/");
  for (const name of names.slice(1)) assert.equal(containers.get(name).children.length, 0, name);
  await run(false);
  for (const container of containers.values()) assert.equal(container.children.length, 0);
});
