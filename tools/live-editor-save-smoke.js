async (page) => {
  const cases = {
    "/about/founder/": "[data-copy-id='live-about-founder-h1-1']",
    "/tattoos/aftercare/": "[data-copy-id='live-tattoos-aftercare-h1-1']",
  };
  const origin = (page.url().match(/^(https?:\/\/[^/]+)/) || ["", ""])[1];
  const pathname = (page.url().match(/^https?:\/\/[^/]+([^?#]*)/) || ["", "/"])[1];
  const selector = cases[pathname];
  if (!selector) throw new Error(`No live-editor smoke target is configured for ${pathname}.`);

  const beforeHistoryResponse = await page.request.post(`${origin}/__tools/live-editor/history`, { data: { pathname } });
  const beforeHistory = await beforeHistoryResponse.json();
  const beforeContextResponse = await page.request.post(`${origin}/__tools/live-editor/context`, { data: { pathname } });
  const beforeContext = await beforeContextResponse.json();

  const target = page.locator(selector);
  await target.waitFor({ state: "visible" });
  const originalHtml = await target.innerHTML();
  await target.evaluate((element) => {
    element.innerHTML += " [live editor smoke]";
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: " [live editor smoke]" }));
  });
  await page.waitForFunction(() => document.querySelector("#live-text-editor-status")?.textContent?.includes("Draft saved"));

  await page.locator("#live-text-apply-source").click();
  await page.waitForFunction(() => document.querySelector("#live-text-editor-status")?.textContent?.includes("Applied 1 change"), null, { timeout: 10000 });
  const appliedStatus = await page.locator("#live-text-editor-status").textContent();
  const appliedContextResponse = await page.request.post(`${origin}/__tools/live-editor/context`, { data: { pathname } });
  const appliedContext = await appliedContextResponse.json();
  if (appliedContext.page.hash === beforeContext.page.hash) throw new Error("The source hash did not change after Apply.");

  await Promise.all([
    page.waitForEvent("framenavigated", { timeout: 10000 }),
    page.locator("#live-text-undo-source").click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
  await target.waitFor({ state: "visible" });
  const restoredHtml = await target.innerHTML();
  const restoredContextResponse = await page.request.post(`${origin}/__tools/live-editor/context`, { data: { pathname } });
  const restoredContext = await restoredContextResponse.json();
  if (restoredHtml !== originalHtml) throw new Error("Undo did not restore the rendered copy.");
  if (restoredContext.page.hash !== beforeContext.page.hash) throw new Error("Undo did not restore the original source hash.");

  const afterHistoryResponse = await page.request.post(`${origin}/__tools/live-editor/history`, { data: { pathname } });
  const afterHistory = await afterHistoryResponse.json();
  const beforeIds = new Set((beforeHistory.revisions || []).map((revision) => revision.id));
  return {
    pathname,
    selector,
    appliedStatus,
    restored: true,
    newRevisionIds: (afterHistory.revisions || []).map((revision) => revision.id).filter((id) => !beforeIds.has(id)),
  };
}
