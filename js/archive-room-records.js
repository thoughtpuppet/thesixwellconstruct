(function () {
  "use strict";

  const room = location.pathname.split("/").filter(Boolean).pop() || "";
  const presets = {
    about: ["person", "saiel-dauhn-solehman"],
    art: ["medium", "art"],
    events: ["medium", "events"],
    film: ["medium", "film"],
    merch: ["medium", "merch"],
    music: ["medium", "music"],
    "sixwell-construct": ["q", "Six.Well Construct"],
    tattoos: ["medium", "tattoo"],
    writings: ["medium", "writings"],
  };
  const preset = presets[room];
  if (!preset) return;

  const target = new URL("/archive/", location.origin);
  const incoming = new URL(location.href).searchParams;
  incoming.forEach((value, key) => target.searchParams.set(key, value));
  if (!target.searchParams.has(preset[0])) target.searchParams.set(preset[0], preset[1]);
  target.hash = "records";
  location.replace(`${target.pathname}${target.search}${target.hash}`);
})();
