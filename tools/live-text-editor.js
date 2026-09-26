/* ============================================================
   live-text-editor.js — local prototype copy editor
   ============================================================
   Enables canvas-like text edits on the live static site.

   Open any page with ?edit=1 or press Cmd/Ctrl+Shift+E.
   Changes are stored in localStorage by page view + stable element id.
   ============================================================ */

(function() {
  var host = window.location.hostname;
  var isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (!isLocalHost) return;

  var STORAGE_PREFIX = 'sixwell:liveText:';
  var ENABLED_KEY = STORAGE_PREFIX + 'enabled';
  var LAST_UNDO_KEY = STORAGE_PREFIX + 'lastUndo';
  var EDITOR_ID = 'live-text-editor';
  var BASE_COLOR_PALETTE = [
    { name: 'Default body', value: '#FFE7CA' },
    { name: 'Global amber', value: '#FCB867' },
    { name: 'Tattooing', value: '#6E0404' },
    { name: 'Art making', value: '#0039BD' },
    { name: 'Merch', value: '#F08F00' },
    { name: 'Events', value: '#005D25' },
    { name: 'Music', value: '#A22F8D' },
    { name: 'Writings', value: '#FFE7CA' },
    { name: 'Film', value: '#00857A' },
    { name: 'Archive', value: '#6D3D15' },
    { name: 'Site black', value: '#0e0e0e' },
    { name: 'Dark brown', value: '#3a2418' },
    { name: 'Construct brown', value: '#6D3D15' },
    { name: 'Sold red', value: '#C0392B' },
    { name: 'Muted cream', value: 'rgba(255,231,202,0.62)' },
    { name: 'Faint amber', value: 'rgba(252,184,103,0.64)' },
    { name: 'Amber wash', value: 'rgba(252,184,103,0.25)' },
    { name: 'Tattoo wash', value: 'rgba(110,4,4,0.25)' },
    { name: 'Art wash', value: 'rgba(0,57,189,0.25)' },
    { name: 'Merch wash', value: 'rgba(240,143,21,0.25)' },
    { name: 'Events wash', value: 'rgba(0, 93, 37,0.25)' },
    { name: 'Music wash', value: 'rgba(162,47,141,0.25)' },
    { name: 'Writings wash', value: 'rgba(255,231,202,0.25)' },
    { name: 'Archive wash', value: 'rgba(109,61,21,0.25)' },
    { name: 'Film wash', value: 'rgba(50,140,132,0.25)' }
  ];
  var SITE_COLOR_VARS = [
    '--color-bg',
    '--color-body',
    '--color-accent',
    '--color-accent-dim',
    '--color-tattooing',
    '--color-tattooing-dim',
    '--color-art',
    '--color-art-dim',
    '--color-merch',
    '--color-merch-dim',
    '--color-about',
    '--color-about-dim',
    '--color-events',
    '--color-events-dim',
    '--color-music',
    '--color-music-dim',
    '--color-writings',
    '--color-writings-dim',
    '--color-archive',
    '--color-archive-dim',
    '--color-film',
    '--color-film-dim',
    '--accent',
    '--accent-hot',
    '--signal',
    '--text',
    '--body-text',
    '--text-mute',
    '--text-dim',
    '--text-ghost',
    '--body-muted',
    '--body-dim',
    '--ring-soft',
    '--ring-faint',
    '--venture-color',
    '--venture-accent',
    '--venture-dim'
  ];
  var editableElements = [];
  var isEnabled = false;
  var isHydrated = false;
  var activeElement = null;
  var helperAvailable = false;
  var reviewDrawer = null;
  var coverageDrawer = null;
  var historyDrawer = null;
  var originalRecords = {};
  var controlSelectionRange = null;
  var resizeObserver = null;
  var toolbarResizeObserver = null;
  var resizeSaveTimers = new WeakMap();
  var activeResizeElement = null;
  var resizeDrag = null;
  var helperContext = null;
  var sourceHashes = {};
  var contentObserver = null;
  var contentSyncTimer = null;
  var lastUndoToken = readStoredUndoToken();

  var TEXT_SELECTOR = [
    '[data-copy-id]',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'li',
    'figcaption', 'blockquote',
    'span', 'small', 'strong', 'em',
    'a', 'button',
    '.venture-title', '.hero-lede', '.hero-note',
    '.section-title', '.section-kicker',
    '.panel-title', '.panel-lede', '.panel-note',
    '.visual-title', '.visual-caption',
    '.tile-kicker', '.meta-kicker'
  ].join(',');

  function pageKey() {
    var params = new URLSearchParams(window.location.search);
    params.delete('edit');
    var query = Array.from(params.entries()).sort(function(a, b) {
      return (a[0] + '=' + a[1]).localeCompare(b[0] + '=' + b[1]);
    }).map(function(entry) {
      return encodeURIComponent(entry[0]) + '=' + encodeURIComponent(entry[1]);
    }).join('&');
    return STORAGE_PREFIX + window.location.pathname + (query ? '?' + query : '');
  }

  function shouldAutoEnable() {
    var params = new URLSearchParams(window.location.search);
    return params.get('edit') === '1' || window.localStorage.getItem(ENABLED_KEY) === '1';
  }

  function isEditorNode(node) {
    return node && node.closest && node.closest('#' + EDITOR_ID);
  }

  function hasDirectText(element) {
    for (var i = 0; i < element.childNodes.length; i += 1) {
      var child = element.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim()) return true;
    }
    return false;
  }

  function hasEditableParent(element) {
    var parent = element.parentElement;
    while (parent && parent !== document.body) {
      if (parent.hasAttribute('data-live-edit-id')) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  function textSignature(element) {
    var text = (element.textContent || '').trim().replace(/\s+/g, ' ');
    return text.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'text';
  }

  function buildElementId(element, index, root) {
    var existing = element.getAttribute('data-copy-id') || element.id;
    if (existing) return existing;
    var runtimeId = element.getAttribute('data-live-edit-id');
    if (runtimeId) return runtimeId;
    return buildGeneratedElementId(element, index, root);
  }

  function copyIdForElement(element) {
    return element ? element.getAttribute('data-copy-id') || '' : '';
  }

  // The optional `root` parameter sets the ancestor to stop at when building the CSS
  // path. It defaults to `document.body` for live-DOM elements. Pass `doc.body` (the
  // DOMParser document's <body>) when working on a parsed source document — otherwise
  // the walk never reaches the live body, overshoots into <html>, and the path gains
  // two extra unwanted segments that break generated-ID matching.
  function buildGeneratedElementId(element, index, root) {
    root = root || document.body;
    var parts = [];
    var node = element;
    while (node && node.nodeType === 1 && node !== root && parts.length < 5) {
      var part = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        part += '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.');
      }
      parts.unshift(part);
      node = node.parentElement;
    }

    return parts.join('>') + ':' + textSignature(element) + ':' + index;
  }

  function buildLegacyElementId(element, index, root) {
    return element.id || buildGeneratedElementId(element, index, root);
  }

  function getSavedCopy() {
    try {
      return JSON.parse(window.localStorage.getItem(pageKey()) || '{}');
    } catch (error) {
      return {};
    }
  }

  function setSavedCopy(copy) {
    window.localStorage.setItem(pageKey(), JSON.stringify(copy));
  }

  function readStoredUndoToken() {
    try {
      var record = JSON.parse(window.sessionStorage.getItem(LAST_UNDO_KEY) || '{}');
      return record.pathname === window.location.pathname && typeof record.token === 'string' ? record.token : '';
    } catch (error) {
      return '';
    }
  }

  function rememberUndoToken(token) {
    lastUndoToken = token || '';
    if (lastUndoToken) {
      window.sessionStorage.setItem(LAST_UNDO_KEY, JSON.stringify({ pathname:window.location.pathname, token:lastUndoToken }));
    } else {
      window.sessionStorage.removeItem(LAST_UNDO_KEY);
    }
    var undoButton = document.getElementById('live-text-undo-source');
    if (undoButton) undoButton.hidden = !lastUndoToken;
  }

  function isSourceApplyContext() {
    var protocol = window.location.protocol;
    var host = window.location.hostname;
    return (protocol === 'http:' || protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1' || host === '::1');
  }

  function callToolApi(endpoint, body) {
    return window.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function(response) {
      return response.json().catch(function() { return {}; }).then(function(data) {
        if (!response.ok) throw new Error(data.error || 'Tool helper failed with ' + response.status + '.');
        return data;
      });
    });
  }

  function detectHelper() {
    if (!isSourceApplyContext()) {
      helperAvailable = false;
      updateSourceButton();
      return Promise.resolve(false);
    }
    return callToolApi('/__tools/live-editor/context', { pathname: window.location.pathname })
      .then(function(context) {
        helperContext = context;
        if (context.page && context.page.pathSegments && context.page.hash) {
          sourceHashes[context.page.pathSegments.join('/')] = context.page.hash;
        }
        helperAvailable = true;
        updateSourceButton();
        return true;
      })
      .catch(function() {
        helperContext = null;
        helperAvailable = false;
        updateSourceButton();
        return false;
      });
  }

  function targetForElement(element) {
    var owner = element && element.getAttribute('data-live-edit-owner') || '';
    var copyId = copyIdForElement(element);
    function ownerTarget(ownerElement, kind) {
      var ownerHref = ownerElement.getAttribute('data-live-edit-owner-href') || '';
      if (!/^\/(?!\/)/.test(ownerHref)) ownerHref = '';
      return {
        kind: kind,
        label: ownerElement.getAttribute('data-live-edit-label') || (kind === 'managed' ? 'Managed content' : 'Preview-only generated copy'),
        ownerHref: ownerHref,
        ownerLabel: ownerElement.getAttribute('data-live-edit-owner-label') || (ownerHref ? 'Open in Studio' : ''),
        applyable: false
      };
    }
    if (owner === 'source-marker') {
      var source = element.getAttribute('data-live-edit-source') || '';
      var marker = element.getAttribute('data-live-edit-marker') || '';
      return {
        kind: 'source-marker',
        source: source,
        marker: marker,
        label: element.getAttribute('data-live-edit-label') || marker || 'Shared source copy',
        applyable: Boolean(source && marker)
      };
    }
    if (owner === 'managed') {
      return ownerTarget(element, 'managed');
    }
    if (owner === 'preview') {
      return ownerTarget(element, 'preview');
    }
    var ownerContainer = element && element.parentElement && element.parentElement.closest('[data-live-edit-owner="managed"], [data-live-edit-owner="preview"]');
    if (ownerContainer) return ownerTarget(ownerContainer, ownerContainer.getAttribute('data-live-edit-owner'));
    if (copyId) {
      return { kind: 'html', copyId: copyId, label: element.getAttribute('data-live-edit-label') || 'Page HTML', applyable: true };
    }
    return { kind: 'preview', label: 'Preview-only element without a stable copy ID', applyable: false };
  }

  function syncElementEditingState(element) {
    if (!element) return;
    var target = targetForElement(element);
    var canEdit = Boolean(isEnabled && target.applyable);
    element.setAttribute('data-live-edit-target', target.kind);
    element.setAttribute('data-live-edit-applyable', target.applyable ? 'true' : 'false');
    element.contentEditable = canEdit ? 'true' : 'false';
    element.spellcheck = canEdit;
  }

  function coverageSummary() {
    var summary = { total:editableElements.length, saveable:0, html:0, source:0, managed:0, preview:0, broken:0 };
    editableElements.forEach(function(element) {
      var target = targetForElement(element);
      if (target.applyable) summary.saveable += 1;
      if (target.kind === 'html') summary.html += 1;
      else if (target.kind === 'source-marker' && target.applyable) summary.source += 1;
      else if (target.kind === 'managed') summary.managed += 1;
      else if (target.kind === 'preview') summary.preview += 1;
      else summary.broken += 1;
    });
    return summary;
  }

  function defaultStatusText() {
    if (!isEnabled) return 'off';
    var summary = coverageSummary();
    return 'editing · ' + summary.saveable + '/' + summary.total + ' saveable';
  }

  function sourcePathForTarget(target) {
    if (!target) return '';
    if (target.kind === 'html') return helperContext && helperContext.page && helperContext.page.pathSegments ? helperContext.page.pathSegments.join('/') : '';
    if (target.kind === 'source-marker') return target.source || '';
    return '';
  }

  function ensureSourceHash(target) {
    var sourcePath = sourcePathForTarget(target);
    if (!sourcePath || sourceHashes[sourcePath]) return Promise.resolve(sourceHashes[sourcePath] || '');
    return callToolApi('/__tools/read-file', { pathSegments: sourcePath.split('/') }).then(function(data) {
      sourceHashes[sourcePath] = data.hash || '';
      return sourceHashes[sourcePath];
    }).catch(function() { return ''; });
  }

  function normalizeColorValue(value) {
    if (!value) return '';
    var color = String(value).trim();
    if (!color || color === 'transparent' || color === 'inherit' || color === 'currentColor') return '';
    return color
      .replace(/\s*,\s*/g, ',')
      .replace(/rgba?\(/g, function(match) { return match.toLowerCase(); })
      .replace(/[A-F0-9]{3,8}/g, function(match) { return match.toUpperCase(); });
  }

  function alphaKey(alpha) {
    if (alpha === undefined || alpha === null || alpha === '') return '1';
    var numeric = Number(alpha);
    if (!Number.isFinite(numeric)) return String(alpha).trim();
    return String(Math.round(numeric * 1000) / 1000);
  }

  function colorValueKey(value) {
    var color = normalizeColorValue(value);
    var hex = color.match(/^#([0-9A-F]{3}|[0-9A-F]{4}|[0-9A-F]{6}|[0-9A-F]{8})$/i);
    if (hex) {
      var raw = hex[1];
      if (raw.length === 3 || raw.length === 4) {
        raw = raw.split('').map(function(char) { return char + char; }).join('');
      }
      var red = parseInt(raw.slice(0, 2), 16);
      var green = parseInt(raw.slice(2, 4), 16);
      var blue = parseInt(raw.slice(4, 6), 16);
      var alpha = raw.length === 8 ? Math.round((parseInt(raw.slice(6, 8), 16) / 255) * 1000) / 1000 : 1;
      return [red, green, blue, alpha].join(',');
    }

    var rgb = color.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      var parts = rgb[1].split(',').map(function(part) { return part.trim(); });
      if (parts.length >= 3) {
        return [
          Math.round(Number(parts[0])),
          Math.round(Number(parts[1])),
          Math.round(Number(parts[2])),
          alphaKey(parts[3])
        ].join(',');
      }
    }

    return color.toLowerCase();
  }

  function addPaletteColor(colors, color) {
    var normalized = normalizeColorValue(color.value);
    if (!normalized) return;
    if (!colors._seen) colors._seen = {};
    var key = colorValueKey(normalized);
    if (colors._seen[key]) return;
    colors._seen[key] = true;
    colors.push({ name: color.name || normalized, value: normalized });
  }

  function collectCssText() {
    var chunks = [];
    Array.prototype.slice.call(document.querySelectorAll('style')).forEach(function(style) {
      chunks.push(style.textContent || '');
    });

    Array.prototype.slice.call(document.querySelectorAll('[style]')).forEach(function(element) {
      chunks.push(element.getAttribute('style') || '');
    });

    Array.prototype.slice.call(document.styleSheets).forEach(function(sheet) {
      try {
        Array.prototype.slice.call(sheet.cssRules || []).forEach(function(rule) {
          chunks.push(rule.cssText || '');
        });
      } catch (error) {
        // Some browser policies block cssRules for external sheets.
      }
    });

    return chunks.join('\n');
  }

  function collectPageColors(colors) {
    var cssText = collectCssText();
    var colorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g;
    var matches = cssText.match(colorPattern) || [];

    matches.forEach(function(value) {
      addPaletteColor(colors, { name: 'Page color ' + value, value: value });
    });
  }

  function getColorPalette() {
    var colors = [];
    var rootStyles = window.getComputedStyle(document.documentElement);

    BASE_COLOR_PALETTE.forEach(function(color) {
      addPaletteColor(colors, color);
    });

    SITE_COLOR_VARS.forEach(function(name) {
      var value = rootStyles.getPropertyValue(name);
      addPaletteColor(colors, { name: name, value: value });
    });

    collectPageColors(colors);
    delete colors._seen;
    return colors;
  }

  function readElementStyles(element) {
    return {
      color: element.style.color || '',
      fontFamily: element.style.fontFamily || '',
      fontSize: element.style.fontSize || '',
      width: element.style.width || '',
      height: element.style.height || '',
      maxWidth: element.style.maxWidth || '',
      display: element.style.display || '',
      opacity: element.style.opacity || '',
      textTransform: element.style.textTransform || '',
      textAlign: element.style.textAlign || ''
    };
  }

  function applyElementStyles(element, styles) {
    styles = styles || {};
    element.style.color = styles.color || '';
    element.style.fontFamily = styles.fontFamily || '';
    element.style.fontSize = styles.fontSize || '';
    element.style.width = styles.width || '';
    element.style.height = styles.height || '';
    element.style.maxWidth = styles.maxWidth || '';
    element.style.display = styles.display || '';
    element.style.opacity = styles.opacity || '';
    element.style.textTransform = styles.textTransform || '';
    element.style.textAlign = styles.textAlign || '';
  }

  function hasMeaningfulStyles(styles) {
    return Boolean(styles && (styles.color || styles.fontFamily || styles.fontSize || styles.width || styles.height || styles.maxWidth || styles.display || styles.opacity || styles.textTransform || styles.textAlign));
  }

  function normalizeRecord(record) {
    record = record || {};
    var styles = Object.assign({}, record.styles || {});
    if (typeof record.color === 'string' && !styles.color) styles.color = record.color;
    return {
      text: typeof record.text === 'string' ? record.text : '',
      html: typeof record.html === 'string' ? record.html : '',
      color: typeof record.color === 'string' ? record.color : '',
      styles: styles,
      updatedAt: record.updatedAt || '',
      target: record.target && typeof record.target === 'object' ? record.target : null,
      expectedHash: typeof record.expectedHash === 'string' ? record.expectedHash : ''
    };
  }

  function collectEditableElements() {
    var candidates = Array.prototype.slice.call(document.querySelectorAll(TEXT_SELECTOR));
    var collected = [];

    candidates.forEach(function(element) {
      var hasStableCopyId = Boolean(copyIdForElement(element));
      if (isEditorNode(element)) return;
      if (element.closest('script, style, noscript, svg, canvas, input, textarea, select')) return;
      if (element.closest('#construct-fade, #construct-corner, #construct-nav')) return;
      if (element.closest('[data-live-edit-ignore]')) return;
      if (element.hasAttribute('data-live-edit-container')) return;
      if (!element.textContent || !element.textContent.trim()) return;
      if (!hasStableCopyId && !hasDirectText(element)) return;
      if (hasEditableParent(element)) return;

      var nextId = buildElementId(element, collected.length);
      if (element.getAttribute('data-live-edit-id') !== nextId) element.setAttribute('data-live-edit-id', nextId);
      collected.push(element);
    });

    return collected;
  }

  function hydrateSavedText() {
    if (isHydrated) return;
    var saved = getSavedCopy();
    editableElements = collectEditableElements();

    var migrated = false;
    var currentIds = {};
    editableElements.forEach(function(element, index) {
      var id = element.getAttribute('data-live-edit-id');
      if (id) currentIds[id] = true;
      var legacyId = buildLegacyElementId(element, index);
      if (legacyId && legacyId !== id && saved[legacyId] && !saved[id]) {
        saved[id] = saved[legacyId];
        delete saved[legacyId];
        migrated = true;
      }
      var target = targetForElement(element);
      if (!originalRecords[id]) {
        originalRecords[id] = {
          html: element.innerHTML,
          styles: readElementStyles(element),
          text: element.textContent || '',
          target: target
        };
      }
      if (saved[id]) {
        var record = normalizeRecord(saved[id]);
        if (target.kind === 'html' && record.html) element.innerHTML = record.html;
        else if (record.text) element.textContent = record.text;
        if (target.kind === 'html') applyElementStyles(element, record.styles);
      }
    });

    if (migrated) setSavedCopy(saved);

    isHydrated = true;
  }

  function saveElement(element) {
    var id = element.getAttribute('data-live-edit-id');
    if (!id) return;

    var saved = getSavedCopy();
    var styles = readElementStyles(element);
    var target = targetForElement(element);
    var sourcePath = sourcePathForTarget(target);
    saved[id] = {
      text: element.textContent.trim(),
      html: target.kind === 'html' ? element.innerHTML : '',
      color: target.kind === 'html' ? styles.color || '' : '',
      styles: target.kind === 'html' ? styles : {},
      updatedAt: new Date().toISOString(),
      target: target,
      expectedHash: sourceHashes[sourcePath] || ''
    };
    setSavedCopy(saved);
    if (target.applyable && !saved[id].expectedHash) {
      ensureSourceHash(target).then(function(hash) {
        var latest = getSavedCopy();
        if (!latest[id]) return;
        latest[id].expectedHash = hash || '';
        setSavedCopy(latest);
      });
    }
    updateStatus(target.applyable ? 'Draft saved in this browser' : target.kind === 'managed' ? 'Preview saved · managed elsewhere' : 'Preview saved · no source target');
  }

  function getEditableFromSelection() {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount) return activeElement;

    var node = selection.anchorNode;
    if (!node) return activeElement;
    var element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element && element.closest ? element.closest('[data-live-edit-id]') || activeElement : activeElement;
  }

  function selectionIsInside(element) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return false;
    var range = selection.getRangeAt(0);
    return element.contains(range.commonAncestorContainer);
  }

  function captureControlTarget() {
    var element = getEditableFromSelection();
    activeElement = element || activeElement;
    controlSelectionRange = null;

    var selection = window.getSelection && window.getSelection();
    if (selection && selection.rangeCount && !selection.isCollapsed && activeElement) {
      var range = selection.getRangeAt(0);
      if (activeElement.contains(range.commonAncestorContainer)) {
        controlSelectionRange = range.cloneRange();
      }
    }

    return activeElement;
  }

  function restoreControlSelection() {
    if (!controlSelectionRange) return;
    var selection = window.getSelection && window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(controlSelectionRange);
  }

  function styleSelection(element, styles) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return false;

    var range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return false;

    var span = document.createElement('span');
    applyElementStyles(span, styles);
    span.appendChild(range.extractContents());
    range.insertNode(span);
    selection.removeAllRanges();
    range.selectNodeContents(span);
    selection.addRange(range);
    return true;
  }

  function selectNodeContents(node) {
    var selection = window.getSelection && window.getSelection();
    if (!selection) return;
    var range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    controlSelectionRange = range.cloneRange();
  }

  function wrapSelection(element, tagName, attributes) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return false;

    var range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return false;

    var wrapper = document.createElement(tagName.toLowerCase());
    Object.keys(attributes || {}).forEach(function(name) {
      wrapper.setAttribute(name, attributes[name]);
    });
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    selectNodeContents(wrapper);
    return true;
  }

  function nodeClosest(node, selector) {
    var element = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    return element && element.closest ? element.closest(selector) : null;
  }

  function linkFromSelection(element) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount || !element) return null;
    var link = nodeClosest(selection.anchorNode, 'a');
    return link && element.contains(link) ? link : null;
  }

  function unwrapNode(node) {
    var parent = node && node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  }

  function richTextAllowed(element) {
    if (!element || targetForElement(element).kind !== 'html') {
      updateStatus('This source accepts plain copy only');
      return false;
    }
    return true;
  }

  function formattingAllowed(element) {
    if (!richTextAllowed(element)) return false;
    if (element.matches('.hero-descriptor,[data-live-edit-system-role]')) {
      updateStatus('Shared typography is controlled by the design system');
      return false;
    }
    return true;
  }

  function applyInlineTag(element, tagName, label) {
    if (!element) {
      updateStatus('select text');
      return;
    }
    if (!richTextAllowed(element)) return;

    restoreControlSelection();
    if (!wrapSelection(element, tagName)) {
      updateStatus('select text');
      return;
    }

    saveElement(element);
    updateStatus(label);
  }

  function applyLink(element) {
    if (!element) {
      updateStatus('select text');
      return;
    }
    if (!richTextAllowed(element)) return;

    restoreControlSelection();
    var currentLink = linkFromSelection(element);
    var currentHref = currentLink ? currentLink.getAttribute('href') || '' : '';
    var href = window.prompt('Link URL. Leave blank to remove an existing link.', currentHref);
    if (href === null) return;

    href = sanitizeUrl(href);
    if (!href) {
      if (currentLink) {
        unwrapNode(currentLink);
        saveElement(element);
        updateStatus('unlinked');
      } else {
        updateStatus('invalid link');
      }
      return;
    }

    if (currentLink) {
      currentLink.setAttribute('href', href);
      selectNodeContents(currentLink);
    } else if (!wrapSelection(element, 'a', { href: href })) {
      updateStatus('select text');
      return;
    }

    saveElement(element);
    updateStatus('linked');
  }

  function insertLineBreak(element) {
    if (!element) {
      updateStatus('select text');
      return;
    }
    if (!richTextAllowed(element)) return;

    restoreControlSelection();
    element.focus();
    var selection = window.getSelection && window.getSelection();
    var br = document.createElement('br');

    if (selection && selection.rangeCount && element.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      var range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(br);
      range.setStartAfter(br);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      controlSelectionRange = range.cloneRange();
    } else {
      element.appendChild(br);
    }

    saveElement(element);
    updateStatus('line break');
  }

  function colorSelection(element, color) {
    return styleSelection(element, { color: color });
  }

  function applyColorToElement(element, color) {
    if (!element) {
      updateStatus('select text');
      return;
    }
    if (!formattingAllowed(element)) return;

    if (selectionIsInside(element) && color) {
      colorSelection(element, color);
    } else {
      element.focus();
      element.style.color = color || '';
    }

    saveElement(element);
    updateStatus(color ? 'colored' : 'default');
  }

  function applyInlineStyle(element, property, value) {
    if (!element) {
      updateStatus('select text');
      return;
    }
    if (!formattingAllowed(element)) return;

    var styles = {};
    styles[property] = value || '';

    if (selectionIsInside(element)) {
      styleSelection(element, styles);
    } else {
      element.focus();
      element.style[property] = value || '';
    }

    saveElement(element);
    updateStatus(value ? 'styled' : 'default');
  }

  function applyBlockStyle(element, property, value) {
    if (!element) {
      updateStatus('select text');
      return;
    }
    if (!formattingAllowed(element)) return;

    element.focus();
    element.style[property] = value || '';
    saveElement(element);
    updateStatus(value ? 'aligned' : 'default');
  }

  function applyCaseToElement(element, value) {
    applyInlineStyle(element, 'textTransform', value);
  }

  function applyFontToElement(element, value) {
    applyInlineStyle(element, 'fontFamily', value);
  }

  function applyFontSizeToElement(element, value) {
    applyInlineStyle(element, 'fontSize', value);
  }

  function enableBoxResize(element) {
    if (!element) {
      updateStatus('select text');
      return;
    }
    if (!formattingAllowed(element)) return;
    activeElement = element;
    activeResizeElement = element;
    ensureResizableBox(element);
    element.classList.add('is-live-resizing');
    saveElement(element);
    updateStatus('box resize');
  }

  function normalizeFontSizeValue(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'default') return '';
    if (/^\d+(\.\d+)?$/.test(raw)) return raw + 'px';
    if (/^\d+(\.\d+)?(px|rem|em|vw|vh|%)$/.test(raw)) return raw;
    return '';
  }

  function ensureResizableBox(element) {
    if (!element) return;
    var computed = window.getComputedStyle(element);
    if (computed.display === 'inline') element.style.display = 'inline-block';
    element.style.maxWidth = 'none';
    if (!element.style.width) element.style.width = Math.ceil(element.getBoundingClientRect().width) + 'px';
    if (!element.style.height) element.style.height = Math.ceil(element.getBoundingClientRect().height) + 'px';
  }

  function saveResizedElement(element, rect) {
    if (!element || !isEnabled || !element.hasAttribute('data-live-edit-id')) return;
    ensureResizableBox(element);
    element.style.width = Math.max(24, Math.round(rect.width)) + 'px';
    element.style.height = Math.max(20, Math.round(rect.height)) + 'px';
    saveElement(element);
    updateStatus('resized');
  }

  function watchEditableResizes() {
    if (resizeObserver) resizeObserver.disconnect();
    if (!isEnabled || !window.ResizeObserver) return;

    resizeObserver = new ResizeObserver(function(entries) {
      entries.forEach(function(entry) {
        var element = entry.target;
        if (!element || element !== activeResizeElement) return;
        var rect = entry.contentRect;
        window.clearTimeout(resizeSaveTimers.get(element));
        resizeSaveTimers.set(element, window.setTimeout(function() {
          saveResizedElement(element, rect);
        }, 220));
      });
    });

    editableElements.forEach(function(element) {
      resizeObserver.observe(element);
    });
  }

  function stopWatchingEditableResizes() {
    if (resizeObserver) resizeObserver.disconnect();
    if (activeResizeElement) activeResizeElement.classList.remove('is-live-resizing');
    resizeObserver = null;
    activeResizeElement = null;
    resizeDrag = null;
  }

  function applyStrengthToElement(element, value) {
    applyBlockStyle(element, 'opacity', value);
  }

  function clearSelectedFormatting(element) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return false;

    var range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return false;

    var text = selection.toString();
    range.deleteContents();
    var textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    controlSelectionRange = range.cloneRange();
    return true;
  }

  function clearElementFormatting(element) {
    applyElementStyles(element, {});
    element.querySelectorAll('span, strong, em, a').forEach(function(node) {
      node.removeAttribute('style');
      unwrapNode(node);
    });
  }

  function clearFormatting(element) {
    if (!element) {
      updateStatus('select text');
      return;
    }
    if (!formattingAllowed(element)) return;

    restoreControlSelection();
    if (selectionIsInside(element)) {
      clearSelectedFormatting(element);
      saveElement(element);
    } else {
      clearElementFormatting(element);
      saveElement(element);
    }
    updateStatus('cleared');
  }

  function sanitizeStyle(sourceStyle) {
    var allowed = ['color', 'font-family', 'font-size', 'width', 'height', 'max-width', 'display', 'opacity', 'text-transform', 'text-align'];
    var output = [];
    String(sourceStyle || '').split(';').forEach(function(part) {
      var index = part.indexOf(':');
      if (index === -1) return;
      var name = part.slice(0, index).trim().toLowerCase();
      var value = part.slice(index + 1).trim();
      if (!value || allowed.indexOf(name) === -1) return;
      if (/url\s*\(|expression\s*\(/i.test(value)) return;
      if (name === 'font-size' && !/^(0|[1-9]\d{0,2})(\.\d{1,2})?(px|rem|em|%)$/i.test(value)) return;
      if ((name === 'width' || name === 'height') && !/^(0|[1-9]\d{0,3})(\.\d{1,2})?(px|rem|em|vw|vh|%)$/i.test(value)) return;
      if (name === 'max-width' && value !== 'none' && !/^(0|[1-9]\d{0,3})(\.\d{1,2})?(px|rem|em|vw|vh|%)$/i.test(value)) return;
      if (name === 'display' && value !== 'block' && value !== 'inline-block') return;
      if (name === 'opacity' && !/^(0(\.\d{1,3})?|1(\.0{1,3})?)$/.test(value)) return;
      output.push(name + ': ' + value);
    });
    return output.join('; ');
  }

  function sanitizeUrl(value) {
    var href = String(value || '').trim();
    if (!href) return '';
    if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return href;
    return '';
  }

  function sanitizeHtml(html) {
    var template = document.createElement('template');
    template.innerHTML = html || '';
    var allowed = { SPAN: true, STRONG: true, EM: true, BR: true, A: true };

    function clean(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function(child) {
        if (child.nodeType === Node.TEXT_NODE) return;
        if (child.nodeType !== Node.ELEMENT_NODE) {
          child.remove();
          return;
        }
        if (!allowed[child.tagName]) {
          var fragment = document.createDocumentFragment();
          while (child.firstChild) fragment.appendChild(child.firstChild);
          child.replaceWith(fragment);
          clean(node);
          return;
        }
        var originalHref = child.getAttribute('href');
        var originalStyle = child.getAttribute('style');
        Array.prototype.slice.call(child.attributes).forEach(function(attribute) {
          child.removeAttribute(attribute.name);
        });
        if (child.tagName === 'A') {
          var href = sanitizeUrl(originalHref);
          if (href) child.setAttribute('href', href);
        }
        if (child.tagName === 'SPAN') {
          var safeStyle = sanitizeStyle(originalStyle);
          if (safeStyle) child.setAttribute('style', safeStyle);
        }
        clean(child);
      });
    }

    clean(template.content);
    return template.innerHTML;
  }

  function injectStyles() {
    if (document.getElementById('live-text-editor-styles')) return;

    var style = document.createElement('style');
    style.id = 'live-text-editor-styles';
    style.textContent = [
      'body.live-text-editing [data-live-edit-applyable="true"]{outline:1px dashed rgba(252,184,103,.42);outline-offset:3px;cursor:text;min-width:24px;min-height:20px;}',
      'body.live-text-editing [data-live-edit-applyable="true"].is-live-resizing{resize:both;max-width:none!important;overflow:auto!important;cursor:text;}',
      'body.live-text-editing [data-live-edit-applyable="true"]:hover,body.live-text-editing [data-live-edit-applyable="true"]:focus{outline-color:#FCB867;background:rgba(252,184,103,.08);}',
      'body.live-text-editing [data-live-edit-applyable="true"]:focus{box-shadow:0 0 0 4px rgba(252,184,103,.12);}',
      '#live-text-editor{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:8px;width:auto;max-width:calc(100vw - 36px);padding:8px;border:1px solid rgba(252,184,103,.32);background:rgba(14,14,14,.94);backdrop-filter:blur(16px);color:#FFE7CA;font-family:Inter,Arial,sans-serif;font-size:11px;line-height:1;box-shadow:0 14px 34px rgba(0,0,0,.36);}',
      '#live-text-editor .tool-section,#live-text-style-panel .tool-section{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;}',
      '#live-text-editor .tool-label,#live-text-style-panel .tool-label{color:rgba(255,231,202,.48);font-family:Georgia,Times New Roman,serif;text-transform:lowercase;}',
      '#live-text-editor button,#live-text-style-panel button{min-height:30px;border:1px solid rgba(252,184,103,.26);background:transparent;color:inherit;padding:0 10px;font:inherit;font-weight:700;text-transform:uppercase;letter-spacing:0;cursor:pointer;}',
      '#live-text-style-panel select,#live-text-style-panel input{min-height:30px;max-width:148px;border:1px solid rgba(252,184,103,.26);background:#0e0e0e;color:#FFE7CA;padding:0 8px;font:inherit;}',
      '#live-text-style-panel .font-size-input{width:92px;}',
      '#live-text-style-panel .font-picker{position:relative;display:grid;gap:6px;min-width:158px;}',
      '#live-text-style-panel .font-picker-toggle{width:100%;text-align:left;text-transform:none;font-size:13px;}',
      '#live-text-style-panel .font-picker-menu{display:none;grid-template-columns:1fr;gap:4px;min-width:190px;max-height:190px;overflow:auto;padding:6px;border:1px solid rgba(252,184,103,.26);background:#0e0e0e;}',
      '#live-text-style-panel .font-picker.is-open .font-picker-menu{display:grid;}',
      '#live-text-style-panel .font-choice{width:100%;justify-content:flex-start;text-align:left;text-transform:none;font-size:15px;line-height:1.1;}',
      '#live-text-editor button:hover,#live-text-editor button:focus-visible,#live-text-style-panel button:hover,#live-text-style-panel button:focus-visible{border-color:#FCB867;color:#FCB867;outline:none;}',
      '#live-text-editor .is-active{background:#FCB867;color:#0e0e0e;border-color:#FCB867;}',
      '#live-text-style-panel{position:fixed;left:50%;bottom:var(--live-text-panel-bottom,118px);transform:translateX(-50%);z-index:2147483647;display:none;grid-template-columns:auto minmax(0,1fr);gap:10px;width:min(760px,calc(100vw - 36px));max-height:min(260px,calc(100vh - var(--live-text-panel-bottom,118px) - 24px));overflow:auto;padding:10px;border:1px solid rgba(252,184,103,.32);background:rgba(14,14,14,.96);backdrop-filter:blur(16px);color:#FFE7CA;font-family:Inter,Arial,sans-serif;font-size:11px;line-height:1;box-shadow:0 18px 44px rgba(0,0,0,.44);}',
      '#live-text-style-panel.is-open{display:grid;}',
      '#live-text-style-panel .style-controls{align-content:start;}',
      '#live-text-style-panel .color-wrap{display:grid;gap:8px;align-content:start;min-width:0;}',
      '#live-text-style-panel .color-group{display:none;align-items:center;flex-wrap:wrap;gap:6px;max-height:116px;overflow:auto;padding:0 2px 0 10px;border-left:1px solid rgba(252,184,103,.22);}',
      '#live-text-style-panel .color-group.is-open{display:flex;}',
      '#live-text-style-panel .color-swatch{width:24px;min-height:24px;padding:0;border-radius:50%;border-color:rgba(255,231,202,.28);background:var(--swatch,transparent);color:transparent;overflow:hidden;flex:0 0 auto;}',
      '#live-text-style-panel .color-swatch:hover,#live-text-style-panel .color-swatch:focus-visible{border-color:#FFE7CA;box-shadow:0 0 0 3px rgba(252,184,103,.12);color:transparent;}',
      '#live-text-style-panel .color-reset{width:24px;min-height:24px;padding:0;border-radius:50%;color:rgba(255,231,202,.62);font-size:16px;line-height:1;}',
      '#live-text-editor-status{min-width:120px;max-width:260px;color:rgba(255,231,202,.62);font-family:Georgia,Times New Roman,serif;line-height:1.25;text-transform:none;}',
      '#live-text-export{position:fixed;right:18px;bottom:var(--live-text-panel-bottom,118px);z-index:2147483647;width:min(560px,calc(100vw - 36px));min-height:220px;max-height:calc(100vh - var(--live-text-panel-bottom,118px) - 24px);padding:12px;border:1px solid rgba(252,184,103,.32);background:#0e0e0e;color:#FFE7CA;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;}',
      '#live-text-review{position:fixed;right:18px;bottom:var(--live-text-panel-bottom,118px);z-index:2147483647;width:min(720px,calc(100vw - 36px));max-height:min(680px,calc(100vh - var(--live-text-panel-bottom,118px) - 24px));overflow:auto;border:1px solid rgba(252,184,103,.32);background:#0e0e0e;color:#FFE7CA;box-shadow:0 18px 48px rgba(0,0,0,.48);font-family:Inter,Arial,sans-serif;}',
      '#live-text-review header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-bottom:1px solid rgba(252,184,103,.22);}',
      '#live-text-review h2{margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#FCB867;}',
      '#live-text-review .review-actions{display:flex;gap:6px;flex-wrap:wrap;}',
      '#live-text-review .review-body{display:grid;gap:10px;padding:12px;}',
      '#live-text-review .review-path{margin:0;color:rgba(255,231,202,.58);font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word;}',
      '#live-text-review .review-item{border:1px solid rgba(252,184,103,.22);padding:10px;background:rgba(255,255,255,.02);}',
      '#live-text-review .review-select{display:flex;align-items:flex-start;gap:8px;margin:0 0 8px;color:#FCB867;font:700 11px/1.3 Inter,Arial,sans-serif;text-transform:uppercase;}',
      '#live-text-review .review-select input{margin:1px 0 0;accent-color:#FCB867;}',
      '#live-text-review .review-target{display:inline-block;margin-top:6px;padding:4px 6px;background:rgba(252,184,103,.08);color:#FCB867;font:10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;}',
      '#live-text-review .review-target.is-preview{color:rgba(255,231,202,.55);}',
      '#live-text-review .review-id{font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(255,231,202,.58);word-break:break-word;}',
      '#live-text-review pre{white-space:pre-wrap;word-break:break-word;margin:8px 0 0;color:rgba(255,231,202,.78);font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;}',
      '#live-text-review button{min-height:30px;border:1px solid rgba(252,184,103,.26);background:transparent;color:#FFE7CA;padding:0 10px;font:700 11px/1 Inter,Arial,sans-serif;text-transform:uppercase;cursor:pointer;}',
      '#live-text-review button:hover{border-color:#FCB867;color:#FCB867;}',
      '#live-text-coverage{position:fixed;right:18px;bottom:var(--live-text-panel-bottom,118px);z-index:2147483647;width:min(720px,calc(100vw - 36px));max-height:min(680px,calc(100vh - var(--live-text-panel-bottom,118px) - 24px));overflow:auto;border:1px solid rgba(252,184,103,.32);background:#0e0e0e;color:#FFE7CA;box-shadow:0 18px 48px rgba(0,0,0,.48);font-family:Inter,Arial,sans-serif;}',
      '#live-text-coverage header{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-bottom:1px solid rgba(252,184,103,.22);background:#0e0e0e;}',
      '#live-text-coverage h2{margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#FCB867;}',
      '#live-text-coverage button{min-height:30px;border:1px solid rgba(252,184,103,.26);background:transparent;color:#FFE7CA;padding:0 10px;font:700 11px/1 Inter,Arial,sans-serif;text-transform:uppercase;cursor:pointer;}',
      '#live-text-coverage .coverage-body{display:grid;gap:10px;padding:12px;}',
      '#live-text-coverage .coverage-summary{margin:0;color:rgba(255,231,202,.78);font:12px/1.5 Inter,Arial,sans-serif;}',
      '#live-text-coverage .coverage-owner-actions{display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding:9px;border:1px solid rgba(252,184,103,.22);background:rgba(252,184,103,.04);}',
      '#live-text-coverage .coverage-owner-actions>span{width:100%;color:rgba(255,231,202,.5);font:700 9px/1.2 Inter,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;}',
      '#live-text-coverage .coverage-item{padding:9px;border:1px solid rgba(252,184,103,.18);background:rgba(255,255,255,.02);}',
      '#live-text-coverage .coverage-kind{color:#FCB867;font:700 10px/1.2 Inter,Arial,sans-serif;text-transform:uppercase;}',
      '#live-text-coverage .coverage-id{margin-top:4px;color:rgba(255,231,202,.48);font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word;}',
      '#live-text-coverage .coverage-copy{margin:6px 0 0;color:rgba(255,231,202,.78);font:11px/1.4 Georgia,Times New Roman,serif;}',
      '#live-text-coverage .coverage-owner-link{display:inline-flex;margin-top:8px;min-height:30px;align-items:center;border:1px solid rgba(252,184,103,.34);padding:0 9px;color:#FCB867;font:700 10px/1 Inter,Arial,sans-serif;letter-spacing:.06em;text-decoration:none;text-transform:uppercase;}',
      '#live-text-coverage .coverage-owner-link:hover,#live-text-coverage .coverage-owner-link:focus-visible{border-color:#FCB867;color:#FFE7CA;}',
      '#live-text-history{position:fixed;right:18px;bottom:var(--live-text-panel-bottom,118px);z-index:2147483647;width:min(760px,calc(100vw - 36px));max-height:min(680px,calc(100vh - var(--live-text-panel-bottom,118px) - 24px));overflow:auto;border:1px solid rgba(252,184,103,.32);background:#0e0e0e;color:#FFE7CA;box-shadow:0 18px 48px rgba(0,0,0,.48);font-family:Inter,Arial,sans-serif;}',
      '#live-text-history header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-bottom:1px solid rgba(252,184,103,.22);background:#0e0e0e;}',
      '#live-text-history h2{margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#FCB867;}',
      '#live-text-history .history-actions,#live-text-history .history-item-actions{display:flex;gap:6px;flex-wrap:wrap;}',
      '#live-text-history button{min-height:30px;border:1px solid rgba(252,184,103,.26);background:transparent;color:#FFE7CA;padding:0 10px;font:700 10px/1 Inter,Arial,sans-serif;text-transform:uppercase;cursor:pointer;}',
      '#live-text-history button:hover,#live-text-history button:focus-visible{border-color:#FCB867;color:#FCB867;}',
      '#live-text-history button:disabled{cursor:wait;opacity:.48;}',
      '#live-text-history .history-body{display:grid;gap:10px;padding:12px;}',
      '#live-text-history .history-empty,#live-text-history .history-summary{margin:0;color:rgba(255,231,202,.7);font:12px/1.5 Inter,Arial,sans-serif;}',
      '#live-text-history .history-item{display:grid;gap:8px;padding:10px;border:1px solid rgba(252,184,103,.2);background:rgba(255,255,255,.02);}',
      '#live-text-history .history-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}',
      '#live-text-history .history-item h3{margin:0;color:#FCB867;font:700 11px/1.3 Inter,Arial,sans-serif;text-transform:uppercase;}',
      '#live-text-history .history-kind{color:rgba(255,231,202,.52);font:700 9px/1.2 Inter,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;}',
      '#live-text-history .history-meta{margin:0;color:rgba(255,231,202,.58);font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word;}',
      '#live-text-history .history-baseline{width:max-content;max-width:100%;padding:3px 5px;background:rgba(252,184,103,.1);color:#FCB867;font:700 9px/1.2 Inter,Arial,sans-serif;text-transform:uppercase;}',
      '#live-text-history .history-detail{display:grid;gap:8px;padding-top:8px;border-top:1px solid rgba(252,184,103,.14);}',
      '#live-text-history .history-file{display:grid;gap:6px;}',
      '#live-text-history .history-file>strong{color:rgba(255,231,202,.62);font:10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;}',
      '#live-text-history .history-change{padding:8px;background:rgba(0,0,0,.28);}',
      '#live-text-history .history-change strong{color:#FCB867;font:700 9px/1.2 Inter,Arial,sans-serif;text-transform:uppercase;}',
      '#live-text-history .history-change pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;color:rgba(255,231,202,.72);font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;}',
      '@media(max-width:760px){#live-text-editor{left:12px;right:12px;bottom:12px;transform:none;justify-content:flex-start;max-width:none;max-height:160px;overflow:auto;align-items:flex-start;flex-wrap:wrap;}#live-text-style-panel{left:12px;right:12px;transform:none;width:auto;grid-template-columns:1fr;}#live-text-review,#live-text-coverage,#live-text-history{left:12px;right:12px;top:12px;width:auto;max-height:none;}#live-text-review header{position:sticky;top:0;z-index:1;background:#0e0e0e;}#live-text-export{left:12px;right:12px;width:auto;}#live-text-style-panel select,#live-text-style-panel input{max-width:100%;}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function updateStatus(message) {
    var status = document.getElementById('live-text-editor-status');
    if (!status) return;

    status.textContent = message;
    window.clearTimeout(updateStatus._timer);
    updateStatus._timer = window.setTimeout(function() {
      status.textContent = defaultStatusText();
      updateStatus._timer = null;
    }, 2600);
  }

  function updateSourceButton() {
    var button = document.getElementById('live-text-apply-source');
    if (button) button.hidden = !helperAvailable;
    var historyButton = document.getElementById('live-text-history-button');
    if (historyButton) historyButton.hidden = !helperAvailable;
  }

  function syncFloatingPanelInset() {
    var toolbar = document.getElementById(EDITOR_ID);
    if (!toolbar) return;
    var rect = toolbar.getBoundingClientRect();
    var inset = Math.max(86, Math.ceil(window.innerHeight - rect.top + 12));
    document.documentElement.style.setProperty('--live-text-panel-bottom', inset + 'px');
  }

  function makeButton(label, onClick, className) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (className) button.className = className;
    button.addEventListener('mousedown', function(event) {
      button._liveEditTarget = captureControlTarget();
      event.preventDefault();
    });
    button.addEventListener('click', function() {
      restoreControlSelection();
      onClick(button._liveEditTarget || getEditableFromSelection());
      button._liveEditTarget = null;
    });
    return button;
  }

  function makeSelect(label, options, onChange) {
    var select = document.createElement('select');
    select.setAttribute('aria-label', label);
    options.forEach(function(option) {
      var item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      select.appendChild(item);
    });
    select.addEventListener('pointerdown', function() {
      select._liveEditTarget = captureControlTarget();
    });
    select.addEventListener('focus', function() {
      if (!select._liveEditTarget) select._liveEditTarget = captureControlTarget();
    });
    select.addEventListener('change', function() {
      restoreControlSelection();
      onChange(select.value, select._liveEditTarget || getEditableFromSelection());
      select._liveEditTarget = null;
      select.value = '';
    });
    return select;
  }

  function makeFontSizeInput(onChange) {
    var input = document.createElement('input');
    input.className = 'font-size-input';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = 'Size px';
    input.setAttribute('aria-label', 'Font size');
    input.addEventListener('pointerdown', function() {
      input._liveEditTarget = captureControlTarget();
    });
    input.addEventListener('focus', function() {
      if (!input._liveEditTarget) input._liveEditTarget = captureControlTarget();
    });
    input.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commitFontSizeInput(input, onChange);
    });
    input.addEventListener('change', function() {
      commitFontSizeInput(input, onChange);
    });
    return input;
  }

  function commitFontSizeInput(input, onChange) {
    var value = normalizeFontSizeValue(input.value);
    if (input.value.trim() && !value) {
      updateStatus('bad size');
      return;
    }
    restoreControlSelection();
    onChange(value, input._liveEditTarget || getEditableFromSelection());
    input._liveEditTarget = null;
    input.value = '';
  }

  function makeFontPicker(options, onChange) {
    var picker = document.createElement('div');
    picker.className = 'font-picker';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'font-picker-toggle';
    toggle.textContent = 'Font';
    toggle.setAttribute('aria-label', 'Choose font family');
    toggle.addEventListener('mousedown', function(event) {
      picker._liveEditTarget = captureControlTarget();
      event.preventDefault();
    });
    toggle.addEventListener('click', function() {
      restoreControlSelection();
      picker.classList.toggle('is-open');
    });

    var menu = document.createElement('div');
    menu.className = 'font-picker-menu';
    menu.setAttribute('role', 'menu');

    options.forEach(function(option) {
      var choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'font-choice';
      choice.textContent = option.label;
      choice.style.fontFamily = option.preview || option.value || '';
      choice.setAttribute('role', 'menuitem');
      choice.addEventListener('mousedown', function(event) {
        if (!picker._liveEditTarget) picker._liveEditTarget = captureControlTarget();
        event.preventDefault();
      });
      choice.addEventListener('click', function() {
        restoreControlSelection();
        onChange(option.value, picker._liveEditTarget || getEditableFromSelection());
        toggle.textContent = option.label;
        toggle.style.fontFamily = option.preview || option.value || '';
        picker.classList.remove('is-open');
        picker._liveEditTarget = null;
      });
      menu.appendChild(choice);
    });

    picker.appendChild(toggle);
    picker.appendChild(menu);
    return picker;
  }

  function makeSection(label) {
    var section = document.createElement('div');
    section.className = 'tool-section';
    if (label) {
      var labelEl = document.createElement('span');
      labelEl.className = 'tool-label';
      labelEl.textContent = label;
      section.appendChild(labelEl);
    }
    return section;
  }

  function toggleStylePanel() {
    var panel = document.getElementById('live-text-style-panel');
    var button = document.getElementById('live-text-style-toggle');
    if (!panel) return;
    var nextOpen = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', nextOpen);
    if (button) button.classList.toggle('is-active', nextOpen);
  }

  function toggleColorPanel() {
    var group = document.getElementById('live-text-color-group');
    var button = document.getElementById('live-text-color-toggle');
    if (!group) return;
    var nextOpen = !group.classList.contains('is-open');
    group.classList.toggle('is-open', nextOpen);
    if (button) button.classList.toggle('is-active', nextOpen);
  }

  function makeToolbar() {
    if (document.getElementById(EDITOR_ID)) return;

    var toolbar = document.createElement('div');
    toolbar.id = EDITOR_ID;
    toolbar.setAttribute('data-live-edit-ignore', 'true');

    var editSection = makeSection('');
    var toggle = makeButton('Edit', function() {
      setEnabled(!isEnabled);
    });
    toggle.id = 'live-text-editor-toggle';
    editSection.appendChild(toggle);
    editSection.appendChild(makeButton('Pages', function() {
      window.location.href = '/edit-links.html';
    }));
    var styleToggle = makeButton('Style', toggleStylePanel);
    styleToggle.id = 'live-text-style-toggle';
    editSection.appendChild(styleToggle);

    var styleSection = makeSection('Style');
    styleSection.className += ' style-controls';
    styleSection.appendChild(makeFontPicker([
      { label: 'Font', value: '', preview: 'Inter, Arial, sans-serif' },
      { label: 'Default font', value: 'default', preview: 'Inter, Arial, sans-serif' },
      { label: 'Site serif', value: 'Georgia, "Times New Roman", Times, serif', preview: 'Georgia, "Times New Roman", Times, serif' },
      { label: 'Site display', value: 'Inter, Arial, sans-serif', preview: 'Inter, Arial, sans-serif' },
      { label: 'System sans', value: 'Arial, Helvetica, sans-serif', preview: 'Arial, Helvetica, sans-serif' },
      { label: 'Monospace', value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', preview: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }
    ], function(value, target) {
      applyFontToElement(target || getEditableFromSelection(), value === 'default' ? '' : value);
    }));
    styleSection.appendChild(makeFontSizeInput(function(value, target) {
      applyFontSizeToElement(target || getEditableFromSelection(), value);
    }));
    styleSection.appendChild(makeSelect('Text strength', [
      { label: 'Strength', value: '' },
      { label: 'Default strength', value: 'default' },
      { label: 'Full strength', value: '1' },
      { label: 'Soft 72%', value: '0.72' },
      { label: 'Muted 55%', value: '0.55' },
      { label: 'Dim 35%', value: '0.35' }
    ], function(value, target) {
      applyStrengthToElement(target || getEditableFromSelection(), value === 'default' ? '' : value);
    }));
    styleSection.appendChild(makeSelect('Case', [
      { label: 'Case', value: '' },
      { label: 'Default case', value: 'default' },
      { label: 'Uppercase', value: 'uppercase' },
      { label: 'Lowercase', value: 'lowercase' },
      { label: 'Capitalize', value: 'capitalize' }
    ], function(value, target) {
      applyCaseToElement(target || getEditableFromSelection(), value === 'default' ? '' : value);
    }));
    styleSection.appendChild(makeSelect('Alignment', [
      { label: 'Align', value: '' },
      { label: 'Default align', value: 'default' },
      { label: 'Left', value: 'left' },
      { label: 'Center', value: 'center' },
      { label: 'Right', value: 'right' }
    ], function(value, target) {
      applyBlockStyle(target || getEditableFromSelection(), 'textAlign', value === 'default' ? '' : value);
    }));
    var boldButton = makeButton('B', function(target) {
      applyInlineTag(target || getEditableFromSelection(), 'strong', 'bold');
    });
    boldButton.title = 'Bold selected text';
    boldButton.setAttribute('aria-label', 'Bold selected text');
    styleSection.appendChild(boldButton);

    var italicButton = makeButton('I', function(target) {
      applyInlineTag(target || getEditableFromSelection(), 'em', 'italic');
    });
    italicButton.title = 'Italic selected text';
    italicButton.setAttribute('aria-label', 'Italic selected text');
    styleSection.appendChild(italicButton);

    var linkButton = makeButton('Link', function(target) {
      applyLink(target || getEditableFromSelection());
    });
    linkButton.title = 'Add or edit link';
    linkButton.setAttribute('aria-label', 'Add or edit link');
    styleSection.appendChild(linkButton);

    var breakButton = makeButton('\u21b5', function(target) {
      insertLineBreak(target || getEditableFromSelection());
    });
    breakButton.title = 'Insert line break';
    breakButton.setAttribute('aria-label', 'Insert line break');
    styleSection.appendChild(breakButton);

    var boxButton = makeButton('Box', function(target) {
      enableBoxResize(target || getEditableFromSelection());
    });
    boxButton.title = 'Enable resizing on selected text box';
    boxButton.setAttribute('aria-label', 'Enable resizing on selected text box');
    styleSection.appendChild(boxButton);

    styleSection.appendChild(makeButton('Clear', function(target) {
      clearFormatting(target || getEditableFromSelection());
    }));

    var colorWrap = document.createElement('div');
    colorWrap.className = 'color-wrap';
    colorWrap.appendChild(makeButton('Colors', toggleColorPanel, 'color-toggle'));
    colorWrap.querySelector('.color-toggle').id = 'live-text-color-toggle';
    var colorGroup = makeSection('');
    colorGroup.className = 'color-group';
    colorGroup.id = 'live-text-color-group';

    getColorPalette().forEach(function(color) {
      var swatch = makeButton('', function(target) {
        applyColorToElement(target || getEditableFromSelection(), color.value);
      });
      swatch.className = 'color-swatch';
      swatch.title = color.name;
      swatch.setAttribute('aria-label', color.name);
      swatch.style.setProperty('--swatch', color.value);
      colorGroup.appendChild(swatch);
    });

    var clearColor = makeButton('x', function(target) {
      applyColorToElement(target || getEditableFromSelection(), '');
    });
    clearColor.className = 'color-reset';
    clearColor.title = 'Default color';
    clearColor.setAttribute('aria-label', 'Default color');
    colorGroup.appendChild(clearColor);

    var actionSection = makeSection('');
    var exportButton = makeButton('Export', toggleExport);
    var coverageButton = makeButton('Coverage', toggleCoverage);
    var reviewButton = makeButton('Review', toggleReview);
    var historyButton = makeButton('History', toggleHistory);
    historyButton.id = 'live-text-history-button';
    historyButton.hidden = true;
    var applyButton = makeButton('Apply Changes', applyToSource);
    applyButton.id = 'live-text-apply-source';
    applyButton.hidden = true;
    var undoButton = makeButton('Undo Apply', undoLastApply);
    undoButton.id = 'live-text-undo-source';
    undoButton.hidden = !lastUndoToken;
    var reset = makeButton('Reset', function() {
      if (!window.confirm('Clear saved copy edits for this page?')) return;
      window.localStorage.removeItem(pageKey());
      window.location.reload();
    });
    actionSection.appendChild(coverageButton);
    actionSection.appendChild(reviewButton);
    actionSection.appendChild(historyButton);
    actionSection.appendChild(applyButton);
    actionSection.appendChild(undoButton);
    actionSection.appendChild(exportButton);
    actionSection.appendChild(reset);

    var status = document.createElement('span');
    status.id = 'live-text-editor-status';
    status.textContent = 'off';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    actionSection.appendChild(status);

    colorWrap.appendChild(colorGroup);

    var stylePanel = document.createElement('div');
    stylePanel.id = 'live-text-style-panel';
    stylePanel.setAttribute('data-live-edit-ignore', 'true');
    stylePanel.appendChild(styleSection);
    stylePanel.appendChild(colorWrap);

    toolbar.appendChild(editSection);
    toolbar.appendChild(actionSection);
    document.body.appendChild(toolbar);
    document.body.appendChild(stylePanel);
    if (typeof ResizeObserver === 'function') {
      toolbarResizeObserver = new ResizeObserver(syncFloatingPanelInset);
      toolbarResizeObserver.observe(toolbar);
    }
    window.requestAnimationFrame(syncFloatingPanelInset);
    updateSourceButton();
  }

  function savedEntries() {
    var saved = getSavedCopy();
    var currentElements = {};
    editableElements.forEach(function(element) {
      var id = element.getAttribute('data-live-edit-id');
      if (id) currentElements[id] = element;
    });
    return Object.keys(saved).map(function(id) {
      var element = currentElements[id];
      var record = normalizeRecord(saved[id]);
      var target = element ? targetForElement(element) : record.target || { kind:'preview', label:'Element is not present in this view', applyable:false };
      var sourcePath = sourcePathForTarget(target);
      return {
        id: id,
        element: element,
        record: record,
        target: target,
        sourcePath: sourcePath,
        expectedHash: record.expectedHash || sourceHashes[sourcePath] || ''
      };
    }).filter(function(entry) {
      if (editableElements.length && !entry.element) return false;
      return entry.record.html || entry.record.text || hasMeaningfulStyles(entry.record.styles);
    });
  }

  function escapeText(value) {
    return String(value || '').replace(/[&<>"']/g, function(char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function escapeAttribute(value) {
    return escapeText(value).replace(/`/g, '&#96;');
  }

  function renderCoverageBody() {
    if (!coverageDrawer) return;
    var summary = coverageSummary();
    var semanticPriority = { h1:0, h2:1, h3:2, h4:3, p:4, figcaption:5, blockquote:6, a:7, button:8, li:9 };
    var unsupported = editableElements.map(function(element) {
      return {
        id: element.getAttribute('data-live-edit-id') || '',
        tag: element.tagName.toLowerCase(),
        text: (element.textContent || '').trim().replace(/\s+/g, ' '),
        target: targetForElement(element)
      };
    }).filter(function(entry) { return !entry.target.applyable; }).sort(function(a, b) {
      if (a.target.kind === 'managed' && b.target.kind !== 'managed') return -1;
      if (b.target.kind === 'managed' && a.target.kind !== 'managed') return 1;
      var aPriority = Object.prototype.hasOwnProperty.call(semanticPriority, a.tag) ? semanticPriority[a.tag] : 20;
      var bPriority = Object.prototype.hasOwnProperty.call(semanticPriority, b.tag) ? semanticPriority[b.tag] : 20;
      return aPriority - bPriority;
    });
    var shown = unsupported.slice(0, 40);
    var ownerLinks = [];
    var seenOwnerHrefs = {};
    unsupported.forEach(function(entry) {
      var href = entry.target.ownerHref || '';
      if (!href || seenOwnerHrefs[href]) return;
      seenOwnerHrefs[href] = true;
      ownerLinks.push({ href:href, label:entry.target.ownerLabel || 'Open owner' });
    });
    var body = coverageDrawer.querySelector('.coverage-body');
    body.innerHTML = [
      '<p class="coverage-summary"><strong>' + summary.saveable + ' of ' + summary.total + '</strong> text targets are saveable on this view. ' + summary.html + ' belong to this page, ' + summary.source + ' belong to shared source, ' + summary.managed + ' are managed elsewhere, and ' + summary.preview + ' are preview-only.</p>',
      unsupported.length ? '<p class="coverage-summary">Unsupported targets stay navigable and cannot be edited accidentally. Showing ' + shown.length + ' of ' + unsupported.length + '.</p>' : '<p class="coverage-summary">Every detected text target has a verified source owner.</p>',
      ownerLinks.length ? '<div class="coverage-owner-actions"><span>Managed owners</span>' + ownerLinks.map(function(ownerLink) { return '<a class="coverage-owner-link" href="' + escapeAttribute(ownerLink.href) + '" target="_blank" rel="noopener">' + escapeText(ownerLink.label) + ' →</a>'; }).join('') + '</div>' : '',
      shown.map(function(entry) {
        return [
          '<article class="coverage-item">',
          '<div class="coverage-kind">' + escapeText(entry.target.kind === 'managed' ? 'Managed elsewhere' : 'Preview only') + ' · ' + escapeText(entry.tag) + '</div>',
          '<div class="coverage-id">' + escapeText(entry.id) + '</div>',
          '<p class="coverage-copy">' + escapeText(entry.text.slice(0, 240)) + '</p>',
          '</article>'
        ].join('');
      }).join('')
    ].join('');
  }

  function toggleCoverage() {
    if (coverageDrawer) {
      coverageDrawer.remove();
      coverageDrawer = null;
      return;
    }
    if (reviewDrawer) {
      reviewDrawer.remove();
      reviewDrawer = null;
    }
    if (historyDrawer) {
      historyDrawer.remove();
      historyDrawer = null;
    }
    coverageDrawer = document.createElement('section');
    coverageDrawer.id = 'live-text-coverage';
    coverageDrawer.setAttribute('data-live-edit-ignore', 'true');
    coverageDrawer.innerHTML = '<header><h2>Source Coverage</h2></header><div class="coverage-body"></div>';
    coverageDrawer.querySelector('header').appendChild(makeButton('Close', toggleCoverage));
    document.body.appendChild(coverageDrawer);
    renderCoverageBody();
  }

  function historyActionLabel(revision) {
    if (revision.action === 'undo') return 'Immediate undo';
    if (revision.action === 'restore') return revision.restoreMode === 'before' ? 'Prior version restored' : 'Saved version restored';
    return 'Source apply';
  }

  function historyTimestamp(value) {
    var date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString();
  }

  function historyTargetLabel(target) {
    return target.kind === 'html' ? target.copyId : target.marker;
  }

  function historyStateText(state) {
    if (!state) return '';
    var value = Object.prototype.hasOwnProperty.call(state, 'html') ? state.html : state.text;
    var styles = state.styles && Object.keys(state.styles).length ? '\nstyles: ' + JSON.stringify(state.styles) : '';
    return String(value || '').slice(0, 4000) + styles;
  }

  function renderHistoryList(revisions) {
    if (!historyDrawer) return;
    var body = historyDrawer.querySelector('.history-body');
    if (!revisions.length) {
      body.innerHTML = '<p class="history-empty">No source revisions have been saved from this page yet. The first apply will protect its starting source as the original baseline.</p>';
      return;
    }
    body.innerHTML = '<p class="history-summary">Immutable local history for this page. Restoring changes only the recorded copy targets, preserves unrelated source edits, and creates a new revision.</p>' + revisions.map(function(revision) {
      var fileLabels = (revision.files || []).map(function(file) { return (file.pathSegments || []).join('/'); }).join(' · ');
      var targetCount = (revision.files || []).reduce(function(count, file) { return count + (file.targets || []).length; }, 0);
      return [
        '<article class="history-item" data-history-revision="' + escapeAttribute(revision.id) + '">',
        '<div class="history-item-head"><div><h3>Revision ' + escapeText(revision.revisionNumber) + '</h3><span class="history-kind">' + escapeText(historyActionLabel(revision)) + '</span></div><span class="history-kind">' + escapeText(historyTimestamp(revision.createdAt)) + '</span></div>',
        revision.isOriginalBaseline ? '<span class="history-baseline">Protected original captured</span>' : '',
        '<p class="history-meta">' + escapeText(targetCount + ' target' + (targetCount === 1 ? '' : 's') + ' · ' + fileLabels) + '</p>',
        revision.relatedRevisionId ? '<p class="history-meta">Based on ' + escapeText(revision.relatedRevisionId) + '</p>' : '',
        '<div class="history-item-actions">',
        '<button type="button" data-history-details="' + escapeAttribute(revision.id) + '">View details</button>',
        '<button type="button" data-history-restore="after" data-history-id="' + escapeAttribute(revision.id) + '">Restore saved version</button>',
        '<button type="button" data-history-restore="before" data-history-id="' + escapeAttribute(revision.id) + '">' + escapeText(revision.isOriginalBaseline ? 'Restore protected original' : 'Restore prior version') + '</button>',
        '</div>',
        '<div class="history-detail" data-history-detail-body hidden></div>',
        '</article>'
      ].join('');
    }).join('');
  }

  function loadHistory() {
    if (!historyDrawer) return;
    var body = historyDrawer.querySelector('.history-body');
    body.innerHTML = '<p class="history-empty">Loading revision history…</p>';
    callToolApi('/__tools/live-editor/history', { pathname:window.location.pathname }).then(function(result) {
      renderHistoryList(result.revisions || []);
    }).catch(function(error) {
      if (historyDrawer) body.innerHTML = '<p class="history-empty">' + escapeText(error.message || 'Revision history could not be loaded.') + '</p>';
    });
  }

  function loadHistoryDetail(revisionId, button) {
    var item = button.closest('[data-history-revision]');
    var detail = item && item.querySelector('[data-history-detail-body]');
    if (!detail) return;
    if (!detail.hidden) {
      detail.hidden = true;
      button.textContent = 'View details';
      return;
    }
    if (detail.getAttribute('data-loaded') === 'true') {
      detail.hidden = false;
      button.textContent = 'Hide details';
      return;
    }
    button.disabled = true;
    detail.hidden = false;
    detail.innerHTML = '<p class="history-meta">Loading exact before and after values…</p>';
    callToolApi('/__tools/live-editor/history/detail', { pathname:window.location.pathname, revisionId:revisionId }).then(function(result) {
      var revision = result.revision || {};
      detail.innerHTML = (revision.files || []).map(function(file) {
        return [
          '<section class="history-file">',
          '<strong>' + escapeText((file.pathSegments || []).join('/')) + '</strong>',
          (file.edits || []).map(function(edit) {
            return '<div class="history-change"><strong>' + escapeText(edit.kind + ' · ' + historyTargetLabel(edit)) + '</strong><pre>before: ' + escapeText(historyStateText(edit.before)) + '\n\nafter: ' + escapeText(historyStateText(edit.after)) + '</pre></div>';
          }).join(''),
          '</section>'
        ].join('');
      }).join('') || '<p class="history-meta">This revision contains only a file-level recovery snapshot.</p>';
      detail.setAttribute('data-loaded', 'true');
      button.textContent = 'Hide details';
    }).catch(function(error) {
      detail.innerHTML = '<p class="history-meta">' + escapeText(error.message || 'Revision details could not be loaded.') + '</p>';
    }).finally(function() {
      button.disabled = false;
    });
  }

  function restoreHistoryRevision(revisionId, mode, button) {
    if (savedEntries().length) {
      updateStatus('Review, apply, or reset browser drafts before restoring history');
      return;
    }
    var versionLabel = mode === 'before' ? 'the version before this revision' : 'this saved version';
    if (!window.confirm('Restore ' + versionLabel + '? This updates only its recorded copy targets and creates a new revision.')) return;
    button.disabled = true;
    updateStatus('Restoring source targets…');
    callToolApi('/__tools/live-editor/history/restore', {
      pathname:window.location.pathname,
      revisionId:revisionId,
      mode:mode
    }).then(function(result) {
      (result.files || []).forEach(function(file) {
        sourceHashes[(file.pathSegments || []).join('/')] = file.hash || '';
      });
      rememberUndoToken(result.undoToken || '');
      updateStatus('Restored as Revision ' + result.revisionNumber + ' · undo available');
      window.setTimeout(function() { window.location.reload(); }, 650);
    }).catch(function(error) {
      button.disabled = false;
      updateStatus(error.message || 'Revision restore failed');
    });
  }

  function toggleHistory() {
    if (historyDrawer) {
      historyDrawer.remove();
      historyDrawer = null;
      return;
    }
    if (reviewDrawer) {
      reviewDrawer.remove();
      reviewDrawer = null;
    }
    if (coverageDrawer) {
      coverageDrawer.remove();
      coverageDrawer = null;
    }
    closeExportIfOpen();
    historyDrawer = document.createElement('section');
    historyDrawer.id = 'live-text-history';
    historyDrawer.setAttribute('data-live-edit-ignore', 'true');
    historyDrawer.innerHTML = '<header><h2>Revision History</h2><div class="history-actions"></div></header><div class="history-body"></div>';
    var actions = historyDrawer.querySelector('.history-actions');
    actions.appendChild(makeButton('Refresh', loadHistory));
    actions.appendChild(makeButton('Close', toggleHistory));
    historyDrawer.addEventListener('click', function(event) {
      var detailButton = event.target.closest('[data-history-details]');
      if (detailButton) {
        loadHistoryDetail(detailButton.getAttribute('data-history-details'), detailButton);
        return;
      }
      var restoreButton = event.target.closest('[data-history-restore]');
      if (restoreButton) restoreHistoryRevision(restoreButton.getAttribute('data-history-id'), restoreButton.getAttribute('data-history-restore'), restoreButton);
    });
    document.body.appendChild(historyDrawer);
    loadHistory();
  }

  function renderReviewBody() {
    if (!reviewDrawer) return;
    var body = reviewDrawer.querySelector('.review-body');
    var entries = savedEntries();
    if (!entries.length) {
      body.innerHTML = '<p>No saved edits for this page.</p>';
      return;
    }

    var applyableCount = entries.filter(function(entry) { return entry.target.applyable; }).length;
    body.innerHTML = '<p class="review-path">' + applyableCount + ' of ' + entries.length + ' changes have verified source targets. Managed and preview-only copy will not be written.</p>' + entries.map(function(entry) {
      var targetLabel = entry.target.kind === 'html'
        ? (entry.sourcePath || 'page HTML') + ' · ' + entry.target.copyId
        : entry.target.kind === 'source-marker'
          ? entry.sourcePath + ' · ' + entry.target.marker
          : entry.target.label;
      var original = originalRecords[entry.id];
      return [
        '<article class="review-item">',
        '<label class="review-select"><input type="checkbox" data-live-edit-apply-id="' + escapeAttribute(entry.id) + '"' + (entry.target.applyable ? ' checked' : ' disabled') + '> ' + escapeText(entry.target.applyable ? 'Apply this change' : 'Not directly applyable') + '</label>',
        '<div class="review-id">' + escapeText(entry.id) + '</div>',
        '<div class="review-target' + (entry.target.applyable ? '' : ' is-preview') + '">' + escapeText(targetLabel) + '</div>',
        original ? '<pre>old: ' + escapeText(original.target && original.target.kind !== 'html' ? original.text : original.html) + '</pre>' : '',
        '<pre>new: ' + escapeText(entry.record.html || entry.record.text) + '</pre>',
        entry.target.kind === 'html' && hasMeaningfulStyles(entry.record.styles) ? '<pre>styles: ' + escapeText(JSON.stringify(entry.record.styles)) + '</pre>' : '',
        '</article>'
      ].join('');
    }).join('');
  }

  function toggleReview() {
    if (reviewDrawer) {
      reviewDrawer.remove();
      reviewDrawer = null;
      return;
    }

    if (coverageDrawer) {
      coverageDrawer.remove();
      coverageDrawer = null;
    }
    if (historyDrawer) {
      historyDrawer.remove();
      historyDrawer = null;
    }

    reviewDrawer = document.createElement('section');
    reviewDrawer.id = 'live-text-review';
    reviewDrawer.setAttribute('data-live-edit-ignore', 'true');
    reviewDrawer.innerHTML = [
      '<header>',
      '<h2>Review Changes</h2>',
      '<div class="review-actions"></div>',
      '</header>',
      '<div class="review-body"></div>'
    ].join('');

    var actions = reviewDrawer.querySelector('.review-actions');
    actions.appendChild(makeButton('Apply Selected', applyToSource));
    var undo = makeButton('Undo Last Apply', undoLastApply);
    undo.hidden = !lastUndoToken;
    actions.appendChild(undo);
    actions.appendChild(makeButton('Close', toggleReview));
    document.body.appendChild(reviewDrawer);
    renderReviewBody();
  }

  function toggleExport() {
    var existing = document.getElementById('live-text-export');
    if (existing) {
      closeExportIfOpen();
      return;
    }
    if (reviewDrawer) {
      reviewDrawer.remove();
      reviewDrawer = null;
    }
    if (coverageDrawer) {
      coverageDrawer.remove();
      coverageDrawer = null;
    }
    if (historyDrawer) {
      historyDrawer.remove();
      historyDrawer = null;
    }

    var textarea = document.createElement('textarea');
    textarea.id = 'live-text-export';
    textarea.setAttribute('aria-label', 'Export or import live text JSON');
    textarea.value = JSON.stringify(getSavedCopy(), null, 2);
    document.body.appendChild(textarea);

    var importButton = makeButton('Import', function() {
      try {
        var next = JSON.parse(textarea.value || '{}');
        setSavedCopy(next);
        updateStatus('imported');
        window.location.reload();
      } catch (error) {
        updateStatus('bad json');
      }
    });
    importButton.id = 'live-text-import-button';
    importButton.style.position = 'fixed';
    importButton.style.right = '28px';
    importButton.style.bottom = 'calc(var(--live-text-panel-bottom,118px) + 10px)';
    importButton.style.zIndex = '2147483647';
    importButton.setAttribute('data-live-edit-ignore', 'true');
    document.body.appendChild(importButton);
    textarea.focus();
    textarea.select();
  }

  function closeExportIfOpen() {
    var textarea = document.getElementById('live-text-export');
    var importButton = document.getElementById('live-text-import-button');
    if (textarea) textarea.remove();
    if (importButton) importButton.remove();
  }

  function applyToSource() {
    if (!isSourceApplyContext()) {
      updateStatus('Applying changes is available on localhost only');
      return;
    }

    if (!helperAvailable) {
      updateStatus('No verified source target is available for this route');
      detectHelper();
      return;
    }

    var entries = savedEntries();
    if (!entries.length) {
      updateStatus('No saved edits');
      return;
    }
    var selectedIds = null;
    if (reviewDrawer) {
      selectedIds = {};
      Array.prototype.slice.call(reviewDrawer.querySelectorAll('[data-live-edit-apply-id]:checked')).forEach(function(input) {
        selectedIds[input.getAttribute('data-live-edit-apply-id')] = true;
      });
    }
    var sourceEntries = entries.filter(function(entry) {
      return entry.target.applyable && (!selectedIds || selectedIds[entry.id]);
    });
    if (!sourceEntries.length) {
      updateStatus('No applyable changes are selected');
      return;
    }

    updateStatus('Verifying source revisions…');
    Promise.all(sourceEntries.map(function(entry) {
      if (entry.expectedHash) return Promise.resolve(entry.expectedHash);
      return ensureSourceHash(entry.target).then(function(hash) {
        entry.expectedHash = hash;
        return hash;
      });
    })).then(function(hashes) {
      if (hashes.some(function(hash) { return !hash; })) throw new Error('A selected source could not be verified. Reload and try again.');
      var edits = sourceEntries.map(function(entry) {
        var base = {
          kind: entry.target.kind,
          pathSegments: entry.sourcePath.split('/'),
          expectedHash: entry.expectedHash
        };
        if (entry.target.kind === 'html') {
          base.copyId = entry.target.copyId;
          base.html = sanitizeHtml(entry.record.html || '');
          base.styles = entry.record.styles || {};
        } else {
          base.marker = entry.target.marker;
          base.text = entry.record.text || '';
        }
        return base;
      });
      return callToolApi('/__tools/live-editor/apply', { pathname:window.location.pathname, edits:edits });
    }).then(function(result) {
      (result.files || []).forEach(function(file) {
        sourceHashes[(file.pathSegments || []).join('/')] = file.hash || '';
      });
      rememberUndoToken(result.undoToken || '');
      var saved = getSavedCopy();
      sourceEntries.forEach(function(entry) {
        delete saved[entry.id];
        if (entry.element) {
          originalRecords[entry.id] = {
            html: entry.element.innerHTML,
            text: entry.element.textContent || '',
            styles: readElementStyles(entry.element),
            target: targetForElement(entry.element)
          };
        }
      });
      setSavedCopy(saved);
      updateStatus('Applied ' + result.applied + ' change' + (result.applied === 1 ? '' : 's') + ' as Revision ' + result.revisionNumber + ' · undo available');
      if (reviewDrawer) renderReviewBody();
      if (historyDrawer) loadHistory();
      })
      .catch(function(error) {
        updateStatus(error.message || 'Apply failed');
      });
  }

  function undoLastApply() {
    if (!lastUndoToken) {
      updateStatus('Nothing is available to undo');
      return;
    }
    callToolApi('/__tools/live-editor/undo', { undoToken: lastUndoToken }).then(function(result) {
      (result.restored || []).forEach(function(file) {
        sourceHashes[(file.pathSegments || []).join('/')] = file.hash || '';
      });
      rememberUndoToken('');
      updateStatus('Undo saved as Revision ' + result.revisionNumber);
      window.setTimeout(function() { window.location.reload(); }, 450);
    }).catch(function(error) {
      if (/not found/i.test(error.message || '')) rememberUndoToken('');
      updateStatus(error.message || 'Undo failed');
    });
  }

  function setEnabled(next) {
    hydrateSavedText();
    isEnabled = Boolean(next);
    document.body.classList.toggle('live-text-editing', isEnabled);
    window.localStorage.setItem(ENABLED_KEY, isEnabled ? '1' : '0');

    editableElements.forEach(function(element) {
      syncElementEditingState(element);
    });

    if (isEnabled) {
      watchEditableResizes();
    } else {
      stopWatchingEditableResizes();
    }

    var toggle = document.getElementById('live-text-editor-toggle');
    if (toggle) toggle.classList.toggle('is-active', isEnabled);
    updateStatus(defaultStatusText());
  }

  function refreshEditableElements() {
    if (!isHydrated) return;
    var saved = getSavedCopy();
    var nextElements = collectEditableElements();
    nextElements.forEach(function(element) {
      var id = element.getAttribute('data-live-edit-id');
      var target = targetForElement(element);
      if (!originalRecords[id]) {
        originalRecords[id] = { html:element.innerHTML, text:element.textContent || '', styles:readElementStyles(element), target:target };
      }
      if (saved[id]) {
        var record = normalizeRecord(saved[id]);
        if (target.kind === 'html' && record.html && element.innerHTML !== record.html) element.innerHTML = record.html;
        else if (target.kind !== 'html' && record.text && element.textContent !== record.text) element.textContent = record.text;
        if (target.kind === 'html') applyElementStyles(element, record.styles);
      }
      syncElementEditingState(element);
    });
    editableElements.forEach(function(element) {
      if (nextElements.indexOf(element) !== -1 || !element.isConnected) return;
      element.contentEditable = 'false';
      element.removeAttribute('data-live-edit-id');
      element.removeAttribute('data-live-edit-target');
      element.removeAttribute('data-live-edit-applyable');
    });
    editableElements = nextElements;
    if (isEnabled) watchEditableResizes();
    if (reviewDrawer) renderReviewBody();
    if (coverageDrawer) renderCoverageBody();
    var status = document.getElementById('live-text-editor-status');
    if (status && (!updateStatus._timer || status.textContent === 'editing')) status.textContent = defaultStatusText();
  }

  function scheduleEditableRefresh() {
    window.clearTimeout(contentSyncTimer);
    contentSyncTimer = window.setTimeout(refreshEditableElements, 40);
  }

  function watchDynamicContent() {
    if (contentObserver) contentObserver.disconnect();
    contentObserver = new MutationObserver(function(mutations) {
      var relevant = mutations.some(function(mutation) {
        return !isEditorNode(mutation.target);
      });
      if (relevant) scheduleEditableRefresh();
    });
    contentObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-copy-id', 'data-live-edit-owner', 'data-live-edit-source', 'data-live-edit-marker', 'data-live-edit-label', 'data-live-edit-owner-href', 'data-live-edit-owner-label']
    });
  }

  document.addEventListener('input', function(event) {
    if (!isEnabled) return;
    var element = event.target.closest && event.target.closest('[data-live-edit-id]');
    if (!element || !targetForElement(element).applyable) return;
    activeElement = element;
    saveElement(element);
  });

  document.addEventListener('paste', function(event) {
    if (!isEnabled) return;
    var element = event.target.closest && event.target.closest('[data-live-edit-id]');
    var target = element && targetForElement(element);
    if (!element || !target.applyable || target.kind === 'html') return;
    event.preventDefault();
    var text = (event.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  document.addEventListener('focusin', function(event) {
    var element = event.target.closest && event.target.closest('[data-live-edit-id]');
    if (element && targetForElement(element).applyable) activeElement = element;
  });

  document.addEventListener('selectionchange', function() {
    if (!isEnabled) return;
    var element = getEditableFromSelection();
    if (element && targetForElement(element).applyable) activeElement = element;
  });

  document.addEventListener('click', function(event) {
    if (!isEnabled) return;
    var link = event.target.closest && event.target.closest('a');
    if (!link || isEditorNode(link)) return;
    var editableLink = link.closest('[data-live-edit-id]');
    if (!editableLink || !targetForElement(editableLink).applyable) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('keydown', function(event) {
    var modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.shiftKey && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      makeToolbar();
      setEnabled(!isEnabled);
    }

    if (isEnabled && event.key === 'Escape') {
      setEnabled(false);
    }
  });

  window.addEventListener('sixwell:booking-rendered', refreshEditableElements);
  window.addEventListener('resize', syncFloatingPanelInset);
  window.addEventListener('popstate', function() { window.location.reload(); });

  function init() {
    injectStyles();
    makeToolbar();
    hydrateSavedText();
    watchDynamicContent();
    detectHelper();
    if (shouldAutoEnable()) setEnabled(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
