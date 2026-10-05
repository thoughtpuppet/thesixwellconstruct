(function (global) {
  "use strict";

  var SERIES_SLUG = "kinmarking";
  var FALLBACKS = Object.freeze([
    {
      number:"01",
      slug:"kinmarking-01-oral-histories-and-tattooing",
      legacySlug:"kinmarking-01-skin-as-archive",
      title:"Oral Histories & Tattooing",
      previousTitle:"Skin As Archive",
      description: /* live-copy:kinmarking.01.description */ "The first edition of KINMARKING explores how meaning persists through oral stories, storytelling, and listening, and how what emerges might be expressed through an image or tattoo.",
      details: /* live-copy:kinmarking.01.details */ "The first edition of KINMARKING explores how meaning persists through telling and listening: experiences we remember, stories passed down to us, and everyday moments that reveal how someone lived.\n\nTogether, we consider what these stories hold, how their meanings change over time, and what we might want to preserve or express through visual symbols. Tattooing offers one way to embody what emerges, using symbolism, color, and composition.\n\nWhat can a mark hold of a person or experience? What might change or be left out when a story becomes a symbol? These questions are part of the exploration.\n\nCome with a story, a memory, or something you want to think about more closely. You are welcome to bring a photograph or object that supports it. Sharing is voluntary, and participation does not require getting tattooed.",
      guideTitle: /* live-copy:kinmarking.01.guide-title */ "Begin with a story.",
      guideIntro: /* live-copy:kinmarking.01.guide-intro */ "A memory, a story passed down to you, or a question is enough to begin. The gathering centers storytelling and listening, with photographs and objects optional as supporting material.",
      bring: /* live-copy:kinmarking.01.bring */ "Come with a story, a memory, or something you want to think about more closely. No physical materials or finished tattoo design are required.",
      bringSharing: /* live-copy:kinmarking.01.bring-sharing */ "Sharing is voluntary. Listening is also a way to participate.",
      bringSupport: /* live-copy:kinmarking.01.bring-support */ "Photographs and objects can support your story if you choose to bring them.",
      how: /* live-copy:kinmarking.01.how */ "Begin with telling and listening. With the participating memory workers and tattoo artist, consider what a story holds, how its meanings connect to personal and cultural histories, and what might change when it becomes an image. The format is developing through collaboration.",
      outcomes: /* live-copy:kinmarking.01.outcomes */ "Conversation, new associations, and questions worth exploring are meaningful outcomes. An image or tattoo may emerge from the process. Participation does not require getting tattooed.",
      readinessTitle: /* live-copy:kinmarking.01.readiness-title */ "Considering a tattoo?",
      readiness: /* live-copy:kinmarking.01.readiness */ "Tattooing is optional, and any tattoo appointment is separate from participation in the gathering. Practical arrangements will be shared as they are confirmed.",
      participationTitle: /* live-copy:kinmarking.01.participation-title */ "Participation + updates",
      participation: /* live-copy:kinmarking.01.participation */ "Registration details and the final gathering format will be shared when confirmed. You can participate through listening, and you decide what you wish to share. An RSVP does not reserve a tattoo appointment.",
      processKicker: /* live-copy:kinmarking.01.process-kicker */ "the inquiry",
      processTitle: /* live-copy:kinmarking.01.process-title */ "Questions for the gathering.",
      processIntro: /* live-copy:kinmarking.01.process-intro */ "Storytelling and listening open these connected areas of inquiry. The session format is developing with the participating memory workers.",
      encounterTitle: /* live-copy:kinmarking.01.encounter-title */ "Remember & Tell.",
      encounterCopy: /* live-copy:kinmarking.01.encounter-copy */ "What do you remember, and which stories have been passed down to you? Everyday moments, habits, sayings, and gestures can reveal how someone lived. Share what you choose, or begin by listening.",
      interpretTitle: /* live-copy:kinmarking.01.interpret-title */ "Listen & Connect.",
      interpretCopy: /* live-copy:kinmarking.01.interpret-copy */ "What becomes visible when we listen to one another? Consider how a personal memory connects to other experiences, cultural traditions, and larger histories.",
      composeTitle: /* live-copy:kinmarking.01.compose-title */ "Interpret & Question.",
      composeCopy: /* live-copy:kinmarking.01.compose-copy */ "What feels worth preserving, and why? Explore how a story changes through retelling, what remains uncertain, and what might be simplified or left out when it becomes a symbol.",
      developTitle: /* live-copy:kinmarking.01.develop-title */ "Imagine & Embody.",
      developCopy: /* live-copy:kinmarking.01.develop-copy */ "How might an image express what a story holds? Consider symbolism, color, and composition, and whether tattooing could become a way to embody that meaning. Questions and discoveries can remain open.",
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
    var fallback = FALLBACKS.find(function (item) { return item.slug === String(slug || "") || item.legacySlug === String(slug || ""); });
    return fallback ? fallback.number : "";
  }

  function isKinmarkingSlug(slug) {
    return String(slug || "") === SERIES_SLUG || Boolean(sessionNumberForSlug(slug));
  }

  function editionTitle(event, occurrence, index) {
    var number = normalizedNumber(occurrence && occurrence.sessionNumber, Number(index) || 0);
    var fallback = fallbackForNumber(number);
    var sessionTitle = String((occurrence && occurrence.title) || (fallback && fallback.title) || "").trim();
    // Use the renamed edition while an existing Event record still has its old title.
    // Other Studio titles remain authoritative, including future editorial changes.
    if (fallback && sessionTitle === fallback.previousTitle) sessionTitle = fallback.title;
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
      var event = bySlug.get(fallback.slug) || bySlug.get(fallback.legacySlug);
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
