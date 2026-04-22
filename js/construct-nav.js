/* ============================================================
   construct-nav.js — the six.well construct
   ============================================================
   Renders a row of 9 colored dots, one per venture, fixed
   at the top of every inner venture page.

   - Current venture dot: full opacity in its color
   - Other dots: dimmed to 0.2 opacity
   - Hover: dot brightens, venture name fades in above it
   - Click: fades to that venture's URL via transition.js

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

  /* ── VENTURE REGISTRY ─────────────────────────────────────
     Single source of truth for all 9 ventures.
     key:   must match the data-venture attribute on <body>
     label: shown in the hover tooltip
     color: venture's node color from the landing system
     url:   destination when dot is clicked
  ────────────────────────────────────────────────────────── */
  var VENTURES = [
    { key: 'tattooing', label: 'TATTOOING',  color: '#8F231D', url: '/tattooing/' },
    { key: 'art',       label: 'ART MAKING', color: '#0581C1', url: '/art/'       },
    { key: 'merch',     label: 'MERCH',      color: '#F7A226', url: '/merch/'     },
    { key: 'about',     label: 'ABOUT',      color: '#FCB867', url: '/about/'     },
    { key: 'events',    label: 'EVENTS',     color: '#55BA5A', url: '/events/'    },
    { key: 'music',     label: 'MUSIC',      color: '#A856A1', url: '/music/'     },
    { key: 'writings',  label: 'WRITINGS',   color: '#328C84', url: '/writings/'  },
    { key: 'archive',   label: 'ARCHIVE',    color: '#EC5E26', url: '/archive/'   },
    { key: 'film',      label: 'FILM',       color: '#FFE7CA', url: '/film/'      },
  ];

  /* ── CONFIGURATION ────────────────────────────────────────*/
  var CONFIG = {
    dotSize:         8,      /* px — diameter of each dot */
    dotGap:          20,     /* px — space between dot centers */
    topInset:        28,     /* px — distance from top of viewport */

    /* Dot opacity states */
    opacityActive:   1.0,    /* current venture */
    opacityInactive: 0.22,   /* all other ventures */
    opacityHover:    1.0,    /* any dot on hover */

    /* Label (tooltip above dot) */
    labelFont:       "'Times New Roman', Times, serif",
    labelSize:       10,     /* px */
    labelTracking:   '0.22em',
    labelOffset:     10,     /* px — gap between top of dot and bottom of label */

    /* Fade-in delay — same as corner element so both appear together */
    fadeInDelay:     800,    /* ms */
    fadeInDuration:  600,    /* ms */

    zIndex:          999,    /* just below the corner element (1000) */
  };

  /* ── READ CURRENT VENTURE ─────────────────────────────────
     Reads data-venture from <body>.
     If missing or unrecognised, no dot is highlighted.
  ────────────────────────────────────────────────────────── */
  var currentKey = (document.body.getAttribute('data-venture') || '').toLowerCase();


  /* ── BUILD NAV ────────────────────────────────────────────
     Structure per venture:
       .cnav-item              — wrapper, position:relative
         .cnav-label           — tooltip text, above dot
         .cnav-dot             — the colored circle
  ────────────────────────────────────────────────────────── */
  var nav = document.createElement('nav');
  nav.id = 'construct-nav';
  nav.setAttribute('aria-label', 'venture navigation');

  /* Nav is fixed, horizontally centered, vertically aligned
     with the corner element. Uses pointer-events:none on the
     nav itself so only the dot buttons capture clicks —
     prevents invisible hit areas between dots blocking page. */
  nav.style.cssText = [
    'position:fixed',
    'top:' + CONFIG.topInset + 'px',
    'left:50%',
    'transform:translateX(-50%)',
    'display:flex',
    'align-items:center',
    'gap:' + CONFIG.dotGap + 'px',
    'z-index:' + CONFIG.zIndex,
    'pointer-events:none',   /* restored per-dot below */
    'opacity:0',
    'transition:opacity ' + CONFIG.fadeInDuration + 'ms ease',
  ].join(';');


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
      /* sit above the dot: bottom of label = top of dot - labelOffset */
      'bottom:calc(100% + ' + CONFIG.labelOffset + 'px)',
      'left:50%',
      'transform:translateX(-50%)',
      'font-family:' + CONFIG.labelFont,
      'font-size:' + CONFIG.labelSize + 'px',
      'letter-spacing:' + CONFIG.labelTracking,
      'text-transform:uppercase',
      'color:' + v.color,
      'white-space:nowrap',
      'line-height:1',
      'opacity:0',
      'transition:opacity 180ms ease',
      'pointer-events:none',   /* tooltip never captures clicks */
    ].join(';');


    /* ── Dot ─── */
    var dot = document.createElement('button');
    dot.className = 'cnav-dot';
    dot.setAttribute('aria-label', v.label);

    /* Base opacity: full for current, dim for others */
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


    /* ── Click: fade to venture URL ─── */
    dot.addEventListener('click', function() {
      /* Don't navigate if already on this venture */
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
  });

  document.body.appendChild(nav);


  /* ── FADE IN ──────────────────────────────────────────────
     Matches the corner element's fade-in delay so both
     appear at the same moment after the page entrance.
  ────────────────────────────────────────────────────────── */
  setTimeout(function() {
    nav.style.opacity = '1';
  }, CONFIG.fadeInDelay);


  /* ── EXPOSE API ───────────────────────────────────────────
     Allows external scripts to show/hide the nav.
  ────────────────────────────────────────────────────────── */
  window._constructNav = {
    show: function() { nav.style.opacity = '1'; },
    hide: function() { nav.style.opacity = '0'; },
  };

})();
