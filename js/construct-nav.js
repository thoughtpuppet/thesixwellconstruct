/* ============================================================
   construct-nav.js — the six.well construct
   ============================================================
   Renders a row of 9 colored dots, one per construct entry, plus a
   separate Construct-wide Explore action, fixed at the top of every inner page.

   - Current construct entry dot: full opacity in its color
   - Other dots: dimmed to 0.2 opacity
   - Hover: dot brightens, entry name fades in above it
   - Click: fades to that entry's URL via transition.js

   HOW TO USE:
   1. Add data-venture="[key]" to the <body> tag of each page.
      Keys: tattooing | art | merch | about | events |
            music | writings | archive | film

      Example: <body data-venture="merch">

   2. Add this script before </body>, after transition.js:
        <script src="/js/construct-nav.js"></script>

   REQUIRES: transition.js loaded first (sets window._constructFade)
   ============================================================ */

(function() {

  /* ── CONSTRUCT ENTRY REGISTRY ────────────────────────────
     Single source of truth for all 9 construct entries.
     key:   must match the data-venture attribute on <body>
     label: shown in the hover tooltip
     token: color token from css/tokens.css
     fallback: construct color used if tokens.css is unavailable
     url:   destination when dot is clicked
  ────────────────────────────────────────────────────────── */
  var VENTURES = [
    { key: 'tattooing', label: 'TATTOOING',  token: '--color-tattooing', fallback: '#6E0404', url: '/tattoos/'   },
    { key: 'art',       label: 'ART MAKING', token: '--color-art',       fallback: '#0039BD', url: '/art/'       },
    { key: 'merch',     label: 'MERCH',      token: '--color-merch',     fallback: '#F08F00', url: '/merch/'     },
    { key: 'about',     label: 'ABOUT',      token: '--color-about',     fallback: '#FCB867', url: '/about/' },
    { key: 'events',    label: 'EVENTS',     token: '--color-events',    fallback: '#005D25', url: '/events/'    },
    { key: 'music',     label: 'MUSIC',      token: '--color-music',     fallback: '#A22F8D', url: '/music/'     },
    { key: 'writings',  label: 'WRITINGS',   token: '--color-writings',  fallback: '#FFE7CA', url: '/writings/'  },
    { key: 'archive',   label: 'ARCHIVE',    token: '--color-archive',   fallback: '#6D3D15', url: '/archive/'   },
    { key: 'film',      label: 'FILM',       token: '--color-film',      fallback: '#00857A', url: '/film/'      },
  ];

  /* Bundled pathway fallback. Managed navigation replaces these after hydrate. */
  var PATHWAYS_BY_KEY = {
    tattooing: [
      ['Art.Pill Tattoo House', '/tattoos/'], ['Client Resources', '/tattoos/client-resources/'],
      ['Flash', '/tattoos/flash/'], ['Portfolio', '/tattoos/portfolio/'],
      ['Booking', '/tattoos/inquire/'], ['Special Projects', '/tattoos/special-projects/'],
      ['Build Your Own', '/tattoos/build/'],
    ],
    art: [
      ['statements', '/writings/#featured'], ['artist bio', '/about/saieldauhnsolehman/'],
      ['portfolio', '/art/'], ['meridian in conflux', '/art/#sectionPainting'],
      ['studio visit', '/booking/studio-visit/'],
    ],
    merch: [
      ['six.well clothing', '/merch/?filter=six.well'], ['art.pill tattoo supply', '/merch/?filter=art.pill'],
      ['thoughtpuppet artifacts', '/merch/?filter=thoughtpuppet'], ['CULT[&SHIFT] merch', '/merch/?filter=cultiv'],
      ['all merch', '/merch/'],
    ],
    about: [
      ['the construct', '/about/#construct'], ['saiel / founder', '/about/saieldauhnsolehman/'],
      ['architecture', '/about/#construct-architecture'], ['nodes', '/about/#access'],
      ['method', '/about/#library'], ['faq', '/about/#faq'], ['Legend', '/about/legend/'],
    ],
    events: [
      ['CULT[&SHIFT]', '/events/cultandshift/'], ['Signal & Symbol', '/events/signal-symbol/'],
      ['Atlanta calendar', '/calendar/'], ['rent the studio', '/booking/studio/'],
      ['archive', '/archive/events/'], ["solehman's new years", '/events/solehmans-new-year/'],
      ['SS&F live audience', '/events/ss-and-f-live-audience/'], ['open studios', '/events/open-studios/'],
    ],
    music: [
      ['ringtones', '/music/#listening-surfaces'], ['MILOWALKSONWATER', '/music/#listening-index'],
      ['scores', '/music/#forms'],
    ],
    writings: [
      ['Mindful Darkness', '/writings/#reading-paths'], ['THE SOLEHMAN LETTERS', 'https://thesolehmanletters.com'],
      ['essays & notes', '/writings/#featured'],
    ],
    archive: [
      ['tattoos', '/archive/tattoos/'], ['art', '/archive/art/'], ['merch', '/archive/merch/'],
      ['events', '/archive/events/'], ['music', '/archive/music/'], ['writings', '/archive/writings/'],
      ['film', '/archive/film/'], ['The six.well Construct', '/archive/sixwell-construct/'],
    ],
    film: [
      ['isolated.take', '/film/#projects'], ['&friends', '/film/#projects'],
      ['animations', '/film/#forms'], ['sloth99', '/film/#status'],
    ],
  };
  VENTURES.forEach(function(venture) {
    venture.pathways = (PATHWAYS_BY_KEY[venture.key] || []).map(function(pathway) {
      return { label: pathway[0], url: pathway[1] };
    });
  });

  function readTokenColor(token, fallback) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return value || fallback;
  }

  function tokenColorsAvailable() {
    return !!getComputedStyle(document.documentElement).getPropertyValue('--color-art').trim();
  }

  function refreshVentureColors() {
    VENTURES.forEach(function(v) {
      v.color = readTokenColor(v.token, v.fallback);
    });
  }

  function ensureTokenStylesheet(onReady) {
    if (tokenColorsAvailable()) return;

    var existing = document.querySelector('link[href="/css/tokens.css"], link[href$="/css/tokens.css"]');
    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      return;
    }

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/tokens.css';
    link.setAttribute('data-construct-token-loader', 'true');
    link.addEventListener('load', onReady, { once: true });
    document.head.appendChild(link);
  }

  function ensureSelectMenuSystem() {
    if (!document.querySelector('link[href^="/css/select-menu.css"]')) {
      var selectStyles = document.createElement('link');
      selectStyles.rel = 'stylesheet';
      selectStyles.href = '/css/select-menu.css?v=2';
      selectStyles.setAttribute('data-sixwell-select-menu-styles', 'true');
      document.head.appendChild(selectStyles);
    }
    if (!window.SixWellSelectMenu && !document.querySelector('script[src^="/js/select-menu.js"]')) {
      var selectScript = document.createElement('script');
      selectScript.src = '/js/select-menu.js?v=2';
      selectScript.setAttribute('data-sixwell-select-menu-script', 'true');
      document.body.appendChild(selectScript);
    }
  }

  refreshVentureColors();
  ensureSelectMenuSystem();

  /* ── CONFIGURATION ────────────────────────────────────────
     All visual values live here. Adjust freely.
  ────────────────────────────────────────────────────────── */
  var CONFIG = {
    dotSize:         17,     /* px — larger navigation dots for readability */
    dotGap:          30,     /* px — space between dot centers */
    dotGapMin:       16,     /* px — narrow-desktop minimum before chip fallback */
    desktopClearance: 24,    /* px — protects hover scale + edge labels */
    topInset:        38,     /* px — aligns the dot row closer to header center */

    /* Dot opacity states */
    opacityActive:   1.0,    /* current construct entry */
    opacityInactive: 0.22,   /* all other construct entries */
    opacityHover:    1.0,    /* any dot on hover */

    /* Label (tooltip above dot) */
    labelFont:       "'Inter',Arial,sans-serif",
    labelWeight:     700,    /* Inter 700 — bold but not 900 at this size */
    labelSize:       9,      /* px */
    labelTracking:   '0.14em',
    labelOffset:     8,      /* px — gap between top of dot and bottom of label */

    /* Fade-in delay — matches corner element so both appear together */
    fadeInDelay:     800,    /* ms */
    fadeInDuration:  600,    /* ms */

    zIndex:          999,    /* just below corner element (1000) */
  };

  /* ── READ CURRENT CONSTRUCT ENTRY ────────────────────────
     Reads data-venture from <body>.
     If missing or unrecognised, no dot is highlighted.
  ────────────────────────────────────────────────────────── */
  var currentKey = (document.body.getAttribute('data-venture') || '').toLowerCase();
  var PUZZLE_PIECE_SVG = '<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><path fill="currentColor" d="M30 30H48C48 19 52 12 60 12S72 19 72 30H90V48C101 48 108 52 108 60S101 72 90 72V90H72C72 79 68 72 60 72S48 79 48 90H30V72C41 72 48 68 48 60S41 48 30 48V30Z"/></svg>';


  /* ── BUILD NAV ────────────────────────────────────────────
     Structure per construct entry:
       .cnav-item              — wrapper, position:relative
         .cnav-label           — tooltip text, above dot
         .cnav-dot             — the colored circle
  ────────────────────────────────────────────────────────── */
  var nav = document.createElement('nav');
  nav.id = 'construct-nav';
  nav.setAttribute('aria-label', 'construct navigation');

  /* Nav is fixed, horizontally centered, vertically aligned
     with the corner element. Uses pointer-events:none on the
     nav itself so only the dot buttons capture clicks —
     prevents invisible hit areas between dots blocking page.

     Mobile (<700px): positioned relative to header, centered
     in the space between corner ring and cart button.
  ────────────────────────────────────────────────────────── */
  nav.style.cssText = [
    'position:fixed',
    'top:' + CONFIG.topInset + 'px',
    'left:50%',
    'transform:translateX(-50%)',
    'display:flex',
    'flex-wrap:wrap',
    'align-items:center',
    'justify-content:center',
    'gap:' + CONFIG.dotGap + 'px',
    'z-index:' + CONFIG.zIndex,
    'pointer-events:none',
    'opacity:0',
    'transition:opacity ' + CONFIG.fadeInDuration + 'ms ease, top 0ms, left 0ms, transform 0ms',
  ].join(';');


  var desktopColorBindings = [];

  var retryItem = document.createElement('div');
  retryItem.className = 'cnav-item cnav-retry-item';
  retryItem.style.cssText = [
    'position:relative',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'pointer-events:auto',
  ].join(';');

  var retryLabel = document.createElement('span');
  retryLabel.className = 'cnav-label';
  retryLabel.textContent = 'PUZZLE';
  retryLabel.style.cssText = [
    'position:absolute',
    'bottom:calc(100% + ' + CONFIG.labelOffset + 'px)',
    'left:50%',
    'transform:translateX(-50%)',
    'font-family:' + CONFIG.labelFont,
    'font-size:' + CONFIG.labelSize + 'px',
    'font-weight:' + CONFIG.labelWeight,
    'letter-spacing:' + CONFIG.labelTracking,
    'text-transform:uppercase',
    'color:' + readTokenColor('--color-about', '#FCB867'),
    'white-space:nowrap',
    'line-height:1',
    'opacity:0',
    'transition:opacity 180ms ease',
    'pointer-events:none',
  ].join(';');

  var retryAction = document.createElement('button');
  retryAction.type = 'button';
  retryAction.className = 'cnav-retry';
  retryAction.setAttribute('aria-label', 'Puzzle');
  retryAction.innerHTML = PUZZLE_PIECE_SVG;
  retryAction.style.cssText = [
    'width:22px',
    'height:22px',
    'padding:0',
    'border:0',
    'background:transparent',
    'color:' + readTokenColor('--color-about', '#FCB867'),
    'cursor:pointer',
    'opacity:0.62',
    'transition:opacity 180ms ease,transform 180ms ease',
    'pointer-events:auto',
    'flex-shrink:0',
  ].join(';');
  retryAction.querySelector('svg').style.cssText = 'display:block;width:100%;height:100%';
  retryItem.addEventListener('mouseenter', function() {
    retryAction.style.opacity = '1';
    retryAction.style.transform = 'scale(1.18)';
    retryLabel.style.opacity = '1';
  });
  retryItem.addEventListener('mouseleave', function() {
    retryAction.style.opacity = '0.62';
    retryAction.style.transform = 'scale(1)';
    retryLabel.style.opacity = '0';
  });
  retryAction.addEventListener('click', function() {
    if (typeof window._constructFade === 'function') window._constructFade('/');
    else window.location.href = '/';
  });
  retryItem.appendChild(retryLabel);
  retryItem.appendChild(retryAction);
  nav.appendChild(retryItem);

  VENTURES.forEach(function(v) {
    var isCurrent = (v.key === currentKey);

    /* ── Item wrapper ─── */
    var item = document.createElement('div');
    item.className = 'cnav-item';
    item.setAttribute('data-venture-key', v.key);
    item.style.cssText = [
      'position:relative',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'pointer-events:auto',   /* restore click target per item */
    ].join(';');


    /* ── Label (tooltip above dot) ─── */
    var label = document.createElement('span');
    label.className = 'cnav-label';
    label.textContent = v.label;
    label.style.cssText = [
      'position:absolute',
      'bottom:calc(100% + ' + CONFIG.labelOffset + 'px)',
      'left:50%',
      'transform:translateX(-50%)',
      'font-family:' + CONFIG.labelFont,
      'font-size:' + CONFIG.labelSize + 'px',
      'font-weight:' + CONFIG.labelWeight,
      'letter-spacing:' + CONFIG.labelTracking,
      'text-transform:uppercase',
      'color:' + v.color,
      'white-space:nowrap',
      'line-height:1',
      'opacity:0',
      'transition:opacity 180ms ease',
      'pointer-events:none',
    ].join(';');


    /* ── Dot ─── */
    var dot = document.createElement('button');
    dot.className = 'cnav-dot';
    dot.setAttribute('aria-label', v.label);
    dot.setAttribute('data-bg-color', v.color);  // store for desktop restore

    /* Base opacity: full for current entry, dim for others */
    var baseOpacity = isCurrent
      ? CONFIG.opacityActive
      : CONFIG.opacityInactive;

    dot.style.cssText = [
      'width:' + CONFIG.dotSize + 'px',
      'height:' + CONFIG.dotSize + 'px',
      'border-radius:50%',
      'background:' + v.color,
      'border:none',
      'padding:0',
      'cursor:' + (isCurrent ? 'default' : 'pointer'),
      'opacity:' + baseOpacity,
      'transition:opacity 180ms ease, transform 180ms ease',
      'flex-shrink:0',
    ].join(';');

    /* Mobile: current entry dot shows as open ring instead of dim filled dot */
    if (isCurrent) {
      dot.setAttribute('data-current', 'true');
    }


    /* ── Hover: brighten dot + show label ─── */
    item.addEventListener('mouseenter', function() {
      dot.style.opacity = String(CONFIG.opacityHover);
      dot.style.transform = 'scale(1.35)';
      label.style.opacity = '1';
    });

    item.addEventListener('mouseleave', function() {
      dot.style.opacity = String(baseOpacity);
      dot.style.transform = 'scale(1)';
      label.style.opacity = '0';
    });


    /* ── Click: fade to construct entry URL ─── */
    dot.addEventListener('click', function() {
      /* Don't navigate if already on this construct entry */
      if (isCurrent) return;

      if (typeof window._constructFade === 'function') {
        window._constructFade(v.url);
      } else {
        window.location.href = v.url;
      }
    });


    item.appendChild(label);
    item.appendChild(dot);
    nav.appendChild(item);
    desktopColorBindings.push({ venture: v, label: label, dot: dot });
  });

  var isExplorePage = window.location.pathname === '/adventure' || window.location.pathname.startsWith('/adventure/');
  var exploreAction = document.createElement('button');
  exploreAction.type = 'button';
  exploreAction.className = 'cnav-explore';
  exploreAction.textContent = 'ADVENTURE';
  exploreAction.setAttribute('aria-label', 'Adventure through the Construct');
  if (isExplorePage) exploreAction.setAttribute('aria-current', 'page');
  exploreAction.style.cssText = [
    'min-height:32px',
    'padding:6px 8px 5px 12px',
    'border:0',
    'border-left:5px solid ' + readTokenColor('--color-about', '#FCB867'),
    'border-radius:0',
    'background:' + (isExplorePage ? readTokenColor('--color-about', '#FCB867') : 'transparent'),
    'color:' + (isExplorePage ? readTokenColor('--color-bg', '#0e0e0e') : readTokenColor('--color-about', '#FCB867')),
    'font-family:' + CONFIG.labelFont,
    'font-size:9px',
    'font-weight:700',
    'letter-spacing:0.14em',
    'line-height:1',
    'cursor:' + (isExplorePage ? 'default' : 'pointer'),
    'pointer-events:auto',
  ].join(';');
  exploreAction.addEventListener('click', function() {
    if (isExplorePage) return;
    if (typeof window._constructFade === 'function') window._constructFade('/adventure/');
    else window.location.href = '/adventure/';
  });
  nav.appendChild(exploreAction);

  var exploreFocusStyle = document.createElement('style');
  exploreFocusStyle.textContent = '.cnav-retry:focus-visible,.cnav-explore:focus-visible,#cnav-mobile-retry:focus-visible,#cnav-mobile-explore:focus-visible{outline:3px solid #FCB867;outline-offset:3px;}';
  document.head.appendChild(exploreFocusStyle);

  document.body.appendChild(nav);


  /* ── MOBILE: CHIP + CANVAS BLOOM RING ─────────────────────
     Below MOBILE_BP the desktop dot row is replaced by the
     previewed chip and full-screen bloom navigation.
  ────────────────────────────────────────────────────────── */

  var SITE_BG = readTokenColor('--color-bg', '#0e0e0e');
  var PARTICLE_COLOR = readTokenColor('--color-about', '#FCB867');
  var WORDMARK_RING_COLOR = readTokenColor('--color-archive', '#6D3D15');
  var MOBILE_RING_RADIUS = 122;
  var MOBILE_BLOOM_DUR = 2200;
  var MOBILE_CLOSE_DUR = 520;
  var MOBILE_NODE_SIZE = 18;
  var MOBILE_PARTICLE_COUNT = 42;
  var MOBILE_TRAVEL_END = 0.85;
  var MOBILE_XFADE_START = 0.42;
  var MOBILE_ORBIT_SPEED = 0.00012;
  var MOBILE_ORBIT_RADIUS = 14;
  var MOBILE_ACTIVE_NODE_RADIUS = 40;
  var MOBILE_ACTIVE_NODE_INNER = 28;
  var MOBILE_SUBNODE_SIZE = 14;
  var MOBILE_SUBNODE_ORBIT_SPEED = 0.00012;
  var MOBILE_SUBNODE_DUR = 2630;
  var MOBILE_SUBNODE_CLOSE_DUR = 560;
  var GLYPH_R = 32;
  var GLYPH_INNER = 22;
  var HOME_DOT_POSITIONS = [[-18, -28], [18, -28], [-18, 0], [18, 0], [-18, 28], [18, 28]];
  var HOME_FROM_DOT = {
    tattooing: 0,
    art: 1,
    merch: 2,
    events: 3,
    music: 4,
    archive: 5,
  };
  var WM_SIZE = 30;
  var WM_OUTER = 12;
  var WM_INNER = 8.5;
  var WM_DOTR = 1.7;
  var WM_FACTOR = WM_OUTER / 56;
  var WM_DOTS = [[-18, -28], [18, -28], [-18, 0], [18, 0], [-18, 28], [18, 28]].map(function(d) {
    return [d[0] * WM_FACTOR, d[1] * WM_FACTOR];
  });
  var currentVenture = null;
  VENTURES.forEach(function(v) { if (v.key === currentKey) currentVenture = v; });

  var mScrim = document.createElement('div');
  mScrim.id = 'cnav-mobile-overlay';
  mScrim.style.cssText = [
    'position:fixed', 'inset:0',
    'background:' + SITE_BG,
    'opacity:0', 'pointer-events:none',
    'transition:opacity 550ms ease',
    'z-index:1100', 'display:none',
    'overflow:hidden',
  ].join(';');

  var mCanvas = document.createElement('canvas');
  mCanvas.id = 'cnav-mobile-canvas';
  mCanvas.style.cssText = [
    'position:absolute', 'inset:0',
    'width:100%', 'height:100%',
    'display:block',
  ].join(';');
  var mCtx = mCanvas.getContext('2d');

  var mLabels = document.createElement('div');
  mLabels.id = 'cnav-mobile-labels';
  mLabels.style.cssText = [
    'position:absolute', 'inset:0',
    'pointer-events:none',
  ].join(';');

  var mCenterLabel = document.createElement('div');
  mCenterLabel.id = 'cnav-mobile-center-label';
  mCenterLabel.style.cssText = [
    'position:absolute',
    'font-family:' + CONFIG.labelFont,
    'font-size:13px',
    'font-weight:900',
    'letter-spacing:-0.06em',
    'text-transform:uppercase',
    'transform:translate(-50%,0)',
    'white-space:nowrap',
    'text-align:center',
    'opacity:0',
    'transition:opacity 400ms ease',
    'pointer-events:none',
  ].join(';');

  var mWordmark = document.createElement('div');
  mWordmark.id = 'cnav-mobile-wordmark';
  mWordmark.style.cssText = [
    'position:absolute',
    'top:16px',
    'left:50%',
    'transform:translateX(-50%)',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'white-space:nowrap',
    'opacity:0',
    'transition:opacity 600ms ease',
    'pointer-events:auto',
    'cursor:pointer',
  ].join(';');
  mWordmark.setAttribute('role', 'link');
  mWordmark.setAttribute('aria-label', 'go to home page');
  mWordmark.setAttribute('tabindex', '0');

  var mWmCanvas = document.createElement('canvas');
  mWmCanvas.id = 'cnav-mobile-wordmark-glyph';
  mWmCanvas.style.cssText = [
    'flex-shrink:0',
    'display:block',
    'width:' + WM_SIZE + 'px',
    'height:' + WM_SIZE + 'px',
  ].join(';');
  var mWmCtx = mWmCanvas.getContext('2d');

  var mWmText = document.createElement('span');
  mWmText.textContent = 'the six.well construct';
  mWmText.style.cssText = [
    'font-family:' + CONFIG.labelFont,
    'font-weight:900',
    'font-size:22px',
    'letter-spacing:-0.05em',
    'color:' + PARTICLE_COLOR,
    'line-height:1',
  ].join(';');

  mWordmark.appendChild(mWmCanvas);
  mWordmark.appendChild(mWmText);

  var mBack = document.createElement('button');
  mBack.id = 'cnav-mobile-back';
  mBack.type = 'button';
  mBack.setAttribute('aria-label', 'return to construct nodes');
  mBack.innerHTML = '<span aria-hidden="true">&lsaquo;</span><span>return</span>';
  mBack.style.cssText = [
    'position:absolute',
    'left:16px',
    'bottom:max(20px,env(safe-area-inset-bottom,20px))',
    'display:none',
    'align-items:center',
    'gap:6px',
    'padding:6px 9px 6px 7px',
    'background:rgba(20,18,15,0.55)',
    'backdrop-filter:blur(6px)',
    'border:2px solid rgba(252,184,103,0.47)',
    'border-radius:4px',
    'color:rgba(252,184,103,0.6)',
    'font-family:' + CONFIG.labelFont,
    'font-size:8.5px',
    'font-weight:500',
    'letter-spacing:0.18em',
    'text-transform:uppercase',
    'cursor:pointer',
    'opacity:0',
    'transition:opacity 350ms ease',
    'pointer-events:none',
    'z-index:2',
  ].join(';');

  var mRetry = document.createElement('button');
  mRetry.id = 'cnav-mobile-retry';
  mRetry.type = 'button';
  mRetry.setAttribute('aria-label', 'Puzzle');
  mRetry.innerHTML = PUZZLE_PIECE_SVG;
  mRetry.style.cssText = [
    'position:absolute',
    'top:72px',
    'left:calc(50% - 122px)',
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'width:44px',
    'height:44px',
    'padding:7px',
    'border:5px solid ' + PARTICLE_COLOR,
    'border-radius:0',
    'background:' + SITE_BG,
    'color:' + PARTICLE_COLOR,
    'cursor:pointer',
    'opacity:0',
    'transition:opacity 350ms ease',
    'pointer-events:none',
    'z-index:2',
  ].join(';');
  mRetry.querySelector('svg').style.cssText = 'display:block;width:100%;height:100%';

  var mExplore = document.createElement('button');
  mExplore.id = 'cnav-mobile-explore';
  mExplore.type = 'button';
  mExplore.textContent = 'ADVENTURE';
  mExplore.setAttribute('aria-label', 'Adventure through the Construct');
  if (isExplorePage) mExplore.setAttribute('aria-current', 'page');
  mExplore.style.cssText = [
    'position:absolute',
    'top:72px',
    'left:50%',
    'transform:translateX(-50%)',
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'min-width:132px',
    'min-height:44px',
    'padding:9px 14px',
    'border:5px solid ' + PARTICLE_COLOR,
    'border-radius:0',
    'background:' + (isExplorePage ? PARTICLE_COLOR : SITE_BG),
    'color:' + (isExplorePage ? SITE_BG : PARTICLE_COLOR),
    'font-family:' + CONFIG.labelFont,
    'font-size:10px',
    'font-weight:700',
    'letter-spacing:0.18em',
    'text-transform:uppercase',
    'cursor:' + (isExplorePage ? 'default' : 'pointer'),
    'opacity:0',
    'transition:opacity 350ms ease',
    'pointer-events:none',
    'z-index:2',
  ].join(';');

  mScrim.appendChild(mCanvas);
  mScrim.appendChild(mLabels);
  mScrim.appendChild(mCenterLabel);
  mScrim.appendChild(mWordmark);
  mScrim.appendChild(mBack);
  mScrim.appendChild(mRetry);
  mScrim.appendChild(mExplore);

  /* mRing remains as a compatibility handle for responsive hide/show code. */
  var mRing = mScrim;

  var mChip = document.createElement('button');
  mChip.id = 'cnav-chip';
  mChip.setAttribute('aria-label', 'open navigation');
  mChip.setAttribute('aria-expanded', 'false');
  var chipColor = currentVenture ? currentVenture.color : '#FCB867';
  var chipLabel = currentVenture ? currentVenture.label : 'MENU';
  mChip.style.cssText = [
    'position:fixed', 'top:30px', 'left:50%',
    'transform:translate(-50%,-50%)',
    'display:none', 'align-items:center', 'gap:7px',
    'background:' + chipColor,
    'color:' + SITE_BG,
    'font-family:' + CONFIG.labelFont,
    'font-size:11px', 'font-weight:900',
    'letter-spacing:0.06em', 'text-transform:uppercase',
    'padding:8px 15px', 'border:none', 'border-radius:20px',
    'cursor:pointer', 'white-space:nowrap',
    'z-index:1103', 'opacity:0',
    'transition:opacity ' + CONFIG.fadeInDuration + 'ms ease',
  ].join(';');
  var chipText = document.createElement('span');
  chipText.textContent = chipLabel;
  var chipCaret = document.createElement('span');
  chipCaret.textContent = '▾';
  chipCaret.style.cssText = 'font-size:14px;line-height:1;transition:transform 300ms ease';
  mChip.appendChild(chipText);
  mChip.appendChild(chipCaret);

  var mobileNodes = [];
  var mobileParticles = [];
  var mobileSubNodes = [];
  var activeMobileNode = null;
  var mobileSubnodeProgress = 0;
  var mobileSubnodeTarget = 0;
  var ringOpen = false;
  var mobileState = 'closed';
  var mobileAnimStart = 0;
  var mobileAlpha = 0;
  var mobileLastT = null;
  var mobileW = 0;
  var mobileH = 0;
  var mobileCx = 0;
  var mobileCy = 0;
  var mobileDpr = 1;
  var mobileMotionMs = 0;

  function applyTokenColorsToRenderedNav() {
    refreshVentureColors();
    SITE_BG = readTokenColor('--color-bg', '#0e0e0e');
    PARTICLE_COLOR = readTokenColor('--color-about', '#FCB867');
    WORDMARK_RING_COLOR = readTokenColor('--color-archive', '#6D3D15');

    desktopColorBindings.forEach(function(binding) {
      binding.label.style.color = binding.venture.color;
      binding.dot.setAttribute('data-bg-color', binding.venture.color);
      binding.dot.style.background = binding.venture.color;
    });

    if (currentVenture) {
      mChip.style.background = currentVenture.color;
      mCenterLabel.style.color = currentVenture.color;
    } else {
      mChip.style.background = PARTICLE_COLOR;
    }
    mScrim.style.background = SITE_BG;
    mWmText.style.color = PARTICLE_COLOR;
    exploreAction.style.borderLeftColor = PARTICLE_COLOR;
    exploreAction.style.background = isExplorePage ? PARTICLE_COLOR : 'transparent';
    exploreAction.style.color = isExplorePage ? SITE_BG : PARTICLE_COLOR;
    retryLabel.style.color = PARTICLE_COLOR;
    retryAction.style.color = PARTICLE_COLOR;
    mRetry.style.borderColor = PARTICLE_COLOR;
    mRetry.style.background = SITE_BG;
    mRetry.style.color = PARTICLE_COLOR;
    mExplore.style.borderColor = PARTICLE_COLOR;
    mExplore.style.background = isExplorePage ? PARTICLE_COLOR : SITE_BG;
    mExplore.style.color = isExplorePage ? SITE_BG : PARTICLE_COLOR;
    mobileNodes.forEach(function(nd) {
      nd.el.style.color = nd.venture.color;
    });
  }

  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutSoft(t) { return 1 - Math.pow(1 - t, 2); }
  function smoothBreath(phase) {
    var s = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
    return s * s * (3 - 2 * s);
  }
  function otherVentures() {
    return VENTURES.filter(function(v) { return v.key !== currentKey; });
  }
  function hexToRgb(hex) {
    var c = hex.replace('#', '');
    return {
      r: parseInt(c.slice(0, 2), 16),
      g: parseInt(c.slice(2, 4), 16),
      b: parseInt(c.slice(4, 6), 16),
    };
  }
  function lerpColor(a, b, t) {
    var ca = hexToRgb(a);
    var cb = hexToRgb(b);
    return 'rgb(' + Math.round(lerp(ca.r, cb.r, t)) + ',' + Math.round(lerp(ca.g, cb.g, t)) + ',' + Math.round(lerp(ca.b, cb.b, t)) + ')';
  }
  function mobileStartForNode(v) {
    var fromDot = HOME_FROM_DOT[v.key];
    if (typeof fromDot === 'number') {
      var factor = GLYPH_R / 56;
      var d = HOME_DOT_POSITIONS[fromDot];
      return {
        x: mobileCx + d[0] * factor,
        y: mobileCy + d[1] * factor,
        r: 7.5 * factor,
      };
    }
    return { x: mobileCx, y: mobileCy, r: 3 };
  }
  function mobileAnchorForNode(nd) {
    var orbit = mobileMotionMs * MOBILE_ORBIT_SPEED;
    var angle = nd.angle + orbit;
    var radius = MOBILE_RING_RADIUS + Math.sin(orbit * 0.65) * MOBILE_ORBIT_RADIUS;
    return {
      x: mobileCx + Math.cos(angle) * radius,
      y: mobileCy + Math.sin(angle) * radius,
    };
  }

  function resizeMobileCanvas() {
    mobileDpr = Math.min(window.devicePixelRatio || 1, 2);
    mobileW = window.innerWidth;
    mobileH = window.innerHeight;
    mCanvas.width = Math.round(mobileW * mobileDpr);
    mCanvas.height = Math.round(mobileH * mobileDpr);
    mCtx.setTransform(mobileDpr, 0, 0, mobileDpr, 0, 0);
    mWmCanvas.width = Math.round(WM_SIZE * mobileDpr);
    mWmCanvas.height = Math.round(WM_SIZE * mobileDpr);
    mWmCtx.setTransform(mobileDpr, 0, 0, mobileDpr, 0, 0);
    mobileCx = mobileW / 2;
    mobileCy = mobileH * 0.46;
  }

  function buildMobileNodes() {
    mLabels.innerHTML = '';
    mobileNodes = [];
    mobileSubNodes = [];
    activeMobileNode = null;
    mobileSubnodeProgress = 0;
    mobileSubnodeTarget = 0;
    var list = otherVentures();
    var n = list.length;
    list.forEach(function(v, i) {
      var ang = (-90 + i * (360 / n)) * Math.PI / 180;
      var el = document.createElement('div');
      el.textContent = v.label + ' .';
      el.style.cssText = [
        'position:absolute',
        'font-family:' + CONFIG.labelFont,
        'font-weight:900',
        'font-size:13px',
        'letter-spacing:-0.06em',
        'text-transform:uppercase',
        'transform:translate(-50%,0)',
        'white-space:nowrap',
        'opacity:0',
        'transition:opacity 250ms ease',
        'pointer-events:none',
        'color:' + v.color,
      ].join(';');
      mLabels.appendChild(el);
      mobileNodes.push({
        venture: v,
        angle: ang,
        el: el,
        x: mobileCx,
        y: mobileCy,
        r: 0,
        alpha: 0,
      });
    });

    if (currentVenture) {
      mCenterLabel.textContent = currentVenture.label + ' .';
      mCenterLabel.style.color = currentVenture.color;
    }
  }

  function clearMobileSubnodes() {
    mobileSubNodes.forEach(function(subnode) {
      if (subnode.el && subnode.el.parentNode) subnode.el.parentNode.removeChild(subnode.el);
    });
    mobileSubNodes = [];
    activeMobileNode = null;
    mobileSubnodeProgress = 0;
    mobileSubnodeTarget = 0;
    mBack.style.opacity = '0';
    mBack.style.pointerEvents = 'none';
    mBack.style.display = 'none';
    if (currentVenture) {
      mCenterLabel.textContent = currentVenture.label + ' .';
      mCenterLabel.style.color = currentVenture.color;
    }
  }

  function collapseMobileSubnodes() {
    mobileSubnodeTarget = 0;
    mBack.style.opacity = '0';
    mBack.style.pointerEvents = 'none';
  }

  function openMobileSubnodes(venture) {
    var pathways = venture && Array.isArray(venture.pathways) ? venture.pathways : [];
    if (!pathways.length) {
      if (typeof window._constructFade === 'function') window._constructFade(venture.url);
      else window.location.href = venture.url;
      return;
    }
    if (activeMobileNode && activeMobileNode.venture === venture) {
      if (venture.key === currentKey) {
        mobileSubnodeTarget = 1;
        mBack.style.display = 'inline-flex';
        mBack.style.pointerEvents = 'auto';
        requestAnimationFrame(function() { mBack.style.opacity = '0.65'; });
        return;
      }
      if (typeof window._constructFade === 'function') window._constructFade(venture.url);
      else window.location.href = venture.url;
      return;
    }

    clearMobileSubnodes();
    var selected = null;
    mobileNodes.forEach(function(node) {
      if (node.venture === venture) selected = node;
    });
    activeMobileNode = selected || {
      venture: venture,
      x: mobileCx,
      y: mobileCy,
      r: GLYPH_R,
      el: null,
      isCenter: true,
    };
    activeMobileNode.originX = activeMobileNode.x;
    activeMobileNode.originY = activeMobileNode.y;

    pathways.slice(0, 9).forEach(function(pathway, i) {
      var el = document.createElement('div');
      el.textContent = pathway.label;
      el.style.cssText = [
        'position:absolute',
        'font-family:Georgia,Times New Roman,serif',
        'font-size:clamp(11px,3.2vw,13px)',
        'font-weight:bold',
        'letter-spacing:0.03em',
        'text-transform:lowercase',
        'line-height:1.18',
        'text-align:center',
        'transform:translate(-50%,0)',
        'white-space:normal',
        'max-width:min(96px,28vw)',
        'pointer-events:none',
        'opacity:0',
        'color:' + (pathway.color || venture.color),
      ].join(';');
      mLabels.appendChild(el);
      mobileSubNodes.push({
        pathway: pathway,
        venture: venture,
        index: i,
        count: Math.min(pathways.length, 9),
        el: el,
        x: activeMobileNode.originX,
        y: activeMobileNode.originY,
        r: 0,
      });
    });
    mCenterLabel.textContent = venture.label + ' .';
    mCenterLabel.style.color = venture.color;
    mobileSubnodeTarget = 1;
    mBack.style.display = 'inline-flex';
    mBack.style.pointerEvents = 'auto';
    requestAnimationFrame(function() { mBack.style.opacity = '0.65'; });
  }

  function updateMobileSubnodes(dt) {
    var duration = mobileSubnodeTarget > mobileSubnodeProgress
      ? MOBILE_SUBNODE_DUR
      : MOBILE_SUBNODE_CLOSE_DUR;
    var step = dt / duration;
    if (mobileSubnodeProgress < mobileSubnodeTarget) {
      mobileSubnodeProgress = Math.min(mobileSubnodeTarget, mobileSubnodeProgress + step);
    } else if (mobileSubnodeProgress > mobileSubnodeTarget) {
      mobileSubnodeProgress = Math.max(mobileSubnodeTarget, mobileSubnodeProgress - step);
      if (mobileSubnodeProgress === 0) clearMobileSubnodes();
    }
  }

  function drawMobileSubnodes() {
    if (!activeMobileNode || !mobileSubNodes.length || mobileSubnodeProgress <= 0) return;
    var ringRadius = Math.min(mobileW * 0.34, mobileH * 0.26);
    var subOrbit = mobileMotionMs * MOBILE_SUBNODE_ORBIT_SPEED;
    var parentX = activeMobileNode.isCenter ? mobileCx : activeMobileNode.x;
    var parentY = activeMobileNode.isCenter ? mobileCy : activeMobileNode.y;
    mobileSubNodes.forEach(function(subnode) {
      var delay = (subnode.index / subnode.count) * 0.42;
      var ep = mobileSubnodeTarget === 0
        ? easeInOut(mobileSubnodeProgress)
        : easeOut(clamp01((mobileSubnodeProgress - delay) / (1 - delay + 0.001)));
      var angle = Math.PI / 2 + (subnode.index / subnode.count) * Math.PI * 2 + subOrbit;
      var targetX = parentX + Math.cos(angle) * ringRadius;
      var targetY = parentY + Math.sin(angle) * ringRadius;
      subnode.x = lerp(parentX, targetX, ep);
      subnode.y = lerp(parentY, targetY, ep);
      subnode.r = lerp(2, MOBILE_SUBNODE_SIZE, ep);

      mCtx.globalAlpha = mobileAlpha * ep * 0.88;
      mCtx.beginPath();
      mCtx.arc(subnode.x, subnode.y, subnode.r, 0, Math.PI * 2);
      mCtx.fillStyle = subnode.pathway.color || subnode.venture.color;
      mCtx.fill();
      mCtx.globalAlpha = 1;

      subnode.el.style.left = subnode.x + 'px';
      subnode.el.style.top = (subnode.y + MOBILE_SUBNODE_SIZE + 8) + 'px';
      subnode.el.style.opacity = ep > 0.35 ? String(ep * 0.65) : '0';
    });
  }

  function drawMobileActiveParent() {
    if (!activeMobileNode || mobileSubnodeProgress <= 0) return;
    var takeover = easeInOut(mobileSubnodeProgress);
    var ringT = easeOutSoft(Math.min(mobileSubnodeProgress * 2.5, 1));
    var parentX = activeMobileNode.isCenter ? mobileCx : activeMobileNode.x;
    var parentY = activeMobileNode.isCenter ? mobileCy : activeMobileNode.y;
    var startR = activeMobileNode.isCenter ? GLYPH_R : MOBILE_NODE_SIZE;
    var outer = lerp(startR, MOBILE_ACTIVE_NODE_RADIUS, takeover);
    var inner = lerp(Math.max(1, startR * 0.25), MOBILE_ACTIVE_NODE_INNER, takeover);

    mCtx.save();
    mCtx.globalAlpha = mobileAlpha * ringT;
    mCtx.beginPath();
    mCtx.arc(parentX, parentY, outer, 0, Math.PI * 2);
    mCtx.arc(parentX, parentY, inner, 0, Math.PI * 2, true);
    mCtx.fillStyle = activeMobileNode.venture.color;
    mCtx.fill();
    mCtx.restore();
  }

  function spawnMobileParticle(seeded) {
    var p = {
      angle: Math.random() * Math.PI * 2,
      dist: GLYPH_R,
      target: GLYPH_R + 18 + Math.random() * 120,
      orbit: (Math.random() * 0.00003 + 0.00001) * (Math.random() < 0.5 ? 1 : -1),
      driftSpeed: 0.0025 + Math.random() * 0.006,
      size: 1 + Math.random() * 2.1,
      maxAlpha: 0.12 + Math.random() * 0.30,
      fAX: 2 + Math.random() * 4,
      fAY: 2 + Math.random() * 4,
      fPX: 12000 + Math.random() * 10000,
      fPY: 14000 + Math.random() * 10000,
      fOX: Math.random() * Math.PI * 2,
      fOY: Math.random() * Math.PI * 2,
      fadeIn: 700 + Math.random() * 500,
      fadeOut: 1200 + Math.random() * 900,
      age: 0,
      life: null,
      reached: false,
    };
    if (seeded) {
      var fr = Math.random();
      p.dist = GLYPH_R + fr * (p.target - GLYPH_R);
      p.age = fr * (p.fadeIn + 2500);
      if (p.dist >= p.target) {
        p.reached = true;
        p.life = p.age + 3000 + Math.random() * 6000;
      }
    }
    mobileParticles.push(p);
  }

  function updateMobileParticles(dt, t, visible) {
    var cap = visible ? MOBILE_PARTICLE_COUNT : 0;
    while (mobileParticles.length < cap) spawnMobileParticle(true);
    for (var i = mobileParticles.length - 1; i >= 0; i--) {
      var p = mobileParticles[i];
      p.age += dt;
      p.angle += p.orbit * dt;
      if (!p.reached) {
        p.dist += p.driftSpeed * dt;
        if (p.dist >= p.target) {
          p.dist = p.target;
          p.reached = true;
          p.life = p.age + 3000 + Math.random() * 6000;
        }
      }
      if ((p.reached && p.age >= p.life) || mobileParticles.length > cap) {
        mobileParticles.splice(i, 1);
        continue;
      }
      var alpha;
      if (!p.reached) {
        alpha = Math.min(p.age / p.fadeIn, 1) * p.maxAlpha;
      } else {
        var tl = p.life - p.age;
        alpha = tl < p.fadeOut ? (tl / p.fadeOut) * p.maxAlpha : p.maxAlpha;
      }
      var fx = p.fAX * Math.sin((t / p.fPX) * Math.PI * 2 + p.fOX);
      var fy = p.fAY * Math.sin((t / p.fPY) * Math.PI * 2 + p.fOY);
      var px = mobileCx + Math.cos(p.angle) * p.dist + fx;
      var py = mobileCy + Math.sin(p.angle) * p.dist + fy;
      mCtx.globalAlpha = alpha * mobileAlpha;
      mCtx.beginPath();
      mCtx.arc(px, py, p.size, 0, Math.PI * 2);
      mCtx.fillStyle = PARTICLE_COLOR;
      mCtx.fill();
    }
    mCtx.globalAlpha = 1;
  }

  function drawMobileGlyph(t) {
    if (!currentVenture) return;
    var breath = smoothBreath((t * 1.375) / 9000);
    var grow = 1 + 0.03 * (breath - 0.5);
    var outer = GLYPH_R * grow;
    var inner = GLYPH_INNER * grow;
    var takeoverFade = activeMobileNode
      ? 1 - easeOutSoft(Math.min(mobileSubnodeProgress * 2.5, 1))
      : 1;
    mCtx.save();
    mCtx.globalAlpha = mobileAlpha * takeoverFade * (0.88 + 0.12 * breath);
    mCtx.beginPath();
    mCtx.arc(mobileCx, mobileCy, outer, 0, Math.PI * 2);
    mCtx.arc(mobileCx, mobileCy, inner, 0, Math.PI * 2, true);
    mCtx.fillStyle = currentVenture.color;
    mCtx.fill();
    mCtx.restore();
  }

  function drawMobileWordmarkGlyph(t) {
    var c = WM_SIZE / 2;
    mWmCtx.clearRect(0, 0, WM_SIZE, WM_SIZE);
    mWmCtx.beginPath();
    mWmCtx.arc(c, c, WM_OUTER, 0, Math.PI * 2);
    mWmCtx.arc(c, c, WM_INNER, 0, Math.PI * 2, true);
    mWmCtx.fillStyle = WORDMARK_RING_COLOR;
    mWmCtx.fill();
    var orbit = t * 0.003;
    for (var i = 0; i < WM_DOTS.length; i++) {
      var d = WM_DOTS[i];
      var ang = Math.atan2(d[1], d[0]) + orbit;
      var dist = Math.hypot(d[0], d[1]) + Math.sin(t * 0.025 + i * 1.1) * 1.5 * WM_FACTOR;
      mWmCtx.beginPath();
      mWmCtx.arc(c + Math.cos(ang) * dist, c + Math.sin(ang) * dist, WM_DOTR, 0, Math.PI * 2);
      mWmCtx.fillStyle = PARTICLE_COLOR;
      mWmCtx.globalAlpha = 0.9;
      mWmCtx.fill();
      mWmCtx.globalAlpha = 1;
    }
  }

  function mobileProgress(now) {
    if (mobileState === 'opening') {
      var p = clamp01((now - mobileAnimStart) / MOBILE_BLOOM_DUR);
      if (p >= 1) mobileState = 'open';
      return p;
    }
    if (mobileState === 'open') return 1;
    if (mobileState === 'closing') {
      var c = clamp01((now - mobileAnimStart) / MOBILE_CLOSE_DUR);
      if (c >= 1) {
        mobileState = 'closed';
        mScrim.style.display = 'none';
      }
      return 1 - c;
    }
    return 0;
  }

  function mobileFrame(now) {
    if (mobileLastT == null) mobileLastT = now;
    var dt = Math.min(now - mobileLastT, 50);
    mobileLastT = now;
    mCtx.clearRect(0, 0, mobileW, mobileH);
    drawMobileWordmarkGlyph(now);

    var wasOpen = mobileState === 'open';
    var prog = mobileProgress(now);
    if (wasOpen) mobileMotionMs += dt;
    var visible = mobileState !== 'closed';
    mobileAlpha = easeOutSoft(prog);

    if (visible) {
      updateMobileParticles(dt, now, mobileState === 'open' || mobileState === 'opening');
      updateMobileSubnodes(dt);
      drawMobileGlyph(now);

      var n = mobileNodes.length;
      for (var i = 0; i < n; i++) {
        var nd = mobileNodes[i];
        var staggered = prog;
        var travel = easeOut(clamp01(staggered / MOBILE_TRAVEL_END));
        var xfade = clamp01((staggered - MOBILE_XFADE_START) / (MOBILE_TRAVEL_END - MOBILE_XFADE_START));
        var bloomAlpha = 1 - xfade;
        var settledAlpha = easeOutSoft(xfade);
        var start = mobileStartForNode(nd.venture);
        var anchor = mobileAnchorForNode(nd);
        var travelX = lerp(start.x, anchor.x, travel);
        var travelY = lerp(start.y, anchor.y, travel);
        var takeover = activeMobileNode ? easeInOut(mobileSubnodeProgress) : 0;
        var takeoverFade = activeMobileNode
          ? easeOutSoft(Math.min(mobileSubnodeProgress * 2.5, 1))
          : 0;

        if (activeMobileNode === nd) {
          travelX = lerp(travelX, mobileCx, takeover);
          travelY = lerp(travelY, mobileCy, takeover);
        }

        nd.x = travelX;
        nd.y = travelY;

        nd.r = lerp(start.r, MOBILE_NODE_SIZE, travel);
        nd.alpha = Math.max(bloomAlpha * 0.9, settledAlpha);
        if (activeMobileNode) nd.alpha *= 1 - takeoverFade;

        mCtx.globalAlpha = mobileAlpha * nd.alpha;
        mCtx.beginPath();
        mCtx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
        mCtx.fillStyle = lerpColor(PARTICLE_COLOR, nd.venture.color, travel);
        mCtx.fill();
        mCtx.globalAlpha = 1;

        nd.el.style.left = nd.x + 'px';
        nd.el.style.top = (nd.y + nd.r + 8) + 'px';
        nd.el.style.opacity = (mobileState === 'closing')
          ? '0'
          : String(clamp01((settledAlpha - 0.25) / 0.75) * (1 - takeoverFade));
      }

      drawMobileActiveParent();
      drawMobileSubnodes();

      mCenterLabel.style.left = mobileCx + 'px';
      if (activeMobileNode) {
        var activeTakeover = easeInOut(mobileSubnodeProgress);
        var activeRingT = easeOutSoft(Math.min(mobileSubnodeProgress * 2.5, 1));
        var activeLabelY = activeMobileNode.isCenter ? mobileCy : activeMobileNode.y;
        var activeStartR = activeMobileNode.isCenter ? GLYPH_R : MOBILE_NODE_SIZE;
        mCenterLabel.style.left = (activeMobileNode.isCenter ? mobileCx : activeMobileNode.x) + 'px';
        mCenterLabel.style.top = (
          activeLabelY
          + lerp(activeStartR, MOBILE_ACTIVE_NODE_RADIUS, activeTakeover)
          + lerp(10, 27, activeRingT)
        ) + 'px';
      } else {
        mCenterLabel.style.top = (mobileCy + GLYPH_R + 10) + 'px';
      }
      mCenterLabel.style.opacity = (mobileState === 'closing') ? '0' : String(clamp01((prog - 0.5) / 0.5));
    }

    requestAnimationFrame(mobileFrame);
  }

  function openRing() {
    if (mobileState === 'open' || mobileState === 'opening') return;
    ringOpen = true;
    mobileMotionMs = 0;
    resizeMobileCanvas();
    buildMobileNodes();
    mScrim.style.display = 'block';
    mScrim.style.pointerEvents = 'auto';
    mobileState = 'opening';
    mobileAnimStart = performance.now();
    requestAnimationFrame(function() {
      mScrim.style.opacity = '0.94';
      mWordmark.style.opacity = '0.82';
      mRetry.style.opacity = '0.82';
      mRetry.style.pointerEvents = 'auto';
      mExplore.style.opacity = '0.82';
      mExplore.style.pointerEvents = 'auto';
      mChip.style.zIndex = '1099';
    });
    chipCaret.style.transform = 'rotate(180deg)';
    mChip.setAttribute('aria-expanded', 'true');
    mChip.setAttribute('aria-label', 'close navigation');
  }

  function closeRing() {
    if (mobileState === 'closed' || mobileState === 'closing') return;
    ringOpen = false;
    mobileState = 'closing';
    mobileAnimStart = performance.now();
    mScrim.style.opacity = '0';
    mScrim.style.pointerEvents = 'none';
    mWordmark.style.opacity = '0';
    mBack.style.opacity = '0';
    mBack.style.pointerEvents = 'none';
    mRetry.style.opacity = '0';
    mRetry.style.pointerEvents = 'none';
    mExplore.style.opacity = '0';
    mExplore.style.pointerEvents = 'none';
    mobileNodes.forEach(function(nd) { nd.el.style.opacity = '0'; });
    mCenterLabel.style.opacity = '0';
    chipCaret.style.transform = 'rotate(0deg)';
    mChip.setAttribute('aria-expanded', 'false');
    mChip.setAttribute('aria-label', 'open navigation');
    setTimeout(function() {
      if (!ringOpen) mChip.style.zIndex = '1103';
    }, MOBILE_CLOSE_DUR);
  }

  function hitMobileNode(mx, my) {
    if (mobileState !== 'open') return null;
    if (activeMobileNode) {
      return Math.hypot(mx - mobileCx, my - mobileCy) < Math.max(34, activeMobileNode.r + 18)
        ? activeMobileNode.venture
        : null;
    }
    for (var i = 0; i < mobileNodes.length; i++) {
      var nd = mobileNodes[i];
      if (Math.hypot(mx - nd.x, my - nd.y) < Math.max(28, nd.r + 18)) return nd.venture;
    }
    if (currentVenture && Math.hypot(mx - mobileCx, my - mobileCy) < GLYPH_R + 18) return currentVenture;
    return null;
  }

  function hitMobileSubnode(mx, my) {
    if (mobileState !== 'open' || mobileSubnodeProgress < 0.75) return null;
    for (var i = 0; i < mobileSubNodes.length; i++) {
      var subnode = mobileSubNodes[i];
      if (Math.hypot(mx - subnode.x, my - subnode.y) < Math.max(24, subnode.r + 15)) {
        return subnode.pathway;
      }
    }
    return null;
  }

  mCanvas.addEventListener('click', function(e) {
    var pathway = hitMobileSubnode(e.clientX, e.clientY);
    if (pathway) {
      if (typeof window._constructFade === 'function') window._constructFade(pathway.url);
      else window.location.href = pathway.url;
      return;
    }
    var hit = hitMobileNode(e.clientX, e.clientY);
    if (hit) {
      openMobileSubnodes(hit);
      return;
    }
    if (activeMobileNode) {
      collapseMobileSubnodes();
      return;
    }
    closeRing();
  });

  function goHomeFromWordmark() {
    if (typeof window._constructFade === 'function') {
      window._constructFade('/home/');
    } else {
      window.location.href = '/home/';
    }
  }

  mWordmark.addEventListener('click', function(e) {
    e.stopPropagation();
    goHomeFromWordmark();
  });
  mWordmark.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goHomeFromWordmark();
    }
  });

  mBack.addEventListener('click', function(e) {
    e.stopPropagation();
    collapseMobileSubnodes();
  });

  mRetry.addEventListener('click', function(e) {
    e.stopPropagation();
    if (typeof window._constructFade === 'function') window._constructFade('/');
    else window.location.href = '/';
  });

  mExplore.addEventListener('click', function(e) {
    e.stopPropagation();
    if (isExplorePage) return;
    if (typeof window._constructFade === 'function') window._constructFade('/adventure/');
    else window.location.href = '/adventure/';
  });

  mChip.addEventListener('click', function(e) {
    e.stopPropagation();
    if (ringOpen) closeRing(); else openRing();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && ringOpen) closeRing();
  });
  window.addEventListener('resize', function() {
    if (ringOpen) {
      resizeMobileCanvas();
    }
  });

  document.body.appendChild(mScrim);
  document.body.appendChild(mChip);
  resizeMobileCanvas();
  requestAnimationFrame(mobileFrame);


  /* ── FADE IN ──────────────────────────────────────────────
     Matches the corner element's fade-in delay so both
     appear at the same moment after the page entrance.
  ────────────────────────────────────────────────────────── */
  setTimeout(function() {
    nav.style.opacity = '1';
    mChip.style.opacity = '1';
  }, CONFIG.fadeInDelay);

  /* ── RESPONSIVE ───────────────────────────────────────────
     <700px: hide the 9-dot row and show the chip + bloom ring
             instead. The chip is centered in the header band,
             in the space between the corner ring (left) and the
             cart button (right).
     >=700px: fit the desktop dot row into the measured space
              between the corner lockup and right-side controls.
              If even the minimum gap cannot fit, use the chip.
  ────────────────────────────────────────────────────────── */
  var MOBILE_BP = 700;
  var TINY_BP   = 380;

  function visibleRect(element) {
    if (!element) return null;
    var style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    var rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }

  function desktopHeaderBounds(w) {
    var clearance = CONFIG.desktopClearance;
    var cornerRect = visibleRect(document.getElementById('construct-corner'));
    var leftBoundary = cornerRect ? cornerRect.right + clearance : clearance;

    var rightControls = Array.prototype.slice.call(document.querySelectorAll(
      'header.top .cart-toggle, header.top .nav-inquire'
    ));
    var header = document.querySelector('header.top');
    if (!rightControls.length && header) {
      rightControls = Array.prototype.slice.call(header.querySelectorAll('a, button, [role="button"]'));
    }

    var rightControlLeft = w;
    rightControls.forEach(function(control) {
      var rect = visibleRect(control);
      if (rect && rect.left >= w / 2) {
        rightControlLeft = Math.min(rightControlLeft, rect.left);
      }
    });

    return {
      left: leftBoundary,
      right: rightControlLeft < w ? rightControlLeft - clearance : w - clearance,
    };
  }

  function positionCompactChip(leftBoundary, rightBoundary, top) {
    mChip.style.display = 'inline-flex';
    mChip.style.top = top + 'px';

    var chipWidth = mChip.getBoundingClientRect().width;
    var minCenter = leftBoundary + chipWidth / 2;
    var maxCenter = rightBoundary - chipWidth / 2;
    var centerX = leftBoundary + Math.max(0, rightBoundary - leftBoundary) / 2;
    if (minCenter <= maxCenter) {
      centerX = Math.max(minCenter, Math.min(maxCenter, centerX));
    }
    mChip.style.left = centerX + 'px';
  }

  function applyResponsiveNav() {
    var w = window.innerWidth;

    if (w < MOBILE_BP) {
      nav.style.display = 'none';

      var corner = document.getElementById('construct-corner');
      var cornerRect = corner ? corner.getBoundingClientRect() : null;
      var ringRight = cornerRect ? cornerRect.right : (w < TINY_BP ? 68 : 72);

      var rightControls = Array.prototype.slice.call(document.querySelectorAll(
        'header.top .cart-toggle, header.top .nav-inquire'
      ));
      var header = document.querySelector('header.top');
      if (!rightControls.length && header) {
        rightControls = Array.prototype.slice.call(header.querySelectorAll('a, button'));
      }

      var rightControlLeft = w - (w < TINY_BP ? 12 : 16);
      rightControls.forEach(function(control) {
        var rect = control.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          rightControlLeft = Math.min(rightControlLeft, rect.left);
        }
      });

      var leftBoundary = ringRight + (w < TINY_BP ? 8 : 10);
      var rightBoundary = rightControlLeft - (w < TINY_BP ? 8 : 10);
      var availableWidth = Math.max(88, rightBoundary - leftBoundary);
      var centerX        = leftBoundary + (availableWidth / 2);

      mChip.style.display = 'inline-flex';
      mChip.style.top     = '30px';
      mChip.style.left    = centerX + 'px';

    } else {
      var desktopDots = nav.querySelectorAll('.cnav-dot');
      desktopDots.forEach(function(d) {
        d.style.width  = CONFIG.dotSize + 'px';
        d.style.height = CONFIG.dotSize + 'px';

        var isCurrent = d.hasAttribute('data-current');
        d.style.opacity = isCurrent ? String(CONFIG.opacityActive) : String(CONFIG.opacityInactive);
        d.style.border  = 'none';
        if (d.style.background === 'transparent' || !d.style.background) {
          var bgColor = d.getAttribute('data-bg-color');
          if (bgColor) d.style.background = bgColor;
        }
      });

      var bounds = desktopHeaderBounds(w);
      var dotCount = desktopDots.length;
      var retryWidth = Math.max(22, retryAction.getBoundingClientRect().width);
      var exploreWidth = Math.max(76, exploreAction.getBoundingClientRect().width);
      var minRowWidth = dotCount > 0
        ? retryWidth + (dotCount * CONFIG.dotSize) + exploreWidth + ((dotCount + 1) * CONFIG.dotGapMin)
        : 0;
      var availableWidth = Math.max(0, bounds.right - bounds.left);

      if (!dotCount || availableWidth < minRowWidth) {
        nav.style.display = 'none';
        positionCompactChip(bounds.left, bounds.right, CONFIG.topInset + CONFIG.dotSize / 2);
        return;
      }

      if (ringOpen) closeRing();
      mChip.style.display  = 'none';
      mScrim.style.display = 'none';
      mRing.style.display  = 'none';

      var fittedGap = dotCount > 1
        ? (availableWidth - retryWidth - (dotCount * CONFIG.dotSize) - exploreWidth) / (dotCount + 1)
        : CONFIG.dotGap;
      fittedGap = Math.max(CONFIG.dotGapMin, Math.min(CONFIG.dotGap, fittedGap));

      var rowWidth = retryWidth + (dotCount * CONFIG.dotSize) + exploreWidth + ((dotCount + 1) * fittedGap);
      var minCenter = bounds.left + rowWidth / 2;
      var maxCenter = bounds.right - rowWidth / 2;
      var centerX = Math.max(minCenter, Math.min(maxCenter, w / 2));

      nav.style.display        = 'flex';
      nav.style.top            = CONFIG.topInset + 'px';
      nav.style.left           = centerX + 'px';
      nav.style.transform      = 'translateX(-50%)';
      nav.style.justifyContent = 'center';
      nav.style.maxWidth       = 'none';
      nav.style.flexWrap       = 'nowrap';
      nav.style.gap            = fittedGap + 'px';
    }
  }

  applyResponsiveNav();
  ensureTokenStylesheet(function() {
    applyTokenColorsToRenderedNav();
    applyResponsiveNav();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(applyResponsiveNav);
  }
  window.addEventListener('resize', applyResponsiveNav);
  window.addEventListener('orientationchange', function() {
    setTimeout(applyResponsiveNav, 150);
  });

  (async function hydrateManagedConstructNav() {
    var snapshotKey = 'swc_managed_navigation_v1';
    var payload = null;
    try {
      var response = await fetch('/api/site/navigation', { cache: 'no-store', headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('navigation unavailable');
      payload = await response.json();
      localStorage.setItem(snapshotKey, JSON.stringify(payload));
    } catch (error) {
      try { payload = JSON.parse(localStorage.getItem(snapshotKey) || 'null'); } catch (ignored) { payload = null; }
    }
    if (!payload || !Array.isArray(payload.nodes) || !payload.nodes.length) return;
    var keyBySlug = { tattoos: 'tattooing', 'art-making': 'art', merch: 'merch', about: 'about', events: 'events', music: 'music', writings: 'writings', archive: 'archive', film: 'film' };
    var byKey = {};
    VENTURES.forEach(function(venture) { byKey[venture.key] = venture; });
    var ordered = payload.nodes.map(function(node) {
      var key = keyBySlug[node.slug] || node.slug;
      var venture = byKey[key];
      if (!venture) return null;
      venture.label = node.name || venture.label;
      venture.url = node.route || venture.url;
      venture.pathways = (node.pathways || []).slice(0, 9).map(function(pathway) {
        return {
          label: pathway.name,
          url: pathway.route,
          color: pathway.color || venture.color,
        };
      });
      return venture;
    }).filter(Boolean);
    if (!ordered.length) return;
    var managedKeys = new Set(ordered.map(function(venture) { return venture.key; }));
    nav.querySelectorAll('[data-venture-key]').forEach(function(item) {
      if (!managedKeys.has(item.getAttribute('data-venture-key'))) item.remove();
    });
    VENTURES.splice.apply(VENTURES, [0, VENTURES.length].concat(ordered));
    desktopColorBindings.forEach(function(binding) {
      binding.label.textContent = binding.venture.label;
      binding.label.style.color = binding.venture.color;
      binding.dot.setAttribute('aria-label', binding.venture.label);
      binding.dot.setAttribute('data-bg-color', binding.venture.color);
      binding.dot.style.background = binding.venture.color;
    });
    VENTURES.forEach(function(venture) {
      var item = nav.querySelector('[data-venture-key="' + venture.key + '"]');
      if (item) nav.appendChild(item);
    });
    nav.appendChild(exploreAction);
    currentVenture = null;
    VENTURES.forEach(function(venture) { if (venture.key === currentKey) currentVenture = venture; });
    if (currentVenture) chipText.textContent = currentVenture.label;
    // Rebuilding while the bloom is visible resets every node to the center.
    // That can happen when managed data resolves after a quick tap, making the
    // pill nav appear to collapse and open again. Existing nodes reference the
    // updated venture objects, so refresh their labels in place and let the
    // next normal open rebuild the managed order.
    if (mobileState === 'closed') {
      buildMobileNodes();
    } else {
      mobileNodes.forEach(function(node) {
        node.el.textContent = node.venture.label;
        node.el.style.color = node.venture.color;
      });
    }
    applyResponsiveNav();
    document.documentElement.setAttribute('data-managed-construct-nav', 'live');
  })();

  /* ── EXPOSE API ───────────────────────────────────────────
     Allows external scripts to show/hide the nav.
  ────────────────────────────────────────────────────────── */
  window._constructNav = {
    show: function() { nav.style.opacity = '1'; },
    hide: function() { nav.style.opacity = '0'; },
  };

  if (!window.__constructWayfindingLoaded && !document.querySelector('script[src^="/js/construct-wayfinding.js"]')) {
    var wayfindingScript = document.createElement('script');
    wayfindingScript.src = '/js/construct-wayfinding.js?v=20260715-breadcrumb-2';
    document.body.appendChild(wayfindingScript);
  }

})();
