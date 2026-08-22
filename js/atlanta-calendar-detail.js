(function () {
  "use strict";

  var RETURN_STATE_KEY = "atlanta-calendar-return-state-v1";
  var record = window.AtlantaCalendarRecord;
  var root = document.getElementById("calendarEventDetail");
  var backLink = document.getElementById("calendarBackLink");
  var payloadNode = document.getElementById("calendar-event-data");
  var event = null;
  var activeGallery = null;

  try { event = JSON.parse(payloadNode.textContent || "{}").event || null; } catch (error) { event = null; }

  function hasReturnState() {
    try {
      var state = JSON.parse(sessionStorage.getItem(RETURN_STATE_KEY) || "null");
      return Boolean(state && state.path === "/calendar/" && Date.now() - Number(state.savedAt || 0) <= 7200000);
    } catch (error) { return false; }
  }

  function syncDescriptionToggles() {
    Array.from(root.querySelectorAll(".calendar-event-description")).forEach(function (description) {
      var control = root.querySelector('[data-description-toggle][aria-controls="' + description.id + '"]');
      if (!control) return;
      if (control.getAttribute("aria-expanded") === "true") { control.hidden = false; return; }
      description.classList.add("is-collapsed");
      control.hidden = !(description.scrollHeight > description.clientHeight + 1);
    });
  }

  async function shareEvent(control) {
    var shareUrl = new URL(control.dataset.shareUrl || location.pathname, location.origin).toString();
    var shareData = { title:control.dataset.shareTitle || document.title, url:shareUrl };
    if (navigator.share) {
      try { await navigator.share(shareData); return; }
      catch (error) { if (error && error.name === "AbortError") return; }
    }
    var copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(shareUrl); copied = true; } catch (error) { copied = false; }
    }
    if (!copied) {
      var field = document.createElement("textarea");
      field.value = shareUrl;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      copied = document.execCommand("copy");
      field.remove();
    }
    if (!copied) return;
    control.textContent = "Link copied";
    control.setAttribute("aria-live", "polite");
    window.setTimeout(function () { control.textContent = "Share"; }, 2000);
  }

  function renderLightbox() {
    if (!activeGallery || !event) return;
    var media = record.eventMedia(event);
    var item = media[activeGallery.index];
    var dialog = document.getElementById("calendarMediaDialog");
    if (!dialog || !item) return;
    document.getElementById("calendarMediaTitle").textContent = event.title + " / " + (activeGallery.index + 1) + " of " + media.length;
    var image = document.getElementById("calendarMediaImage");
    image.src = item.url;
    image.alt = item.altText || event.title + " event image";
    document.getElementById("calendarMediaCaption").textContent = item.caption || "";
    document.getElementById("calendarMediaPrevious").disabled = media.length < 2;
    document.getElementById("calendarMediaNext").disabled = media.length < 2;
  }

  function openGallery(index) {
    if (!record.eventMedia(event).length) return;
    activeGallery = { index:index };
    renderLightbox();
    var dialog = document.getElementById("calendarMediaDialog");
    if (!dialog.open) dialog.showModal();
  }

  function shiftGallery(direction) {
    if (!activeGallery) return;
    var media = record.eventMedia(event);
    activeGallery.index = (activeGallery.index + direction + media.length) % media.length;
    renderLightbox();
  }

  if (!event || !record) {
    root.innerHTML = '<p class="calendar-empty">This approved event record could not be loaded.</p>';
    return;
  }

  root.innerHTML = record.renderEvent(event, { headingTag:"h1", includeViewEvent:false, detail:true });
  document.documentElement.classList.add("is-ready");
  if (hasReturnState()) backLink.textContent = "Back to your calendar view";
  requestAnimationFrame(syncDescriptionToggles);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncDescriptionToggles);
  window.addEventListener("resize", syncDescriptionToggles);

  root.addEventListener("click", function (clickEvent) {
    var shareControl = clickEvent.target.closest("[data-share-event]");
    if (shareControl) { shareEvent(shareControl); return; }
    var galleryButton = clickEvent.target.closest("[data-gallery-event]");
    if (galleryButton) { openGallery(Number(galleryButton.dataset.galleryIndex) || 0); return; }
    var tagControl = clickEvent.target.closest("[data-tag-toggle]");
    if (tagControl) {
      var expanded = tagControl.getAttribute("aria-expanded") !== "true";
      var tagRoot = tagControl.closest(".calendar-tags");
      tagRoot.querySelectorAll(".calendar-tag.is-extra").forEach(function (tag) { tag.hidden = !expanded; });
      tagControl.setAttribute("aria-expanded", expanded ? "true" : "false");
      tagControl.textContent = expanded ? "Show fewer" : "+" + tagRoot.querySelectorAll(".calendar-tag.is-extra").length + " more";
      return;
    }
    var control = clickEvent.target.closest("[data-description-toggle]");
    if (!control) return;
    var description = document.getElementById(control.getAttribute("aria-controls"));
    if (!description) return;
    var shouldExpand = control.getAttribute("aria-expanded") !== "true";
    control.setAttribute("aria-expanded", shouldExpand ? "true" : "false");
    control.textContent = shouldExpand ? "See less" : "See more";
    description.classList.toggle("is-collapsed", !shouldExpand);
  });

  document.getElementById("calendarMediaPrevious").addEventListener("click", function () { shiftGallery(-1); });
  document.getElementById("calendarMediaNext").addEventListener("click", function () { shiftGallery(1); });
  document.getElementById("calendarMediaClose").addEventListener("click", function () { document.getElementById("calendarMediaDialog").close(); });
  document.getElementById("calendarMediaDialog").addEventListener("click", function (clickEvent) { if (clickEvent.target === this) this.close(); });
  document.addEventListener("keydown", function (keyEvent) {
    var dialog = document.getElementById("calendarMediaDialog");
    if (!dialog.open) return;
    if (keyEvent.key === "Escape") { keyEvent.preventDefault(); dialog.close(); activeGallery = null; }
    if (keyEvent.key === "ArrowLeft") { keyEvent.preventDefault(); shiftGallery(-1); }
    if (keyEvent.key === "ArrowRight") { keyEvent.preventDefault(); shiftGallery(1); }
  });
})();
