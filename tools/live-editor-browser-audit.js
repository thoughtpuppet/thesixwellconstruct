async (page) => {
  const initialUrl = page.url();
  const requestedSection = decodeURIComponent((initialUrl.match(/[?&]auditSection=([^&]+)/) || ["", "all"])[1]);
  const origin = (initialUrl.match(/^(https?:\/\/[^/]+)/) || ["", ""])[1];
  const inventoryResponse = await page.request.post(`${origin}/__tools/live-editor/pages`, { data: {} });
  if (!inventoryResponse.ok()) throw new Error(`Coverage inventory failed with ${inventoryResponse.status()}.`);
  const inventory = await inventoryResponse.json();
  const primarySections = ["about", "archive", "tattoos"];
  const pages = inventory.pages.filter((entry) => {
    if (entry.browserAudit === false || entry.relativePath === "writings/mindful-darkness/wrkng/detail/index.html") return false;
    const section = entry.relativePath.split("/")[0];
    if (requestedSection === "all") return true;
    if (requestedSection === "other") return !primarySections.includes(section);
    return section === requestedSection;
  });
  const results = [];

  for (const entry of pages) {
    const url = `${origin}${entry.pathname}?edit=1`;
    let navigationError = "";
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
      await page.waitForTimeout(180);
    } catch (error) {
      navigationError = error.message || String(error);
    }
    const rendered = await page.evaluate(() => {
      const status = document.querySelector("#live-text-status")?.textContent?.trim() || "";
      return {
        finalPathname: window.location.pathname,
        title: document.title,
        status,
        total: document.querySelectorAll("[data-live-edit-id]").length,
        saveable: document.querySelectorAll('[data-live-edit-applyable="true"]').length,
        preview: document.querySelectorAll('[data-live-edit-target="preview"]').length,
        managed: document.querySelectorAll('[data-live-edit-target="managed"]').length,
        explicitPreview: [...document.querySelectorAll('[data-live-edit-target="preview"]')].filter((element) => element.closest('[data-live-edit-owner="preview"]')).length,
        anonymousPreview: [...document.querySelectorAll('[data-live-edit-target="preview"]')].filter((element) => !element.closest('[data-live-edit-owner="preview"]')).length,
        anonymousPreviewSamples: [...document.querySelectorAll('[data-live-edit-target="preview"]')]
          .filter((element) => !element.closest('[data-live-edit-owner="preview"]'))
          .slice(0, 8)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            id: element.id,
            className: typeof element.className === "string" ? element.className : "",
            text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
          })),
        editorDisabled: document.body?.getAttribute("data-live-text-editor") === "off",
        duplicateRuntimeIds: (() => {
          const ids = [...document.querySelectorAll("[data-live-edit-id]")].map((element) => element.getAttribute("data-live-edit-id"));
          return [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))];
        })(),
      };
    });
    results.push({ ...entry, ...rendered, navigationError });
  }

  const summary = {
    requestedSection,
    pages: results.length,
    zeroSaveable: results.filter((entry) => entry.finalPathname === entry.pathname && !entry.editorDisabled && entry.saveable === 0 && entry.managed === 0 && entry.explicitPreview === 0).map((entry) => entry.relativePath),
    duplicateRuntimeIds: results.filter((entry) => entry.duplicateRuntimeIds.length).map((entry) => ({ path:entry.relativePath, ids:entry.duplicateRuntimeIds })),
    navigationErrors: results.filter((entry) => entry.navigationError).map((entry) => ({ path:entry.relativePath, error:entry.navigationError })),
    redirected: results.filter((entry) => entry.finalPathname !== entry.pathname).map((entry) => ({ path:entry.relativePath, finalPathname:entry.finalPathname })),
    lowCoverage: results.filter((entry) => entry.total > 0 && entry.saveable / entry.total < 0.5).map((entry) => ({ path:entry.relativePath, saveable:entry.saveable, total:entry.total, preview:entry.preview, managed:entry.managed })),
    unclassifiedPreview: results.filter((entry) => entry.anonymousPreview > 10).map((entry) => ({ path:entry.relativePath, anonymousPreview:entry.anonymousPreview, explicitPreview:entry.explicitPreview, managed:entry.managed, samples:entry.anonymousPreviewSamples })),
  };
  return { summary };
}
