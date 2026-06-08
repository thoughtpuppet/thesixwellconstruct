/* ============================================================
   construct-corner.js — the six.well construct
   ============================================================
   Renders the construct return lockup in the top-left corner
   of every inner medium page:

     [ring + 6 dots] [the six.well construct]

   The ring exactly matches the landing page's ring:
   - Filled annulus (not a stroked circle), color #6D3D15
   - 6 amber dots using the same position + orbit math as
     the landing, scaled proportionally
   - No breathing animation — the ring is static, dots orbit

   The wordmark sits inline to the right, vertically centered
   on the ring's centerline via flexbox.

   Clicking anywhere on the lockup fades to / via transition.js.

   HOW TO USE:
   Add after transition.js, before </body> on every medium page:
     <script src="/js/transition.js"></script>
     <script src="/js/construct-corner.js"></script>

   REQUIRES: transition.js loaded first (sets window._constructFade)
   REQUIRES: Inter font available on the page for wordmark rendering
   ============================================================ */

(function() {

  /* ── SCALE ────────────────────────────────────────────────
     Landing ring: RING_OUTER = 56px, RING_INNER = 40px
     Corner ring:  RING_OUTER = 18px
     Scale factor: 18/56 = 0.3214

     All landing values are multiplied by this factor so the
     corner ring is a true geometric reduction of the original.
  ────────────────────────────────────────────────────────── */
  var SCALE = 21 / 56;

  /* ── CONFIGURATION ────────────────────────────────────────
     All geometry derived from landing values × SCALE.
     Edit SCALE above to resize everything proportionally.
  ────────────────────────────────────────────────────────── */
  var CONFIG = {

    /* Canvas — square, large enough to contain ring + dots */
    canvasSize: 52,           /* px — larger header footprint for roomier fit */

    /* Ring — filled annulus, matches landing's drawRing() */
    ringOuter:  21,           /* px — slightly larger to support bigger header lockup */
    ringInner:  15,           /* px — scaled proportionally from landing ring */
    ringColor:  '#6D3D15',    /* matches landing RING_COLOR exactly */

    /* Dots — matches landing's DOT_POSITIONS + drawDots() math
       Landing positions: [[-18,-28],[18,-28],[-18,0],[18,0],[-18,28],[18,28]]
       Scaled × 0.3214:   [[-5.79,-9],[5.79,-9],[-5.79,0],[5.79,0],[-5.79,9],[5.79,9]]
       Orbit distance from center: hypot(5.79,9) ≈ 10.7px — sits just
       inside RING_INNER (13px), matching how the landing dots nestle
       inside the ring's inner edge. */
    dotPositions: [
      [-6.75, -10.5],
      [ 6.75, -10.5],
      [-6.75,   0],
      [ 6.75,   0],
      [-6.75,  10.5],
      [ 6.75,  10.5],
    ],
    dotRadius:     2.8,       /* px — slightly larger to match roomier header */
    dotColor:      '#FCB867', /* matches landing DOT_COLOR exactly */
    /* Matches landing orbit speed exactly: time * 0.003 */
    dotOrbitSpeed: 0.003,     /* radians/ms */

    /* Wordmark */
    wordmark:        'the six.well construct',
    fontSize:        19,      /* px — 4px larger global construct wordmark */
    fontFamily:      "'Inter','Helvetica Neue',Arial,sans-serif",
    fontWeight:      900,
    letterSpacing:   '-0.05em',
    wordmarkColor:   '#FCB867',
    wordmarkOpacity: 0.82,    /* matches landing wordmark opacity */

    /* Layout */
    insetX: 24,               /* px from left edge of viewport */
    insetY: 18,               /* px from top edge of viewport */
    gap:    14,               /* px between canvas and wordmark text */

    /* Timing */
    fadeInDelay:    800,      /* ms — page gets its own entrance first */
    fadeInDuration: 600,      /* ms */
    zIndex:         1000,

  };

  /* Canvas center point in CSS pixel space */
  var CX = CONFIG.canvasSize / 2;
  var CY = CONFIG.canvasSize / 2;

  var existingHeader = document.querySelector('header.top');
  var headerShell = null;

  if (!existingHeader) {
    headerShell = document.createElement('div');
    headerShell.id = 'construct-header-shell';
    document.body.appendChild(headerShell);
  }

  function syncHeaderState() {
    var isActive = window.scrollY > 8;
    document.body.classList.toggle('construct-header-active', isActive);

    if (headerShell) {
      headerShell.classList.toggle('is-active', isActive);
    }
  }


  /* ── WRAPPER ──────────────────────────────────────────────
     Fixed div containing canvas + wordmark.
     Flexbox with align-items:center puts both elements on
     the same centerline — the ring center and the text
     optical center are vertically aligned.
  ────────────────────────────────────────────────────────── */
  var wrapper = document.createElement('div');
  wrapper.id = 'construct-corner';
  wrapper.style.cssText = [
    'position:fixed',
    'top:' + CONFIG.insetY + 'px',
    'left:' + CONFIG.insetX + 'px',
    'display:flex',
    'align-items:center',
    'gap:' + CONFIG.gap + 'px',
    'min-height:' + CONFIG.canvasSize + 'px',
    'z-index:' + CONFIG.zIndex,
    'cursor:pointer',
    'opacity:0',
    'transition:opacity ' + CONFIG.fadeInDuration + 'ms ease',
    'user-select:none',
    '-webkit-user-select:none',
  ].join(';');


  /* ── CANVAS ───────────────────────────────────────────────
     Retina-sharp via devicePixelRatio scaling.
     Physical pixel size = canvasSize × dpr.
     CSS display size = canvasSize (CSS pixels).
     All drawing coordinates stay in CSS pixels.
  ────────────────────────────────────────────────────────── */
  var dpr    = window.devicePixelRatio || 1;
  var canvas = document.createElement('canvas');
  var ctx    = canvas.getContext('2d');

  canvas.width  = CONFIG.canvasSize * dpr;
  canvas.height = CONFIG.canvasSize * dpr;
  canvas.style.width     = CONFIG.canvasSize + 'px';
  canvas.style.height    = CONFIG.canvasSize + 'px';
  canvas.style.flexShrink = '0';  /* prevent canvas from squishing in flex row */

  ctx.scale(dpr, dpr);


  /* ── WORDMARK ─────────────────────────────────────────────
     Span sits inline in the flex row. Flex align-items:center
     centers it vertically to the canvas — putting it on the
     ring's centerline without any manual offset math.
  ────────────────────────────────────────────────────────── */
  var wm = document.createElement('span');
  wm.textContent = CONFIG.wordmark;
  wm.style.cssText = [
    'font-family:' + CONFIG.fontFamily,
    'font-weight:' + CONFIG.fontWeight,
    'font-size:' + CONFIG.fontSize + 'px',
    'letter-spacing:' + CONFIG.letterSpacing,
    'color:' + CONFIG.wordmarkColor,
    'opacity:' + CONFIG.wordmarkOpacity,
    'white-space:nowrap',
    'line-height:1',
  ].join(';');


  /* ── ASSEMBLE + INJECT ────────────────────────────────────*/
  wrapper.appendChild(canvas);
  wrapper.appendChild(wm);
  document.body.appendChild(wrapper);


  /* ── FADE IN ──────────────────────────────────────────────
     Delay lets the medium page's own entrance animation
     complete before the corner element appears.
  ────────────────────────────────────────────────────────── */
  setTimeout(function() {
    wrapper.style.opacity = '1';
  }, CONFIG.fadeInDelay);

  syncHeaderState();
  window.addEventListener('scroll', syncHeaderState, { passive: true });

  /* ── RESPONSIVE ───────────────────────────────────────────
     <700px: hide the wordmark (the ring alone reads as the
     home glyph), pull inset closer to the edge, tighten gap.
     <420px: nudge inset further in for very small phones.
     Restored automatically when the viewport grows again.
  ────────────────────────────────────────────────────────── */
  var MOBILE_BP = 700;
  var TINY_BP   = 420;

  function applyResponsiveCorner() {
    var w = window.innerWidth;
    if (w < MOBILE_BP) {
      wm.style.display        = 'none';
      wrapper.style.left      = (w < TINY_BP ? 12 : 16) + 'px';
      wrapper.style.top       = '30px';
      wrapper.style.transform = 'translateY(-50%)';
      wrapper.style.gap       = '0px';
    } else {
      wm.style.display        = '';
      wrapper.style.left      = CONFIG.insetX + 'px';
      wrapper.style.top       = CONFIG.insetY + 'px';
      wrapper.style.transform = 'none';
      wrapper.style.gap       = CONFIG.gap + 'px';
    }
  }
  applyResponsiveCorner();
  window.addEventListener('resize', applyResponsiveCorner);
  window.addEventListener('orientationchange', function() {
    setTimeout(applyResponsiveCorner, 150);
  });

  /* ── HOVER ────────────────────────────────────────────────
     Wordmark opacity bumps up on hover to signal interactivity.
  ────────────────────────────────────────────────────────── */
  var isHovered = false;

  wrapper.addEventListener('mouseenter', function() {
    isHovered = true;
    wm.style.opacity = '1';
  });

  wrapper.addEventListener('mouseleave', function() {
    isHovered = false;
    wm.style.opacity = String(CONFIG.wordmarkOpacity);
  });


  /* ── CLICK — NAVIGATE TO LANDING ─────────────────────────
     Uses the shared fade transition from transition.js.
  ────────────────────────────────────────────────────────── */
  wrapper.addEventListener('click', function() {
    if (typeof window._constructFade === 'function') {
      window._constructFade('/');
    } else {
      window.location.href = '/';
    }
  });


  /* ── ANIMATION LOOP ───────────────────────────────────────
     Draws on every animation frame. Time-driven (not frame-
     count-driven) so speed is consistent at any frame rate.

     drawRing() — matches landing's drawRing() exactly:
       filled annulus via two arcs (outer CW, inner CCW) + fill

     drawDots() — matches landing's drawDots() exactly:
       for each dot position d:
         angle = atan2(d[1], d[0]) + orbitT
         dist  = hypot(d[0], d[1])
         draw dot at (cx + cos(angle)*dist, cy + sin(angle)*dist)
  ────────────────────────────────────────────────────────── */
  var startTime = null;

  function draw(timestamp) {

    if (!startTime) startTime = timestamp;
    var t = timestamp - startTime;

    ctx.clearRect(0, 0, CONFIG.canvasSize, CONFIG.canvasSize);

    /* ── Ring ─────────────────────────────────────────────
       Filled annulus: outer arc clockwise, inner arc
       counter-clockwise, then fill. Identical to landing's
       drawRing() minus the hover halo (not needed at this size).
    ────────────────────────────────────────────────────── */
    ctx.beginPath();
    ctx.arc(CX, CY, CONFIG.ringOuter, 0, Math.PI * 2);        /* outer CW */
    ctx.arc(CX, CY, CONFIG.ringInner, 0, Math.PI * 2, true);  /* inner CCW = cut hole */
    ctx.fillStyle = CONFIG.ringColor;
    ctx.fill();

    /* ── Dots ─────────────────────────────────────────────
       Each dot uses Math.atan2 to get its base angle from
       its position offset, then adds orbitT for rotation.
       hypot gives its orbit radius from center.
       This exactly mirrors the landing's drawDots() logic.
    ────────────────────────────────────────────────────── */
    var orbitT = t * CONFIG.dotOrbitSpeed;

    CONFIG.dotPositions.forEach(function(d, i) {
      var angle    = Math.atan2(d[1], d[0]) + orbitT;
      var baseDist = Math.hypot(d[0], d[1]);
      /* Radial pulse — matches landing's sin(time*0.025 + i*1.1)*1.5*scale,
         amplitude scaled down by SCALE so it's proportional at corner size. */
      var dist = baseDist + Math.sin(t * 0.025 + i * 1.1) * 1.5 * SCALE;

      ctx.beginPath();
      ctx.arc(
        CX + Math.cos(angle) * dist,
        CY + Math.sin(angle) * dist,
        CONFIG.dotRadius,
        0,
        Math.PI * 2
      );
      ctx.fillStyle   = CONFIG.dotColor;
      ctx.globalAlpha = isHovered ? 1 : 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);


  /* ── EXPOSE API ───────────────────────────────────────────
     Allows external scripts to show/hide the corner element.
  ────────────────────────────────────────────────────────── */
  window._constructCorner = {
    show: function() { wrapper.style.opacity = '1'; },
    hide: function() { wrapper.style.opacity = '0'; },
  };

})();
