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

  var TEXT_SELECTOR = [
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

  function buildElementId(element, index) {
    var existing = element.getAttribute('data-copy-id') || element.id;
    if (existing) return existing;

    var parts = [];
    var node = element;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
      var part = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        part += '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.');
      }
      parts.unshift(part);
      node = node.parentElement;
    }

    return parts.join('>') + ':' + textSignature(element) + ':' + index;
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

  function collectEditableElements() {
    var candidates = Array.prototype.slice.call(document.querySelectorAll(TEXT_SELECTOR));
    var collected = [];

    candidates.forEach(function(element) {
      if (isEditorNode(element)) return;
      if (element.closest('script, style, noscript, svg, canvas, input, textarea, select')) return;
      if (element.closest('#construct-fade, #construct-corner, #construct-nav')) return;
      if (element.closest('[data-live-edit-ignore]')) return;
      if (!hasDirectText(element)) return;
      if (!element.textContent || !element.textContent.trim()) return;
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

    editableElements.forEach(function(element) {
      var id = element.getAttribute('data-live-edit-id');
      if (saved[id] && typeof saved[id].html === 'string') {
        element.innerHTML = saved[id].html;
      }
      if (saved[id] && typeof saved[id].color === 'string') {
        element.style.color = saved[id].color;
      }
    });

    isHydrated = true;
  }

  function saveElement(element) {
    var id = element.getAttribute('data-live-edit-id');
    if (!id) return;

    var saved = getSavedCopy();
    saved[id] = {
      text: element.textContent.trim(),
      html: element.innerHTML,
      color: element.style.color || ''
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

  function colorSelection(element, color) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return false;

    var range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return false;

    var span = document.createElement('span');
    span.style.color = color;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    selection.removeAllRanges();
    range.selectNodeContents(span);
    selection.addRange(range);
    return true;
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

  function injectStyles() {
    if (document.getElementById('live-text-editor-styles')) return;

    var style = document.createElement('style');
    style.id = 'live-text-editor-styles';
    style.textContent = [
      'body.live-text-editing [data-live-edit-id]{outline:1px dashed rgba(252,184,103,.42);outline-offset:3px;cursor:text;}',
      'body.live-text-editing [data-live-edit-id]:hover,body.live-text-editing [data-live-edit-id]:focus{outline-color:#FCB867;background:rgba(252,184,103,.08);}',
      'body.live-text-editing [data-live-edit-id]:focus{box-shadow:0 0 0 4px rgba(252,184,103,.12);}',
      '#live-text-editor{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;align-items:center;flex-wrap:wrap;gap:8px;max-width:min(760px,calc(100vw - 36px));padding:8px;border:1px solid rgba(252,184,103,.32);background:rgba(14,14,14,.92);backdrop-filter:blur(16px);color:#FFE7CA;font-family:Inter,Helvetica Neue,Arial,sans-serif;font-size:11px;line-height:1;box-shadow:0 14px 34px rgba(0,0,0,.36);}',
      '#live-text-editor button{min-height:30px;border:1px solid rgba(252,184,103,.26);background:transparent;color:inherit;padding:0 10px;font:inherit;font-weight:700;text-transform:uppercase;letter-spacing:0;cursor:pointer;}',
      '#live-text-editor button:hover,#live-text-editor button:focus-visible{border-color:#FCB867;color:#FCB867;outline:none;}',
      '#live-text-editor .is-active{background:#FCB867;color:#0e0e0e;border-color:#FCB867;}',
      '#live-text-editor .color-group{display:flex;align-items:center;flex-wrap:wrap;gap:5px;max-width:min(520px,calc(100vw - 230px));max-height:74px;overflow:auto;padding-left:4px;border-left:1px solid rgba(252,184,103,.22);}',
      '#live-text-editor .color-swatch{width:26px;min-height:26px;padding:0;border-radius:50%;border-color:rgba(255,231,202,.28);background:var(--swatch,transparent);color:transparent;overflow:hidden;}',
      '#live-text-editor .color-swatch:hover,#live-text-editor .color-swatch:focus-visible{border-color:#FFE7CA;box-shadow:0 0 0 3px rgba(252,184,103,.12);color:transparent;}',
      '#live-text-editor .color-reset{width:26px;min-height:26px;padding:0;border-radius:50%;color:rgba(255,231,202,.62);font-size:16px;line-height:1;}',
      '#live-text-editor-status{min-width:52px;color:rgba(255,231,202,.62);font-family:Georgia,Times New Roman,serif;text-transform:lowercase;}',
      '#live-text-export{position:fixed;right:18px;bottom:68px;z-index:2147483647;width:min(520px,calc(100vw - 36px));min-height:180px;padding:12px;border:1px solid rgba(252,184,103,.32);background:#0e0e0e;color:#FFE7CA;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;}'
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

  function makeToolbar() {
    if (document.getElementById(EDITOR_ID)) return;

    var toolbar = document.createElement('div');
    toolbar.id = EDITOR_ID;
    toolbar.setAttribute('data-live-edit-ignore', 'true');

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'live-text-editor-toggle';
    toggle.textContent = 'Edit';
    toggle.addEventListener('click', function() {
      setEnabled(!isEnabled);
    });

    var exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'Export';
    exportButton.addEventListener('click', toggleExport);

    var reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.addEventListener('click', function() {
      if (!window.confirm('Clear saved copy edits for this page?')) return;
      window.localStorage.removeItem(pageKey());
      window.location.reload();
    });

    var colorGroup = document.createElement('div');
    colorGroup.className = 'color-group';

    getColorPalette().forEach(function(color) {
      var swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.title = color.name;
      swatch.setAttribute('aria-label', color.name);
      swatch.style.setProperty('--swatch', color.value);
      swatch.addEventListener('mousedown', function(event) {
        event.preventDefault();
      });
      swatch.addEventListener('click', function() {
        applyColorToElement(getEditableFromSelection(), color.value);
      });
      colorGroup.appendChild(swatch);
    });

    var clearColor = document.createElement('button');
    clearColor.type = 'button';
    clearColor.className = 'color-reset';
    clearColor.title = 'Default color';
    clearColor.setAttribute('aria-label', 'Default color');
    clearColor.textContent = 'x';
    clearColor.addEventListener('mousedown', function(event) {
      event.preventDefault();
    });
    clearColor.addEventListener('click', function() {
      applyColorToElement(getEditableFromSelection(), '');
    });
    colorGroup.appendChild(clearColor);

    var status = document.createElement('span');
    status.id = 'live-text-editor-status';
    status.textContent = 'off';

    toolbar.appendChild(toggle);
    toolbar.appendChild(colorGroup);
    toolbar.appendChild(exportButton);
    toolbar.appendChild(reset);
    toolbar.appendChild(status);
    document.body.appendChild(toolbar);
  }

  function toggleExport() {
    var existing = document.getElementById('live-text-export');
    if (existing) {
      existing.remove();
      return;
    }

    var textarea = document.createElement('textarea');
    textarea.id = 'live-text-export';
    textarea.setAttribute('readonly', 'readonly');
    textarea.value = JSON.stringify(getSavedCopy(), null, 2);
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
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
    if (shouldAutoEnable()) setEnabled(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
