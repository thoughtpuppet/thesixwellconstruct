(function () {
  "use strict";
  document.querySelectorAll("[data-painting-detail]").forEach(function (root) {
    var marker = root.querySelector(".kinmarking-work-marker");
    var toggle = root.querySelector("[data-painting-detail-toggle]");
    var inset = root.querySelector(".kinmarking-work-inset");
    if (!marker || !toggle || !inset) return;
    var pinned = false;
    function show(open) {
      root.classList.toggle("is-open", open);
      inset.hidden = !open;
      marker.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-expanded", String(open));
    }
    function toggleDetail() {
      pinned = !pinned;
      show(pinned);
    }
    marker.addEventListener("pointerenter", function (event) {
      if (event.pointerType === "mouse") show(true);
    });
    marker.addEventListener("pointerleave", function () {
      if (!pinned && document.activeElement !== marker) show(false);
    });
    marker.addEventListener("focus", function () { show(true); });
    marker.addEventListener("blur", function () { if (!pinned) show(false); });
    marker.addEventListener("click", toggleDetail);
    toggle.addEventListener("click", toggleDetail);
    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        pinned = false;
        show(false);
      }
    });
    root.classList.add("is-enhanced");
    marker.hidden = false;
    toggle.hidden = false;
    show(false);
  });
})();
