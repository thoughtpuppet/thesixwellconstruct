(function (global) {
  "use strict";

  var contextPromise = null;

  function loadContext() {
    if (!contextPromise) {
      contextPromise = fetch("/api/booking/public-consultation/context", { cache: "no-store" })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (payload) {
            if (!response.ok) throw new Error(payload.error || "Unable to load consultation details.");
            return payload;
          });
        });
    }
    return contextPromise;
  }

  function terms(type) {
    if (!type) return "Details unavailable";
    return type.depositLabel + " · " + type.durationMinutes + " min";
  }

  function findType(payload, id) {
    return (payload.bookingTypes || []).find(function (type) { return type.id === id; }) || null;
  }

  function hydrate(root) {
    root = root || document;
    var targets = Array.prototype.slice.call(root.querySelectorAll("[data-consultation-meta]"));
    var current = root.querySelector("[data-consultation-current]");
    if (!targets.length && !current) return Promise.resolve(null);

    return loadContext().then(function (payload) {
      targets.forEach(function (target) {
        var type = findType(payload, target.getAttribute("data-consultation-meta"));
        target.textContent = type ? terms(type) : "Currently unavailable";
      });

      function updateCurrent() {
        if (!current) return;
        var select = root.getElementById ? root.getElementById("bookingTypeId") : null;
        var requested = new URLSearchParams(global.location.search).get("type");
        var id = select && select.value ? select.value : requested;
        var type = findType(payload, id) || payload.bookingType || (payload.bookingTypes || [])[0];
        current.textContent = type ? terms(type) : "Pricing and duration load with the available session type.";
      }

      updateCurrent();
      var select = root.getElementById ? root.getElementById("bookingTypeId") : null;
      if (select) select.addEventListener("change", updateCurrent);
      return payload;
    }).catch(function () {
      targets.forEach(function (target) { target.textContent = "See live availability"; });
      if (current) current.textContent = "Pricing and duration appear with the available session type.";
      return null;
    });
  }

  global.getPublicConsultationContext = loadContext;
  global.hydrateConsultationContext = hydrate;
})(window);
