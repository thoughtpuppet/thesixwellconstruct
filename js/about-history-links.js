(async function () {
  "use strict";

  const identities = [...document.querySelectorAll("[data-identity-history]")];
  if (!identities.length) return;
  const key = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  try {
    const response = await fetch("/api/archive/timelines", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    const payload = await response.json();
    const records = Array.isArray(payload.records) ? payload.records : payload.timelines;
    if (!Array.isArray(records)) return;

    await Promise.all(identities.map(async (identity) => {
      const name = identity.dataset.identityHistory;
      const record = records.find((item) =>
        [item.title, item.name, item.slug].some((value) => value && key(value) === key(name))
      );
      if (!record) return;
      const route = record.canonical_route || record.canonicalRoute || record.route;
      if (!/^\/archive\/timelines\/[a-z0-9-]+\/$/.test(route || "")) return;
      try {
        const visibility = await fetch("/api/site/visibility?path=" + encodeURIComponent(route), {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!visibility.ok) return;
        const decision = await visibility.json();
        if (decision.visibility !== "public" || decision.hidden !== false) return;
        const container = identity.querySelector(".identity-history");
        if (!container) return;
        const link = document.createElement("a");
        link.href = route;
        link.textContent = "Explore the Archive timeline";
        link.setAttribute("aria-label", `Explore the ${name} Archive timeline`);
        container.replaceChildren(link);
      } catch {
        // The identity remains readable when its history cannot be confirmed.
      }
    }));
  } catch {
    // A catalog outage does not replace the identity introductions with errors.
  }
})();
