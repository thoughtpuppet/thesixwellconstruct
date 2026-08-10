import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINES = {
  "merch/index.html": "daeb288eaf41a42974ff18d6d2aed52d57e9be7b37427596489d90835992c8a0",
  "events/index.html": "595ba76b18b2ed5fbedc523b5e7ed42a40b2bd9db5fdf9b3453cc92efe82ae70",
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

async function page(file) {
  return readFile(path.join(ROOT, file), "utf8");
}

if (process.env.LANDING_INVENTORY_PRINT === "1") {
  for (const file of Object.keys(BASELINES)) {
    console.log(file, hashInventory(inventory(await page(file))));
  }
} else {
  test("Merch and Events preserve current content, controls, links, and runtime scripts", async () => {
    for (const [file, baseline] of Object.entries(BASELINES)) {
      assert.equal(hashInventory(inventory(await page(file))), baseline, `${file} operational inventory changed`);
    }
  });

  test("all four production variants identify and load the Landing Family contract", async () => {
    const variants = {
      "art/index.html": "art-catalog",
      "tattoos/index.html": "tattoo-service",
      "merch/index.html": "merch-commerce",
      "events/index.html": "events-program",
    };

    for (const [file, variant] of Object.entries(variants)) {
      const html = await page(file);
      const tokenIndex = html.indexOf('href="/css/tokens.css');
      const familyIndex = html.indexOf('href="/css/landing-family.css');
      const typographyIndex = html.indexOf('href="/css/site-typography.css');
      const heroIndex = html.indexOf('href="/css/hero.css');

      assert.ok(tokenIndex >= 0, `${file} does not load tokens.css`);
      assert.ok(familyIndex > tokenIndex, `${file} does not load Landing Family CSS after tokens`);
      assert.ok(typographyIndex > familyIndex, `${file} must keep site typography after Landing Family CSS`);
      assert.ok(heroIndex > typographyIndex, `${file} must load hero.css after site typography`);
      assert.match(html, new RegExp(`data-landing-family=["']${variant}["']`), `${file} lost ${variant} identity`);
      assert.match(html, /\blanding-hero\b/, `${file} does not expose the shared landing hero region`);
      assert.match(html, /\bhero-title\b|\bventure-title\b/, `${file} does not expose the hero title role`);
      assert.match(html, /\bhero-descriptor\b|\bhero-lede\b/, `${file} does not expose the descriptor role`);
    }
  });

  test("Landing Family CSS owns semantic variants and canonical responsive foundations", async () => {
    const css = await page("css/landing-family.css");

    for (const [variant, token] of [
      ["art-catalog", "art"],
      ["tattoo-service", "tattooing"],
      ["merch-commerce", "merch"],
      ["events-program", "events"],
    ]) {
      assert.match(
        css,
        new RegExp(`data-landing-family="${variant}"[\\s\\S]*--venture-color:\\s*var\\(--color-${token}\\)`),
        `${variant} is not wired to --color-${token}`,
      );
    }

    for (const width of ["900", "700", "380"]) {
      assert.match(css, new RegExp(`@media \\(max-width: ${width}px\\)`));
    }
    assert.match(css, /--landing-structural-rule:\s*5px/);
    assert.match(css, /--landing-control-min-height-active:\s*var\(--control-min-height\)/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
  });

  test("Merch title authority resolves through the shared Merch token", async () => {
    const [html, familyCss, heroCss, storefront] = await Promise.all([
      page("merch/index.html"),
      page("css/landing-family.css"),
      page("css/hero.css"),
      page("js/shop-storefront.js"),
    ]);
    assert.match(html, /--venture-color:\s*var\(--color-merch\)/);
    assert.match(html, /--venture-accent:\s*var\(--color-merch\)/);
    assert.match(familyCss, /data-landing-family="merch-commerce"[\s\S]*--type-hero-color:\s*var\(--color-merch\)/);
    assert.match(heroCss, /color:\s*var\(--hero-title-color\)\s*!important/);
    assert.match(storefront, /setProperty\("--hero-title-color",\s*color\)/);
    assert.doesNotMatch(`${html}\n${storefront}`, /--title-color/);
  });
}
