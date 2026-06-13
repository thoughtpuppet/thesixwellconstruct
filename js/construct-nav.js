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
     color: construct color from the landing system
     url:   destination when dot is clicked
  ────────────────────────────────────────────────────────── */
  var VENTURES = [
    { key: 'tattooing', label: 'TATTOOING',  color: '#6E0404', url: '/tattoos/'   },
    { key: 'art',       label: 'ART MAKING', color: '#0581C1', url: '/art/'       },
    { key: 'merch',     label: 'MERCH',      color: '#F7A226', url: '/merch/'     },
    { key: 'about',     label: 'ABOUT',      color: '#FCB867', url: '/about/' },
    { key: 'events',    label: 'EVENTS',     color: '#005d25', url: '/events/'    },
    { key: 'music',     label: 'MUSIC',      color: '#A856A1', url: '/music/'     },
    { key: 'writings',  label: 'WRITINGS',   color: '#FFE7CA', url: '/writings/'  },
    { key: 'archive',   label: 'ARCHIVE',    color: '#6D3D15', url: '/archive/'   },
    { key: 'film',      label: 'FILM',       color: '#328C84', url: '/film/'      },
  ];

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
    labelFont:       "'Inter','Helvetica Neue',Arial,sans-serif",
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
  });

  document.body.appendChild(nav);


  /* ── FADE IN ──────────────────────────────────────────────
     Matches the corner element's fade-in delay so both
     appear at the same moment after the page entrance.
  ────────────────────────────────────────────────────────── */
  setTimeout(function() {
    nav.style.opacity = '1';
  }, CONFIG.fadeInDelay);

  /* ── RESPONSIVE ───────────────────────────────────────────
     <700px: position nav inside the header band, centered in the
             space between the corner ring (left) and cart button
             (right). Tighter gaps. Current construct entry dot rendered
             as an open ring so it reads at small size.
     <380px: shrink dots + reduce gaps further so all 9 fit.
  ────────────────────────────────────────────────────────── */
  var MOBILE_BP = 700;
  var TINY_BP   = 380;

  function applyResponsiveNav() {
    var w = window.innerWidth;

    if (w < MOBILE_BP) {
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

      nav.style.position       = 'fixed';
      nav.style.top            = '30px';
      nav.style.left           = centerX + 'px';
      nav.style.transform      = 'translate(-50%, -50%)';
      nav.style.justifyContent = 'center';
      nav.style.maxWidth       = (availableWidth - 20) + 'px';
      nav.style.flexWrap       = 'wrap';

      var dotSize = w < TINY_BP ? 10 : 12;

      // Calculate gap so all 9 dots fit between the real left ring and right CTA.
      var usableWidth = availableWidth - 8;
      if (usableWidth < dotSize * 9 + 4 * 8) {
        dotSize = Math.max(8, Math.floor((usableWidth - 4 * 8) / 9));
      }
      var maxGap = Math.floor((usableWidth - dotSize * 9) / 8);
      var gapSize = Math.max(3, Math.min(maxGap, w < TINY_BP ? 8 : 10));

      nav.style.gap     = gapSize + 'px';
      nav.style.flexWrap = 'nowrap';

      var dots = nav.querySelectorAll('.cnav-dot');
      dots.forEach(function(d) {
        d.style.width  = dotSize + 'px';
        d.style.height = dotSize + 'px';

        var isCurrent = d.hasAttribute('data-current');
        if (isCurrent) {
          var bgColor = d.getAttribute('data-bg-color') || '#FCB867';
          d.style.background = 'transparent';
          d.style.border     = '2px solid ' + bgColor;
          d.style.opacity    = '1';
        } else {
          d.style.opacity = '1';
          d.style.border  = 'none';
          var bgColor2 = d.getAttribute('data-bg-color');
          if (bgColor2 && d.style.background === 'transparent') {
            d.style.background = bgColor2;
          }
        }
      });

    } else {
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
