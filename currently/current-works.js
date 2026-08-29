(function () {
  const ambientRoot = document.querySelector("[data-current-works-eye-field]");
  const eyesCanvas = document.querySelector("[data-current-works-eyes]");
  if (ambientRoot && eyesCanvas && window.ConstructAmbientField) {
    window.ConstructAmbientField.mount({
      root: ambientRoot,
      eyesCanvas,
      eyeOpacity: 0.10,
      eyeTint: "#6D3D15",
      eyeMask: "radial-gradient(ellipse 58% 48% at 50% 42%, black 18%, rgba(0,0,0,0.62) 46%, transparent 86%)"
    });
  }

  const fallbackProjects = [
    { id:"current-project-academic-study",slug:"academic-study",category:"Academic Study",title:"Philosophy, Politics & Economics",contextLine:"Georgia State University · Ongoing",summary:"A present course of study bringing additional language, historical context, and analytical frameworks into the questions and systems already moving through the practice.",status:"Ongoing",accent:"about",links:[{label:"Academic context",url:"/about/saieldauhnsolehman/"}] },
    { id:"current-project-construct-archive",slug:"construct-archive",category:"Construct System",title:"The Six.Well Construct + Archive",contextLine:"Active",summary:"Building the public creative ecosystem and the record system that preserves its works, relationships, states, and origins.",items:[{title:"The Six.Well Construct",description:"The public-facing architecture connecting the practice’s mediums, projects, offerings, and pathways."},{title:"Archive",description:"The record system preserving works, relationships, states, origins, and the context that moves between them."}],status:"Active",accent:"archive",links:[{label:"The Construct",url:"/about/"},{label:"Archive",url:"/archive/"}] },
    { id:"current-project-thoughtpuppet",slug:"thoughtpuppet",category:"Visual Art",title:"ThoughtPuppet",contextLine:"In studio",summary:"Paintings, objects, studies, and visual-language research that feed the wider Construct.",status:"In studio",accent:"art",links:[{label:"View visual art",url:"/art/"}] },
    { id:"current-project-sixwell-clothing",slug:"sixwell-clothing",category:"Clothing + Objects",title:"Six.Well Clothing",contextLine:"In development",summary:"Garments, editions, and physical artifacts carrying Construct imagery and thought into the world.",status:"In development",accent:"merch",links:[{label:"View Six.Well Clothing",url:"/merch/?filter=six.well"}] },
    { id:"current-project-artpill",slug:"artpill-tattoo-house",category:"Tattoo Practice",title:"Participatory Tattoo Systems",contextLine:"Active · Maze Builder, Build Your Own + Special Projects",summary:"I’m developing three connected ways for tattoos to begin—through participant-led play, structured collaboration, and artist-led inquiry. Together, they explore how authorship, interpretation, trust, and personal meaning can move differently through the tattoo process. Maze Builder — An interactive drawing environment where participants create paths, symbols, and visual relationships that can become the foundation of a tattoo. I’m interested in what appears when play and intuition come before a fixed image. Build Your Own — A guided system for assembling references, meanings, placement, and visual ingredients into a collaborative tattoo brief. It gives people a clearer way into custom work while preserving interpretation as part of my practice. Special Projects — Artist-led tattoo inquiries organized around specific images, techniques, questions, or relationships to the body. These projects create space for experiments that cannot emerge through a conventional commission process.",items:[{title:"Maze Builder",description:"An interactive drawing environment where participants create paths, symbols, and visual relationships that can become the foundation of a tattoo."},{title:"Build Your Own",description:"A guided system for assembling references, meanings, placement, and visual ingredients into a collaborative tattoo brief."},{title:"Special Projects",description:"Artist-led tattoo inquiries organized around specific images, techniques, questions, or relationships to the body."}],status:"Active",accent:"tattooing",links:[{label:"Maze Builder",url:"/tattoos/build/maze/"},{label:"Build Your Own",url:"/tattoos/build/"},{label:"Special Projects",url:"/tattoos/special-projects/"}] },
    { id:"current-project-cultural-research",slug:"cultural-research-discovery",category:"Cultural Research + Discovery",title:"Signal & Symbol + Atlanta Creative Calendar",contextLine:"Active",summary:"Signal & Symbol develops cultural research through guided creative gatherings. The Atlanta Creative Calendar supports discovery and connection, while Night Planning shapes those discoveries into one chronological day/night itinerary.",items:[{title:"Signal & Symbol",description:"Develops cultural research through guided creative gatherings."},{title:"Atlanta Creative Calendar",description:"Supports discovery and connection across Atlanta art, film, poetry, music, technology, and experimental events."},{title:"Night Planning",description:"Builds one chronological day/night itinerary from standalone events and related programs, with Include and Must Attend choices."}],status:"Active",accent:"events",links:[{label:"Signal & Symbol",url:"/events/signal-symbol/"},{label:"Atlanta Creative Calendar",url:"/calendar/"}] },
    { id:"current-project-solehman-letters",slug:"solehman-letters",category:"Writing + Publishing",title:"The Solehman Letters + Mindful Darkness",contextLine:"Ongoing · Newsletter + writing platform",summary:"Two connected publishing spaces for letters, essays, studio notes, reflections, and discussion moving through the Construct.",items:[{title:"The Solehman Letters",description:"A direct publishing channel for letters, essays, studio notes, and reflections moving through the Construct."},{title:"Mindful Darkness",description:"A developing space for essays, reflections, and discussion around what emerges through the practice."}],status:"Ongoing",accent:"writings",links:[{label:"Read The Solehman Letters",url:"https://www.solehmanletters.com/"},{label:"Mindful Darkness",url:"/writings/#reading-paths"}] },
    { id:"current-project-events",slug:"solehmans-new-year-cult-shift",category:"Events",title:"Solehman’s New Year + CULT[&SHIFT]",contextLine:"Forthcoming",summary:"Solehman’s New Year is one four-day annual presentation of the ecosystem, anchored by the annual exhibition and extending through fashion, tattooing, conversation, tools, objects, and open-studio viewing. CULT[&SHIFT] holds community shows, performances, and shared experiments.",items:[{title:"Solehman’s New Year",description:"A four-day annual presentation of the ecosystem, anchored by the annual exhibition and extending through fashion, tattooing, conversation, tools, objects, and open-studio viewing."},{title:"CULT[&SHIFT]",description:"Holds community shows, performances, and shared experiments."}],status:"Forthcoming",accent:"events",links:[{label:"Solehman’s New Year",url:"/events/solehmans-new-year/"},{label:"CULT[&SHIFT]",url:"/events/cultandshift/"}] }
  ];
  const accentTokens = { about:"--color-about",art:"--color-art",merch:"--color-merch",tattooing:"--color-tattooing",events:"--color-events",writings:"--color-writings",archive:"--color-archive",film:"--color-film",music:"--color-music" };
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
  const safeUrl = (value) => { const url=String(value||""); return url.startsWith("/") || /^https:\/\//i.test(url) ? url : ""; };
  const constellation = document.querySelector("[data-current-projects]");
  const anchorImage = document.querySelector("[data-current-anchor-image]");
  const anchorCaption = document.querySelector(".current-constellation-photo figcaption");

  function projectLinks(project) {
    const links=Array.isArray(project.links)?[...project.links]:[];
    if (project.slug!=="thoughtpuppet") return links;
    const required=[
      {label:"Identity profile",url:"/about/identities/thoughtpuppet/",publicationGate:"thoughtpuppet"},
      {label:"Full Archive history",url:"/archive/timelines/thoughtpuppet/",publicationGate:"thoughtpuppet"}
    ];
    const seen=new Set(links.map((link)=>safeUrl(link?.url)).filter(Boolean));
    required.forEach((link)=>{if(!seen.has(link.url)){links.push(link);seen.add(link.url)}});
    return links;
  }

  function projectBodyMarkup(project) {
    const items=Array.isArray(project.items)?project.items.filter((item)=>String(item?.title||"").trim()&&String(item?.description||"").trim()).slice(0,6):[];
    if(!items.length)return `<p class="current-project-summary">${escape(project.summary)}</p>`;
    return `<ul class="current-project-items">${items.map((item)=>`<li><strong>${escape(item.title)}</strong><span>${escape(item.description)}</span></li>`).join("")}</ul>`;
  }

  function renderProjects(projects) {
    constellation.querySelectorAll(".current-project-node,.current-loading").forEach((element) => element.remove());
    constellation.insertAdjacentHTML("beforeend", projects.map((project,index) => {
      const links=projectLinks(project).map((link)=>{const url=safeUrl(link.url),gated=link.publicationGate==="thoughtpuppet";return url?`<a href="${escape(url)}"${gated?' data-thoughtpuppet-public-link hidden':""}>${escape(link.label)}</a>`:""}).join("");
      const token=accentTokens[project.accent]||accentTokens.about;
      return `<article class="current-project-node" id="current-project-${escape(project.slug)}" data-position="${index+1}" style="--project-accent:var(${token})">
        <div class="current-project-meta"><span>${escape(project.category)}</span><span class="current-project-status">${escape(project.status)}</span></div>
        <div><h3>${escape(project.title)}</h3><p class="current-project-context">${escape(project.contextLine)}</p>
        ${projectBodyMarkup(project)}</div>
        ${links?`<div class="current-project-links">${links}</div>`:""}</article>`;
    }).join(""));
  }

  function renderAnchor(projects,collage) {
    const candidates=Array.isArray(collage)?collage:[];
    const item=candidates.find((candidate)=>candidate.projectSlug==="artpill-tattoo-house")||candidates.find((candidate)=>Number(candidate.slot)===1);
    const src=safeUrl(item?.src);
    if (!src) return;
    const project=projects.find((candidate)=>candidate.slug===item.projectSlug);
    const focalX=Number(item.focal?.x),focalY=Number(item.focal?.y);
    anchorImage.src=src;
    anchorImage.alt=String(item.alt||"");
    anchorImage.style.setProperty("--anchor-focal-x",`${Number.isFinite(focalX)?focalX:50}%`);
    anchorImage.style.setProperty("--anchor-focal-y",`${Number.isFinite(focalY)?focalY:50}%`);
    if (project) anchorCaption.textContent=`${project.title} · ${project.status}`;
  }

  renderProjects(fallbackProjects);
  fetch("/api/current-projects", { headers:{accept:"application/json"}, cache:"no-store" })
    .then((response)=>{if(!response.ok)throw new Error("Current Works unavailable");return response.json();})
    .then((payload)=>{const projects=Array.isArray(payload.projects)&&payload.projects.length?payload.projects:fallbackProjects;renderProjects(projects);renderAnchor(projects,payload.collage);})
    .catch(()=>{});
})();
