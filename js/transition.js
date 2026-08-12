/* ============================================================
   transition.js — the six.well construct
   ============================================================
   Handles fade-to-black page transitions across all mediums.

   HOW TO USE:
   Add this script to the bottom of every medium page's
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
  const INTER_FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800;900&display=swap';


  /* ── OVERLAY SETUP ────────────────────────────────────────
     The overlay may already exist — medium pages include a
     tiny inline script right after <body> opens that creates
     it immediately (before any content renders) to prevent
     the blink on page entry.

     If it exists: grab it and ensure it's visible.
     If not: create it now (fallback — shouldn't happen in
     production but safe to handle).
  ────────────────────────────────────────────────────────── */

  var overlay = document.getElementById('construct-fade');
  var pendingNavigationTimer = null;

  function loadInterFontAsync() {
    if (document.querySelector('link[data-construct-inter-font], link[href*="fonts.googleapis.com/css2?family=Inter"]')) return;

    var preconnectFontsApi = document.createElement('link');
    preconnectFontsApi.rel = 'preconnect';
    preconnectFontsApi.href = 'https://fonts.googleapis.com';
    preconnectFontsApi.setAttribute('data-construct-inter-font', 'true');
    document.head.appendChild(preconnectFontsApi);

    var preconnectFontsStatic = document.createElement('link');
    preconnectFontsStatic.rel = 'preconnect';
    preconnectFontsStatic.href = 'https://fonts.gstatic.com';
    preconnectFontsStatic.crossOrigin = 'anonymous';
    preconnectFontsStatic.setAttribute('data-construct-inter-font', 'true');
    document.head.appendChild(preconnectFontsStatic);

    var fontStylesheet = document.createElement('link');
    fontStylesheet.rel = 'preload';
    fontStylesheet.as = 'style';
    fontStylesheet.href = INTER_FONT_CSS_URL;
    fontStylesheet.setAttribute('data-construct-inter-font', 'true');
    fontStylesheet.onload = function() {
      fontStylesheet.onload = null;
      fontStylesheet.rel = 'stylesheet';
    };
    document.head.appendChild(fontStylesheet);
  }

  function scheduleInterFontLoad() {
    var run = function() {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(loadInterFontAsync, { timeout: 1600 });
      } else {
        setTimeout(loadInterFontAsync, 0);
      }
    };

    if (document.readyState === 'complete') {
      run();
    } else {
      window.addEventListener('load', run, { once: true });
    }
  }

  if (!overlay) {
    /* Fallback: create if the inline script didn't run */
    overlay = document.createElement('div');
    overlay.id = 'construct-fade';
    document.body.appendChild(overlay);
  }

  function clearPendingNavigation() {
    if (!pendingNavigationTimer) return;
    clearTimeout(pendingNavigationTimer);
    pendingNavigationTimer = null;
  }

  function clearInlineOverlayState() {
    overlay.style.opacity = '';
    overlay.style.pointerEvents = '';
  }

  function showOverlay() {
    clearInlineOverlayState();
    overlay.style.transition = '';
    overlay.classList.remove('is-hidden');
    overlay.classList.add('is-visible');
  }

  function hideOverlay(immediate) {
    clearInlineOverlayState();

    if (immediate) {
      var previousTransition = overlay.style.transition;
      overlay.style.transition = 'none';
      overlay.classList.remove('is-visible');
      overlay.classList.add('is-hidden');
      overlay.offsetHeight;
      requestAnimationFrame(function() {
        overlay.style.transition = previousTransition;
      });
      return;
    }

    overlay.style.transition = '';
    overlay.classList.remove('is-visible');
    overlay.classList.add('is-hidden');
  }

  /* Ensure the overlay is fully covering while page loads.
     Also clear inline state set by early page scripts so CSS
     classes can control it without specificity fights. */
  showOverlay();


  /* ── PAGE ENTRANCE ────────────────────────────────────────
     transition.js loads at the bottom of <body>, which means
     DOMContentLoaded has almost certainly already fired by the
     time this code runs. Listening for it would register an
     event that never fires — keeping the overlay opaque forever.

     Fix: check readyState first. If the document is already
     parsed ('interactive') or fully loaded ('complete'), run
     the fade immediately. Only fall back to the event listener
     if somehow the script runs very early ('loading').
  ────────────────────────────────────────────────────────── */

  function runEntrance() {
    /* Two rAF frames ensures the browser has committed a
       paint with the overlay visible before we start fading */
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {

        hideOverlay(false);

        /* After fade completes, trigger entrance animations */
        setTimeout(function() {
          document.body.classList.add('entrance-active');
        }, FADE_DURATION_MS);

      });
    });
  }

  function fitHeroTitles() {
    var titles = document.querySelectorAll(
      '.site-hero--landing .hero-title, [data-fit-width]:not(.hero-title)'
    );

    titles.forEach(function(title) {
      if (!title || !title.parentElement) return;
      var isLandingHeroTitle = title.matches('.site-hero--landing .hero-title');
      title.style.transform = '';
      title.style.transformOrigin = '';
      title.style.width = '';
      title.style.removeProperty('font-size');
      if (!isLandingHeroTitle) {
        title.style.display = title.style.display || 'inline-block';
      }

      var fitOwnWidth = !isLandingHeroTitle;
      var parentRect = title.parentElement.getBoundingClientRect();
      var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      var availableWidth;
      if (isLandingHeroTitle) {
        availableWidth = title.getBoundingClientRect().width;
      } else {
        availableWidth = fitOwnWidth
          ? title.clientWidth
          : (title.parentElement.clientWidth || viewportWidth);
        if (!fitOwnWidth) {
          availableWidth = Math.min(availableWidth, viewportWidth - parentRect.left - 8);
        }
      }
      var titleWidth = title.scrollWidth;
      if (!availableWidth || !titleWidth || titleWidth <= availableWidth) return;

      var computedSize = parseFloat(window.getComputedStyle(title).fontSize);
      if (!computedSize) return;

      var minimumScale = isLandingHeroTitle ? 0.24 : (fitOwnWidth ? 0.28 : 0.48);
      var scale = Math.max(minimumScale, Math.min(1, availableWidth / titleWidth));
      title.style.setProperty('font-size', Math.floor(computedSize * scale) + 'px', 'important');

      /* Font rounding and inline live-editor spans can leave a title a few
         pixels wide after the proportional pass. Tighten once more from the
         rendered width so every tattoo route stays inside the phone viewport. */
      var renderedWidth = isLandingHeroTitle
        ? title.scrollWidth
        : title.getBoundingClientRect().width;
      if (renderedWidth > availableWidth) {
        var correctedSize = parseFloat(window.getComputedStyle(title).fontSize);
        title.style.setProperty(
          'font-size',
          Math.max(
            isLandingHeroTitle ? 28 : (fitOwnWidth ? 16 : 22),
            Math.floor(correctedSize * (availableWidth / renderedWidth))
          ) + 'px',
          'important'
        );
      }
    });
  }

  fitHeroTitles();
  window.addEventListener('resize', fitHeroTitles, { passive: true });
  window.addEventListener('load', fitHeroTitles);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitHeroTitles).catch(function() {});
  }
  setTimeout(fitHeroTitles, 250);

  if (document.readyState === 'loading') {
    /* Script ran early — wait for DOM to be ready */
    document.addEventListener('DOMContentLoaded', runEntrance);
  } else {
    /* DOM already parsed — run immediately */
    runEntrance();
  }

  window.addEventListener('pageshow', function(e) {
    if (!e.persisted) return;
    clearPendingNavigation();
    hideOverlay(true);
    document.body.classList.add('entrance-active');
    fitHeroTitles();
  });

  window.addEventListener('pagehide', clearPendingNavigation);


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

    // Ignore links with no href, same-document fragments,
    // and links with special modifiers (new tab, ctrl+click)
    if (!href) return;
    if (href.startsWith('#')) return;
    if (isSameDocumentFragment(href)) return;
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

  function isSameDocumentFragment(href) {
    try {
      const url = new URL(href, window.location.href);
      return (
        Boolean(url.hash) &&
        url.origin === window.location.origin &&
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      );
    } catch (e) {
      return false;
    }
  }

  /*
   * fadeOutThenNavigate(href)
   * Fades the overlay back to opaque, then navigates.
   */
  function fadeOutThenNavigate(href) {

    // Block further clicks during transition
    clearPendingNavigation();
    showOverlay();

    // Navigate after the fade completes
    pendingNavigationTimer = setTimeout(function() {
      pendingNavigationTimer = null;
      window.location.href = href;
    }, FADE_DURATION_MS);

  }

  /* ── EXPOSE NAVIGATION FOR EXTERNAL USE ──────────────────
     construct-corner.js calls window._constructFade('/home/')
     to trigger the shared fade before navigating home.
     Exposed here so both scripts share one fade system.
  ────────────────────────────────────────────────────────── */
  window._constructFade = fadeOutThenNavigate;
  scheduleInterFontLoad();

  /* ── LOCAL PROTOTYPE TEXT EDITOR ─────────────────────────
     Loads the optional canvas-like copy editor once per page.
     It stays inert until ?edit=1 is present or Cmd/Ctrl+Shift+E
     is pressed, so production visitors get the normal site.
  ────────────────────────────────────────────────────────── */
  var isLocalHost = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '::1'
  );

  var isHomePath = (
    window.location.pathname === '/home' ||
    window.location.pathname === '/home/' ||
    window.location.pathname === '/home/index.html'
  );

  var liveTextEditorDisabled = document.body && document.body.getAttribute('data-live-text-editor') === 'off';

  if (isLocalHost && !isHomePath && !liveTextEditorDisabled && !document.querySelector('script[data-live-text-editor]')) {
    var liveTextEditor = document.createElement('script');
    liveTextEditor.src = '/js/live-text-editor.js?v=' + Date.now();
    liveTextEditor.defer = true;
    liveTextEditor.setAttribute('data-live-text-editor', 'true');
    document.body.appendChild(liveTextEditor);
  }

})(); // end IIFE — keeps all variables out of global scope
