/* ============================================================
   transition.js — the six.well construct
   ============================================================
   Handles fade-to-black page transitions across all ventures.

   HOW TO USE:
   Add this script to the bottom of every venture page's
   <body>, after transitions.css is loaded:
     <script src="/js/transition.js"></script>

   That's it. It handles everything automatically:
   - Injects the fade overlay div
   - Fades in on page load (revealing the page)
   - Intercepts all internal links
   - Fades out before navigating away

   WHAT COUNTS AS AN "INTERNAL" LINK:
   Any <a href> that points to the same domain
   (thesixwellconstruct.com or localhost for dev).
   External links (Shopify checkout, Substack, etc.)
   navigate normally without the fade.
   ============================================================ */

(function() {

  /* ── TIMING ───────────────────────────────────────────────
     Must match the transition duration in transitions.css.
     If you change one, change both.
  ────────────────────────────────────────────────────────── */
  const FADE_DURATION_MS = 500;


  /* ── OVERLAY SETUP ────────────────────────────────────────
     The overlay may already exist — venture pages include a
     tiny inline script right after <body> opens that creates
     it immediately (before any content renders) to prevent
     the blink on page entry.

     If it exists: grab it and ensure it's visible.
     If not: create it now (fallback — shouldn't happen in
     production but safe to handle).
  ────────────────────────────────────────────────────────── */

  var overlay = document.getElementById('construct-fade');

  if (!overlay) {
    /* Fallback: create if the inline script didn't run */
    overlay = document.createElement('div');
    overlay.id = 'construct-fade';
    document.body.appendChild(overlay);
  }

  /* Ensure the overlay is fully covering while page loads */
  overlay.classList.remove('is-hidden');
  overlay.classList.add('is-visible');


  /* ── PAGE ENTRANCE ────────────────────────────────────────
     DOMContentLoaded fires as soon as the HTML is parsed —
     much earlier than window.load (which waits for images).
     Starting the fade-out here means the page is revealed
     sooner and with less chance of a blink.
  ────────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function() {
    /* Two rAF frames ensures the browser has committed a
       paint with the overlay visible before we start fading */
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {

        overlay.classList.remove('is-visible');
        overlay.classList.add('is-hidden');

        /* After fade completes, trigger entrance animations */
        setTimeout(function() {
          document.body.classList.add('entrance-active');
        }, FADE_DURATION_MS);

      });
    });
  });


  /* ── LINK INTERCEPTION ────────────────────────────────────
     Listen for all clicks on the document.
     If the clicked element (or its parent) is an internal
     link, intercept it: fade to black first, then navigate.
  ────────────────────────────────────────────────────────── */

  document.addEventListener('click', function(e) {

    // Walk up the DOM from the clicked element to find
    // an <a> tag — handles clicks on children of links
    // (e.g. clicking an <img> inside an <a>)
    let target = e.target;
    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }

    // No <a> found in the chain — ignore
    if (!target) return;

    const href = target.getAttribute('href');

    // Ignore links with no href, hash-only links (#section),
    // and links with special modifiers (new tab, ctrl+click)
    if (!href) return;
    if (href.startsWith('#')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (target.target === '_blank') return;

    // Check if this is an internal link
    if (isInternalLink(href)) {

      // Prevent the default immediate navigation
      e.preventDefault();

      // Fade to black, then navigate after fade completes
      fadeOutThenNavigate(href);

    }
    // External links fall through to normal browser behavior

  });


  /* ── HELPERS ──────────────────────────────────────────────*/

  /*
   * isInternalLink(href)
   * Returns true if the href points to the same site.
   * Handles relative paths (/tattooing), absolute paths
   * with the site domain, and localhost for dev.
   */
  function isInternalLink(href) {

    // Relative paths are always internal
    if (href.startsWith('/')) return true;

    // Absolute URL — check if hostname matches
    try {
      const url = new URL(href);
      const currentHost = window.location.hostname;
      return (
        url.hostname === currentHost ||
        url.hostname === 'thesixwellconstruct.com' ||
        url.hostname === 'www.thesixwellconstruct.com'
      );
    } catch (e) {
      // URL parsing failed — treat as external to be safe
      return false;
    }

  }

  /*
   * fadeOutThenNavigate(href)
   * Fades the overlay back to opaque, then navigates.
   */
  function fadeOutThenNavigate(href) {

    // Block further clicks during transition
    overlay.classList.remove('is-hidden');
    overlay.classList.add('is-visible');

    // Navigate after the fade completes
    setTimeout(function() {
      window.location.href = href;
    }, FADE_DURATION_MS);

  }

  /* ── EXPOSE NAVIGATION FOR EXTERNAL USE ──────────────────
     construct-corner.js calls window._constructFade('/')
     to trigger the shared fade before navigating home.
     Exposed here so both scripts share one fade system.
  ────────────────────────────────────────────────────────── */
  window._constructFade = fadeOutThenNavigate;

})(); // end IIFE — keeps all variables out of global scope
