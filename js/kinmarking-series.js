(function (global) {
  "use strict";

  var EDITIONS = Object.freeze([
    { slug:"kinmarking-01-skin-as-archive", number:"01", fallbackTitle:"KINMARKING 01: Skin As Archive" },
    { slug:"kinmarking-02", number:"02", fallbackTitle:"KINMARKING 02" },
    { slug:"kinmarking-03", number:"03", fallbackTitle:"KINMARKING 03" },
    { slug:"kinmarking-04", number:"04", fallbackTitle:"KINMARKING 04" },
  ]);
  var TIME_ZONE = "America/New_York";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[character];
    });
  }

  function isKinmarkingSlug(slug) {
    return EDITIONS.some(function (edition) { return edition.slug === String(slug || ""); });
  }

  function orderedEvents(events) {
    var bySlug = new Map((Array.isArray(events) ? events : []).map(function (event) {
      return [event.slug, event];
    }));
    return EDITIONS.map(function (edition) {
      var event = bySlug.get(edition.slug);
      return event ? Object.assign({}, edition, event) : null;
    }).filter(Boolean);
  }

  function eventHref(slug) {
    return "/events/" + encodeURIComponent(slug) + "/";
  }

  function formatDate(value) {
    if (!value) return "Date to be announced";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date to be announced";
    return new Intl.DateTimeFormat("en-US", {
      timeZone:TIME_ZONE,
      weekday:"long",
      month:"long",
      day:"numeric",
      year:"numeric",
      hour:"numeric",
      minute:"2-digit",
      timeZoneName:"short",
    }).format(date);
  }

  function stateLabel(event) {
    if (event.publicationState === "announced") return "Announced";
    if (event.publicationState === "published" && event.open) return event.free ? "RSVP open" : "Booking open";
    if (event.publicationState === "published") return "Registration closed";
    return "In development";
  }

  function editionLinksMarkup(events, currentSlug) {
    var editions = orderedEvents(events);
    if (!editions.length) return '<p class="kinmarking-empty">Edition records are temporarily unavailable. <a href="/events/kinmarking/">Return to KINMARKING</a>.</p>';
    return editions.map(function (event) {
      var current = event.slug === currentSlug;
      return '<a class="kinmarking-edition-link' + (current ? ' is-current' : '') + '" href="' + eventHref(event.slug) + '"' + (current ? ' aria-current="page"' : '') + '>' +
        '<span>KINMARKING ' + escapeHtml(event.number) + '</span>' +
        '<strong>' + escapeHtml(event.title || event.fallbackTitle) + '</strong>' +
        '<small>' + escapeHtml(formatDate(event.startsAt)) + ' · ' + escapeHtml(stateLabel(event)) + '</small>' +
      '</a>';
    }).join("");
  }

  global.KinmarkingSeries = Object.freeze({
    editions:EDITIONS,
    editionLinksMarkup:editionLinksMarkup,
    eventHref:eventHref,
    escapeHtml:escapeHtml,
    formatDate:formatDate,
    isKinmarkingSlug:isKinmarkingSlug,
    orderedEvents:orderedEvents,
    stateLabel:stateLabel,
  });
})(window);
