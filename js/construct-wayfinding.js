/* ============================================================
   construct-wayfinding.js - shared inner-page wayfinding
   ============================================================ */
(function() {
  if (window.__constructWayfindingLoaded) return;
  window.__constructWayfindingLoaded = true;

  var MEDIUMS = {
    tattooing: { label: 'Art.Pill Tattoo House', url: '/tattoos/' },
    art: { label: 'Art', url: '/art/' },
    merch: { label: 'Merch', url: '/merch/' },
    about: { label: 'About', url: '/about/' },
    archive: { label: 'Archive', url: '/archive/' },
    events: { label: 'Events', url: '/events/' },
    music: { label: 'Music', url: '/music/' },
    writings: { label: 'Writings', url: '/writings/' },
    film: { label: 'Film', url: '/film/' },
  };

  var SECTION_LABELS = {
    approved: 'Approved booking',
    booking: 'Booking',
    build: 'Build yours',
    consultation: 'Consultation',
    confirmed: 'Confirmation',
    custom: 'Custom inquiry',
    day: 'Day-of prep',
    flash: 'Flash',
    inquire: 'Inquire',
    location: 'Location',
    parking: 'Parking',
    policies: 'Policies',
    portfolio: 'Portfolio',
    received: 'Received',
    special: 'Special projects',
    submission: 'Submission',
    virtual: 'Virtual',
  };

  function titleCase(value) {
    return String(value || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, function(char) { return char.toUpperCase(); })
      .replace(/\bAnd\b/g, 'and')
      .replace(/\bOf\b/g, 'of');
  }

  function labelForSegment(segment) {
    if (!segment) return '';
    var clean = String(segment).replace(/\.html$/i, '');
    if (/^ap-/.test(clean)) return clean.toUpperCase();
    return titleCase(clean)
      .split(' ')
      .map(function(part) { return SECTION_LABELS[part.toLowerCase()] || part; })
      .join(' ');
  }

  function appendStyles() {
    if (document.getElementById('construct-wayfinding-style')) return;
    var style = document.createElement('style');
    style.id = 'construct-wayfinding-style';
    style.textContent = [
      '.construct-breadcrumb{position:relative;z-index:3;display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 32px;font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,231,202,.38)}',
      '.construct-breadcrumb a{color:rgba(255,231,202,.58);text-decoration:none;transition:color .18s cubic-bezier(.2,0,.2,1)}',
      '.construct-breadcrumb a:hover,.construct-breadcrumb a:focus-visible{color:#FCB867;outline:none}',
      '.construct-breadcrumb span{color:rgba(255,231,202,.28)}',
      '.construct-wayfinding-footer{position:relative;z-index:3;display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px;margin:56px auto 0;padding:28px 0 0;border-top:5px solid rgba(109,61,21,.18);font-family:Inter,Arial,sans-serif;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,231,202,.42)}',
      '.construct-wayfinding-footer a{color:rgba(255,231,202,.62);text-decoration:none;transition:color .18s cubic-bezier(.2,0,.2,1)}',
      '.construct-wayfinding-footer a:hover,.construct-wayfinding-footer a:focus-visible{color:#FCB867;outline:none}',
      '@media(max-width:700px){.construct-breadcrumb,.construct-wayfinding-footer{gap:10px;font-size:9px}.construct-wayfinding-footer{flex-direction:column;align-items:flex-start}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function currentMedium() {
    var key = (document.body.getAttribute('data-venture') || '').toLowerCase();
    if (MEDIUMS[key]) return MEDIUMS[key];
    var first = location.pathname.split('/').filter(Boolean)[0];
    if (first === 'tattoos') return MEDIUMS.tattooing;
    return MEDIUMS[first] || null;
  }

  function breadcrumbItems(medium) {
    var parts = location.pathname.split('/').filter(Boolean);
    var items = [{ label: 'Construct', url: '/' }];
    if (medium) items.push({ label: medium.label, url: medium.url });

    var mediumRoot = medium ? medium.url.replace(/^\/|\/$/g, '') : '';
    var startIndex = mediumRoot ? mediumRoot.split('/').length : 0;
    parts.slice(startIndex).forEach(function(part, index, rest) {
      if (part === 'index.html') return;
      var url = '/' + parts.slice(0, startIndex + index + 1).join('/') + '/';
      items.push({
        label: labelForSegment(part),
        url: index === rest.length - 1 ? '' : url
      });
    });

    return items.filter(function(item, index, all) {
      return item.label && (index === 0 || item.label !== all[index - 1].label);
    });
  }

  function addBreadcrumb(medium) {
    if (document.querySelector('.breadcrumb, .construct-breadcrumb')) return;
    var main = document.querySelector('main');
    if (!main) return;
    var items = breadcrumbItems(medium);
    if (items.length < 2) return;

    var nav = document.createElement('nav');
    nav.className = 'construct-breadcrumb';
    nav.setAttribute('aria-label', 'Breadcrumb');
    items.forEach(function(item, index) {
      if (index > 0) {
        var sep = document.createElement('span');
        sep.textContent = '/';
        nav.appendChild(sep);
      }
      if (item.url && index < items.length - 1) {
        var link = document.createElement('a');
        link.href = item.url;
        link.textContent = item.label;
        nav.appendChild(link);
      } else {
        var current = document.createElement('span');
        current.textContent = item.label;
        nav.appendChild(current);
      }
    });
    main.insertBefore(nav, main.firstElementChild);
  }

  function normalizeFooter(medium) {
    var footer = document.querySelector('footer');
    if (!footer) {
      var main = document.querySelector('main');
      if (!main) return;
      footer = document.createElement('footer');
      footer.className = 'construct-wayfinding-footer';
      main.appendChild(footer);
    }

    if (!footer.classList.contains('footer-bottom') && !footer.classList.contains('footer-links')) {
      footer.classList.add('construct-wayfinding-footer');
    }

    var constructLinks = Array.from(footer.querySelectorAll('a')).filter(function(link) {
      var href = link.getAttribute('href') || '';
      var text = (link.textContent || '').toLowerCase();
      return href === '/' ||
        href === '/index.html' ||
        /(^|\/|\.\.\/)index\.html$/i.test(href) ||
        text.indexOf('construct') !== -1;
    });

    constructLinks.forEach(function(link, index) {
      if (index > 0) {
        link.remove();
        return;
      }
      link.setAttribute('href', '/');
      link.textContent = 'Return to construct';
    });

    if (medium && !footer.querySelector('a[href="' + medium.url + '"]')) {
      var mediumLink = document.createElement('a');
      mediumLink.href = medium.url;
      mediumLink.textContent = 'Back to ' + medium.label;
      footer.appendChild(mediumLink);
    }

    if (!footer.querySelector('a[href="/"], a[href="/index.html"]')) {
      var constructLink = document.createElement('a');
      constructLink.href = '/';
      constructLink.textContent = 'Return to construct';
      footer.appendChild(constructLink);
    }
  }

  appendStyles();
  var medium = currentMedium();
  addBreadcrumb(medium);
  normalizeFooter(medium);
})();
