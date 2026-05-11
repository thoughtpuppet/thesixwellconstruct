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
  var editableElements = [];
  var isEnabled = false;
  var isHydrated = false;

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
    });

    isHydrated = true;
  }

  function saveElement(element) {
    var id = element.getAttribute('data-live-edit-id');
    if (!id) return;

    var saved = getSavedCopy();
    saved[id] = {
      text: element.textContent.trim(),
      html: element.innerHTML
    };
    setSavedCopy(saved);
    updateStatus('saved');
  }

  function injectStyles() {
    if (document.getElementById('live-text-editor-styles')) return;

    var style = document.createElement('style');
    style.id = 'live-text-editor-styles';
    style.textContent = [
      'body.live-text-editing [data-live-edit-id]{outline:1px dashed rgba(252,184,103,.42);outline-offset:3px;cursor:text;}',
      'body.live-text-editing [data-live-edit-id]:hover,body.live-text-editing [data-live-edit-id]:focus{outline-color:#FCB867;background:rgba(252,184,103,.08);}',
      'body.live-text-editing [data-live-edit-id]:focus{box-shadow:0 0 0 4px rgba(252,184,103,.12);}',
      '#live-text-editor{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;align-items:center;gap:8px;padding:8px;border:1px solid rgba(252,184,103,.32);background:rgba(14,14,14,.92);backdrop-filter:blur(16px);color:#FFE7CA;font-family:Inter,Helvetica Neue,Arial,sans-serif;font-size:11px;line-height:1;box-shadow:0 14px 34px rgba(0,0,0,.36);}',
      '#live-text-editor button{min-height:30px;border:1px solid rgba(252,184,103,.26);background:transparent;color:inherit;padding:0 10px;font:inherit;font-weight:700;text-transform:uppercase;letter-spacing:0;cursor:pointer;}',
      '#live-text-editor button:hover,#live-text-editor button:focus-visible{border-color:#FCB867;color:#FCB867;outline:none;}',
      '#live-text-editor .is-active{background:#FCB867;color:#0e0e0e;border-color:#FCB867;}',
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

    var status = document.createElement('span');
    status.id = 'live-text-editor-status';
    status.textContent = 'off';

    toolbar.appendChild(toggle);
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

  document.addEventListener('input', function(event) {
    if (!isEnabled) return;
    var element = event.target.closest && event.target.closest('[data-live-edit-id]');
    if (!element) return;
    saveElement(element);
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
