// Upgrade only the old bundled/cached Writing pathways; preserve Studio edits.
export function normalizeWritingPathways(pathways = []) {
  const legacy = pathways.some(path => path.route === "/writings/#reading-paths" || (path.name === "essays & notes" && path.route === "/writings/#featured"));
  const normalized = pathways.map(path => {
    if (path.route === "/writings/#reading-paths") return {...path,name:"Mindful Darkness",route:"/writings/mindful-darkness/"};
    if (path.name === "essays & notes" && path.route === "/writings/#featured") return {...path,name:"WRKNG*",route:"/writings/mindful-darkness/wrkng/"};
    if (path.name === "THE SOLEHMAN LETTERS" && /^https:\/\/(?:www\.)?thesolehmanletters\.com\/?$/.test(path.route)) return {...path,route:"https://www.solehmanletters.com/"};
    return {...path};
  });
  const order = {"Mindful Darkness":1,"WRKNG*":2,"THE SOLEHMAN LETTERS":3};
  return legacy ? normalized.sort((a,b)=>(order[a.name]||4)-(order[b.name]||4)) : normalized;
}
