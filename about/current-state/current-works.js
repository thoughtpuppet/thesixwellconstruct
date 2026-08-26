(function () {
  const fallbackProjects = [
    { id:"current-project-academic-study",slug:"academic-study",category:"Academic Study",title:"Philosophy, Politics & Economics",contextLine:"Georgia State University · Ongoing",summary:"A present course of study bringing additional language, historical context, and analytical frameworks into the questions and systems already moving through the practice.",status:"Ongoing",accent:"about",links:[{label:"Academic context",url:"/about/saieldauhnsolehman/"}] },
    { id:"current-project-construct-archive",slug:"construct-archive",category:"Construct System",title:"The Six.Well Construct + Archive",contextLine:"Active",summary:"Building the public creative ecosystem and the record system that preserves its works, relationships, states, and origins.",status:"Active",accent:"archive",links:[{label:"The Construct",url:"/about/"},{label:"Archive",url:"/archive/"}] },
    { id:"current-project-thoughtpuppet",slug:"thoughtpuppet",category:"Visual Art",title:"ThoughtPuppet",contextLine:"In studio",summary:"Paintings, objects, studies, and visual-language research that feed the wider Construct.",status:"In studio",accent:"art",links:[{label:"View visual art",url:"/art/"}] },
    { id:"current-project-sixwell-clothing",slug:"sixwell-clothing",category:"Clothing + Objects",title:"Six.Well Clothing",contextLine:"In development",summary:"Garments, editions, and physical artifacts carrying Construct imagery and thought into the world.",status:"In development",accent:"merch",links:[{label:"View Six.Well Clothing",url:"/merch/?filter=six.well"}] },
    { id:"current-project-artpill",slug:"artpill-tattoo-house",category:"Tattoo Practice",title:"Art.Pill Tattoo House",contextLine:"Active",summary:"Tattooing, symbolic mark-making, flash, and special projects rooted in care, boundaries, and interpretation.",status:"Active",accent:"tattooing",links:[{label:"Tattoo practice",url:"/tattoos/"},{label:"Special projects",url:"/tattoos/special-projects/"}] },
    { id:"current-project-cultural-research",slug:"cultural-research-discovery",category:"Cultural Research + Discovery",title:"Signal & Symbol + Atlanta Creative Calendar",contextLine:"Active",summary:"Signal & Symbol develops cultural research through guided creative gatherings. The Atlanta Creative Calendar supports discovery and connection through day/night itinerary planning. Mindful Darkness remains the potential platform for writing and discussion around what emerges.",status:"Active",accent:"events",links:[{label:"Signal & Symbol",url:"/events/signal-symbol/"},{label:"Atlanta Creative Calendar",url:"/calendar/"},{label:"Mindful Darkness",url:"/writings/#reading-paths"}] },
    { id:"current-project-events",slug:"solehmans-new-year-cult-shift",category:"Events",title:"Solehman’s New Year + CULT[&SHIFT]",contextLine:"Forthcoming",summary:"Solehman’s New Year is one four-day annual presentation of the ecosystem, anchored by the annual exhibition and extending through fashion, tattooing, conversation, tools, objects, and open-studio viewing. CULT[&SHIFT] holds community shows, performances, and shared experiments.",status:"Forthcoming",accent:"events",links:[{label:"Solehman’s New Year",url:"/events/solehmans-new-year/"},{label:"CULT[&SHIFT]",url:"/events/cultandshift/"}] }
  ];
  const accentTokens = { about:"--color-about",art:"--color-art",merch:"--color-merch",tattooing:"--color-tattooing",events:"--color-events",writings:"--color-writings",archive:"--color-archive",film:"--color-film",music:"--color-music" };
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
  const safeUrl = (value) => { const url=String(value||""); return url.startsWith("/") || /^https:\/\//i.test(url) ? url : ""; };
  const projectGrid = document.querySelector("[data-current-projects]");
  const mosaic = document.querySelector("[data-current-mosaic]");

  function renderProjects(projects) {
    projectGrid.innerHTML = projects.map((project) => {
      const links=(project.links||[]).map((link)=>{const url=safeUrl(link.url);return url?`<a href="${escape(url)}">${escape(link.label)}</a>`:""}).join("");
      const token=accentTokens[project.accent]||accentTokens.about;
      return `<article class="current-project-card" id="current-project-${escape(project.slug)}" style="--project-accent:var(${token})">
        <div class="current-project-meta"><span>${escape(project.category)}</span><span class="current-project-status">${escape(project.status)}</span></div>
        <h3>${escape(project.title)}</h3><p class="current-project-context">${escape(project.contextLine)}</p>
        <p class="current-project-summary">${escape(project.summary)}</p>
        ${links?`<div class="current-project-links">${links}</div>`:""}</article>`;
    }).join("");
  }

  function renderMosaic(collage) {
    const bySlot=new Map((collage||[]).map((item)=>[Number(item.slot),item]));
    if ([1,2,3,4,5].some((slot)=>!bySlot.has(slot))) return;
    const tiles=[1,2,3,4,5].map((slot)=>{const item=bySlot.get(slot),x=Number(item.focal?.x),y=Number(item.focal?.y);return `<a class="current-mosaic-tile" data-slot="${slot}" href="#current-project-${escape(item.projectSlug)}" style="--focal-x:${Number.isFinite(x)?x:50}%;--focal-y:${Number.isFinite(y)?y:50}%"><img src="${escape(item.src)}" alt="${escape(item.alt)}"><span class="current-mosaic-label">${escape(item.projectTitle)}</span></a>`;}).join("");
    mosaic.insertAdjacentHTML("afterbegin",tiles);
    mosaic.classList.remove("is-awaiting-media"); mosaic.classList.add("is-ready");
  }

  renderProjects(fallbackProjects);
  fetch("/api/current-projects", { headers:{accept:"application/json"}, cache:"no-store" })
    .then((response)=>{if(!response.ok)throw new Error("Current Works unavailable");return response.json();})
    .then((payload)=>{if(Array.isArray(payload.projects)&&payload.projects.length)renderProjects(payload.projects);renderMosaic(payload.collage);})
    .catch(()=>{});
})();
