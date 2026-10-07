(function (global) {
  'use strict';
  function isDevelopmentEdition(number) { return ['01', '02', '03', '04'].includes(String(number)); }
  function mount(number, series) {
    if (!isDevelopmentEdition(number)) return;
    var shell = document.querySelector('.venture-shell');
    var footer = shell.querySelector('.footer');
    var edition = series.editions.find(function (item) { return item.number === number; });
    var lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
    var closing = 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
    var root = document.createElement('div');
    root.className = 'kinmarking-development';
    root.innerHTML = '<canvas class="kinmarking-development-eyes" aria-hidden="true"></canvas>' +
      '<header class="site-hero site-hero--supporting kinmarking-development-hero" aria-labelledby="eventTitle">' +
      '<span class="venture-kicker" data-live-edit-owner="managed" data-live-edit-label="KINMARKING edition identity">KINMARKING ' + number + '</span>' +
      '<h1 class="hero-title" id="eventTitle" data-live-edit-owner="managed" data-live-edit-label="KINMARKING edition title"></h1></header>' +
      '<div class="kinmarking-development-stage"><div class="kinmarking-development-backdrop" aria-hidden="true" inert data-live-edit-ignore="true">' +
      '<div class="kinmarking-development-panel"><h2>The gathering</h2><p>' + lorem + '</p><p>' + lorem + '</p></div>' +
      '<div class="kinmarking-development-panel"><h2>Participation</h2><p>' + lorem + '</p></div></div>' +
      '<section class="kinmarking-development-message" aria-labelledby="developmentStatus">' +
      '<h2 id="developmentStatus" data-copy-id="kinmarking-development-status" data-live-edit-owner="source-marker" data-live-edit-source="js/kinmarking-development.js" data-live-edit-marker="kinmarking-development-status"></h2>' +
      '<p id="developmentNote" data-copy-id="kinmarking-development-note" data-live-edit-owner="source-marker" data-live-edit-source="js/kinmarking-development.js" data-live-edit-marker="kinmarking-development-note"></p>' +
      '<a class="venture-link" href="/events/kinmarking/" data-copy-id="kinmarking-development-explore" data-live-edit-owner="source-marker" data-live-edit-source="js/kinmarking-development.js" data-live-edit-marker="kinmarking-development-explore"></a>' +
      '</section></div><div class="kinmarking-development-filler" aria-hidden="true" inert data-live-edit-ignore="true"><h2>Lorem ipsum dolor sit amet.</h2><p>' + lorem + '</p><p>' + closing + '</p></div>';
    root.querySelector('#developmentStatus').textContent = /* live-copy:kinmarking-development-status */ 'In development';
    root.querySelector('#developmentNote').textContent = /* live-copy:kinmarking-development-note */ 'Program and participation details will follow.';
    root.querySelector('.venture-link').textContent = /* live-copy:kinmarking-development-explore */ 'Explore KINMARKING';
    shell.replaceChildren(root);
    if (footer) shell.append(footer);
    function setTitle(session) {
      var theme = session && session.title || edition && edition.title || 'Theme to be announced';
      var publicTitle = 'KINMARKING ' + number + ': ' + theme;
      root.querySelector('#eventTitle').textContent = theme;
      document.title = publicTitle + ' — the six.well construct';
      document.body.setAttribute('data-construct-breadcrumb-current', publicTitle);
      var breadcrumb = document.querySelector('.construct-breadcrumb-current');
      if (breadcrumb) breadcrumb.textContent = publicTitle;
    }
    setTitle(null);
    global.ConstructAmbientField.mount({root:root, eyesCanvas:root.querySelector('canvas'), eyeFilter:'brightness(0.20) saturate(2)', eyeOpacity:0.28, particleCount:0});
    // Keep published Studio titles authoritative while the program stays in development.
    fetch('/api/events/' + encodeURIComponent(series.seriesSlug) + '/context', {headers:{accept:'application/json'}})
      .then(function (response) { if (!response.ok) throw new Error('Edition context unavailable'); return response.json(); })
      .then(function (data) {
        var session = data.event && data.event.occurrences.find(function (item) { return item.sessionNumber === number; });
        if (session) setTitle(session);
      }).catch(function () {});
  }
  global.KinmarkingDevelopment = Object.freeze({isDevelopmentEdition:isDevelopmentEdition, mount:mount});
})(window);
