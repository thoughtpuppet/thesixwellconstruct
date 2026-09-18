(function () {
  function init(form) {
    var preview = form.querySelector('[data-request-preview]');
    var card = form.querySelector('[data-request-review]');
    var list = card?.querySelector('ul');
    var submit = form.querySelector('[data-request-submit]');
    if (!preview || !card || !list || !submit) return;

    function hide() {
      card.hidden = true;
      submit.hidden = true;
    }

    function answer(control) {
      if (control.type === 'checkbox' || control.type === 'radio') {
        var group = form.querySelectorAll('[name="' + CSS.escape(control.name) + '"]');
        return Array.from(group).filter(function (item) { return item.checked && !item.disabled; })
          .map(function (item) {
            var label = item.closest('label');
            return label?.querySelector('strong')?.textContent.trim()
              || label?.querySelector('.radio-option span')?.textContent.trim()
              || (label?.classList.contains('radio-option') ? label.querySelector('span')?.textContent.trim() : '')
              || label?.textContent.trim() || item.value;
          }).join(', ');
      }
      if (control.tagName === 'SELECT') return control.selectedOptions[0]?.textContent.trim() || '';
      return control.value.trim();
    }

    form.addEventListener('input', hide);
    form.addEventListener('change', hide);
    preview.addEventListener('click', function () {
      if (!form.reportValidity()) return;
      list.replaceChildren();
      form.querySelectorAll('[data-review-label]').forEach(function (control) {
        if (control.disabled || control.closest('[hidden]')) return;
        var value = answer(control);
        if (!value || (control.tagName === 'SELECT' && !control.value)) return;
        var item = document.createElement('li');
        var title = document.createElement('strong');
        title.textContent = control.dataset.reviewLabel + ': ';
        item.append(title, document.createTextNode(value));
        list.append(item);
      });
      if (!list.childElementCount) {
        var item = document.createElement('li');
        item.textContent = 'Review your selections above before sending.';
        list.append(item);
      }
      card.hidden = false;
      submit.hidden = false;
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    hide();
  }

  document.querySelectorAll('form[data-tattoo-request-review]').forEach(init);
})();
