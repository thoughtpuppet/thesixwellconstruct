(function () {
  var form = document.querySelector('[data-search-form]');
  var input = document.querySelector('[data-search-query]');
  var submit = document.querySelector('[data-search-submit]');
  var tools = document.querySelector('[data-search-tools]');
  var count = document.querySelector('[data-search-count]');
  var status = document.querySelector('[data-search-status]');
  var results = document.querySelector('[data-search-results]');
  var scopeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-search-scope]'));
  if (!form || !input || !submit || !tools || !count || !status || !results) return;

  var VALID_SCOPES = new Set(['all', 'art', 'archive', 'tattoo', 'merch', 'events', 'symbols', 'pages']);
  var MEDIUM_LABELS = { art: 'Art', archive: 'Archive', tattoo: 'Tattoo', merch: 'Merch', events: 'Events', symbols: 'Symbol', pages: 'Page' };
  var records = [];
  var activeQuery = '';
  var activeScope = 'all';
  var controller = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }

  function safeRoute(value) {
    var route = String(value || '').trim();
    if (!route.startsWith('/') || route.startsWith('//')) return '';
    try {
      var parsed = new URL(route, location.origin);
      if (parsed.origin !== location.origin) return '';
      return parsed.pathname + parsed.search + parsed.hash;
    } catch (error) {
      return '';
    }
  }

  function readLocation() {
    var params = new URL(location.href).searchParams;
    var scope = String(params.get('scope') || 'all').toLowerCase();
    return {
      query: String(params.get('q') || '').trim().slice(0, 200),
      scope: VALID_SCOPES.has(scope) ? scope : 'all',
    };
  }

  function writeLocation(query, scope, mode) {
    var url = new URL(location.href);
    query ? url.searchParams.set('q', query) : url.searchParams.delete('q');
    scope && scope !== 'all' ? url.searchParams.set('scope', scope) : url.searchParams.delete('scope');
    history[mode === 'replace' ? 'replaceState' : 'pushState']({ constructSearch: true }, '', url.pathname + url.search + url.hash);
  }

  function setScope(scope) {
    activeScope = VALID_SCOPES.has(scope) ? scope : 'all';
    scopeButtons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.searchScope === activeScope));
    });
  }

  function statusMarkup(kind, options) {
    var data = options || {};
    if (kind === 'prompt') {
      return '<span class="search-status-kicker">A way into the ecosystem</span><h2>Begin with what you remember.</h2><p>Search by title, medium, material, symbol, person, event, date, or a relationship between records.</p>';
    }
    if (kind === 'loading') {
      return '<span class="search-status-kicker">Searching</span><h2>Following the public record…</h2><p>Looking across published works, Archive fragments, relationships, and Construct pathways.</p>';
    }
    if (kind === 'empty') {
      return '<span class="search-status-kicker">No public match</span><h2>Nothing surfaced for “' + esc(data.query) + '.”</h2><p>Try a broader title, medium, material, person, event, symbol, or year.</p>';
    }
    return '<span class="search-status-kicker">Search unavailable</span><h2>The public index could not be reached.</h2><p>Try the search again. No private or unpublished records were exposed.</p><button class="search-retry" type="button" data-search-retry>Retry search</button>';
  }

  function showStatus(kind, options) {
    var data = options || {};
    status.hidden = false;
    status.dataset.state = kind;
    status.innerHTML = statusMarkup(kind, data);
    results.replaceChildren();
    tools.hidden = !data.keepTools;
    if (kind === 'error') {
      var retry = status.querySelector('[data-search-retry]');
      if (retry) retry.addEventListener('click', function () { load(activeQuery); });
    }
  }

  function summaryFor(record) {
    return String(record.summary || record.description || record.statement || record.body || '').trim().slice(0, 460);
  }

  function matchFor(record) {
    var match = record.primary_match || {};
    var kind = String(match.kind || 'Record').trim();
    var label = String(match.label || record.title || '').trim();
    return { kind: kind || 'Record', label: label || 'Published record' };
  }

  function resultKindFor(record) {
    if (record.result_kind) return String(record.result_kind);
    var type = String(record.entity_type || 'record').toLowerCase();
    if (type === 'appearance') return 'Appearance';
    if (type === 'event') return 'Six.Well event';
    return type.replace(/_/g, ' ');
  }

  function eventDate(value) {
    var raw = String(value || '').trim();
    if (!raw) return null;
    var date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T12:00:00Z' : raw);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function eventDateLabel(context) {
    var timezone = String(context.timezone || 'America/New_York');
    var start = eventDate(context.startsAt);
    var end = eventDate(context.endsAt || context.confirmedThrough);
    if (!start) return '';
    var dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' });
    if (context.dateKind === 'date_range' && end) return dateFormat.format(start) + ' – ' + dateFormat.format(end);
    var label = dateFormat.format(start);
    if (context.dateKind === 'timed') {
      var timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
      label += ' · ' + timeFormat.format(start);
      if (end && dateFormat.format(end) === dateFormat.format(start)) label += '–' + timeFormat.format(end);
    }
    return label;
  }

  function eventStatusLabel(context) {
    var schedule = String(context.scheduleStatus || '').toLowerCase();
    if (schedule && !['scheduled', 'published'].includes(schedule)) return schedule.replace(/_/g, ' ');
    var temporal = String(context.temporalState || '').toLowerCase();
    if (temporal === 'on_view') return 'On view';
    if (temporal === 'upcoming') return 'Upcoming';
    if (temporal === 'past') return 'Past';
    if (temporal === 'cancelled') return 'Cancelled';
    return '';
  }

  function eventMetaMarkup(record) {
    var context = record.event_context;
    if (!context || typeof context !== 'object') return '';
    var values = [eventDateLabel(context), context.venueName, context.organizer, eventStatusLabel(context)].map(function (value) { return String(value || '').trim(); }).filter(function (value, index, list) { return value && list.indexOf(value) === index; });
    return values.length ? '<p class="search-result-meta">' + values.map(function (value, index) { return '<span' + (index === values.length - 1 ? ' class="search-result-status"' : '') + '>' + esc(value) + '</span>'; }).join('') + '</p>' : '';
  }

  function recordMarkup(record) {
    var route = safeRoute(record.route);
    if (!route) return '';
    var medium = VALID_SCOPES.has(record.medium_key) && record.medium_key !== 'all' ? record.medium_key : 'archive';
    var match = matchFor(record);
    var summary = summaryFor(record);
    return '<a class="search-result" data-medium="' + esc(medium) + '" href="' + esc(route) + '">' +
      '<span class="search-result-copy"><span class="search-result-kind">' + esc(MEDIUM_LABELS[medium] || 'Archive') + ' · ' + esc(resultKindFor(record)) + '</span>' +
      '<h2>' + esc(record.title || record.name || 'Untitled record') + '</h2>' +
      eventMetaMarkup(record) +
      (summary ? '<p class="search-result-summary">' + esc(summary) + '</p>' : '') +
      '<p class="search-match"><span class="search-match-label">Found through</span><span>' + esc(match.kind) + ' · ' + esc(match.label) + '</span></p></span>' +
      '<span class="search-result-action" aria-hidden="true">' + (record.event_context ? 'Open event' : 'Open record') + '</span></a>';
  }

  function visibleRecords() {
    return activeScope === 'all' ? records : records.filter(function (record) { return record.medium_key === activeScope; });
  }

  function render() {
    var visible = visibleRecords();
    setScope(activeScope);
    tools.hidden = false;
    status.hidden = true;
    results.setAttribute('aria-busy', 'false');
    results.innerHTML = visible.map(recordMarkup).filter(Boolean).join('');
    var rendered = results.querySelectorAll('.search-result').length;
    count.textContent = rendered + ' ' + (rendered === 1 ? 'result' : 'results') + ' for “' + activeQuery + '”';
    input.dataset.analyticsResults = String(rendered);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (!rendered) showStatus('empty', { query: activeQuery, keepTools: true });
  }

  async function load(query) {
    activeQuery = String(query || '').trim().slice(0, 200);
    input.value = activeQuery;
    input.dataset.analyticsResults = '';
    if (controller) controller.abort();
    if (!activeQuery) {
      records = [];
      submit.disabled = false;
      results.setAttribute('aria-busy', 'false');
      showStatus('prompt');
      return;
    }
    controller = new AbortController();
    submit.disabled = true;
    results.setAttribute('aria-busy', 'true');
    showStatus('loading');
    try {
      var params = new URLSearchParams({ q: activeQuery, include: 'pages,calendar' });
      var response = await fetch('/api/search?' + params.toString(), { headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Search unavailable');
      var payload = await response.json();
      records = Array.isArray(payload.records) ? payload.records : [];
      render();
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      records = [];
      results.setAttribute('aria-busy', 'false');
      showStatus('error');
    } finally {
      submit.disabled = false;
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = input.value.trim();
    if (!query) setScope('all');
    writeLocation(query, activeScope, 'push');
    load(query);
  });

  scopeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      setScope(button.dataset.searchScope);
      writeLocation(activeQuery, activeScope, 'push');
      render();
    });
  });

  window.addEventListener('popstate', function () {
    var state = readLocation();
    setScope(state.scope);
    if (state.query === activeQuery && records.length) render();
    else load(state.query);
  });

  var initial = readLocation();
  setScope(initial.scope);
  input.value = initial.query;
  load(initial.query);
})();
