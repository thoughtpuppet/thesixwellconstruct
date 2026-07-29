(function () {
  "use strict";

  var PUBLIC_TEMPLATES = [
    { id: "venture-landing", label: "Standard venture landing", family: "Landing Family", variant: "Standard venture", kind: "landing", accent: "about", routes: [], sources: ["css/venture-pages.css"], adoption: "Shared-shell specimen · reference route not linked", variantRegions: ["Descriptive sections", "Pathway cards", "Related routes"], description: "Shared landing foundation for a medium or venture whose page is primarily descriptive rather than operational." },
    { id: "information-page", label: "Information / editorial", kind: "editorial", accent: "about", route: "/about/mediums/", sources: ["about/mediums/index.html", "about/section-page.css"], adoption: "Foundation adopted · centered composition retained", description: "Reading-led information page with a bounded hero, section rhythm, disclosures, and related paths." },
    { id: "artwork-catalog", label: "Art catalog landing", family: "Landing Family", variant: "Art catalog", kind: "catalog", accent: "art", route: "/art/", routes: ["/art/"], sources: ["art/index.html", "css/landing-family.css", "css/portfolio-cards.css"], adoption: "Shared foundation adopted · catalog composition retained", variantRegions: ["Artwork gallery", "Catalog filters", "Availability", "Acquisition path"], description: "Art entry with filtering, artwork records, availability, and an acquisition path." },
    { id: "artwork-detail", label: "Artwork detail", kind: "detail", accent: "art", route: "/art/lostmarblespainting", sources: ["art/lostmarblespainting.html"], description: "Artwork media, title, material metadata, availability, inquiry action, archive thread, and related work." },
    { id: "artwork-inquiry", label: "Acquisition inquiry", kind: "form", accent: "art", route: "/art/acquisitioninquiry", sources: ["art/acquisitioninquiry.html"], description: "Focused artwork inquiry form with contact, work selection, validation, consent, and explicit status." },
    { id: "merch-catalog", label: "Merch commerce landing", family: "Landing Family", variant: "Merch commerce", kind: "commerce-catalog", accent: "merch", route: "/merch/", routes: ["/merch/"], sources: ["merch/index.html", "css/landing-family.css"], adoption: "Shared foundation adopted · commerce composition retained", variantRegions: ["Product catalog", "Inventory", "Variants", "Cart entry"], description: "Commerce entry with product filters, source labels, inventory states, cart entry, and checkout feedback." },
    { id: "merch-product", label: "Merch product detail", kind: "commerce-detail", accent: "merch", route: "/merch/lostmarbles-hoodie", sources: ["merch/lostmarbles-hoodie.html"], description: "Product gallery, price, edition, size/variant selection, availability, purchase action, and origin record." },
    { id: "tattoo-landing", label: "Tattoo service landing", family: "Landing Family", variant: "Tattoo service", kind: "landing", accent: "tattooing", route: "/tattoos/", routes: ["/tattoos/"], sources: ["tattoos/index.html", "css/tattoos.css", "css/landing-family.css"], adoption: "Shared foundation adopted · service composition retained", variantRegions: ["Live walk-in windows", "Collaboration paths", "Booking process", "Rates and policies"], description: "Tattoo service entry with live availability, portfolio, collaboration pathways, booking process, policies, and chooser actions." },
    { id: "tattoo-portfolio", label: "Tattoo portfolio item", kind: "portfolio", accent: "tattooing", route: "/tattoos/portfolio/", sources: ["tattoos/portfolio/index.html", "css/portfolio-cards.css", "css/portfolio-detail.css"], description: "Portfolio grid and item detail with image roles, placement, style, healed/fresh context, and inquiry path." },
    { id: "flash-catalog", label: "Flash catalog", kind: "catalog", accent: "tattooing", route: "/tattoos/flash/", sources: ["tattoos/flash/index.html"], description: "Multi-filter flash catalog with sheet/design grouping, availability, session fit, and claim path." },
    { id: "flash-detail", label: "Flash detail", kind: "detail", accent: "tattooing", route: "/tattoos/flash/:slug/", sources: ["tattoos/flash/detail/index.html"], description: "API-backed flash media, status, size/session metadata, selected-design context, and claim action." },
    { id: "tattoo-intake", label: "Tattoo intake / application", kind: "form-upload", accent: "tattooing", route: "/tattoos/inquire/custom/", sources: ["tattoos/inquire/custom/index.html", "js/submission-form.js"], description: "Long-form project intake with conditional fields, dates, reference uploads, consent, validation, and feedback." },
    { id: "submission-status", label: "Submission status", kind: "confirmation", accent: "tattooing", route: "/tattoos/submission-received/", sources: ["tattoos/submission-received/index.html"], description: "Clear completion state, next steps, response timing, and safe return paths." },
    { id: "booking-flow", label: "Booking / checkout", kind: "booking", accent: "tattooing", route: "/booking/", sources: ["booking/index.html"], description: "Approved-client session choice, contact details, month calendar, time windows, summary, and checkout state." },
    { id: "consultation-booking", label: "Consultation booking", kind: "booking-form", accent: "tattooing", route: "/tattoos/inquire/consultation/", sources: ["tattoos/inquire/consultation/index.html", "js/booking-calendar.js"], description: "Public scheduling form with calendar, availability, selected time, contact information, and payment step." },
    { id: "reschedule-flow", label: "Rescheduling", kind: "booking", accent: "tattooing", route: "/booking/reschedule/", sources: ["booking/reschedule/index.html"], description: "Existing appointment context, constrained replacement calendar, selected window, and explicit result." },
    { id: "booking-confirmation", label: "Booking confirmation", kind: "confirmation", accent: "tattooing", route: "/booking/confirmed/", sources: ["booking/confirmed/index.html"], description: "Appointment confirmation, timing, preparation, payment state, and next actions." },
    { id: "event-hub", label: "Events program landing", family: "Landing Family", variant: "Events program", kind: "landing", accent: "events", route: "/events/", routes: ["/events/"], sources: ["events/index.html", "css/venture-pages.css", "css/landing-family.css"], adoption: "Shared foundation adopted · event composition retained", variantRegions: ["Live event feed", "Capacity and status", "Registration paths", "Calendar and archive"], description: "Program entry with current events, pathways, status grid, timeline, registration, and archive bridge." },
    { id: "event-registration", label: "Event registration / waitlist", kind: "event-form", accent: "events", route: "/events/signal-symbol/", sources: ["events/signal-symbol/index.html"], description: "Event details, ticket or waitlist state, attendee fields, marketing consent, accessibility, payment, and result." },
    { id: "event-calendar", label: "Event calendar", kind: "event-calendar", accent: "events", route: "/events/calendar/", sources: ["events/calendar/index.html"], description: "Calendar/list presentation for upcoming events with status, medium context, and record paths." },
    { id: "archive-explorer", label: "Archive explorer", kind: "search", accent: "archive", route: "/archive/", sources: ["archive/index.html", "js/archive-public.js", "css/archive-public.css", "css/archive-cards.css"], description: "Managed Archive search, filters, result states, collection entry, top-level Compare records action, and public record navigation." },
    { id: "archive-collection", label: "Archive collection", kind: "catalog", accent: "archive", route: "/archive/collections/", sources: ["archive/collections/index.html", "js/archive-public.js"], description: "Curated collection statement, filters, records, and related archive paths." },
    { id: "archive-record", label: "Archive record / dossier", kind: "archive-record", accent: "archive", route: "/archive/records/:slug/", sources: ["archive/records/index.html", "js/archive-public.js", "css/archive-public.css", "functions/api/construct/_lib.js"], description: "Canonical dossier with permanent catalogue identity, current public condition, version rows, Roman-numeral state cards, adaptive documentation, state materials, history, grouped connections, and stable state anchors." },
    { id: "archive-guide", label: "Archive catalogue guide", kind: "editorial", accent: "archive", route: "/archive/guide/", sources: ["archive/guide/index.html", "css/archive-guide.css"], description: "Public explanation of cultural-object identities, versions, states, materials, documentation, comparison, relationships, and publication gates." },
    { id: "archive-compare", label: "Archive comparison", kind: "comparison", accent: "archive", route: "/archive/compare/", sources: ["archive/compare/index.html", "js/archive-compare.js", "css/archive-compare.css", "functions/api/construct/_lib.js"], description: "Shareable two-subject comparison for public records and states, with lead media, aligned catalogue rows, em dashes for undocumented values, and stacked mobile reading." },
    { id: "archive-timeline", label: "Archive timeline", kind: "timeline", accent: "archive", route: "/archive/timelines/:slug/", sources: ["archive/timelines/index.html", "js/archive-public.js"], description: "Chronological record with dated milestones, materials, subject context, and record links." },
    { id: "legend-catalog", label: "Legend taxonomy", kind: "taxonomy", accent: "about", route: "/about/legend/", sources: ["about/legend/index.html", "about/legend/detail/index.html", "js/legend-record-view.js"], description: "Symbol filters, clean canonical records, meaning, applications, appearances, and connected system usage." },
    { id: "construct-search", label: "Search / results", kind: "search", accent: "about", route: "/search/", sources: ["search/index.html", "js/managed-preview.js"], description: "Construct-wide search field, mixed result catalog, detail dialog, loading, empty, and error states." },
    { id: "preferences", label: "Preferences / settings", kind: "preferences", accent: "about", route: "/preferences/", sources: ["preferences/index.html"], description: "Visitor-facing settings, grouped controls, consent choices, save state, and confirmation." },
    { id: "hidden-state", label: "Hidden medium / 404", kind: "error", accent: "film", route: "/404", sources: ["404.html", "film/index.html", "music/index.html", "writings/index.html"], description: "Unavailable-path message with preserved navigation, alternate routes, and no dead end." }
  ];

  PUBLIC_TEMPLATES.forEach(function (record) {
    record.heroVariant = record.family === "Landing Family" ? "Medium landing hero" : "Supporting hero";
    if (record.sources.indexOf("css/hero.css") === -1) record.sources.push("css/hero.css");
  });

  var LANDING_SHARED_REGIONS = [
    "Shared navigation",
    "Breadcrumb",
    "Hero title role",
    "Descriptor",
    "Page spacing",
    "Structural rules",
    "Responsive behavior",
    "Footer"
  ];
  var LANDING_VARIANTS = PUBLIC_TEMPLATES.filter(function (record) {
    return record.family === "Landing Family";
  });
  var PUBLIC_NON_LANDING = PUBLIC_TEMPLATES.filter(function (record) {
    return record.family !== "Landing Family";
  });

  var COMPONENTS = [
    { id: "component-forms", label: "Forms and validation", system: "public", kind: "component-form", referenceRoute: "/tattoos/flash/claim/?preview=1", sources: ["css/forms.css", "css/select-menu.css", "tattoos/flash/claim/index.html", "js/submission-form.js"], adoption: "Shared public form system adopted · controls rest neutral · interaction and required acknowledgements inherit their route accent · Construct-wide updates remain amber", description: "Canonical public text, email, phone, date, dropdown, textarea, file, help, validation, status, acknowledgement, and Optional Updates treatment." },
    { id: "component-selects", label: "Dropdowns and filters", system: "public", kind: "component-select", sources: ["js/select-menu.js", "merch/index.html"], description: "Native select, custom listbox, filter chips, tabs, scrolling subnavigation, and disclosures." },
    { id: "component-scheduling", label: "Public calendar", system: "public", kind: "component-calendar", referenceRoute: "/booking/?preview=1", sources: ["booking/index.html", "css/booking-calendar.css", "js/booking-calendar.js", "booking/reschedule/index.html"], adoption: "Shared public appointment pickers adopted · public variants preserve their workflows · Studio excluded", description: "Canonical public month calendar, availability window, and time-slot selection. Hover uses an amber border, body-colored text, and a subtle shared amber fill; selection keeps its node-colored border and body text while using the same subtle amber fill." },
    { id: "component-uploads", label: "Uploads and media", system: "studio", kind: "component-upload", sources: ["studio/submissions/index.html", "studio/construct-manager.js"], description: "File input, drop zone, preview, progress, success, and failure containment." },
    { id: "component-commerce", label: "Commerce", system: "public", kind: "component-commerce", sources: ["merch/index.html", "merch/lostmarbles-hoodie.html"], description: "Product card, gallery, variant, price, edition, inventory, cart line, subtotal, and checkout feedback." },
    { id: "component-data", label: "Records, tables, timelines", system: "studio", kind: "component-data", sources: ["studio/construct-manager.js", "studio/people-manager.js"], description: "Cards, list rows, metadata, data tables, mobile fallbacks, timelines, pagination, and empty states." },
    { id: "component-archive-catalogue", label: "Archive evolution and comparison", system: "public", kind: "component-archive-catalogue", referenceRoute: "/archive/records/lostmarbles/", sources: ["js/archive-public.js", "css/archive-public.css", "js/archive-compare.js", "css/archive-compare.css"], adoption: "Shared Archive catalogue component adopted · 5px state rails · top-level comparison workspace · desktop side-by-side and stacked mobile comparison", description: "Version rows, Roman state cards, current-condition marker, lead media, material counts, stable state anchors, a Compare records hero action, a two-selector comparison workspace, shareable subject URLs, and aligned comparison rows. Individual cards carry no comparison controls." },
    { id: "component-overlays", label: "Dialogs and overlays", system: "public", kind: "component-overlay", sources: ["search/index.html", "tattoos/portfolio/index.html"], description: "Dialog, confirmation, lightbox, drawer, popover, menu, and destructive confirmation." },
    { id: "component-feedback", label: "Operational feedback", system: "studio", kind: "component-feedback", sources: ["studio/submissions/index.html"], description: "Clean, dirty, saving, saved, warning, success, failed, disabled, loading, and empty states." }
  ];

  var STUDIO_PATTERNS = [
    { id: "studio-shell", label: "Console shell", kind: "studio-shell", route: "/studio/submissions/", sources: ["studio/submissions/index.html", "studio/console-system.css"], description: "Console header, top-level tabs, subnavigation, status, and responsive workspace frame." },
    { id: "studio-list-detail", label: "List / detail manager", kind: "studio-list", route: "/studio/submissions/", sources: ["studio/submissions/index.html"], description: "Scrollable record list and operational detail pane that stack without losing access at phone width." },
    { id: "studio-dashboard", label: "Home dashboard", kind: "studio-dashboard", route: "/studio/submissions/#home", sources: ["studio/submissions/index.html"], description: "Cross-medium calendar, upcoming work, quick actions, and attention states." },
    { id: "studio-scheduler", label: "Scheduler / availability", kind: "studio-scheduler", route: "/studio/submissions/#studio", sources: ["studio/submissions/index.html"], description: "Mini calendar, day panel, availability rules, date/time pickers, slots, and appointment actions." },
    { id: "studio-editor", label: "Record editor", kind: "studio-editor", route: "/studio/submissions/#archive", sources: ["studio/construct-manager.js"], description: "Multi-section form editor with sticky workspace navigation, validation, save, and archive actions." },
    { id: "studio-table", label: "Responsive data table", kind: "studio-table", route: "/studio/submissions/#analytics", sources: ["studio/analytics.js", "studio/analytics.css"], description: "Operational table with filters, metadata, horizontal containment, and compact mobile presentation." },
    { id: "studio-media", label: "Portfolio / media manager", kind: "studio-media", route: "/studio/submissions/#tattoo", sources: ["studio/submissions/index.html", "studio/construct-manager.js"], description: "Drop zone, cards, image roles, permission state, editors, sort actions, and upload feedback." },
    { id: "studio-people", label: "People / CRM timeline", kind: "studio-people", route: "/studio/submissions/#people", sources: ["studio/people-manager.js", "studio/people-manager.css"], description: "Directory list, person detail, identities, interactions, transactions, notes, consent, and timeline." },
    { id: "studio-campaign", label: "Campaign / audience", kind: "studio-campaign", route: "/studio/submissions/#people/outreach", sources: ["studio/people-manager.js"], description: "Audience review, campaign states, schedule controls, delivery feedback, and provider handoff." },
    { id: "studio-import", label: "CSV import / mapping", kind: "studio-import", route: "/studio/submissions/#people/integrations", sources: ["studio/people-manager.js"], description: "File selection, field mapping, date range, validation summary, import progress, and result." },
    { id: "studio-dossier", label: "Construct dossier", kind: "studio-dossier", route: "/studio/submissions/#archive/dossiers", sources: ["studio/construct-manager.js", "studio/construct-manager.css", "studio/archive-catalogue.css"], description: "Dossier workspace with read-only permanent identity, current-state selection, version/state publication, lead-material previews, grouped adaptive documentation, materials, history, connections, publication gates, and sticky section navigation." },
    { id: "studio-connections", label: "Connections manager", kind: "studio-connections", route: "/studio/submissions/#shared/relationships", sources: ["studio/connections-manager.js", "studio/connections-manager.css"], description: "Relationship filters, sentence preview, source/target records, type library, and graph-adjacent workflow." },
    { id: "studio-dialog", label: "Dialogs and protected actions", kind: "studio-dialog", route: "/studio/submissions/", sources: ["studio/submissions/index.html", "css/select-menu.css"], description: "Token unlock, confirmation, protected and destructive actions, dropdowns, and explicit success/failure." }
  ];

  var SPECIALIZED = [
    { id: "special-home", label: "Homepage construct", route: "/home/", source: "home/index.html", description: "Canvas/node navigation with its own spatial and motion contract." },
    { id: "special-entry", label: "Entry threshold / room", route: "/", source: "index.html + entry-room/3d", description: "Immersive threshold and 3D entry logic; not a standard page shell." },
    { id: "special-maze", label: "Maze application", route: "/tattoos/build/maze/", source: "apps/maze + compiled bundle", description: "Application workspace owned by its React/Konva composition system." },
    { id: "special-map", label: "Construct Map", route: "/construct-map/", source: "construct-map/index.html", description: "Relationship diagram and structural key rather than a content page." },
    { id: "special-build", label: "Tattoo Build workspace", route: "/tattoos/build/", source: "tattoos/build/index.html", description: "Composition builder plus application flow with specialized responsive states." },
    { id: "special-bible", label: "Construct Bible", route: "/sixwellconstruct/bible/", source: "sixwellconstruct/bible/index.html", description: "Internal reference surface, not a public production template." }
  ];

  var SOURCE_CANDIDATE_ROUTES = {
    "venture-landing": ["/about/", "/events/"],
    "component-forms": ["/art/acquisitioninquiry", "/tattoos/inquire/custom/"],
    "component-selects": ["/merch/", "/tattoos/flash/", "/search/"],
    "component-scheduling": [
      "/booking/",
      "/tattoos/inquire/consultation/",
      "/tattoos/build/in-person/",
      "/booking/studio-visit/",
      "/booking/reschedule/",
      "/events/calendar/"
    ],
    "component-uploads": ["/tattoos/inquire/custom/", "/studio/submissions/#tattoo", "/studio/submissions/#archive"],
    "component-commerce": ["/merch/", "/merch/lostmarbles-hoodie"],
    "component-data": ["/archive/", "/studio/submissions/#analytics", "/studio/submissions/#people"],
    "component-archive-catalogue": ["/archive/", "/archive/records/:slug/", "/archive/compare/"],
    "component-overlays": ["/search/", "/tattoos/portfolio/", "/studio/submissions/"],
    "component-feedback": ["/studio/submissions/"]
  };

  var FOUNDATION_PATTERNS = [
    {
      id: "foundation-canvas-ink",
      label: "Canvas and base ink",
      description: "Opaque root canvas plus the shared body, muted, dim, and ghost ink hierarchy.",
      sourceInfo: {
        primaryRoute: "/about/mediums/",
        candidateRoutes: ["/about/mediums/", "/art/", "/tattoos/", "/merch/", "/events/", "/studio/submissions/"],
        ownerFiles: ["css/tokens.css", "about/section-page.css", "studio/console-system.css"],
        parentFamily: "Foundations",
        variantOf: "",
        adoptionState: "Shared by audited public pages and Studio Console",
        notes: "Foundation is already established in the UI Guide."
      }
    },
    {
      id: "foundation-typography",
      label: "Typography roles",
      description: "Display, narrative, operational, metadata, descriptor, and responsive type assignments.",
      sourceInfo: {
        primaryRoute: "",
        candidateRoutes: ["/about/mediums/", "/art/", "/tattoos/", "/merch/", "/events/", "/studio/submissions/"],
        ownerFiles: ["css/tokens.css", "css/site-typography.css", "css/hero.css", "studio/console-system.css"],
        parentFamily: "Foundations",
        variantOf: "",
        adoptionState: "Shared roles exist",
        notes: "Reference route can be linked manually without reopening the foundation."
      }
    },
    {
      id: "foundation-spacing",
      label: "Spacing and grids",
      description: "Page padding, section rhythm, content widths, card gutters, and responsive grid gaps.",
      sourceInfo: {
        primaryRoute: "",
        candidateRoutes: ["/about/mediums/", "/art/", "/tattoos/", "/merch/", "/events/", "/studio/submissions/"],
        ownerFiles: ["css/tokens.css", "css/venture-pages.css", "css/mobile.css", "studio/console-system.css"],
        parentFamily: "Foundations",
        variantOf: "",
        adoptionState: "Shared tokens exist",
        notes: "Reference route can be linked manually without reopening the foundation."
      }
    },
    {
      id: "foundation-structure-motion",
      label: "Structure, motion, and focus",
      description: "Structural rules, component framing, motion, focus visibility, reduced motion, and target sizes.",
      sourceInfo: {
        primaryRoute: "",
        candidateRoutes: ["/about/mediums/", "/art/", "/tattoos/", "/merch/", "/events/", "/studio/submissions/"],
        ownerFiles: ["css/tokens.css", "css/transitions.css", "css/mobile.css", "studio/console-system.css"],
        parentFamily: "Foundations",
        variantOf: "",
        adoptionState: "Project constraints exist",
        notes: "Reference route can be linked manually without reopening the foundation."
      }
    }
  ];

  function sourceRecord(record, system) {
    var routes = SOURCE_CANDIDATE_ROUTES[record.id] ||
      record.routes ||
      (record.route ? [record.route] : []);
    var ownerFiles = record.sources || (record.source ? [record.source] : []);
    record.system = record.system || system;
    record.sourceInfo = {
      primaryRoute: record.referenceRoute || "",
      candidateRoutes: routes.slice(),
      ownerFiles: ownerFiles.slice(),
      parentFamily: record.family || "",
      variantOf: record.variant ? record.family || "" : "",
      adoptionState: record.adoption || "Not yet migrated",
      notes: record.heroVariant || ""
    };
    return record;
  }

  PUBLIC_TEMPLATES.forEach(function (record) { sourceRecord(record, "public"); });
  COMPONENTS.forEach(function (record) { sourceRecord(record, record.system || "public"); });
  STUDIO_PATTERNS.forEach(function (record) { sourceRecord(record, "studio"); });
  SPECIALIZED.forEach(function (record) { sourceRecord(record, "specialized"); });

  var state = {
    system: "public"
  };
  var root = document.getElementById("contract-root");

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sourceInfo(record) {
    return record.sourceInfo || {
      primaryRoute: "",
      candidateRoutes: [],
      ownerFiles: [],
      parentFamily: "",
      variantOf: "",
      adoptionState: "Not yet migrated",
      notes: ""
    };
  }

  function templateCards(records, system) {
    return records.map(function (record) {
      return '<article class="template-card" data-template-system="' + esc(system) + '">' +
        "<strong>" + esc(record.label) + "</strong>" +
        (record.variant ? '<span class="template-variant">' + esc(record.family + " · " + record.variant) + "</span>" : "") +
        "<span>" + esc(record.description) + "</span>" +
        (sourceInfo(record).candidateRoutes.length ? "<code>" + esc(sourceInfo(record).candidateRoutes.join(" · ")) + "</code>" : "<code>Reference route not linked</code>") +
      "</article>";
    }).join("");
  }

  function regionList(regions) {
    return '<ul class="contract-region-list">' + (regions || []).map(function (region) {
      return "<li>" + esc(region) + "</li>";
    }).join("") + "</ul>";
  }

  function landingVariantCards() {
    return LANDING_VARIANTS.map(function (record) {
      return '<article class="landing-variant">' +
        '<div class="landing-variant-head"><span class="kicker">' + esc(record.variant) + "</span><h3>" + esc(record.label) + "</h3></div>" +
        "<p>" + esc(record.description) + "</p>" +
        regionList(record.variantRegions) +
        templateCards([record], "public") +
      "</article>";
    }).join("");
  }

  function foundationSourceCards() {
    return FOUNDATION_PATTERNS.map(function (record) {
      var current = sourceInfo(record);
      return '<article class="foundation-review-card">' +
        "<h3>" + esc(record.label) + "</h3>" +
        "<p>" + esc(record.description) + "</p>" +
        '<dl><div><dt>Reference</dt><dd>' + esc(current.primaryRoute || "Linked manually when needed") + '</dd></div><div><dt>Owners</dt><dd>' + esc(current.ownerFiles.join(" · ")) + '</dd></div><div><dt>State</dt><dd>' + esc(current.adoptionState) + '</dd></div></dl>' +
      "</article>";
    }).join("");
  }

  function renderSections() {
    var sourceRows = FOUNDATION_PATTERNS.map(function (record) {
      return sourceRow("foundation", record);
    }).concat(PUBLIC_TEMPLATES.map(function (record) {
      return sourceRow("public", record);
    })).concat(COMPONENTS.map(function (record) {
      return sourceRow(record.system === "studio" ? "studio" : "public", record);
    })).concat(STUDIO_PATTERNS.map(function (record) {
      return sourceRow("studio", record);
    })).concat(SPECIALIZED.map(function (record) {
      return sourceRow("specialized", record);
    })).join("");

    root.innerHTML =
      '<section class="contract-section canon-review-section" id="canon-review">' +
        '<span class="kicker">01 · source linking</span>' +
        '<div class="contract-section-head"><div><h2>Every pattern follows a named source</h2><p>The UI Guide foundations remain established. Templates and components record their production specimen, ownership, and responsive contract without embedding a second rendering surface.</p></div><div class="contract-note"><strong>Manual workflow:</strong> choose the source route, identify whether it owns a shared template or a legitimate variant, then link its HTML, CSS, and JavaScript owners.</div></div>' +
        '<div class="foundation-review-grid" aria-label="Established foundation sources">' + foundationSourceCards() + "</div>" +
      "</section>" +
      '<section class="contract-section" id="systems">' +
        '<span class="kicker">02 · foundations</span>' +
        '<div class="contract-section-head"><div><h2>Dual-system foundations</h2><p>Public pages and Studio share established foundations while retaining different shells, roles, and responsive behavior.</p></div><div class="contract-note"><strong>Preservation boundary:</strong> source records document existing visual contracts without replacing page content, routes, APIs, or Studio workflows.</div></div>' +
      "</section>" +
      '<section class="contract-section" id="component-library">' +
        '<span class="kicker">03 · components</span>' +
        '<div class="contract-section-head"><div><h2>Component sources</h2><p>Each component records its production reference, owning files, and shared behavior.</p></div><div class="contract-note">Keyboard access, visible focus, ARIA state, reduced motion, viewport containment, and a 44px mobile target floor remain shared requirements.</div></div>' +
        '<div class="component-grid">' + COMPONENTS.map(function (record) {
          return '<article class="component-card"><strong>' + esc(record.label) + '</strong><span>' + esc(record.description) + '</span></article>';
        }).join("") + "</div>" +
        '<section class="form-system-specimen" aria-labelledby="form-system-specimen-title"><span class="kicker">Forms and validation · css/forms.css</span><h3 id="form-system-specimen-title">Shared public data-entry system</h3><p>Neutral resting controls use one geometry, label, help, status, and placeholder treatment. Medium color appears on interaction and required acknowledgement; Optional Updates remains Construct amber.</p>' + formMarkup(true) + "</section>" +
      "</section>" +
      '<section class="contract-section" id="public-templates">' +
        '<span class="kicker">04 · public templates</span>' +
        '<div class="contract-section-head"><div><h2>Public page-family sources</h2><p>Each family record follows its linked production route and owning files.</p></div><div class="contract-note">Landing variants share the established foundation while retaining their source-owned anatomy.</div></div>' +
        '<section class="template-family" aria-labelledby="landing-family-title">' +
          '<div class="template-family-head"><div><span class="kicker">Landing family</span><h3 id="landing-family-title">One foundation · five variants</h3><p>Every landing inherits the same navigation, breadcrumb, hero roles, descriptor, spacing, structural rules, responsive behavior, and footer.</p></div><div><span class="kicker">Shared regions</span>' + regionList(LANDING_SHARED_REGIONS) + "</div></div>" +
          '<div class="landing-variant-grid">' + landingVariantCards() + "</div>" +
        "</section>" +
        '<div class="public-template-remainder"><span class="kicker">Other public templates</span><div class="template-grid">' + templateCards(PUBLIC_NON_LANDING, "public") + "</div></div>" +
      "</section>" +
      '<section class="contract-section" id="studio-patterns">' +
        '<span class="kicker">05 · studio patterns</span>' +
        '<div class="contract-section-head"><div><h2>Studio operation sources</h2><p>Operational patterns link directly to the existing console without importing public heroes, breadcrumbs, navigation, or footers.</p></div><div class="contract-note">At 390px, every lane and action remains reachable.</div></div>' +
        '<div class="template-grid">' + templateCards(STUDIO_PATTERNS, "studio") + "</div>" +
      "</section>" +
      '<section class="contract-section" id="specialized-surfaces">' +
        '<span class="kicker">06 · specialized surfaces</span>' +
        '<div class="contract-section-head"><div><h2>Explicit exceptions</h2><p>These surfaces own specialized composition or interaction systems and must not be mistaken for standard public page shells.</p></div></div>' +
        '<div class="special-grid">' + SPECIALIZED.map(function (record) {
          return '<article class="special-card"><h3>' + esc(record.label) + '</h3><p>' + esc(record.description) + '</p><span class="source-badge">' + esc(record.route + " · " + record.source) + "</span></article>";
        }).join("") + "</div>" +
      "</section>" +
      '<section class="contract-section" id="source-map">' +
        '<span class="kicker">07 · source map</span>' +
        '<div class="contract-section-head"><div><h2>Reference sources and ownership</h2><p>Use this map to link each Guide pattern to its production route, template relationship, and owning files.</p></div></div>' +
        '<div class="source-map-wrap"><table><thead><tr><th>Specimen</th><th>Family / variant</th><th>Reference route</th><th>Candidate routes</th><th>Owning files</th><th>Adoption / notes</th></tr></thead><tbody>' + sourceRows + "</tbody></table></div>" +
      "</section>";
  }

  function sourceRow(system, record) {
    var current = sourceInfo(record);
    return '<tr data-system="' + system + '"><td>' + esc(record.label) + "</td><td>" +
      esc(record.family ? record.family + " · " + record.variant : (system === "foundation" ? "Foundations" : system === "specialized" ? "Specialized surface" : "Standalone pattern")) +
      "</td><td>" + esc(current.primaryRoute || "Not linked yet") +
      "</td><td><code>" + esc(current.candidateRoutes.length ? current.candidateRoutes.join(" · ") : "No route candidate yet") +
      "</code></td><td>" + esc(current.ownerFiles.length ? current.ownerFiles.join(" · ") : "Owner not mapped") +
      "</td><td>" + esc(current.adoptionState + (current.notes ? " · " + current.notes : "")) + "</td></tr>";
  }

  function nav(accent) {
    return '<nav class="ui-preview-nav" aria-label="Shared navigation">' +
      '<a class="ui-preview-wordmark" href="#">the six.well construct</a>' +
      '<div class="ui-preview-nav-links"><a href="#">' + esc(accent) + '</a><a href="#">Archive</a><a href="#">About</a></div>' +
    "</nav>";
  }

  function bookingNav() {
    var dots = ["tattooing", "art", "merch", "events", "about", "music", "writings", "archive", "film"].map(function (medium) {
      return '<span class="booking-nav-dot" data-medium="' + medium + '" aria-hidden="true"></span>';
    }).join("");
    return '<nav class="booking-preview-nav" aria-label="Approved booking navigation">' +
      '<a class="booking-preview-brand" href="#"><span class="booking-brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span>the six.well construct</span></a>' +
      '<div class="booking-preview-dots" aria-hidden="true">' + dots + "</div>" +
    "</nav>";
  }

  function breadcrumb(label) {
    return '<nav class="construct-breadcrumb" aria-label="Breadcrumb"><a href="#">Construct</a><span class="construct-breadcrumb-sep">/</span><a href="#">Medium</a><span class="construct-breadcrumb-sep">/</span><span class="construct-breadcrumb-current" aria-current="page">' + esc(label) + "</span></nav>";
  }

  function footer() {
    return '<footer class="ui-preview-footer"><span>© the six.well construct</span><nav aria-label="Footer"><a href="#">Return to construct</a></nav></footer>';
  }

  function hero(record, title) {
    var variant = record.heroVariant === "Medium landing hero" ? "site-hero--landing" : "site-hero--supporting";
    return '<section class="ui-preview-hero site-hero ' + variant + '"><div><span class="venture-kicker">' + esc(record.label) + '</span><h1 class="venture-title hero-title">' + esc(title || record.label) + '</h1></div><div class="ui-preview-hero-copy"><p class="hero-descriptor">' + esc(record.description) + '</p><div class="ui-actions"><a class="ui-action primary" href="#">Primary action</a><a class="ui-action" href="#">Related path</a></div></div></section>';
  }

  function cardGrid(prefix, count) {
    var cards = [];
    for (var i = 1; i <= (count || 3); i += 1) {
      cards.push('<article class="ui-card"><div class="ui-media">' + esc(prefix) + ' media ' + i + '</div><span class="ui-meta">Record ' + String(i).padStart(2, "0") + '</span><h3>' + esc(prefix) + " " + i + '</h3><p class="ui-copy">Representative metadata and a concise record description.</p></article>');
    }
    return '<div class="ui-card-grid">' + cards.join("") + "</div>";
  }

  function formMarkup(upload) {
    return '<div class="ui-form-layout public-form"><form class="ui-panel public-form" onsubmit="return false"><div class="ui-field-grid form-grid">' +
      '<label class="ui-field form-field">First name<input class="form-control" autocomplete="given-name" required></label>' +
      '<label class="ui-field form-field">Last name<input class="form-control" autocomplete="family-name" required></label>' +
      '<label class="ui-field form-field">Email · invalid example<input class="form-control is-invalid" type="email" value="not-an-email" autocomplete="email" aria-invalid="true" required></label>' +
      '<label class="ui-field form-field">Phone<input class="form-control" type="tel" autocomplete="tel"></label>' +
      '<label class="ui-field form-field">Requested date<input class="form-control" type="date"></label>' +
      '<label class="ui-field form-field">Project type<select class="form-control"><option value="">Choose one</option><option>Original work</option><option>Consultation</option></select></label>' +
      '<label class="ui-field form-field">Readonly reference<input class="form-control" value="Public form specimen" readonly></label>' +
      '<label class="ui-field form-field">Disabled field<input class="form-control" value="Unavailable" disabled></label>' +
      '<label class="ui-field form-field form-field--full wide">Project notes<textarea class="form-control form-control--textarea" required></textarea><span class="ui-help form-help">Explain the useful context without changing the underlying submission contract.</span></label>' +
      (upload ? '<label class="ui-field form-field form-field--full wide">Reference uploads<input class="form-control form-control--file" type="file" multiple data-preview-file><span class="ui-help form-help">JPEG, PNG, WebP, or PDF.</span></label>' : "") +
      '<label class="form-check wide"><input class="form-check__input" type="checkbox" required><span class="form-check__label">I consent to the stated contact and review process.</span></label>' +
      '<div class="form-check-group wide"><p class="form-check-group__heading">Optional updates</p><label class="form-check form-check--construct"><input class="form-check__input" type="checkbox"><span class="form-check__label">Yes, send me Construct-wide updates by email.</span></label><a class="form-check-group__manage" href="#">Manage communication preferences</a></div>' +
      '<div class="ui-actions wide"><button class="ui-action primary" type="submit" data-status-state="success" data-status-copy="Mock submission complete.">Submit</button></div>' +
      '<div class="wide"><p class="form-status">Ready for input.</p><p class="form-status form-status--error">Error · review the highlighted field.</p><p class="form-status form-status--success">Success · the form was received.</p></div>' +
    '</div></form><aside class="ui-detail-card"><span class="ui-meta">css/forms.css owner</span><h3>What happens next</h3><p class="ui-copy">Neutral resting controls share one 5px frame, background, value ink, label, help, and status system. Medium color is reserved for interaction and validation.</p><p class="ui-status form-status" data-preview-status role="status" aria-live="polite">Clean · ready for input.</p></aside></div>';
  }

  function calendarCells() {
    var open = [24];
    var cells = ["", ""].map(function () {
      return '<button class="cal-day empty" type="button" tabindex="-1" aria-hidden="true"></button>';
    });
    for (var day = 1; day <= 30; day += 1) {
      var isOpen = open.indexOf(day) !== -1;
      var active = day === 24;
      cells.push('<button class="cal-day ' + (isOpen ? "open" : "past") + (active ? " active" : "") + '" type="button" role="gridcell" ' +
        (isOpen ? 'data-preview-press aria-pressed="' + (active ? "true" : "false") + '"' : "disabled") +
        ' aria-label="September ' + day + ', 2026, ' + (isOpen ? "open" : "closed") + '">' + day + "</button>");
    }
    return cells.join("");
  }

  function canonicalCalendarSection() {
    return '<div class="booking-layout canonical-booking-calendar" aria-label="Approved tattoo booking calendar specimen">' +
      '<div class="booking-main-column"><section class="section session-section"><div class="session-list"><button class="choice session-choice" type="button" aria-pressed="false"><span><span class="choice-title">Extended Day Session</span><span class="choice-meta">8–10 hours / Optional 8–10 hour session. Reserves a 10-hour appointment block with a $200 Extended Day fee.</span></span><span class="price-wrap"><span class="price">$350</span><span class="price-label">Deposit</span></span></button></div></section>' +
      '<section class="section" aria-labelledby="calendar-preview-title"><p class="section-label" id="calendar-preview-title">Available Windows</p><div class="cal-wrap"><div class="cal-header"><div class="cal-month-nav"><button class="cal-nav" type="button" aria-label="Previous month">&lt;</button><select class="cal-month-select" aria-label="Available month"><option>September 2026</option></select><button class="cal-nav" type="button" aria-label="Next month">&gt;</button></div><span class="cal-month-count">1 open</span></div>' +
      '<div class="cal-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="cal-grid" role="grid" aria-label="Available appointment dates">' + calendarCells() + "</div></div>" +
      '<div class="window-list"><button class="booking-window-option" type="button" aria-pressed="false"><span><span class="booking-window-title">Thu, Sep 24, 2:00 PM</span><span class="booking-window-meta">Ends Thu, Sep 24, 5:00 PM</span></span></button></div></section></div>' +
      '<aside class="panel"><div class="panel-row"><span class="panel-key">Client</span><span>Preview Client</span></div><div class="panel-row"><span class="panel-key">Session</span><span>Half Day Session</span></div><div class="panel-row"><span class="panel-key">Window</span><span>Select a time</span></div><div class="panel-row"><span class="panel-key">Deposit</span><span>$100</span></div>' +
      '<div class="tip-control"><span class="panel-key">Optional Tip</span><div class="tip-options" role="group" aria-label="Optional tip amount"><button class="tip-button active" type="button" aria-pressed="true">None</button><button class="tip-button" type="button">$10</button><button class="tip-button" type="button">$20</button><button class="tip-button" type="button">$50</button></div><input class="custom-tip" type="number" min="0" max="500" step="0.01" inputmode="decimal" placeholder="Custom tip"></div>' +
      '<div class="panel-row"><span class="panel-key">Tip</span><span>$0</span></div><div class="panel-row"><span class="panel-key">Total Due Today</span><span>$100</span></div><button class="checkout" type="button" disabled>Preview Checkout</button><p class="fine">The tattoo deposit is applied toward the appointment total. Shorter sessions have no Extended Day fee, and additional dates can be coordinated when needed. Optional tips are itemized separately on the Square receipt.</p></aside></div>';
  }

  function schedulingSourceMarkup(record) {
    return bookingNav() + '<main class="booking-specimen-main">' + canonicalCalendarSection() + "</main>";
  }

  function publicMarkup(record) {
    var head = nav(record.accent) + '<main class="ui-preview-main">' + breadcrumb(record.label);
    var tail = "</main>" + footer();
    if (record.kind === "landing") {
      return head + hero(record) + '<section class="ui-preview-section"><div class="ui-preview-section-head"><div><span class="section-kicker">Paths through this medium</span><h2 class="section-title">Choose a path</h2></div><p class="ui-copy">The standard shell carries a clear page promise, bounded components, and quiet routes into related work.</p></div>' + cardGrid("Pathway", 3) + "</section>" + tail;
    }
    if (record.kind === "editorial") {
      return head + hero(record, "A reading page") + '<section class="ui-preview-section"><div class="ui-preview-section-head"><h2 class="section-title">Shared context</h2><p class="ui-copy">Long-form copy keeps a readable measure while headings, descriptors, metadata, and related links remain in their provisional roles.</p></div><div class="ui-detail-layout"><article class="ui-copy"><p>Primary narrative copy belongs in a stable reading column. Individual pages may vary their composition without redefining the shared type and spacing foundation.</p><p>Optional disclosures and related records follow the same structural system.</p></article><aside class="ui-detail-card"><span class="ui-meta">Related route</span><h3>Continue through the construct</h3><a class="ui-action" href="#">Open related page</a></aside></div></section>' + tail;
    }
    if (record.kind === "comparison") {
      return head + hero(record, "Compare two public subjects") + '<section class="ui-preview-section"><div class="ui-detail-layout"><article class="ui-detail-card"><span class="ui-meta">Left subject</span><h3>Lost Marbles</h3><p class="ui-copy">ART-004.1/I · current public condition</p><div class="ui-media">Lead material</div></article><article class="ui-detail-card"><span class="ui-meta">Right subject</span><h3>Lost Marbles Hoodie</h3><p class="ui-copy">MER-001 · entire record</p><div class="ui-media">Lead media</div></article></div><div class="ui-table-wrap"><table class="ui-table"><tbody><tr><th scope="row">Catalogue identity</th><td>ART-004.1/I</td><td>MER-001</td></tr><tr><th scope="row">Support</th><td>Canvas</td><td>—</td></tr><tr><th scope="row">Relationship</th><td>Source work</td><td>Uses imagery</td></tr></tbody></table></div></section>' + tail;
    }
    if (record.kind === "catalog" || record.kind === "portfolio" || record.kind === "commerce-catalog") {
      return head + hero(record, record.kind === "commerce-catalog" ? "Merch" : "Catalog") + '<section class="ui-preview-section"><div class="ui-filter-row" aria-label="Catalog filters"><button class="ui-chip" type="button" data-preview-press aria-pressed="true">All</button><button class="ui-chip" type="button" data-preview-press aria-pressed="false">Available</button><button class="ui-chip" type="button" data-preview-press aria-pressed="false">Archive</button></div><div style="height:24px"></div>' + cardGrid(record.kind === "portfolio" ? "Tattoo" : record.kind === "commerce-catalog" ? "Product" : "Work", 6) + "</section>" + tail;
    }
    if (record.kind === "detail" || record.kind === "commerce-detail" || record.kind === "archive-record") {
      return head + hero(record, "Record title") + '<section class="ui-preview-section"><div class="ui-detail-layout"><div class="ui-gallery"><div class="ui-media">Primary media</div><div class="ui-media">Detail 01</div><div class="ui-media">Detail 02</div><div class="ui-media">Detail 03</div></div><aside class="ui-detail-card"><span class="ui-meta">Published · Available</span><h3>' + esc(record.label) + '</h3><p class="ui-copy">The detail contract keeps media, metadata, record context, availability, and next action distinct.</p>' + (record.kind === "commerce-detail" ? '<p class="ui-price">$130</p><div class="ui-variant-grid"><button type="button" data-preview-press aria-pressed="true">S</button><button type="button" data-preview-press aria-pressed="false">M</button><button type="button" data-preview-press aria-pressed="false">L</button></div>' : "") + '<div class="ui-actions"><button class="ui-action primary" type="button">Continue</button></div></aside></div></section>' + tail;
    }
    if (record.kind === "form" || record.kind === "form-upload" || record.kind === "event-form" || record.kind === "preferences") {
      return head + hero(record, record.kind === "preferences" ? "Preferences" : "Begin here") + '<section class="ui-preview-section">' + formMarkup(record.kind !== "form") + "</section>" + tail;
    }
    if (record.kind === "booking" || record.kind === "booking-form") {
      return head + hero(record, "Scheduling") + canonicalCalendarSection() + tail;
    }
    if (record.kind === "event-calendar") {
      return head + hero(record, "Events") + '<section class="ui-preview-section"><div class="ui-preview-section-head"><h2 class="section-title">Current board</h2><p class="ui-copy">Events use the event feed and registration state rather than the public appointment calendar.</p></div>' + cardGrid("Event", 4) + "</section>" + tail;
    }
    if (record.kind === "confirmation") {
      return head + '<section class="ui-preview-hero site-hero site-hero--supporting"><div><span class="venture-kicker">Complete</span><h1 class="venture-title hero-title">Received</h1></div><div class="ui-preview-hero-copy"><p class="hero-descriptor">The action completed successfully. The next step and response timing are explicit.</p><p class="ui-status" data-state="success" role="status">Saved successfully.</p></div></section><section class="ui-preview-section">' + cardGrid("Next step", 3) + "</section>" + tail;
    }
    if (record.kind === "search" || record.kind === "taxonomy") {
      return head + hero(record, record.kind === "taxonomy" ? "Legend" : "Search") + '<section class="ui-preview-section"><div class="ui-search-layout"><div><label class="ui-field">Find a record<input class="ui-search" type="search" value="symbol"></label><div class="ui-filter-row"><button class="ui-chip" type="button" aria-pressed="true">All</button><button class="ui-chip" type="button" aria-pressed="false">Works</button><button class="ui-chip" type="button" aria-pressed="false">Archive</button></div></div><aside class="ui-status" role="status">6 representative results.</aside></div><div style="height:24px"></div>' + cardGrid(record.kind === "taxonomy" ? "Symbol" : "Result", 6) + "</section>" + tail;
    }
    if (record.kind === "timeline") {
      return head + hero(record, "Timeline") + '<section class="ui-preview-section"><div class="ui-timeline"><article><span class="ui-meta">2024</span><div><h3>Record opened</h3><p class="ui-copy">A dated milestone with related materials and subject context.</p></div></article><article><span class="ui-meta">2025</span><div><h3>Work developed</h3><p class="ui-copy">The chronology remains readable at every viewport.</p></div></article><article><span class="ui-meta">2026</span><div><h3>Current state</h3><p class="ui-copy">Related records continue the thread.</p></div></article></div></section>' + tail;
    }
    if (record.kind === "error") {
      return nav(record.accent) + '<main class="ui-preview-main"><section class="ui-preview-hero site-hero site-hero--supporting"><div><span class="venture-kicker">Unavailable</span><h1 class="venture-title hero-title">Not found</h1></div><div class="ui-preview-hero-copy"><p class="hero-descriptor">This path is not currently available. Continue through a valid part of the construct.</p><div class="ui-actions"><a class="ui-action primary" href="#">Return home</a><a class="ui-action" href="#">Open archive</a></div></div></section></main>' + footer();
    }
    return head + hero(record) + '<section class="ui-preview-section">' + cardGrid("Record", 3) + "</section>" + tail;
  }

  function studioFrame(record, content) {
    return '<div class="studio-preview-shell"><header><div><span class="ui-meta">The Six.Well Construct</span><h1>Studio Console</h1></div><span class="status" role="status">Saved</span></header><nav class="tabs" aria-label="Console sections"><button class="tab is-active" type="button">Home</button><button class="tab" type="button">People</button><button class="tab" type="button">Tattoo booking</button><button class="tab" type="button">Archive</button></nav><nav class="subnav" aria-label="Manager sections"><button class="subnav-btn is-active" type="button">' + esc(record.label) + '</button><button class="subnav-btn" type="button">Settings</button><button class="subnav-btn" type="button">History</button></nav>' + content + "</div>";
  }

  function studioMarkup(record) {
    var list = '<section class="list-pane"><button class="studio-preview-row is-active" type="button"><strong>Selected record</strong><br><span class="ui-meta">Needs review</span></button><button class="studio-preview-row" type="button"><strong>Second record</strong><br><span class="ui-meta">Saved</span></button><button class="studio-preview-row" type="button"><strong>Third record</strong><br><span class="ui-meta">Scheduled</span></button></section>';
    var detail = '<section class="detail-pane"><div class="ui-detail-card"><span class="ui-meta">Operational record</span><h3>' + esc(record.label) + '</h3><p class="ui-copy">' + esc(record.description) + '</p><div class="ui-actions"><button class="button" type="button">Save</button><button class="button" type="button">Send update</button></div><p class="ui-status" data-preview-status role="status" aria-live="polite">Clean · no unsaved changes.</p></div></section>';
    if (record.kind === "studio-shell" || record.kind === "studio-list") {
      return studioFrame(record, '<main class="layout">' + list + detail + "</main>");
    }
    if (record.kind === "studio-dashboard" || record.kind === "studio-analytics") {
      return studioFrame(record, '<main class="detail-pane"><div class="studio-pattern-grid"><article class="ui-panel"><span class="ui-meta">Today</span><h3>4 appointments</h3><p class="ui-price">4</p></article><article class="ui-panel"><span class="ui-meta">Needs attention</span><h3>2 records</h3><p class="ui-price">2</p></article><article class="ui-panel"><span class="ui-meta">Reference route</span><h3>Dashboard scheduling source</h3><p class="ui-copy"><code>/studio/submissions/#home</code> owns this operational calendar variant.</p></article><article class="ui-panel"><h3>Status</h3><p class="ui-status" data-state="success">All services operational.</p></article></div></main>');
    }
    if (record.kind === "studio-scheduler") {
      return studioFrame(record, '<main class="detail-pane"><section class="ui-panel"><span class="ui-meta">Reference route</span><h3>Operational scheduler</h3><p class="ui-copy"><code>/studio/submissions/#studio</code> owns this availability and appointment-management variant.</p></section></main>');
    }
    if (record.kind === "studio-dossier") {
      return studioFrame(record, '<main class="detail-pane"><nav class="cm-workspace-nav"><a href="#">Catalogue</a><a href="#">Evolution</a><a href="#">Documentation</a><a href="#">Materials</a><a href="#">Publish</a></nav><section class="ui-panel"><span class="ui-meta">Permanent identity</span><h3>Lost Marbles · ART-004</h3><div class="ui-form-layout"><label class="ui-field">Base catalogue ID<input type="text" value="ART-004" readonly></label><label class="ui-field">Current public condition<select><option>Version 1 · State I</option></select></label><label class="ui-field">State publication<select><option>Published</option><option>Draft</option><option>Archived</option></select></label><label class="ui-field">Public visibility<select><option>Public</option><option>Internal</option></select></label></div></section><section class="ui-panel"><span class="ui-meta">Evolution</span><h3>Version 1 · State I</h3><p class="ui-copy">Lead material: finished image · public and eligible</p><div class="ui-actions"><button class="button" type="button">Select lead</button><button class="button" type="button">Set current condition</button></div></section><section class="ui-panel"><span class="ui-meta">Adaptive documentation</span><h3>Physical object</h3><p class="ui-copy">Ordered entries carry citations, URLs where relevant, and individual public toggles.</p><button class="button" type="button">Add documentation entry</button></section></main>');
    }
    if (record.kind === "studio-editor") {
      return studioFrame(record, '<main class="detail-pane"><nav class="cm-workspace-nav"><a href="#">Identity</a><a href="#">Materials</a><a href="#">History</a><a href="#">Connections</a></nav><section class="ui-panel"><h3>Record identity</h3>' + formMarkup(true) + '</section></main>');
    }
    if (record.kind === "studio-table") {
      return studioFrame(record, '<main class="detail-pane"><div class="ui-filter-row"><button class="button" type="button">Last 30 days</button><button class="button" type="button">All mediums</button></div><div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Record</th><th>Status</th><th>Owner</th><th>Updated</th></tr></thead><tbody><tr><td>Submission 1042</td><td>Review</td><td>Studio</td><td>Today</td></tr><tr><td>Appointment 821</td><td>Confirmed</td><td>Calendar</td><td>Yesterday</td></tr><tr><td>Archive 204</td><td>Draft</td><td>Construct</td><td>July 18</td></tr></tbody></table></div></main>');
    }
    if (record.kind === "studio-media") {
      return studioFrame(record, '<main class="detail-pane"><label class="ui-upload"><strong>Drop JPEG, PNG, or WebP images here</strong><input type="file" multiple data-preview-file><span class="ui-status" data-upload-status role="status">No files selected.</span></label><div style="height:18px"></div>' + cardGrid("Portfolio", 3) + "</main>");
    }
    if (record.kind === "studio-people") {
      return studioFrame(record, '<main class="layout">' + list + '<section class="detail-pane"><div class="ui-detail-card"><h3>Person record</h3><div class="ui-meta">Client · Email permitted</div></div><div class="ui-timeline"><article><span class="ui-meta">Today</span><div><h3>Follow-up scheduled</h3><p class="ui-copy">Communication and consent context remain visible.</p></div></article><article><span class="ui-meta">July 12</span><div><h3>Appointment completed</h3><p class="ui-copy">Operational history stays connected to the person.</p></div></article></div></section></main>');
    }
    if (record.kind === "studio-campaign") {
      return studioFrame(record, '<main class="detail-pane"><div class="studio-pattern-grid"><article class="ui-panel"><h3>Audience review</h3><p class="ui-price">128</p><p class="ui-copy">Recipients after consent and suppression checks.</p></article><article class="ui-panel"><h3>Delivery</h3><label class="ui-field">Schedule<input type="datetime-local"></label><div class="ui-actions"><button class="button" type="button">Review audience</button><button class="button" type="button">Schedule</button></div></article></div></main>');
    }
    if (record.kind === "studio-import") {
      return studioFrame(record, '<main class="detail-pane"><div class="ui-form-layout"><label class="ui-upload"><strong>Choose CSV or TSV</strong><input type="file" accept=".csv,.tsv" data-preview-file><span class="ui-status" data-upload-status>No file selected.</span></label><section class="ui-panel"><h3>Map fields</h3><label class="ui-field">Email column<select><option>Email address</option></select></label><label class="ui-field">Period start<input type="date"></label><button class="button" type="button">Analyze import</button></section></div></main>');
    }
    if (record.kind === "studio-connections") {
      return studioFrame(record, '<main class="detail-pane"><section class="ui-panel"><h3>Relationship sentence</h3><p class="ui-copy">Artwork A draws from Symbol B through the authored relationship.</p></section><div class="studio-pattern-grid"><article class="ui-detail-card"><span class="ui-meta">Source</span><h3>Artwork A</h3></article><article class="ui-detail-card"><span class="ui-meta">Target</span><h3>Symbol B</h3></article></div></main>');
    }
    if (record.kind === "studio-dialog") {
      return studioFrame(record, '<main class="detail-pane"><div class="ui-actions"><button class="button" type="button" data-preview-dialog-open="studio-preview-dialog">Open protected action</button></div><dialog class="ui-dialog" id="studio-preview-dialog"><span class="ui-meta">Protected action</span><h3>Confirm before continuing</h3><p class="ui-copy">The action, consequence, success, and failure states remain explicit.</p><div class="ui-actions"><button class="button" type="button" data-preview-dialog-close>Cancel</button><button class="button" type="button" data-preview-dialog-close>Confirm</button></div></dialog></main>');
    }
    return studioFrame(record, '<main class="layout">' + list + detail + "</main>");
  }

  function componentMarkup(record) {
    var publicRecord = { label: record.label, description: record.description, accent: record.system === "studio" ? "about" : "art" };
    if (record.kind === "component-form") return nav("components") + '<main class="ui-preview-main">' + breadcrumb(record.label) + hero(publicRecord, "Form controls") + '<section class="ui-preview-section">' + formMarkup(false) + "</section></main>" + footer();
    if (record.kind === "component-select") return nav("components") + '<main class="ui-preview-main">' + breadcrumb(record.label) + hero(publicRecord, "Select and filter") + '<section class="ui-preview-section"><div class="ui-actions"><label class="ui-field">Native select<select><option>All records</option><option>Available</option></select></label><div class="ui-dropdown"><button class="ui-action" type="button" data-preview-dropdown aria-expanded="false" aria-controls="preview-listbox"><span data-preview-value>Choose status</span></button><div class="ui-dropdown-panel" id="preview-listbox" role="listbox" hidden><button type="button" data-preview-option>Draft</button><button type="button" data-preview-option>Published</button><button type="button" data-preview-option>Archived</button></div></div></div><div class="ui-filter-row"><button class="ui-chip" type="button" data-preview-press aria-pressed="true">All</button><button class="ui-chip" type="button" data-preview-press aria-pressed="false">Works</button><button class="ui-chip" type="button" data-preview-press aria-pressed="false">Events</button></div></section></main>' + footer();
    if (record.kind === "component-calendar") return schedulingSourceMarkup(record);
    if (record.kind === "component-commerce") return nav("components") + '<main class="ui-preview-main">' + breadcrumb(record.label) + hero(publicRecord, "Commerce states") + '<section class="ui-preview-section"><div class="ui-commerce-layout">' + cardGrid("Product", 2) + '<aside class="ui-detail-card"><span class="ui-meta">Limited edition · 12 available</span><h3>Product title</h3><p class="ui-price">$130</p><div class="ui-variant-grid"><button type="button" data-preview-press aria-pressed="true">S</button><button type="button" data-preview-press aria-pressed="false">M</button><button type="button" data-preview-press aria-pressed="false">L</button></div><p class="ui-status" data-preview-status>Clean · select a variant.</p><button class="ui-action primary" type="button">Add to cart</button></aside></div></section></main>' + footer();
    if (record.kind === "component-overlay") return nav("components") + '<main class="ui-preview-main">' + breadcrumb(record.label) + hero(publicRecord, "Overlays") + '<section class="ui-preview-section"><div class="ui-actions"><button class="ui-action" type="button" data-preview-dialog-open="preview-dialog">Open dialog</button><div class="ui-dropdown"><button class="ui-action" type="button" data-preview-dropdown aria-expanded="false" aria-controls="preview-menu">Open menu</button><div class="ui-dropdown-panel" id="preview-menu" role="menu" hidden><button type="button" data-preview-option>Edit</button><button type="button" data-preview-option>Duplicate</button><button type="button" data-preview-option>Archive</button></div></div></div><dialog class="ui-dialog" id="preview-dialog"><span class="ui-meta">Confirmation</span><h3>Archive this record?</h3><p class="ui-copy">Destructive actions state their consequence before confirmation.</p><div class="ui-actions"><button class="ui-action" type="button" data-preview-dialog-close>Cancel</button><button class="ui-action primary" type="button" data-preview-dialog-close>Confirm</button></div></dialog></section></main>' + footer();
    if (record.kind === "component-archive-catalogue") return nav("archive") + '<main class="ui-preview-main">' + breadcrumb(record.label) + hero(publicRecord, "Evolution and comparison") + '<section class="ui-preview-section"><div class="ui-preview-section-head"><div><span class="section-kicker">Version 1</span><h2 class="section-title">Documented evolution</h2></div><p class="ui-copy">The permanent object identity stays fixed while public states receive Roman numerals, stable anchors, and an evidence-backed lead material. Individual cards carry no comparison controls.</p></div><div class="ui-detail-layout"><article class="ui-detail-card"><span class="ui-meta">I · current public condition</span><h3>Finished state</h3><div class="ui-media">M01 · lead material</div><p class="ui-copy">1 public material · <a href="#state-i">#state-i</a></p></article><article class="ui-detail-card"><span class="ui-meta">II · published state</span><h3>Earlier condition</h3><div class="ui-media">M01 · lead material</div><p class="ui-copy">3 public materials · <a href="#state-ii">#state-ii</a></p></article></div><div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Comparison workspace</th><th>Left</th><th>Right</th></tr></thead><tbody><tr><th scope="row">Public record</th><td>Select first subject</td><td>Select second subject</td></tr><tr><th scope="row">Result</th><td colspan="2">Open a shareable side-by-side comparison</td></tr></tbody></table></div></section></main>' + footer();
    if (record.kind === "component-upload") return studioFrame(record, '<main class="detail-pane"><label class="ui-upload"><strong>Drop files here or choose files</strong><input type="file" multiple data-preview-file><span class="ui-status" data-upload-status role="status">No files selected.</span></label><div style="height:18px"></div>' + cardGrid("Upload preview", 3) + "</main>");
    if (record.kind === "component-data") return studioFrame(record, '<main class="detail-pane"><div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Record</th><th>Status</th><th>Updated</th></tr></thead><tbody><tr><td>Record 01</td><td>Saved</td><td>Today</td></tr><tr><td>Record 02</td><td>Review</td><td>Yesterday</td></tr></tbody></table></div><div class="ui-timeline"><article><span class="ui-meta">Today</span><div><h3>Record saved</h3><p class="ui-copy">Timeline and table specimens remain contained.</p></div></article></div></main>');
    return studioFrame(record, '<main class="detail-pane"><div class="ui-actions"><button class="button" type="button" data-status-state="" data-status-copy="Dirty · unsaved changes.">Dirty</button><button class="button" type="button" data-status-state="success" data-status-copy="Saved successfully.">Saved</button><button class="button" type="button" data-status-state="error" data-status-copy="Save failed. Try again.">Failed</button><button class="button" type="button" disabled>Disabled</button></div><p class="ui-status" data-preview-status role="status" aria-live="polite">Clean · no unsaved changes.</p></main>');
  }

  function syncPressedStates() {
    document.querySelectorAll("[data-guide-system]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.guideSystem === state.system ? "true" : "false");
    });
  }

  function selectSystem(system) {
    state.system = system;
    document.body.dataset.guideSystem = system;
    syncPressedStates();
    var target = document.getElementById(system === "studio" ? "studio-patterns" : "public-templates");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.querySelectorAll("[data-guide-system]").forEach(function (button) {
    button.addEventListener("click", function () {
      selectSystem(button.dataset.guideSystem);
    });
  });

  renderSections();
  syncPressedStates();
})();
