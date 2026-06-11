/* ============================================================
   live-text-editor.js — local prototype copy editor
   ============================================================
   Enables canvas-like text edits on the live static site.

   Open any page with ?edit=1 or press Cmd/Ctrl+Shift+E.
   Changes are stored in localStorage by page path + element id.
   ============================================================ */

(function() {
  var host = window.location.hostname;
  var isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (!isLocalHost) return;

  var STORAGE_PREFIX = 'sixwell:liveText:';
  var ENABLED_KEY = STORAGE_PREFIX + 'enabled';
  var EDITOR_ID = 'live-text-editor';
  var BASE_COLOR_PALETTE = [
    { name: 'Default body', value: '#FFE7CA' },
    { name: 'Global amber', value: '#FCB867' },
    { name: 'Tattooing', value: '#7A1010' },
    { name: 'Art making', value: '#0581C1' },
    { name: 'Merch', value: '#F7A226' },
    { name: 'Events', value: '#55BA5A' },
    { name: 'Music', value: '#A856A1' },
    { name: 'Writings', value: '#328C84' },
    { name: 'Archive', value: '#EC5E26' },
    { name: 'Site black', value: '#0e0e0e' },
    { name: 'Dark brown', value: '#3a2418' },
    { name: 'Construct brown', value: '#6D3D15' },
    { name: 'Sold red', value: '#C0392B' },
    { name: 'Muted cream', value: 'rgba(255,231,202,0.62)' },
    { name: 'Faint amber', value: 'rgba(252,184,103,0.64)' },
    { name: 'Amber wash', value: 'rgba(252,184,103,0.25)' },
    { name: 'Tattoo wash', value: 'rgba(122,16,16,0.25)' },
    { name: 'Art wash', value: 'rgba(5,129,193,0.25)' },
    { name: 'Merch wash', value: 'rgba(247,162,38,0.25)' },
    { name: 'Events wash', value: 'rgba(85,186,90,0.25)' },
    { name: 'Music wash', value: 'rgba(168,86,161,0.25)' },
    { name: 'Writings wash', value: 'rgba(50,140,132,0.25)' },
    { name: 'Archive wash', value: 'rgba(236,94,38,0.25)' },
    { name: 'Film wash', value: 'rgba(255,231,202,0.25)' }
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
  var originalRecords = {};
  var controlSelectionRange = null;

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
    return STORAGE_PREFIX + window.location.pathname;
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

  function pageFilePath() {
    var path = window.location.pathname || '/';
    if (path === '/') return ['index.html'];
    var trimmed = path.replace(/^\/+|\/+$/g, '');
    if (!trimmed) return ['index.html'];
    var segments = trimmed.split('/');
    if (segments[segments.length - 1].indexOf('.') !== -1) return segments;
    segments.push('index.html');
    return segments;
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
    return callToolApi('/__tools/read-file', { pathSegments: pageFilePath() })
      .then(function() {
        helperAvailable = true;
        updateSourceButton();
        return true;
      })
      .catch(function() {
        helperAvailable = false;
        updateSourceButton();
        return false;
      });
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
    element.style.opacity = styles.opacity || '';
    element.style.textTransform = styles.textTransform || '';
    element.style.textAlign = styles.textAlign || '';
  }

  function hasMeaningfulStyles(styles) {
    return Boolean(styles && (styles.color || styles.fontFamily || styles.fontSize || styles.opacity || styles.textTransform || styles.textAlign));
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
      updatedAt: record.updatedAt || ''
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
      if (!element.textContent || !element.textContent.trim()) return;
      if (!hasStableCopyId && !hasDirectText(element)) return;
      if (hasEditableParent(element)) return;

      element.setAttribute('data-live-edit-id', buildElementId(element, collected.length));
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
      if (!originalRecords[id]) {
        originalRecords[id] = {
          html: element.innerHTML,
          styles: readElementStyles(element)
        };
      }
      if (saved[id]) {
        var record = normalizeRecord(saved[id]);
        if (record.html) element.innerHTML = record.html;
        applyElementStyles(element, record.styles);
      }
    });

    var stale = {};
    Object.keys(saved).forEach(function(id) {
      if (currentIds[id]) return;
      stale[id] = saved[id];
      delete saved[id];
      migrated = true;
    });

    if (Object.keys(stale).length) {
      window.localStorage.setItem(pageKey() + ':stale-backup', JSON.stringify(stale));
    }

    if (migrated) setSavedCopy(saved);

    isHydrated = true;
  }

  function saveElement(element) {
    var id = element.getAttribute('data-live-edit-id');
    if (!id) return;

    var saved = getSavedCopy();
    var styles = readElementStyles(element);
    saved[id] = {
      text: element.textContent.trim(),
      html: element.innerHTML,
      color: styles.color || '',
      styles: styles,
      updatedAt: new Date().toISOString()
    };
    setSavedCopy(saved);
    updateStatus('saved');
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

  function applyInlineTag(element, tagName, label) {
    if (!element) {
      updateStatus('select text');
      return;
    }

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
    var allowed = ['color', 'font-family', 'font-size', 'opacity', 'text-transform', 'text-align'];
    var output = [];
    String(sourceStyle || '').split(';').forEach(function(part) {
      var index = part.indexOf(':');
      if (index === -1) return;
      var name = part.slice(0, index).trim().toLowerCase();
      var value = part.slice(index + 1).trim();
      if (!value || allowed.indexOf(name) === -1) return;
      if (/url\s*\(|expression\s*\(/i.test(value)) return;
      if (name === 'font-size' && !/^(0|[1-9]\d{0,2})(\.\d{1,2})?(px|rem|em|%)$/i.test(value)) return;
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
      'body.live-text-editing [data-live-edit-id]{outline:1px dashed rgba(252,184,103,.42);outline-offset:3px;cursor:text;}',
      'body.live-text-editing [data-live-edit-id]:hover,body.live-text-editing [data-live-edit-id]:focus{outline-color:#FCB867;background:rgba(252,184,103,.08);}',
      'body.live-text-editing [data-live-edit-id]:focus{box-shadow:0 0 0 4px rgba(252,184,103,.12);}',
      '#live-text-editor{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:8px;width:auto;max-width:calc(100vw - 36px);padding:8px;border:1px solid rgba(252,184,103,.32);background:rgba(14,14,14,.94);backdrop-filter:blur(16px);color:#FFE7CA;font-family:Inter,Helvetica Neue,Arial,sans-serif;font-size:11px;line-height:1;box-shadow:0 14px 34px rgba(0,0,0,.36);}',
      '#live-text-editor .tool-section,#live-text-style-panel .tool-section{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;}',
      '#live-text-editor .tool-label,#live-text-style-panel .tool-label{color:rgba(255,231,202,.48);font-family:Georgia,Times New Roman,serif;text-transform:lowercase;}',
      '#live-text-editor button,#live-text-style-panel button{min-height:30px;border:1px solid rgba(252,184,103,.26);background:transparent;color:inherit;padding:0 10px;font:inherit;font-weight:700;text-transform:uppercase;letter-spacing:0;cursor:pointer;}',
      '#live-text-style-panel select{min-height:30px;max-width:148px;border:1px solid rgba(252,184,103,.26);background:#0e0e0e;color:#FFE7CA;padding:0 8px;font:inherit;}',
      '#live-text-style-panel .font-picker{position:relative;display:grid;gap:6px;min-width:158px;}',
      '#live-text-style-panel .font-picker-toggle{width:100%;text-align:left;text-transform:none;font-size:13px;}',
      '#live-text-style-panel .font-picker-menu{display:none;grid-template-columns:1fr;gap:4px;min-width:190px;max-height:190px;overflow:auto;padding:6px;border:1px solid rgba(252,184,103,.26);background:#0e0e0e;}',
      '#live-text-style-panel .font-picker.is-open .font-picker-menu{display:grid;}',
      '#live-text-style-panel .font-choice{width:100%;justify-content:flex-start;text-align:left;text-transform:none;font-size:15px;line-height:1.1;}',
      '#live-text-editor button:hover,#live-text-editor button:focus-visible,#live-text-style-panel button:hover,#live-text-style-panel button:focus-visible{border-color:#FCB867;color:#FCB867;outline:none;}',
      '#live-text-editor .is-active{background:#FCB867;color:#0e0e0e;border-color:#FCB867;}',
      '#live-text-style-panel{position:fixed;left:50%;bottom:68px;transform:translateX(-50%);z-index:2147483647;display:none;grid-template-columns:auto minmax(0,1fr);gap:10px;width:min(760px,calc(100vw - 36px));max-height:min(260px,calc(100vh - 118px));overflow:auto;padding:10px;border:1px solid rgba(252,184,103,.32);background:rgba(14,14,14,.96);backdrop-filter:blur(16px);color:#FFE7CA;font-family:Inter,Helvetica Neue,Arial,sans-serif;font-size:11px;line-height:1;box-shadow:0 18px 44px rgba(0,0,0,.44);}',
      '#live-text-style-panel.is-open{display:grid;}',
      '#live-text-style-panel .style-controls{align-content:start;}',
      '#live-text-style-panel .color-wrap{display:grid;gap:8px;align-content:start;min-width:0;}',
      '#live-text-style-panel .color-group{display:none;align-items:center;flex-wrap:wrap;gap:6px;max-height:116px;overflow:auto;padding:0 2px 0 10px;border-left:1px solid rgba(252,184,103,.22);}',
      '#live-text-style-panel .color-group.is-open{display:flex;}',
      '#live-text-style-panel .color-swatch{width:24px;min-height:24px;padding:0;border-radius:50%;border-color:rgba(255,231,202,.28);background:var(--swatch,transparent);color:transparent;overflow:hidden;flex:0 0 auto;}',
      '#live-text-style-panel .color-swatch:hover,#live-text-style-panel .color-swatch:focus-visible{border-color:#FFE7CA;box-shadow:0 0 0 3px rgba(252,184,103,.12);color:transparent;}',
      '#live-text-style-panel .color-reset{width:24px;min-height:24px;padding:0;border-radius:50%;color:rgba(255,231,202,.62);font-size:16px;line-height:1;}',
      '#live-text-editor-status{min-width:52px;color:rgba(255,231,202,.62);font-family:Georgia,Times New Roman,serif;text-transform:lowercase;}',
      '#live-text-export{position:fixed;right:18px;bottom:86px;z-index:2147483647;width:min(560px,calc(100vw - 36px));min-height:220px;padding:12px;border:1px solid rgba(252,184,103,.32);background:#0e0e0e;color:#FFE7CA;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;}',
      '#live-text-review{position:fixed;right:18px;bottom:86px;z-index:2147483647;width:min(720px,calc(100vw - 36px));max-height:min(680px,calc(100vh - 120px));overflow:auto;border:1px solid rgba(252,184,103,.32);background:#0e0e0e;color:#FFE7CA;box-shadow:0 18px 48px rgba(0,0,0,.48);font-family:Inter,Helvetica Neue,Arial,sans-serif;}',
      '#live-text-review header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-bottom:1px solid rgba(252,184,103,.22);}',
      '#live-text-review h2{margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#FCB867;}',
      '#live-text-review .review-actions{display:flex;gap:6px;flex-wrap:wrap;}',
      '#live-text-review .review-body{display:grid;gap:10px;padding:12px;}',
      '#live-text-review .review-path{margin:0;color:rgba(255,231,202,.58);font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word;}',
      '#live-text-review .review-item{border:1px solid rgba(252,184,103,.22);padding:10px;background:rgba(255,255,255,.02);}',
      '#live-text-review .review-id{font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(255,231,202,.58);word-break:break-word;}',
      '#live-text-review pre{white-space:pre-wrap;word-break:break-word;margin:8px 0 0;color:rgba(255,231,202,.78);font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;}',
      '#live-text-review button{min-height:30px;border:1px solid rgba(252,184,103,.26);background:transparent;color:#FFE7CA;padding:0 10px;font:700 11px/1 Inter,Helvetica Neue,Arial,sans-serif;text-transform:uppercase;cursor:pointer;}',
      '#live-text-review button:hover{border-color:#FCB867;color:#FCB867;}',
      '@media(max-width:760px){#live-text-editor{left:18px;right:18px;transform:none;justify-content:flex-start;overflow-x:auto;}#live-text-style-panel{left:18px;right:18px;transform:none;width:auto;grid-template-columns:1fr;}#live-text-style-panel select{max-width:100%;}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function updateStatus(message) {
    var status = document.getElementById('live-text-editor-status');
    if (!status) return;

    status.textContent = message;
    window.clearTimeout(updateStatus._timer);
    updateStatus._timer = window.setTimeout(function() {
      status.textContent = isEnabled ? 'editing' : 'off';
    }, 900);
  }

  function updateSourceButton() {
    var button = document.getElementById('live-text-apply-source');
    if (button) button.hidden = !helperAvailable;
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
      { label: 'Font', value: '', preview: 'Inter, "Helvetica Neue", Arial, sans-serif' },
      { label: 'Default font', value: 'default', preview: 'Inter, "Helvetica Neue", Arial, sans-serif' },
      { label: 'Site serif', value: 'Georgia, "Times New Roman", Times, serif', preview: 'Georgia, "Times New Roman", Times, serif' },
      { label: 'Site display', value: 'Inter, "Helvetica Neue", Arial, sans-serif', preview: 'Inter, "Helvetica Neue", Arial, sans-serif' },
      { label: 'System sans', value: 'Arial, Helvetica, sans-serif', preview: 'Arial, Helvetica, sans-serif' },
      { label: 'Monospace', value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', preview: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }
    ], function(value, target) {
      applyFontToElement(target || getEditableFromSelection(), value === 'default' ? '' : value);
    }));
    styleSection.appendChild(makeSelect('Font size', [
      { label: 'Size', value: '' },
      { label: 'Default size', value: 'default' },
      { label: '12 px', value: '12px' },
      { label: '14 px', value: '14px' },
      { label: '16 px', value: '16px' },
      { label: '18 px', value: '18px' },
      { label: '20 px', value: '20px' },
      { label: '24 px', value: '24px' },
      { label: '32 px', value: '32px' },
      { label: '48 px', value: '48px' },
      { label: '64 px', value: '64px' },
      { label: '96 px', value: '96px' }
    ], function(value, target) {
      applyFontSizeToElement(target || getEditableFromSelection(), value === 'default' ? '' : value);
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
    var reviewButton = makeButton('Review', toggleReview);
    var applyButton = makeButton('Apply Source', applyToSource);
    applyButton.id = 'live-text-apply-source';
    applyButton.hidden = true;
    var reset = makeButton('Reset', function() {
      if (!window.confirm('Clear saved copy edits for this page?')) return;
      window.localStorage.removeItem(pageKey());
      window.location.reload();
    });
    actionSection.appendChild(reviewButton);
    actionSection.appendChild(applyButton);
    actionSection.appendChild(exportButton);
    actionSection.appendChild(reset);

    var status = document.createElement('span');
    status.id = 'live-text-editor-status';
    status.textContent = 'off';
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
    updateSourceButton();
  }

  function savedEntries() {
    var saved = getSavedCopy();
    var currentIds = {};
    editableElements.forEach(function(element) {
      var id = element.getAttribute('data-live-edit-id');
      if (id) currentIds[id] = true;
    });
    return Object.keys(saved).map(function(id) {
      return { id: id, record: normalizeRecord(saved[id]) };
    }).filter(function(entry) {
      if (editableElements.length && !currentIds[entry.id]) return false;
      return entry.record.html || entry.record.text || hasMeaningfulStyles(entry.record.styles);
    }).map(function(entry) {
      // Any entry that matches a currently-tracked element can be located in the
      // source document, either via a stable data-copy-id or via the same
      // path/text/index id scheme used to generate data-live-edit-id values.
      entry.sourceBacked = true;
      return entry;
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

  function renderReviewBody() {
    if (!reviewDrawer) return;
    var body = reviewDrawer.querySelector('.review-body');
    var entries = savedEntries();
    if (!entries.length) {
      body.innerHTML = '<p>No saved edits for this page.</p>';
      return;
    }

    var targetPath = isSourceApplyContext() ? pageFilePath().join('/') : 'preview only - open via localhost to apply source';
    body.innerHTML = '<p class="review-path">target: ' + escapeText(targetPath) + '</p>' + entries.map(function(entry) {
      return [
        '<article class="review-item">',
        '<div class="review-id">' + escapeText(entry.id) + ' - ' + (entry.sourceBacked ? 'source-backed' : 'preview-only') + '</div>',
        originalRecords[entry.id] ? '<pre>old: ' + escapeText(originalRecords[entry.id].html) + '</pre>' : '',
        '<pre>new: ' + escapeText(entry.record.html || entry.record.text) + '</pre>',
        hasMeaningfulStyles(entry.record.styles) ? '<pre>styles: ' + escapeText(JSON.stringify(entry.record.styles)) + '</pre>' : '',
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
    actions.appendChild(makeButton('Apply Source', applyToSource));
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
    importButton.style.bottom = '96px';
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

  // data-live-edit-id is a runtime-only marker (set on parsed source documents by
  // collectDocEditableElements). Strip it before serializing outerHTML so it never
  // gets written into source files.
  function stripLiveEditIds(element) {
    element.removeAttribute('data-live-edit-id');
    var nested = element.querySelectorAll('[data-live-edit-id]');
    for (var i = 0; i < nested.length; i += 1) nested[i].removeAttribute('data-live-edit-id');
  }

  function applyRecordToElement(element, record) {
    var newHtml = sanitizeHtml(record.html || '');
    if (newHtml && newHtml !== element.innerHTML) {
      element.innerHTML = newHtml;
    }
    applyElementStyles(element, record.styles);
  }

  // Replicates collectEditableElements() against a parsed source document so that
  // elements without a stable data-copy-id can still be located by the same
  // path/text/index scheme used to build data-live-edit-id values in the live DOM.
  // Mutates `doc` by setting data-live-edit-id on each collected element, mirroring
  // the live-document behavior so hasEditableParent() and ordering line up.
  function collectDocEditableElements(doc) {
    var root = doc.body;
    var candidates = Array.prototype.slice.call(doc.querySelectorAll(TEXT_SELECTOR));
    var collected = [];

    candidates.forEach(function(element) {
      var hasStableCopyId = Boolean(copyIdForElement(element));
      if (element.closest('script, style, noscript, svg, canvas, input, textarea, select')) return;
      if (element.closest('#construct-fade, #construct-corner, #construct-nav')) return;
      if (element.closest('[data-live-edit-ignore]')) return;
      if (!element.textContent || !element.textContent.trim()) return;
      if (!hasStableCopyId && !hasDirectText(element)) return;
      if (hasEditableParent(element)) return;

      var id = buildElementId(element, collected.length, root);
      element.setAttribute('data-live-edit-id', id);
      collected.push({ element: element, id: id });
    });

    return collected;
  }

  // Generated ids have the shape "path:signature:index". Parsing from the right
  // keeps any ':' inside the path intact.
  function parseGeneratedId(id) {
    var match = String(id).match(/^(.*):([a-z0-9-]+):(\d+)$/);
    if (!match) return null;
    return { path: match[1], signature: match[2], index: Number(match[3]) };
  }

  function findSourceElement(doc, id) {
    var candidates = Array.prototype.slice.call(doc.querySelectorAll('[data-copy-id]'));
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i].getAttribute('data-copy-id') === id) return candidates[i];
    }
    var generated = collectDocEditableElements(doc);
    for (var j = 0; j < generated.length; j += 1) {
      if (generated[j].id === id) return generated[j].element;
    }

    // Fuzzy matching for generated ids. The index component counts elements
    // across the whole live page, so JS-injected content (walk-in cards, flash
    // grids) shifts it relative to the static source file; the signature
    // component changes when the text itself was edited. Match on the stable
    // parts instead of requiring all three to line up.
    var wanted = parseGeneratedId(id);
    if (!wanted) return null;
    var parsed = generated.map(function(entry) {
      return { entry: entry, id: parseGeneratedId(entry.id) };
    }).filter(function(item) { return item.id; });

    var samePathSig = parsed.filter(function(item) {
      return item.id.path === wanted.path && item.id.signature === wanted.signature;
    });
    if (samePathSig.length) {
      samePathSig.sort(function(a, b) {
        return Math.abs(a.id.index - wanted.index) - Math.abs(b.id.index - wanted.index);
      });
      return samePathSig[0].entry.element;
    }

    var samePathIndex = parsed.filter(function(item) {
      return item.id.path === wanted.path && item.id.index === wanted.index;
    });
    if (samePathIndex.length === 1) return samePathIndex[0].entry.element;

    var samePath = parsed.filter(function(item) { return item.id.path === wanted.path; });
    if (samePath.length === 1) return samePath[0].entry.element;

    return null;
  }

  function sourceEditableIds(doc) {
    var ids = Array.prototype.slice.call(doc.querySelectorAll('[data-copy-id]')).map(function(element) {
      return element.getAttribute('data-copy-id') || '';
    }).filter(Boolean);
    collectDocEditableElements(doc).forEach(function(entry) { ids.push(entry.id); });
    return ids;
  }

  function sampleIds(ids) {
    return ids.slice(0, 4).join(', ');
  }

  // Strip the current origin (e.g. "http://localhost:4173") from href/src/action/srcset
  // attribute values in a serialized HTML string. DOMParser absolutizes all relative URLs
  // when it serializes outerHTML, so "href="/tattoos/"" becomes
  // "href="http://localhost:4173/tattoos/"". Without this normalization, indexOf searches
  // against the raw source file (which has relative URLs) always fail for link elements.
  function deabsolutizeHtml(html) {
    var origin = window.location.origin;
    if (!origin || origin === 'null') return html;
    var escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return html.replace(
      new RegExp('((?:href|src|action|srcset)=")' + escaped, 'g'),
      '$1'
    );
  }

  // Find an element in the raw HTML source string by its stable data-copy-id
  // attribute, then replace its entire span (opening tag through closing tag) with
  // `replacement`. Returns the updated source string, or null if the element cannot
  // be located. This avoids the DOMParser-to-outerHTML roundtrip that causes
  // serialization mismatches (e.g. trailing semicolons on inline style values).
  // Given the position of an element's '<' in the raw source, return the index of
  // the final '>' that closes the element (its full outer span), or -1 if the span
  // cannot be determined.
  function elementSpanEnd(source, tagStart, tagName) {
    var openEnd = source.indexOf('>', tagStart);
    if (openEnd === -1) return -1;

    // Void elements and explicit self-closing tags have no children or closing tag.
    var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
    if (VOID[tagName] || source[openEnd - 1] === '/') return openEnd;

    // Walk forward to find the matching closing tag, tracking nesting depth.
    var pos = openEnd + 1;
    var depth = 1;
    var openPat = '<' + tagName;
    var closePat = '</' + tagName;

    while (depth > 0 && pos < source.length) {
      var nc = source.indexOf(closePat, pos);
      if (nc === -1) return -1; // malformed HTML

      var no = source.indexOf(openPat, pos);
      if (no !== -1 && no < nc) {
        var c = source[no + openPat.length];
        // Confirm this is an actual opening tag, not a prefix match (e.g. <paragraph vs <p).
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '>' || c === '/') {
          depth += 1;
          pos = no + 1;
          continue;
        }
      }

      var ce = source.indexOf('>', nc);
      if (ce === -1) return -1;
      depth -= 1;
      if (depth === 0) return ce;
      pos = ce + 1;
    }

    return -1;
  }

  function normalizeMatchText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function replaceSourceElement(source, element, replacement, originalText) {
    var copyId = element.getAttribute('data-copy-id') || '';
    var tagName = element.tagName.toLowerCase();

    if (copyId) {
      var searches = ['data-copy-id="' + copyId + '"', "data-copy-id='" + copyId + "'"];
      for (var si = 0; si < searches.length; si += 1) {
        var attrPos = source.indexOf(searches[si]);
        if (attrPos === -1) continue;

        // Walk backward from the attribute to find the '<' that opens this tag.
        var tagStart = source.lastIndexOf('<', attrPos);
        if (tagStart === -1) continue;

        // Confirm the tag name at this position matches (case-insensitive).
        var nameSlice = source.slice(tagStart + 1, tagStart + 1 + tagName.length);
        if (nameSlice.toLowerCase() !== tagName) continue;
        var boundaryChar = source[tagStart + 1 + tagName.length];
        if (!boundaryChar || !/[\s>\/]/.test(boundaryChar)) continue;

        var spanEnd = elementSpanEnd(source, tagStart, tagName);
        if (spanEnd === -1) continue;
        return source.slice(0, tagStart) + replacement + source.slice(spanEnd + 1);
      }
    }

    // Fallback for elements without a data-copy-id: scan the raw source for tags of
    // the same name (and class, when the element has one) and compare decoded text
    // content. Parsing each candidate span through DOMParser makes the comparison
    // immune to entity differences (&mdash; vs the literal character) and attribute
    // serialization drift that defeat plain outerHTML string matching.
    var wanted = normalizeMatchText(originalText);
    if (!wanted) return null;
    var firstClass = (typeof element.className === 'string' && element.className.trim().split(/\s+/)[0]) || '';
    var openPattern = '<' + tagName;
    var parser = new DOMParser();
    var from = 0;

    while (true) {
      var start = source.indexOf(openPattern, from);
      if (start === -1) break;
      from = start + 1;

      var boundary = source[start + openPattern.length];
      if (!boundary || !/[\s>\/]/.test(boundary)) continue;

      var openClose = source.indexOf('>', start);
      if (openClose === -1) break;
      if (firstClass && source.slice(start, openClose + 1).indexOf(firstClass) === -1) continue;

      var end = elementSpanEnd(source, start, tagName);
      if (end === -1) continue;

      var spanDoc = parser.parseFromString(source.slice(start, end + 1), 'text/html');
      var spanElement = spanDoc.body && spanDoc.body.firstElementChild;
      if (!spanElement || normalizeMatchText(spanElement.textContent) !== wanted) continue;

      return source.slice(0, start) + replacement + source.slice(end + 1);
    }

    return null;
  }

  function applyToSource() {
    if (!isSourceApplyContext()) {
      updateStatus('localhost only');
      return;
    }

    if (!helperAvailable) {
      updateStatus('no helper');
      detectHelper();
      return;
    }

    var entries = savedEntries();
    if (!entries.length) {
      updateStatus('no edits');
      return;
    }
    var sourceEntries = entries.filter(function(entry) {
      return entry.sourceBacked;
    });
    if (!sourceEntries.length) {
      updateStatus('preview only');
      return;
    }

    var pathSegments = pageFilePath();
    callToolApi('/__tools/read-file', { pathSegments: pathSegments })
      .then(function(data) {
        var rawContent = data.content || '';
        var parser = new DOMParser();
        var doc = parser.parseFromString(rawContent, 'text/html');
        var applied = 0;
        var skipped = 0;
        var nextContent = rawContent;

        sourceEntries.forEach(function(entry) {
          var target = findSourceElement(doc, entry.id);
          if (!target) {
            skipped += 1;
            return;
          }
          // Deabsolutize immediately: DOMParser converts relative URLs (href="/tattoos/")
          // to absolute ones (href="http://localhost:4173/tattoos/") when serializing
          // outerHTML. Strip the origin prefix so comparisons against raw source work.
          stripLiveEditIds(target);
          var originalOuterHTML = deabsolutizeHtml(target.outerHTML);
          var originalText = target.textContent;
          applyRecordToElement(target, entry.record);
          var modifiedOuterHTML = deabsolutizeHtml(target.outerHTML);
          if (modifiedOuterHTML === originalOuterHTML) {
            applied += 1;
            return;
          }

          // Primary path: locate the element in the raw source by its stable data-copy-id
          // and replace its full span. This is immune to DOMParser serialization differences
          // (trailing semicolons on inline styles, attribute-order shifts, etc.) that make
          // outerHTML string matching unreliable.
          var replaced = replaceSourceElement(nextContent, target, modifiedOuterHTML, originalText);
          if (replaced !== null) {
            nextContent = replaced;
            applied += 1;
            return;
          }

          // Fallback: outerHTML string match after deabsolutizing relative URLs.
          var idx = nextContent.indexOf(originalOuterHTML);
          if (idx !== -1) {
            nextContent = nextContent.slice(0, idx) + modifiedOuterHTML + nextContent.slice(idx + originalOuterHTML.length);
            applied += 1;
            return;
          }

          skipped += 1;
        });

        if (!applied) {
          var savedIds = sourceEntries.map(function(entry) { return entry.id; });
          var sourceIds = sourceEditableIds(doc);
          throw new Error('No IDs matched ' + pathSegments.join('/') + '. Saved: ' + (sampleIds(savedIds) || 'none') + '. Source: ' + (sampleIds(sourceIds) || 'none') + '.');
        }

        return callToolApi('/__tools/write-file', {
          pathSegments: pathSegments,
          content: nextContent
        }).then(function() {
          updateStatus(skipped ? 'applied ' + applied + ', skipped ' + skipped : 'applied ' + applied);
          if (reviewDrawer) renderReviewBody();
        });
      })
      .catch(function(error) {
        updateStatus(error.message || 'apply failed');
      });
  }

  function setEnabled(next) {
    hydrateSavedText();
    isEnabled = Boolean(next);
    document.body.classList.toggle('live-text-editing', isEnabled);
    window.localStorage.setItem(ENABLED_KEY, isEnabled ? '1' : '0');

    editableElements.forEach(function(element) {
      element.contentEditable = isEnabled ? 'true' : 'false';
      element.spellcheck = isEnabled;
    });

    var toggle = document.getElementById('live-text-editor-toggle');
    if (toggle) toggle.classList.toggle('is-active', isEnabled);
    updateStatus(isEnabled ? 'editing' : 'off');
  }

  function refreshEditableElements() {
    if (!isHydrated) return;
    var wasEnabled = isEnabled;
    editableElements.forEach(function(element) {
      element.contentEditable = 'false';
      element.removeAttribute('data-live-edit-id');
    });
    activeElement = null;
    isHydrated = false;
    hydrateSavedText();
    if (wasEnabled) setEnabled(true);
  }

  document.addEventListener('input', function(event) {
    if (!isEnabled) return;
    var element = event.target.closest && event.target.closest('[data-live-edit-id]');
    if (!element) return;
    activeElement = element;
    saveElement(element);
  });

  document.addEventListener('focusin', function(event) {
    var element = event.target.closest && event.target.closest('[data-live-edit-id]');
    if (element) activeElement = element;
  });

  document.addEventListener('selectionchange', function() {
    if (!isEnabled) return;
    var element = getEditableFromSelection();
    if (element) activeElement = element;
  });

  document.addEventListener('click', function(event) {
    if (!isEnabled) return;
    var link = event.target.closest && event.target.closest('a');
    if (!link || isEditorNode(link)) return;
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

  function init() {
    injectStyles();
    makeToolbar();
    hydrateSavedText();
    detectHelper();
    if (shouldAutoEnable()) setEnabled(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
