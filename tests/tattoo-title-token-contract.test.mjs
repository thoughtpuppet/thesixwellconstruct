import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = {
  "tattoos/approved/index.html": "5784bded98b6978e3657f1cffd0a48376f893dc55826772c68fa1768b88cf6dc",
  "tattoos/aftercare/index.html": "73d41a7c103ce6c1afa03e32f59ef9ebaf51e2fbc988fd822905024933a70654",
  "tattoos/build/in-person/index.html": "e8c6486e60bfa71637e87ec67130967509aadcb017d9dee588702aa0f1f9516b",
  "tattoos/build/index.html": "0c3985611a79970e403691c4e0cd2578c6ca822f1962aa726a3c50b46ba24855",
  "tattoos/day-of/index.html": "dbc3b302075cbbc9017983636065ce8c3fab0df5b5510aa508168a1d5dc9f617",
  "tattoos/flash/ap-flash-001/index.html": "d17c77f8f974dc11f90adc9b1087d18fb6e060e25405cbb06a4cf0a4785365bb",
  "tattoos/flash/ap-maze-001/index.html": "2e1bbe6e65e14ee5f733baf08cccfc4a91fd88711d90045210feaa8feae91f05",
  "tattoos/flash/ap-sairo-001/index.html": "55046510f28a4cd1a6761d0ba37c934f432179ba6cdd1ca0c181fa7725625329",
  "tattoos/flash/ap-standalone-001/index.html": "e4eb92219f6caf0b07e588c87921d20ca5e71a63223d26a7ea4a9d7602806b3f",
  "tattoos/flash/ap-standalone-archive-001/index.html": "ea0cdf32a4f784e17559a0179bcc0e06e09f47a1e32178105e1ab928abc513ed",
  "tattoos/flash/claim/index.html": "30d9594881ddac49e3d3890c66b106afbe2d2c8415b15e83b2fdaccda284654b",
  "tattoos/flash/detail/index.html": "00e39d142e0609c14a8c2f1e2627a55a62fc18da8e16e14b7b045f715c18dd2a",
  "tattoos/flash/index.html": "14240f03e6db18dbdc812d6abb0c4397df6de183838b6b87be6d824cebfc7578",
  "tattoos/flash/maze/index.html": "c64e277f52d32203d26dfcd3d10d323aabfc5907c2f8041f344caefb9c881674",
  "tattoos/index.html": "cce3d5529b7b14fddc369b8c78709c99215a910db91ec4209078c9802698580c",
  "tattoos/inquire/consultation/index.html": "7b9c15b091eff6e688b1c8e7bdf6414bb50cce27323edc0cc85d7299635e0536",
  "tattoos/inquire/custom/index.html": "786b8b31e21fe1518244735ca6a906637e4332aebf07ace1ceef30bec3714710",
  "tattoos/inquire/index.html": "8f17808a958f0e404334521a55794d1627259325ad9efd80e355fd7ea3f72979",
  "tattoos/location-parking/index.html": "b3b3d42d975c9af4e17831e11760758065cd30f6dbdfdb35d546be5014777447",
  "tattoos/policies/index.html": "0879869acd5b316b810cf2e49a4b14fabbfdf79f5c0da1857d8f9f1280f2f74a",
  "tattoos/portfolio/index.html": "e0916fd329f2f600fcb7695202e4ffecc14006f92165a8605306a9f7f6690ca2",
  "tattoos/special-projects/apply/index.html": "0bc3a84d2a696c2334f2b84a01072574dd504a2be99495d76f240cb7d0985529",
  "tattoos/special-projects/index.html": "a28751eb7304fd7ad5d6fa3f43d1c7eea69b9dd2899eb27dc3281eb2780d3c93",
  "tattoos/submission-received/index.html": "1132c913f018cf928883959bd940639bce379e0b5969bdba7e983f73a5041887",
};

function cleanText(value) {
  return value
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return match ? match[1] : "";
}

function inventory(html) {
  const body = (html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i) || ["", html])[1];
  return {
    title: (html.match(/<title>([\s\S]*?)<\/title>/i) || ["", ""])[1].trim(),
    text: cleanText(body),
    headings: [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
      .map((match) => [Number(match[1]), cleanText(match[2])]),
    links: [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({
        href: attribute(match[1], "href"),
        label: cleanText(match[2]),
        aria: attribute(match[1], "aria-label"),
      })),
    aria: [...body.matchAll(/\baria-label=["']([^"']*)["']/gi)].map((match) => match[1]),
    controls: [...body.matchAll(/<(input|select|textarea|button|form)\b([^>]*)>/gi)]
      .map((match) => ({
        tag: match[1].toLowerCase(),
        type: attribute(match[2], "type"),
        name: attribute(match[2], "name"),
        id: attribute(match[2], "id"),
        required: /\brequired\b/i.test(match[2]),
        action: attribute(match[2], "action"),
        method: attribute(match[2], "method"),
      })),
    scripts: [...body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .map((match) => ({
        src: attribute(match[1], "src"),
        body: match[2].replace(/\s+/g, " ").trim(),
      })),
  };
}

function hashInventory(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

test("Tattoo title normalization preserves content, controls, links, and runtime scripts", async () => {
  for (const [file, baseline] of Object.entries(PAGES)) {
    const html = await readFile(path.join(ROOT, file), "utf8");
    assert.equal(hashInventory(inventory(html)), baseline, `${file} operational inventory changed`);
  }
});

test("every public Tattoo title surface explicitly consumes the shared token foundation", async () => {
  for (const file of Object.keys(PAGES)) {
    const html = await readFile(path.join(ROOT, file), "utf8");
    const tokenIndex = html.indexOf("/css/tokens.css");
    const transitionIndex = html.indexOf("/css/transitions.css");

    assert.ok(tokenIndex >= 0, `${file} does not load tokens.css`);
    assert.ok(transitionIndex < 0 || tokenIndex < transitionIndex, `${file} must load tokens before transitions`);
    assert.match(html, /\/css\/hero\.css/, `${file} does not load the shared hero authority`);
    assert.match(html, /data-venture=["']tattooing["']/i, `${file} lost its Tattoo medium identity`);
    assert.match(html, /<h1\b/i, `${file} no longer exposes a top-level title`);
    assert.match(html, /\bsite-hero--supporting\b|\bsite-hero--landing\b/, `${file} lacks a hero variant`);
    assert.match(html, /\bhero-title\b/, `${file} lacks the shared hero title role`);
    assert.doesNotMatch(html, /--signal\s*:\s*#6E0404/i, `${file} duplicates the Tattoo signal`);
    assert.doesNotMatch(html, /--venture(?:-color)?\s*:\s*#6E0404/i, `${file} duplicates the Tattoo venture color`);
    assert.doesNotMatch(html, /--title-color\s*:\s*#6E0404/i, `${file} duplicates the Tattoo title color`);
  }

  const maze = await readFile(path.join(ROOT, "tattoos/build/maze/index.html"), "utf8");
  assert.doesNotMatch(maze, /\/css\/tokens\.css/, "Maze remains owned by its application bundle");
});

test("the shared hero layer makes the Tattoo node token authoritative for page titles", async () => {
  const [typography, hero] = await Promise.all([
    readFile(path.join(ROOT, "css/site-typography.css"), "utf8"),
    readFile(path.join(ROOT, "css/hero.css"), "utf8"),
  ]);

  assert.match(typography, /body\[data-venture="tattooing"\]\s*\{[\s\S]*--venture-color:\s*var\(--color-tattooing\)/);
  assert.match(typography, /--venture-accent:\s*var\(--color-tattooing\)/);
  assert.match(typography, /--type-hero-color:\s*var\(--color-tattooing\)/);
  assert.match(hero, /--hero-title-color:\s*var\([\s\S]*--type-hero-color/);
  assert.match(hero, /\.site-hero \.hero-title\s*\{[\s\S]*color:\s*var\(--hero-title-color\)\s*!important/);
});

test("managed navigation cannot override semantic top-level node colors", async () => {
  const [constructNav, home] = await Promise.all([
    readFile(path.join(ROOT, "js/construct-nav.js"), "utf8"),
    readFile(path.join(ROOT, "home/index.html"), "utf8"),
  ]);

  assert.doesNotMatch(constructNav, /venture\.color\s*=\s*node\.color/);
  assert.doesNotMatch(constructNav, /pathway\.color\s*\|\|\s*node\.color/);
  assert.match(constructNav, /color:\s*pathway\.color\s*\|\|\s*venture\.color/);
  assert.match(home, /const semanticColor=prior\.color\|\|slot\.color/);
  assert.match(home, /color:path\.color\|\|semanticColor/);
  assert.doesNotMatch(home, /color:node\.color\|\|prior\.color/);
});
