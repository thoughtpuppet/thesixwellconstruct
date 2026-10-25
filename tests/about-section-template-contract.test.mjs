import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = [
  "six-well",
];

const BASELINE_HASHES = {
  "six-well": "5d4945896075558a5fa411da09e3f54ddd1148c381c8c44f4775b9013b96b4c7",
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
      assert.match(html, /<h1 class="hero-title"[^>]*>/);
      assert.match(html, /<p class="section-intro hero-descriptor"[^>]*>/);
      assert.match(html, /<h2 class="band-title section-title"[^>]*>/);
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
