(function () {
  "use strict";

  const profileRoute = "/about/identities/thoughtpuppet/";
  const selector = "[data-thoughtpuppet-public-links], [data-thoughtpuppet-public-link]";
  let published = false;

  function synchronize(root = document) {
    root.querySelectorAll(selector).forEach((element) => {
      element.hidden = !published;
      if (published) {
        element.style.removeProperty("display");
        element.dataset.publicationConfirmed = "true";
      } else {
        element.style.setProperty("display", "none", "important");
        delete element.dataset.publicationConfirmed;
      }
    });
  }

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.addedNodes.length)) return;
    synchronize();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  synchronize();

  fetch("/api/identities", {
    cache: "no-store",
    headers: { accept: "application/json" },
  }).then(async (response) => {
    if (!response.ok) throw new Error("Creative identities unavailable.");
    const payload = await response.json();
    const records = Array.isArray(payload.records)
      ? payload.records
      : (Array.isArray(payload.identities) ? payload.identities : []);
    published = records.some((record) =>
      String(record?.slug || "") === "thoughtpuppet" &&
      String(record?.canonical_route || record?.canonicalRoute || "") === profileRoute
    );
    synchronize();
  }).catch(() => {
    published = false;
    synchronize();
  });
})();
