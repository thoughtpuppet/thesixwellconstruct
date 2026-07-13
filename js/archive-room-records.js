(function () {
  const shell = document.querySelector(".venture-shell");
  const footer = shell?.querySelector(".footer");
  if (!shell || !footer) return;
  const room = location.pathname.split("/").filter(Boolean).pop() || "";
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const aliases = {
    "sixwell-construct": ["six-well", "sixwell", "construct", "milestone"],
    tattoos: ["tattoo", "flash", "art-pill"],
    art: ["painting", "art-work", "artwork", "visual-source"],
    events: ["event", "gathering"],
    merch: ["merch", "apparel", "object"],
    music: ["music", "audio", "sound"],
    writings: ["writing", "letter", "essay"],
    film: ["film", "video", "screening"],
    about: ["about", "person", "place"],
  };
  const terms = aliases[room] || [room];
  const matches = (record) => {
    const haystack = normalize([record.room, record.node_label, record.record_type].filter(Boolean).join(" "));
    return terms.some((term) => haystack.includes(normalize(term)));
  };

  fetch("/api/archive", { cache: "no-store", headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error();
      const payload = await response.json();
      const records = (payload.records || []).filter(matches);
      if (!records.length) return;
      const section = document.createElement("section");
      section.className = "section managed-room-records";
      const header = document.createElement("header");
      header.className = "section-head";
      header.innerHTML = '<div><span class="section-kicker">published from Studio</span><h2 class="section-title">Current records</h2></div><p class="section-copy">This room updates directly from the managed Archive.</p>';
      const list = document.createElement("div");
      list.className = "timeline";
      records.forEach((record) => {
        const article = document.createElement("article");
        article.className = "timeline-item";
        const date = document.createElement("span");
        date.className = "timeline-date";
        date.textContent = record.date_or_period || record.record_status || "record";
        const copy = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = record.title;
        const summary = document.createElement("p");
        summary.textContent = record.summary || record.why_it_matters || "";
        copy.append(title, summary);
        article.append(date, copy);
        list.appendChild(article);
      });
      section.append(header, list);
      shell.insertBefore(section, footer);
    })
    .catch(() => {
      // The room's bundled editorial framing remains available during an outage.
    });
})();
