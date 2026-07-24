import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART_PAGE = path.join(ROOT, "art", "index.html");
const BASELINE_HASH = "d1eebf3433366394c861a8d5ee8b464c9b86c15f3043b74244073eb925c0abcb";

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

const html = await readFile(ART_PAGE, "utf8");

if (process.env.ART_INVENTORY_PRINT === "1") {
  console.log(hashInventory(inventory(html)));
} else {
  test("Art catalog landing preserves current content, controls, links, and runtime scripts", () => {
    assert.equal(hashInventory(inventory(html)), BASELINE_HASH);
  });

  test("Art catalog landing adopts the shared Landing Family foundation", async () => {
    const [familyCss, mobileCss] = await Promise.all([
      readFile(path.join(ROOT, "css", "landing-family.css"), "utf8"),
      readFile(path.join(ROOT, "css", "mobile.css"), "utf8"),
    ]);
    const tokenIndex = html.indexOf('href="/css/tokens.css"');
    const transitionIndex = html.indexOf('href="/css/transitions.css"');
    const familyIndex = html.indexOf('href="/css/landing-family.css"');
    const mobileIndex = html.indexOf('href="/css/mobile.css"');
    const typographyIndex = html.indexOf('href="/css/site-typography.css"');

    assert.ok(tokenIndex >= 0, "Art landing does not load tokens.css");
    assert.ok(tokenIndex < transitionIndex, "tokens.css must load before transitions.css");
    assert.ok(transitionIndex < familyIndex, "Landing Family CSS must load after transitions.css");
    assert.ok(familyIndex < mobileIndex, "mobile.css must load after Landing Family CSS");
    assert.ok(mobileIndex < typographyIndex, "site typography must remain the last shared layer");
    assert.match(html, /<body[^>]*data-venture=["']art["'][^>]*data-landing-family=["']art-catalog["']/i);
    assert.match(html, /<section class=["'][^"']*\blanding-hero\b[^"']*\bintro\b/i);
    assert.match(html, /<h1[^>]*class=["'][^"']*\bhero-title\b/i);
    assert.match(html, /<p[^>]*class=["'][^"']*\bhero-descriptor\b/i);

    for (const token of [
      "--color-bg",
      "--color-art",
      "--type-hero",
      "--type-descriptor",
      "--type-control",
      "--type-footer",
      "--type-meta",
      "--page-padding",
      "--section-gap",
      "--grid-gap",
      "--control-min-height",
    ]) {
      assert.match(`${html}\n${familyCss}`, new RegExp(token), `missing ${token} token family`);
    }

    assert.match(familyCss, /@media \(max-width: 900px\)/);
    assert.match(familyCss, /@media \(max-width: 700px\)/);
    assert.match(familyCss, /@media \(max-width: 380px\)/);
    assert.match(familyCss, /prefers-reduced-motion:\s*reduce/);
    assert.match(familyCss, /--landing-structural-rule:\s*5px/);
    assert.match(mobileCss, /\.filter-row \.chip\s*\{[\s\S]*min-height:\s*var\(--control-min-height,\s*44px\)/);
  });

  test("Art catalog title color and filter state resolve through the Art semantic token", () => {
    assert.match(html, /--venture-color:\s*var\(--color-art\)/);
    assert.match(html, /--venture-accent:\s*var\(--color-art\)/);
    assert.match(html, /--title-color:\s*var\(--color-art\)/);
    assert.doesNotMatch(html, /--title-color\s*:\s*#(?:0039BD|0071EB)/i);
    assert.doesNotMatch(html, /--accent-hot\s*:\s*#(?:0039BD|0071EB)/i);
  });
}
