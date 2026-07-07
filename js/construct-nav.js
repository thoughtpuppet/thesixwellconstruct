/* ============================================================
   construct-nav.js — the six.well construct
   ============================================================
   Renders a row of 9 colored dots, one per construct entry, fixed
   at the top of every inner page.

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

  refreshVentureColors();

  /* ── CONFIGURATION ────────────────────────────────────────
     All visual values live here. Adjust freely.
  ────────────────────────────────────────────────────────── */
  var CONFIG = {
    dotSize:         17,     /* px — larger navigation dots for readability */
    dotGap:          30,     /* px — space between dot centers */
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

  VENTURES.forEach(function(v) {
    var isCurrent = (v.key === currentKey);

    /* ── Item wrapper ─── */
    var item = document.createElement('div');
    item.className = 'cnav-item';
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
  var MOBILE_PARTICLE_COUNT = 26;
  var MOBILE_TRAVEL_END = 0.85;
  var MOBILE_XFADE_START = 0.42;
  var MOBILE_ORBIT_SPEED = 0.00007;
  var MOBILE_ORBIT_RADIUS = 8;
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

  mScrim.appendChild(mCanvas);
  mScrim.appendChild(mLabels);
  mScrim.appendChild(mCenterLabel);
  mScrim.appendChild(mWordmark);

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
  var mobileOrbit = 0;

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
  function mobileDriftOpenFactor(prog) {
    var t = clamp01(prog);
    return 0.04 + 0.96 * (t * t * t);
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
  function mobileAnchorForNode(nd, prog) {
    var orbitOpen = mobileDriftOpenFactor(prog);
    var orbitAngle = mobileOrbit * orbitOpen + nd.orbitPhase;
    var angle = nd.angle + mobileOrbit * 0.18 * orbitOpen;
    var drift = {
      x: nd.dax * orbitOpen * Math.sin((mobileLastT / nd.dpx) * Math.PI * 2 + nd.dox),
      y: nd.day * orbitOpen * Math.sin((mobileLastT / nd.dpy) * Math.PI * 2 + nd.doy),
    };
    return {
      x: mobileCx + Math.cos(angle) * MOBILE_RING_RADIUS + Math.cos(orbitAngle) * MOBILE_ORBIT_RADIUS * orbitOpen + drift.x,
      y: mobileCy + Math.sin(angle) * MOBILE_RING_RADIUS + Math.sin(orbitAngle) * MOBILE_ORBIT_RADIUS * orbitOpen + drift.y,
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
        orbitPhase: i * 0.77,
        dax: 4.5 + (i * 1.7) % 3.5,
        day: 3.5 + (i * 2.3) % 3.5,
        dpx: 18000 + (i * 3700) % 9000,
        dpy: 22000 + (i * 4100) % 8000,
        dox: i * 1.4,
        doy: i * 2.1,
      });
    });

    if (currentVenture) {
      mCenterLabel.textContent = currentVenture.label + ' .';
      mCenterLabel.style.color = currentVenture.color;
    }
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
    mCtx.save();
    mCtx.globalAlpha = mobileAlpha * (0.88 + 0.12 * breath);
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
    mobileOrbit += dt * MOBILE_ORBIT_SPEED;
    mCtx.clearRect(0, 0, mobileW, mobileH);
    drawMobileWordmarkGlyph(now);

    var prog = mobileProgress(now);
    var visible = mobileState !== 'closed';
    mobileAlpha = easeOutSoft(prog);

    if (visible) {
      updateMobileParticles(dt, now, mobileState === 'open' || mobileState === 'opening');
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
        var anchor = mobileAnchorForNode(nd, staggered);
        var travelX = lerp(start.x, anchor.x, travel);
        var travelY = lerp(start.y, anchor.y, travel);

        if (settledAlpha > 0 && nd.alpha <= 0.02) {
          nd.x = travelX;
          nd.y = travelY;
        }
        if (settledAlpha > 0) {
          var follow = 0.012 * (dt / 16);
          nd.x += (anchor.x - nd.x) * follow;
          nd.y += (anchor.y - nd.y) * follow;
        } else {
          nd.x = travelX;
          nd.y = travelY;
        }

        nd.r = lerp(start.r, MOBILE_NODE_SIZE, travel);
        nd.alpha = Math.max(bloomAlpha * 0.9, settledAlpha);

        mCtx.globalAlpha = mobileAlpha * nd.alpha;
        mCtx.beginPath();
        mCtx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
        mCtx.fillStyle = lerpColor(PARTICLE_COLOR, nd.venture.color, travel);
        mCtx.fill();
        mCtx.globalAlpha = 1;

        nd.el.style.left = nd.x + 'px';
        nd.el.style.top = (nd.y + nd.r + 8) + 'px';
        nd.el.style.opacity = (mobileState === 'closing') ? '0' : String(clamp01((settledAlpha - 0.25) / 0.75));
      }

      mCenterLabel.style.left = mobileCx + 'px';
      mCenterLabel.style.top = (mobileCy + GLYPH_R + 10) + 'px';
      mCenterLabel.style.opacity = (mobileState === 'closing') ? '0' : String(clamp01((prog - 0.5) / 0.5));
    }

    requestAnimationFrame(mobileFrame);
  }

  function openRing() {
    if (mobileState === 'open' || mobileState === 'opening') return;
    ringOpen = true;
    resizeMobileCanvas();
    buildMobileNodes();
    mScrim.style.display = 'block';
    mScrim.style.pointerEvents = 'auto';
    mobileState = 'opening';
    mobileAnimStart = performance.now();
    requestAnimationFrame(function() {
      mScrim.style.opacity = '0.94';
      mWordmark.style.opacity = '0.82';
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
    for (var i = 0; i < mobileNodes.length; i++) {
      var nd = mobileNodes[i];
      if (Math.hypot(mx - nd.x, my - nd.y) < Math.max(28, nd.r + 18)) return nd.venture;
    }
    return null;
  }

  mCanvas.addEventListener('click', function(e) {
    var hit = hitMobileNode(e.clientX, e.clientY);
    if (hit) {
      if (typeof window._constructFade === 'function') {
        window._constructFade(hit.url);
      } else {
        window.location.href = hit.url;
      }
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
      buildMobileNodes();
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
     >=700px: restore the desktop dot row; hide chip + ring.
  ────────────────────────────────────────────────────────── */
  var MOBILE_BP = 700;
  var TINY_BP   = 380;

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
      if (ringOpen) closeRing();
      mChip.style.display  = 'none';
      mScrim.style.display = 'none';
      mRing.style.display  = 'none';

      nav.style.display        = 'flex';
      nav.style.top            = CONFIG.topInset + 'px';
      nav.style.left           = '50%';
      nav.style.transform      = 'translateX(-50%)';
      nav.style.justifyContent = 'center';
      nav.style.maxWidth       = 'none';
      nav.style.flexWrap       = 'nowrap';
      nav.style.gap            = CONFIG.dotGap + 'px';

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
    }
  }

  applyResponsiveNav();
  ensureTokenStylesheet(function() {
    applyTokenColorsToRenderedNav();
    applyResponsiveNav();
  });
  window.addEventListener('resize', applyResponsiveNav);
  window.addEventListener('orientationchange', function() {
    setTimeout(applyResponsiveNav, 150);
  });

  /* ── EXPOSE API ───────────────────────────────────────────
     Allows external scripts to show/hide the nav.
  ────────────────────────────────────────────────────────── */
  window._constructNav = {
    show: function() { nav.style.opacity = '1'; },
    hide: function() { nav.style.opacity = '0'; },
  };

  if (!window.__constructWayfindingLoaded && !document.querySelector('script[src="/js/construct-wayfinding.js"]')) {
    var wayfindingScript = document.createElement('script');
    wayfindingScript.src = '/js/construct-wayfinding.js';
    document.body.appendChild(wayfindingScript);
  }

})();
