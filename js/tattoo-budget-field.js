(function (window, document) {
  "use strict";

  var SPECIFIC_VALUE = "__specific_amount__";
  var FLEXIBLE_VALUE = "I’m flexible / I’d like guidance";
  var MINIMUM_SPECIFIC_DOLLARS = 150;
  var DEFAULT_RANGES = [
    { minimumDollars: null, maximumDollars: 300 },
    { minimumDollars: 300, maximumDollars: 500 },
    { minimumDollars: 500, maximumDollars: 800 },
    { minimumDollars: 800, maximumDollars: 1200 },
    { minimumDollars: 1200, maximumDollars: 2000 },
    { minimumDollars: 2000, maximumDollars: null },
  ];

  function money(value) {
    return "$" + Number(value).toLocaleString("en-US");
  }

  function rangeLabel(range) {
    if (range.label) return String(range.label);
    if (range.minimumDollars === null) return "Up to " + money(range.maximumDollars);
    if (range.maximumDollars === null) return money(range.minimumDollars) + "+";
    return money(range.minimumDollars) + "–" + money(range.maximumDollars);
  }

  function normalizedRanges(value) {
    if (!Array.isArray(value) || !value.length) return DEFAULT_RANGES;
    return value.slice(0, 12).map(function (range) {
      return {
        minimumDollars: range.minimumDollars === null ? null : Number(range.minimumDollars),
        maximumDollars: range.maximumDollars === null ? null : Number(range.maximumDollars),
        label: range.label || "",
      };
    }).filter(function (range) {
      return (range.minimumDollars === null || Number.isSafeInteger(range.minimumDollars))
        && (range.maximumDollars === null || Number.isSafeInteger(range.maximumDollars))
        && (range.minimumDollars !== null || range.maximumDollars !== null);
    });
  }

  function targetFor(select) {
    var selector = select.dataset.specificBudgetTarget;
    return selector ? document.querySelector(selector) : null;
  }

  function syncSpecificField(select) {
    var field = targetFor(select);
    if (!field) return;
    var input = field.querySelector('input[name="budget_amount_dollars"]');
    var active = select.value === SPECIFIC_VALUE;
    field.hidden = !active;
    field.setAttribute("aria-hidden", String(!active));
    if (input) {
      input.disabled = !active;
      input.required = active;
      input.min = String(MINIMUM_SPECIFIC_DOLLARS);
      if (!active) input.setCustomValidity("");
    }
  }

  function populateSelect(select, ranges) {
    var currentValue = select.value;
    var options = [{ value: "", label: "Select a range" }].concat(
      normalizedRanges(ranges).map(function (range) {
        var label = rangeLabel(range);
        return { value: label, label: label };
      }),
      [
        { value: SPECIFIC_VALUE, label: "Enter a specific amount" },
        { value: FLEXIBLE_VALUE, label: FLEXIBLE_VALUE },
      ]
    );
    if (currentValue && !options.some(function (option) { return option.value === currentValue; })) {
      options.splice(options.length - 2, 0, { value: currentValue, label: currentValue + " (saved selection)" });
    }
    select.replaceChildren.apply(select, options.map(function (option) {
      return new Option(option.label, option.value, false, option.value === currentValue);
    }));
    if (!currentValue) select.value = "";
    if (typeof select._customSync === "function") select._customSync();
    syncSpecificField(select);
  }

  function sync(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("select[data-tattoo-budget-select]").forEach(function (select) {
      syncSpecificField(select);
    });
  }

  function init() {
    var selects = Array.from(document.querySelectorAll("select[data-tattoo-budget-select]"));
    if (!selects.length) return;
    selects.forEach(function (select) {
      populateSelect(select, DEFAULT_RANGES);
      select.addEventListener("change", function () { syncSpecificField(select); });
    });
    fetch("/api/tattoo/settings", { cache: "no-store", headers: { accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error("Tattoo settings unavailable")); })
      .then(function (payload) {
        var ranges = payload && payload.settings && payload.settings.inquiryBudgetRanges;
        selects.forEach(function (select) { populateSelect(select, ranges); });
      })
      .catch(function () {
        // The bundled defaults keep inquiry forms usable during a settings outage.
      });
  }

  window.SixWellTattooBudget = {
    minimumSpecificDollars: MINIMUM_SPECIFIC_DOLLARS,
    specificValue: SPECIFIC_VALUE,
    sync: sync,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window, document);
