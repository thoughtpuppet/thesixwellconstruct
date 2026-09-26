(function (global) {
  "use strict";

  var SERIES_SLUG = "kinmarking";
  var FALLBACKS = Object.freeze([
    {
      number:"01",
      slug:"kinmarking-01-skin-as-archive",
      title:"Skin As Archive",
      description: /* live-copy:kinmarking.01.description */ "KINMARKING 01: Skin As Archive is the first edition of KINMARKING, a participatory memory, archive, and tattoo practice. Participants are invited to bring photographs, documents, objects, stories, inherited symbols, and fragments of family history into conversation with an archivist and tattoo artist.",
    },
    {
      number:"02", slug:"kinmarking-02", title:"Color as Inheritance", theme:"Color",
      description: /* live-copy:kinmarking.02.description */ "Explore the meanings we inherit through color, from family and cultural traditions to personal associations. Through conversation and visual experimentation, develop palettes, shapes, and symbols into possibilities for tattooing.",
      details: /* live-copy:kinmarking.02.details */ "How did a color come to mean something to you? This edition follows color through textiles, objects, images, ceremonies, and everyday life. Consider the meanings you have received, the associations you have made yourself, and what you want to preserve or reinterpret in a tattoo.",
      guideTitle: /* live-copy:kinmarking.02.guide-title */ "Begin with a color.",
      guideIntro: /* live-copy:kinmarking.02.guide-intro */ "Arrive with a color, palette, reference, or curiosity. A personal association can be your starting point, and new connections can develop through the session.",
      bring: /* live-copy:kinmarking.02.bring */ "Bring one to three color references if you have them: a textile, photograph, object, palette, or image of something you are drawn to.",
      how: /* live-copy:kinmarking.02.how */ "Explore colors within particular histories and traditions, consider your own associations, and experiment with palettes and forms. Work with the tattoo artist to develop a design through color, shape, scale, and placement.",
    },
    {
      number:"03", slug:"kinmarking-03", title:"Symbols as Language", theme:"Symbolism",
      description: /* live-copy:kinmarking.03.description */ "Explore how symbols, badges, and visual signs communicate identity, belief, belonging, and personal history. Interpret inherited meanings and develop a visual language of your own through drawing and tattoo design.",
      details: /* live-copy:kinmarking.03.details */ "What does a symbol say, and who knows how to read it? This edition considers the signs we encounter, inherit, wear, and create. Explore how context changes their interpretation, what you want a mark to communicate, and how to preserve, combine, or transform those meanings in a tattoo.",
      guideTitle: /* live-copy:kinmarking.03.guide-title */ "Begin with a sign.",
      guideIntro: /* live-copy:kinmarking.03.guide-intro */ "Bring a symbol you recognize, wear, question, or want to understand. You can also begin with an idea or affiliation and discover its visual form through the session.",
      bring: /* live-copy:kinmarking.03.bring */ "Bring one to three references if you have them: a symbol, badge, pattern, piece of lettering, photograph, or object bearing a sign.",
      how: /* live-copy:kinmarking.03.how */ "Discuss symbols in their specific contexts, explore how you and others read them, and experiment with drawing, abstraction, and composition. Work with the tattoo artist to develop a mark that expresses what you want to communicate.",
    },
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
      return fallback.description;
    }
    return (event && event.description) || "A KINMARKING session.";
  }

  function copyAttributes(number, field) {
    var edition = fallbackForNumber(String(number || ""));
    if (!edition || !edition[field] || edition.number === "04") return "";
    var marker = "kinmarking." + edition.number + "." + field.replace(/[A-Z]/g, function (letter) { return "-" + letter.toLowerCase(); });
    return ' data-copy-id="' + marker + '" data-live-edit-owner="source-marker" data-live-edit-source="js/kinmarking-series.js" data-live-edit-marker="' + marker + '"';
  }

  function applyEditionCopy(element, number, field) {
    var edition = fallbackForNumber(String(number || ""));
    if (!element || !edition || !edition[field]) return;
    element.textContent = edition[field];
    var attributes = copyAttributes(number, field);
    attributes.replace(/([\w-]+)="([^"]*)"/g, function (_, name, value) { element.setAttribute(name, value); });
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
    applyEditionCopy:applyEditionCopy,
    copyAttributes:copyAttributes,
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
