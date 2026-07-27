(function initIdentityBandLightboxes() {
  var triggers = document.querySelectorAll("[data-band-image-open]");

  triggers.forEach(function bindIdentityBandLightbox(trigger) {
    var dialog = document.getElementById(trigger.getAttribute("data-band-image-open"));
    if (!dialog) return;

    var closeButton = dialog.querySelector("[data-band-image-close]");
    var frame = dialog.querySelector(".band-image-dialog__frame");
    var previousOverflow = "";

    function openDialog() {
      if (dialog.open) return;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }

      if (closeButton) closeButton.focus();
    }

    function closeDialog() {
      if (!dialog.open && !dialog.hasAttribute("open")) return;

      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
        document.body.style.overflow = previousOverflow;
        trigger.focus();
      }
    }

    trigger.addEventListener("click", openDialog);
    if (closeButton) closeButton.addEventListener("click", closeDialog);

    dialog.addEventListener("click", function closeFromBackdrop(event) {
      if (event.target === dialog || event.target === frame) closeDialog();
    });

    dialog.addEventListener("cancel", function closeFromEscape(event) {
      event.preventDefault();
      closeDialog();
    });

    dialog.addEventListener("close", function restoreIdentityBandFocus() {
      document.body.style.overflow = previousOverflow;
      trigger.focus({ preventScroll: true });
    });
  });
})();
