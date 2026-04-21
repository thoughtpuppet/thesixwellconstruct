/* ============================================================
   construct-corner.js — the six.well construct
   ============================================================
   Renders a live miniature version of the landing's breathing
   ring + orbiting dots in the top-left corner of every inner
   venture page. Clicking it fades back to the landing (/).

   HOW TO USE:
   Add this script to the bottom of every venture page's
   <body>, after transition.js:
     <script src="/js/construct-corner.js"></script>

   That's it. The canvas is injected and positioned
   automatically. No HTML needed.

   WHAT IT RENDERS:
   - A small breathing ring (same amber tint as landing)
   - 6 orbiting amber dots around the ring
   - Gentle sine-wave pulse on a 9-second cycle
   - Fades in 800ms after page entrance (so the page gets
     its own opening moment before the corner appears)

   CLICKING:
   - Triggers the fade-to-black transition (from transition.js)
     then navigates to /
   - Requires transition.js to be loaded first
   ============================================================ */

(function() {

  /* ── CONFIGURATION ────────────────────────────────────────
     Tweak these values to adjust the corner element's
     appearance without touching the animation logic below.
  ────────────────────────────────────────────────────────── */

  const CONFIG = {

    /* Canvas dimensions — the element's footprint on the page */
    size:         64,       // px — square canvas (width = height)

    /* Position — inset from top-left corner of viewport */
    insetX:       24,       // px from left edge
    insetY:       24,       // px from top edge

    /* Ring geometry */
    ringRadius:   18,       // px — outer radius of the ring
    ringThickness: 1.2,     // px — stroke width of the ring
    ringOpacity:  0.55,     // 0–1 — how prominent the ring is

    /* Breathing animation — matches the landing's 9s cycle */
    breathPeriod: 9000,     // ms — full breath cycle duration
    breathAmp:    1.8,      // px — how much the ring radius pulses

    /* Orbiting dots */
    dotCount:     6,        // number of dots (matches landing)
    dotRadius:    1.8,      // px — size of each dot
    dotOrbit:     22,       // px — orbit radius from center
    dotOrbitSpeed:0.00028,  // radians per ms — orbit speed
    dotOpacity:   0.7,      // 0–1

    /* Color — amber accent, same as landing */
    color:        '#FCB867',

    /* Fade-in delay after page entrance */
    fadeInDelay:  800,      // ms — wait after page loads before appearing
    fadeInDuration:600,     // ms — how long the fade-in takes

    /* Hover state — ring brightens slightly on hover */
    hoverOpacity: 0.9,

    /* Z-index — sits above venture content */
    zIndex:       1000,

  };


  /* ── CANVAS SETUP ─────────────────────────────────────────
     Create and position the canvas element.
     Uses devicePixelRatio for crisp rendering on retina
     screens — the canvas is larger internally but scaled
     down via CSS to the configured size.
  ────────────────────────────────────────────────────────── */

  const dpr    = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');

  /* Physical pixel dimensions (sharp on retina) */
  canvas.width  = CONFIG.size * dpr;
  canvas.height = CONFIG.size * dpr;

  /* CSS display size (what the user sees) */
  canvas.style.width  = CONFIG.size + 'px';
  canvas.style.height = CONFIG.size + 'px';

  /* Position fixed in the top-left corner */
  canvas.style.position   = 'fixed';
  canvas.style.top        = CONFIG.insetY + 'px';
  canvas.style.left       = CONFIG.insetX + 'px';
  canvas.style.zIndex     = CONFIG.zIndex;
  canvas.style.cursor     = 'pointer';
  canvas.style.opacity    = '0';           // starts invisible, fades in
  canvas.style.transition = 'opacity ' + CONFIG.fadeInDuration + 'ms ease';

  /* Scale context for retina — all drawing coordinates stay
     in CSS pixels; the dpr scale handles the crispness */
  ctx.scale(dpr, dpr);

  /* Center point in CSS pixel space */
  const cx = CONFIG.size / 2;
  const cy = CONFIG.size / 2;

  document.body.appendChild(canvas);


  /* ── FADE IN ──────────────────────────────────────────────
     Wait for the page entrance to complete, then fade in.
     The 800ms delay gives the page its own opening moment.
  ────────────────────────────────────────────────────────── */

  setTimeout(function() {
    canvas.style.opacity = '1';
  }, CONFIG.fadeInDelay);


  /* ── HOVER STATE ──────────────────────────────────────────
     Brighten slightly on hover to signal it's clickable.
  ────────────────────────────────────────────────────────── */

  let isHovered = false;

  canvas.addEventListener('mouseenter', function() {
    isHovered = true;
  });

  canvas.addEventListener('mouseleave', function() {
    isHovered = false;
  });


  /* ── CLICK — NAVIGATE TO LANDING ─────────────────────────
     Uses the same fade-to-black transition as all other
     internal navigation. Calls fadeOutThenNavigate from
     transition.js if available, otherwise falls back to
     direct navigation (shouldn't happen in production but
     safe to handle).
  ────────────────────────────────────────────────────────── */

  canvas.addEventListener('click', function() {

    // transition.js exposes fadeOutThenNavigate on window
    // if it's loaded before this script
    if (typeof window._constructFade === 'function') {
      window._constructFade('/');
    } else {
      // Fallback: direct navigation
      window.location.href = '/';
    }

  });


  /* ── ANIMATION LOOP ───────────────────────────────────────
     Uses requestAnimationFrame for smooth 60fps rendering.
     All animation is driven by elapsed time (not frame count)
     so it stays consistent regardless of frame rate.
  ────────────────────────────────────────────────────────── */

  let startTime = null;

  function draw(timestamp) {

    /* Initialize start time on first frame */
    if (!startTime) startTime = timestamp;
    const t = timestamp - startTime; // ms elapsed since start

    /* Clear canvas */
    ctx.clearRect(0, 0, CONFIG.size, CONFIG.size);

    /* ── Breathing pulse ──────────────────────────────────
       Sine wave on the ring radius creates the same slow
       breath as the landing's eye animation.
    ────────────────────────────────────────────────────── */
    const breathPhase  = (t / CONFIG.breathPeriod) * Math.PI * 2;
    const breathOffset = Math.sin(breathPhase) * CONFIG.breathAmp;
    const currentRadius = CONFIG.ringRadius + breathOffset;

    /* ── Ring opacity ─────────────────────────────────────
       Slightly brighter on hover.
    ────────────────────────────────────────────────────── */
    const ringOpacity = isHovered ? CONFIG.hoverOpacity : CONFIG.ringOpacity;

    /* ── Draw ring ────────────────────────────────────────*/
    ctx.beginPath();
    ctx.arc(cx, cy, currentRadius, 0, Math.PI * 2);
    ctx.strokeStyle = CONFIG.color;
    ctx.lineWidth   = CONFIG.ringThickness;
    ctx.globalAlpha = ringOpacity;
    ctx.stroke();
    ctx.globalAlpha = 1;

    /* ── Draw orbiting dots ───────────────────────────────
       Evenly spaced around the orbit, all moving at the
       same speed. Phase offset distributes them evenly.
    ────────────────────────────────────────────────────── */
    for (let i = 0; i < CONFIG.dotCount; i++) {

      /* Evenly distribute dots around the circle */
      const baseAngle    = (i / CONFIG.dotCount) * Math.PI * 2;
      /* Add time-based orbit rotation */
      const angle        = baseAngle + t * CONFIG.dotOrbitSpeed;

      const dotX = cx + Math.cos(angle) * CONFIG.dotOrbit;
      const dotY = cy + Math.sin(angle) * CONFIG.dotOrbit;

      ctx.beginPath();
      ctx.arc(dotX, dotY, CONFIG.dotRadius, 0, Math.PI * 2);
      ctx.fillStyle   = CONFIG.color;
      ctx.globalAlpha = CONFIG.dotOpacity;
      ctx.fill();
      ctx.globalAlpha = 1;

    }

    /* Request next frame */
    requestAnimationFrame(draw);

  }

  /* Start the loop */
  requestAnimationFrame(draw);


  /* ── EXPOSE NAVIGATION FOR EXTERNAL USE ──────────────────
     transition.js sets window._constructFade so the corner
     can trigger the shared fade transition.
     We also expose the corner's own API in case other
     scripts need to show/hide it.
  ────────────────────────────────────────────────────────── */
  window._constructCorner = {

    /* Manually show the corner (in case you need to trigger
       it outside of the automatic fade-in) */
    show: function() {
      canvas.style.opacity = '1';
    },

    /* Manually hide */
    hide: function() {
      canvas.style.opacity = '0';
    },

  };

})(); // end IIFE
