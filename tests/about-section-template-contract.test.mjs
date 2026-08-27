import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = [
  "breakdown",
  "contact-press",
  "founder",
  "mediums",
  "six-well",
  "visual-language",
  "ways-in",
];

const BASELINE_HASHES = {
  "breakdown": "97d2c2bc2a33a6111ae8f4f46758bbf11f2c6f18a06c5c1551a5730958603e3a",
  "contact-press": "cd18abae7c031385f5c42203b37505298bb009d4f280df9b1e2f56190902b875",
  "founder": "252580e269fc64f7216e1547f79caacdc8cd9a0ba506fc7557e3999e2530d6cd",
  "mediums": "918f240d75785649fff9b314412f78739afc59a1250c6b302093a38e09bc42e4",
  "six-well": "879c7da538c716089067dd0c668d3765294fcd1b56cb25de63e348c49d97a90b",
  "visual-language": "422aa04f42ed1f5110a0f7851be30f5757e78ea47016d150a3215062e93b4a0e",
  "ways-in": "097a93e6f048f0542a173222d2f0090a22cd5ba51543101d6bcb69c1bc5effb9",
};

function cleanText(value) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
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
    ariaLabels: [...body.matchAll(/\baria-label="([^"]*)"/gi)].map((match) => match[1]),
    scripts: [...body.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((match) => match[1]),
  };
}

function hashInventory(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readPage(page) {
  return readFile(path.join(ROOT, "about", page, "index.html"), "utf8");
}

if (process.env.ABOUT_INVENTORY_PRINT === "1") {
  for (const page of PAGES) {
    const html = await readPage(page);
    const value = inventory(html);
    console.log(page, hashInventory(value), value.headings.length, value.links.length, value.scripts.length);
  }
} else {
  test("About section pages preserve their content, links, labels, and scripts", async () => {
    for (const page of PAGES) {
      const html = await readPage(page);
      assert.equal(hashInventory(inventory(html)), BASELINE_HASHES[page], `${page} inventory changed`);
    }
  });

  test("About section pages load the shared foundation and canonical role classes", async () => {
    for (const page of PAGES) {
      const html = await readPage(page);
      const tokenIndex = html.indexOf("/css/tokens.css");
      const transitionIndex = html.indexOf("/css/transitions.css");
      const familyIndex = html.indexOf("/about/section-page.css");
      const mobileIndex = html.indexOf("/css/mobile.css");
      const typographyIndex = html.indexOf("/css/site-typography.css");

      assert.ok(tokenIndex >= 0, `${page} does not load tokens.css`);
      assert.ok(tokenIndex < transitionIndex, `${page} must load tokens before transitions`);
      assert.ok(transitionIndex < familyIndex, `${page} must load family CSS after transitions`);
      assert.ok(familyIndex < mobileIndex, `${page} must load mobile.css after family CSS`);
      assert.ok(mobileIndex < typographyIndex, `${page} must load typography last`);
      assert.match(html, /<h1 class="hero-title">/);
      assert.match(html, /<p class="section-intro hero-descriptor">/);
      assert.match(html, /<h2 class="band-title section-title">/);
      assert.doesNotMatch(html, /<style\b/i, `${page} must not add page-local CSS`);
    }
  });

  test("About family CSS consumes Guide tokens at the canonical breakpoints", async () => {
    const css = await readFile(path.join(ROOT, "about", "section-page.css"), "utf8");
    const typography = await readFile(path.join(ROOT, "css", "site-typography.css"), "utf8");
    const contractCss = `${css}\n${typography}`;

    for (const token of [
      "--color-bg",
      "--color-about",
      "--type-hero-size",
      "--type-section-size",
      "--type-descriptor",
      "--type-eyebrow",
      "--type-control",
      "--type-footer",
      "--type-meta",
      "--page-padding",
      "--section-gap",
      "--grid-gap",
      "--control-min-height",
    ]) {
      assert.match(contractCss, new RegExp(token), `missing ${token} token family`);
    }

    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /@media \(max-width: 700px\)/);
    assert.match(css, /@media \(max-width: 380px\)/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /border-top:\s*5px/);
    assert.doesNotMatch(css, /@media \(max-width: 820px\)/);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
    assert.doesNotMatch(css, /\brgba?\(/i);
  });
}
