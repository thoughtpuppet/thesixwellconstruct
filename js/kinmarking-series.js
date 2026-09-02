(function (global) {
  "use strict";

  var SERIES_SLUG = "kinmarking";
  var FALLBACKS = Object.freeze([
    {
      number:"01",
      slug:"kinmarking-01-skin-as-archive",
      title:"Skin As Archive",
      description:"KINMARKING 01: Skin As Archive is the first edition of KINMARKING, a participatory memory, archive, and tattoo practice. Participants are invited to bring photographs, documents, objects, stories, inherited symbols, and fragments of family history into conversation with an archivist and tattoo artist.",
    },
    { number:"02", slug:"kinmarking-02", title:"", description:"Theme to be announced." },
    { number:"03", slug:"kinmarking-03", title:"", description:"Theme to be announced." },
    { number:"04", slug:"kinmarking-04", title:"", description:"Theme to be announced." },
  ]);
  var TIME_ZONE = "America/New_York";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[character];
    });
  }

  function normalizedNumber(value, index) {
    var number = String(value || "").trim();
    return number || String(index + 1).padStart(2, "0");
  }

  function fallbackForNumber(number) {
    return FALLBACKS.find(function (item) { return item.number === number; }) || null;
  }

  function sessionNumberForSlug(slug) {
    var fallback = FALLBACKS.find(function (item) { return item.slug === String(slug || ""); });
    return fallback ? fallback.number : "";
  }

  function isKinmarkingSlug(slug) {
    return String(slug || "") === SERIES_SLUG || Boolean(sessionNumberForSlug(slug));
  }

  function editionTitle(event, occurrence, index) {
    var number = normalizedNumber(occurrence && occurrence.sessionNumber, Number(index) || 0);
    var fallback = fallbackForNumber(number);
    var sessionTitle = String((occurrence && occurrence.title) || (fallback && fallback.title) || "").trim();
    return "KINMARKING " + number + (sessionTitle ? ": " + sessionTitle : "");
  }

  function editionDescription(event, occurrence, index) {
    var number = normalizedNumber(occurrence && occurrence.sessionNumber, Number(index) || 0);
    var fallback = fallbackForNumber(number);
    if (fallback && fallback.description) {
      return number === "01" ? fallback.description : fallback.description + " A future edition of KINMARKING, a participatory memory, archive, and tattoo practice.";
    }
    return (event && event.description) || "A KINMARKING session.";
  }

  function editionHref(edition) {
    var fallback = fallbackForNumber(String(edition && edition.number || ""));
    if (fallback) return "/events/" + encodeURIComponent(fallback.slug) + "/";
    return "/events/kinmarking/?occurrence=" + encodeURIComponent(edition && edition.occurrenceId || "");
  }

  function orderedEvents(events) {
    var list = Array.isArray(events) ? events : [];
    var parent = list.find(function (event) { return event.slug === SERIES_SLUG; });
    if (parent) {
      return (Array.isArray(parent.occurrences) ? parent.occurrences : [])
        .slice()
        .sort(function (left, right) {
          return Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || new Date(left.startsAt) - new Date(right.startsAt);
        })
        .map(function (occurrence, index) {
          var number = normalizedNumber(occurrence.sessionNumber, index);
          return {
            number:number,
            occurrenceId:occurrence.id,
            title:editionTitle(parent, occurrence, index),
            description:editionDescription(parent, occurrence, index),
            startsAt:occurrence.startsAt,
            endsAt:occurrence.endsAt,
            location:occurrence.location || parent.location,
            status:occurrence.status,
            open:occurrence.open,
            publicationState:parent.publicationState,
            free:parent.free,
            parentEvent:parent,
            occurrence:occurrence,
          };
        });
    }

    var bySlug = new Map(list.map(function (event) { return [event.slug, event]; }));
    return FALLBACKS.map(function (fallback) {
      var event = bySlug.get(fallback.slug);
      return event ? Object.assign({}, event, {
        number:fallback.number,
        occurrenceId:event.occurrences && event.occurrences[0] ? event.occurrences[0].id : "",
        title:event.title,
      }) : null;
    }).filter(Boolean);
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

  function editionLinksMarkup(events, currentSlug, selectedOccurrence) {
    var editions = orderedEvents(events);
    if (!editions.length) return '<p class="kinmarking-empty">Edition records are temporarily unavailable. <a href="/events/kinmarking/">Return to KINMARKING</a>.</p>';
    var currentNumber = sessionNumberForSlug(currentSlug) || String(selectedOccurrence && selectedOccurrence.sessionNumber || "");
    return editions.map(function (edition) {
      var current = edition.number === currentNumber;
      return '<a class="kinmarking-edition-link' + (current ? ' is-current' : '') + '" href="' + editionHref(edition) + '"' + (current ? ' aria-current="page"' : '') + '>' +
        '<span>KINMARKING ' + escapeHtml(edition.number) + '</span>' +
        '<strong>' + escapeHtml(edition.title) + '</strong>' +
        '<small>' + escapeHtml(formatDate(edition.startsAt)) + ' · ' + escapeHtml(stateLabel(edition)) + '</small>' +
      '</a>';
    }).join("");
  }

  global.KinmarkingSeries = Object.freeze({
    editions:FALLBACKS,
    seriesSlug:SERIES_SLUG,
    editionDescription:editionDescription,
    editionHref:editionHref,
    editionLinksMarkup:editionLinksMarkup,
    editionTitle:editionTitle,
    escapeHtml:escapeHtml,
    formatDate:formatDate,
    isKinmarkingSlug:isKinmarkingSlug,
    orderedEvents:orderedEvents,
    sessionNumberForSlug:sessionNumberForSlug,
    stateLabel:stateLabel,
  });
})(window);
