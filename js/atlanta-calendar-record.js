(function () {
  "use strict";

  var SUBJECT_LABELS = { art:"Art", "art-making":"Art Making", film:"Film", "poetry-music":"Poetry / Music", technology:"Technology", ai:"AI", "creative-technology":"Creative Technology", anthropology:"Anthropology", engineering:"Engineering", philosophy:"Philosophy" };
  var FORMAT_LABELS = { exhibition:"Exhibitions / Art Openings", screening:"Screening", performance:"Performance", "experimental-event":"Experimental Event", "lecture-talk":"Lecture / Talk", panel:"Panel", workshop:"Workshop", conference:"Conference" };
  var AFFILIATION_LABELS = { gsu:"GSU Events" };
  var OCCURRENCE_LABELS = { opening_reception:"Opening Reception", closing_reception:"Closing Reception", artist_talk:"Artist Talk", mixer:"Mixer", screening:"Screening", performance:"Performance", workshop:"Workshop", panel:"Panel", lecture:"Lecture", other:"Related Program" };
  var SCHEDULE_LABELS = { postponed:"Postponed", rescheduled:"Rescheduled", cancelled:"Cancelled", moved_online:"Moved Online" };
  var TICKET_LABELS = { not_required:"No Ticket Required", not_yet_on_sale:"Tickets Not Yet On Sale", on_sale:"Tickets On Sale", sold_out:"Sold Out", registration_open:"Registration Open", registration_closed:"Registration Closed" };
  var TIME_ZONE = "America/New_York";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[character];
    });
  }

  function displayText(value) {
    var text = String(value == null ? "" : value).replace(/\\[rRnN]/g, " ");
    for (var pass = 0; pass < 2; pass += 1) {
      text = text
        .replace(/&amp;/gi, "&")
        .replace(/&lt;|&#0*60;|&#x0*3c;/gi, "<")
        .replace(/&gt;|&#0*62;|&#x0*3e;/gi, ">")
        .replace(/&quot;|&#0*34;|&#x0*22;/gi, '"')
        .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
        .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, " ");
    }
    return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function validDate(value) {
    var date = value ? new Date(value.length === 10 ? value + "T12:00:00" : value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function localParts(value) {
    var date = validDate(value);
    if (!date) return null;
    return new Intl.DateTimeFormat("en-US", { timeZone:TIME_ZONE, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(date).reduce(function (result, part) { result[part.type] = part.value; return result; }, {});
  }

  function dateKey(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return String(value);
    var parts = localParts(value);
    return parts ? parts.year + "-" + parts.month + "-" + parts.day : "";
  }

  function isOnViewExhibition(event) {
    var formats = Array.isArray(event.formats) ? event.formats : [];
    var spansMultipleDates = dateKey(event.startsAt) && dateKey(event.startsAt) !== dateKey(event.endsAt || event.startsAt);
    return event.eventStructure === "exhibition" || (formats.includes("exhibition") && spansMultipleDates);
  }

  function classificationEnd(event) {
    var start = validDate(event.startsAt);
    var end = validDate(event.endsAt) || validDate(event.confirmedThrough) || start;
    var isAmbiguousTimedRange = event.dateKind === "timed"
      && event.eventStructure === "single"
      && !event.isOccurrence
      && start
      && end
      && end.getTime() - start.getTime() > 86400000;
    return isAmbiguousTimedRange ? start : end;
  }

  function isPast(event, now) {
    var end = classificationEnd(event);
    var current = now instanceof Date ? now.getTime() : Number.isFinite(Number(now)) ? Number(now) : Date.now();
    return end ? end.getTime() < current : false;
  }

  function eventDate(event) {
    if (event.dateKind === "all_day") return new Intl.DateTimeFormat("en-US", { weekday:"short", month:"short", day:"numeric", year:"numeric", timeZone:"UTC" }).format(new Date(event.startsAt + "T12:00:00Z"));
    if (event.dateKind === "date_range" || isOnViewExhibition(event)) {
      var start = new Date(dateKey(event.startsAt) + "T12:00:00Z");
      var dateFormatter = new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric", timeZone:"UTC" });
      if (!event.endsAt && event.confirmedThrough) {
        var confirmed = new Date(dateKey(event.confirmedThrough) + "T12:00:00Z");
        return "On view from " + dateFormatter.format(start) + " / confirmed through " + dateFormatter.format(confirmed) + " / closing date TBA";
      }
      var end = new Date(dateKey(event.endsAt || event.startsAt) + "T12:00:00Z");
      return dateFormatter.format(start) + " - " + dateFormatter.format(end);
    }
    var startDate = validDate(event.startsAt);
    if (!startDate) return "Date unavailable";
    var endDate = validDate(event.endsAt);
    var fullFormatter = new Intl.DateTimeFormat("en-US", { weekday:"short", month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", timeZone:TIME_ZONE });
    var startLabel = fullFormatter.format(startDate);
    if (!endDate) return startLabel;
    if (dateKey(event.startsAt) === dateKey(event.endsAt)) {
      return startLabel + " - " + new Intl.DateTimeFormat("en-US", { hour:"numeric", minute:"2-digit", timeZone:TIME_ZONE }).format(endDate);
    }
    return startLabel + " - " + fullFormatter.format(endDate);
  }

  function eventAnchor(event) {
    return "event-" + String(event.id || "").replace(/[^a-z0-9_-]+/gi, "-");
  }

  function normalizedLabel(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function calendarDayDifference(fromKey, toKey) {
    var from = /^\d{4}-\d{2}-\d{2}$/.test(fromKey) ? new Date(fromKey + "T12:00:00Z") : null;
    var to = /^\d{4}-\d{2}-\d{2}$/.test(toKey) ? new Date(toKey + "T12:00:00Z") : null;
    return from && to ? Math.round((to.getTime() - from.getTime()) / 86400000) : null;
  }

  function relativeDateCue(event) {
    var todayKey = dateKey(new Date().toISOString());
    var startKey = dateKey(event.startsAt);
    var endKey = dateKey(event.endsAt || event.confirmedThrough || event.startsAt);
    if (!todayKey || !startKey) return "";
    var startDifference = calendarDayDifference(todayKey, startKey);
    var endDifference = calendarDayDifference(todayKey, endKey);
    if (isOnViewExhibition(event) && startDifference <= 0 && endDifference >= 0 && endDifference <= 7) {
      if (endDifference === 0) return "Ends today";
      if (endDifference === 1) return "Ends tomorrow";
      return "Ends " + new Intl.DateTimeFormat("en-US", { weekday:"long", timeZone:"UTC" }).format(new Date(endKey + "T12:00:00Z"));
    }
    if (startDifference === 0) return "Today";
    if (startDifference === 1) return "Tomorrow";
    var today = new Date(todayKey + "T12:00:00Z");
    var start = new Date(startKey + "T12:00:00Z");
    var daysUntilSunday = (7 - today.getUTCDay()) % 7;
    if (startDifference > 1 && startDifference <= daysUntilSunday && [0,6].includes(start.getUTCDay())) return "This weekend";
    return "";
  }

  function ticketCardNote(event, ticketLabel) {
    var parts = [];
    var ticketClosed = ["sold_out","registration_closed"].includes(event.ticketStatus);
    if (ticketLabel && !ticketClosed) parts.push(ticketLabel);
    var onSaleDate = validDate(event.ticketOnSaleAt);
    if (onSaleDate && onSaleDate.getTime() > Date.now()) parts.push("On sale " + eventDate({ startsAt:event.ticketOnSaleAt, dateKind:"timed" }));
    var note = String(event.ticketNotes || "").trim();
    var duplicateLabels = [ticketLabel].concat(parts).map(normalizedLabel).filter(Boolean);
    if (note && !duplicateLabels.includes(normalizedLabel(note))) parts.push(note);
    return parts.join(" / ");
  }

  function mapDestination(event) {
    var planning = event.planning || {};
    var hasLatitude = planning.latitude !== null && planning.latitude !== undefined && planning.latitude !== "";
    var hasLongitude = planning.longitude !== null && planning.longitude !== undefined && planning.longitude !== "";
    if (hasLatitude && hasLongitude && Number.isFinite(Number(planning.latitude)) && Number.isFinite(Number(planning.longitude))) {
      return Number(planning.latitude) + "," + Number(planning.longitude);
    }
    return [event.venueName, event.venueAddress].filter(Boolean).join(", ");
  }

  function addressFact(event, expanded) {
    if (event.locationDisclosure === "after_registration") {
      return '<span><strong>location:</strong> Location revealed after registration</span>';
    }
    var address = String(event.venueAddress || "").trim();
    var venue = String(event.venueName || "").trim();
    var movedOnline = event.scheduleStatus === "moved_online";
    var isPhysicalAddress = address && normalizedLabel(address) !== normalizedLabel(venue) && !event.virtual && !movedOnline;
    if (!address || normalizedLabel(address) === normalizedLabel(venue)) return "";
    if (!isPhysicalAddress) return '<span>' + escapeHtml(address) + '</span>';
    var destination = encodeURIComponent(mapDestination(event));
    if (expanded) return '<div class="calendar-map-choices is-expanded"><span class="calendar-map-address">' + escapeHtml(address) + '</span>' +
      '<div><a href="https://www.google.com/maps/dir/?api=1&amp;destination=' + destination + '" target="_blank" rel="noopener noreferrer">Google Maps</a>' +
      '<a href="https://maps.apple.com/?daddr=' + destination + '&amp;dirflg=d" target="_blank" rel="noopener noreferrer">Apple Maps</a></div></div>';
    return '<details class="calendar-map-choices"><summary>' + escapeHtml(address) + '</summary>' +
      '<div><a href="https://www.google.com/maps/dir/?api=1&amp;destination=' + destination + '" target="_blank" rel="noopener noreferrer">Google Maps</a>' +
      '<a href="https://maps.apple.com/?daddr=' + destination + '&amp;dirflg=d" target="_blank" rel="noopener noreferrer">Apple Maps</a></div></details>';
  }

  function tagList(labels, expanded) {
    if (expanded) return '<div class="calendar-tags">' + labels.map(function (label) { return '<span class="calendar-tag">' + escapeHtml(label) + '</span>'; }).join("") + '</div>';
    var visible = labels.slice(0, 3);
    var hidden = labels.slice(3);
    return '<div class="calendar-tags">' +
      visible.map(function (label) { return '<span class="calendar-tag">' + escapeHtml(label) + '</span>'; }).join("") +
      hidden.map(function (label) { return '<span class="calendar-tag is-extra" hidden>' + escapeHtml(label) + '</span>'; }).join("") +
      (hidden.length ? '<button class="calendar-tag-toggle" type="button" data-tag-toggle aria-expanded="false">+' + hidden.length + ' more</button>' : '') +
      '</div>';
  }

  function relatedDisclosure(event, creditedLink, expanded) {
    var relatedOccurrences = Array.isArray(event.relatedOccurrences) ? event.relatedOccurrences : [];
    var relatedLinks = Array.isArray(event.relatedLinks) ? event.relatedLinks : [];
    var artistLinks = relatedLinks.filter(function (link) { return link.role === "artist"; });
    var participantLinks = relatedLinks.filter(function (link) { return link.role === "participant"; });
    var organizerLinks = relatedLinks.filter(function (link) { return link.role === "organizer"; });
    var otherRelatedLinks = relatedLinks.filter(function (link) { return !["artist","participant","organizer"].includes(link.role); });
    var peopleCount = artistLinks.length + participantLinks.length + organizerLinks.length + otherRelatedLinks.length;
    var scheduleContent = relatedOccurrences.map(function (occurrence) {
      var href = occurrence.detailUrl || ("#" + eventAnchor(occurrence));
      var programItems = Array.isArray(occurrence.programItems) ? occurrence.programItems : [];
      return '<a href="' + escapeHtml(href) + '"' + (occurrence.detailUrl ? ' data-calendar-detail-link' : '') + '><strong>' + escapeHtml(occurrence.occurrenceLabel || occurrence.title) + '</strong><small>' + escapeHtml(eventDate(occurrence)) + '</small>' + (programItems.length ? '<small>' + escapeHtml(programItems.map(function(item){return item.title;}).filter(Boolean).join(" / ")) + '</small>' : '') + '</a>';
    }).join("");
    var peopleContent =
      (artistLinks.length ? '<div class="calendar-related-links calendar-artist-links"><span>Artists</span>' + artistLinks.map(creditedLink).join("") + '</div>' : '') +
      (participantLinks.length ? '<div class="calendar-related-links"><span>Participants</span>' + participantLinks.map(creditedLink).join("") + '</div>' : '') +
      (organizerLinks.length ? '<div class="calendar-related-links"><span>Additional organizers</span>' + organizerLinks.map(creditedLink).join("") + '</div>' : '') +
      (otherRelatedLinks.length ? '<div class="calendar-related-links"><span>Related</span>' + otherRelatedLinks.map(creditedLink).join("") + '</div>' : '');
    var schedule = relatedOccurrences.length ? (expanded
      ? '<section class="calendar-event-detail-section"><h2>Related schedule</h2><div class="calendar-disclosure-content calendar-related-schedule">' + scheduleContent + '</div></section>'
      : '<details class="calendar-event-disclosure"><summary>Related schedule (' + relatedOccurrences.length + ')</summary><div class="calendar-disclosure-content calendar-related-schedule">' + scheduleContent + '</div></details>') : '';
    var people = peopleCount ? (expanded
      ? '<section class="calendar-event-detail-section"><h2>People + related</h2><div class="calendar-disclosure-content">' + peopleContent + '</div></section>'
      : '<details class="calendar-event-disclosure"><summary>People + related (' + peopleCount + ')</summary><div class="calendar-disclosure-content">' + peopleContent + '</div></details>') : '';
    return schedule + people;
  }

  function eventMedia(event) {
    var flyer = event.flyer && event.flyer.url ? event.flyer : null;
    var media = Array.isArray(event.media) ? event.media.slice() : [];
    if (flyer && !media.some(function (item) { return item && item.url === flyer.url; })) media.unshift(flyer);
    return media;
  }

  function renderEvent(event, options) {
    options = options || {};
    var headingTag = options.headingTag === "h1" ? "h1" : "h3";
    var includeViewEvent = options.includeViewEvent !== false;
    var primarySubject = (event.subjects || [])[0] || "";
    var labels = (event.subjects || []).map(function (value) { return SUBJECT_LABELS[value] || value; })
      .concat((event.formats || []).map(function (value) { return FORMAT_LABELS[value] || value; }), (event.affiliations || []).map(function (value) { return AFFILIATION_LABELS[value] || value; }), event.collectionKind === "festival" ? ["Festival"] : [], event.collectionRelation === "preview" ? ["Festival Preview"] : event.collectionRelation === "related_event" ? ["Festival Related"] : [], event.virtual ? ["Virtual"] : []);
    var sourceLabel = event.origin === "sixwell" ? "Six.Well event" : (event.affiliations || []).includes("gsu") ? "Georgia State University event" : "";
    function creditedLink(link) { return '<a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(link.label) + (link.creditRole ? ' / ' + escapeHtml(link.creditRole) : '') + '</a>'; }
    var media = eventMedia(event);
    var galleryKey = eventAnchor(event);
    var accessNote = event.accessStatus === "restricted" ? (event.accessNotes || "Attendance is restricted. Check the official details for eligibility.") : "";
    var scheduleLabel = SCHEDULE_LABELS[event.scheduleStatus] || "";
    var ticketLabel = TICKET_LABELS[event.ticketStatus] || "";
    var ticketNote = ticketCardNote(event, ticketLabel);
    var officialUrl = event.sourceUrl || event.actionUrl || event.ticketUrl || "";
    var scheduleState = scheduleLabel || (event.status === "cancelled" ? "Cancelled" : "");
    var ticketState = ["sold_out","registration_closed"].includes(event.ticketStatus) ? ticketLabel : "";
    var statusLabels = [scheduleState, ticketState].filter(function (value, index, list) { return value && list.indexOf(value) === index; });
    var descriptionId = eventAnchor(event) + "-description";
    var cleanDescription = displayText(event.description);
    var descriptionClass = options.detail ? "hero-descriptor calendar-event-description" : "calendar-event-description is-collapsed";
    var descriptionToggle = options.detail ? '' : '<button class="calendar-description-toggle" type="button" data-description-toggle aria-controls="' + descriptionId + '" aria-expanded="false" hidden>See more</button>';
    var description = cleanDescription ? '<p class="' + descriptionClass + '" id="' + descriptionId + '">' + escapeHtml(cleanDescription) + '</p>' + descriptionToggle : '';
    var planningNote = String((event.planning || {}).notes || "").trim();
    var parent = event.isOccurrence ? '<p class="calendar-event-series">Part of / ' + (event.parentDetailUrl ? '<a href="' + escapeHtml(event.parentDetailUrl) + '" data-calendar-detail-link>' + escapeHtml(event.parentTitle) + '</a>' : escapeHtml(event.parentTitle)) + ' / ' + escapeHtml(OCCURRENCE_LABELS[event.occurrenceType] || "Related Program") + '</p>' : '';
    var viewAction = includeViewEvent && event.detailUrl ? '<a href="' + escapeHtml(event.detailUrl) + '" data-calendar-detail-link>View event</a>' : '';
    var officialAction = officialUrl ? '<a href="' + escapeHtml(officialUrl) + '">Official details</a>' : '';
    var ticketAction = event.ticketUrl ? '<a href="' + escapeHtml(event.ticketUrl) + '">Tickets / Register</a>' : '';
    var classes = 'calendar-event-card' + (options.detail ? ' calendar-event-detail-record' : '') + (event.status === "cancelled" ? ' is-cancelled' : '');
    var cardHref = includeViewEvent && event.detailUrl ? event.detailUrl : '';
    var cardHrefAttribute = cardHref ? ' data-calendar-card-href="' + escapeHtml(cardHref) + '"' : '';
    var flyerUrl = event.flyer && event.flyer.url ? event.flyer.url : '';
    var mediaMarkup = media.map(function (item, index) {
      var flyerClass = flyerUrl && item.url === flyerUrl ? ' class="is-flyer"' : '';
      return '<button type="button"' + flyerClass + ' data-gallery-event="' + escapeHtml(galleryKey) + '" data-gallery-index="' + index + '" aria-label="View ' + escapeHtml(item.altText || event.title + ' event image') + '"><img src="' + escapeHtml(item.url) + '" alt="' + escapeHtml(item.altText || event.title + ' event image') + '" loading="lazy" decoding="async"' + (item.width ? ' width="' + Number(item.width) + '"' : '') + (item.height ? ' height="' + Number(item.height) + '"' : '') + '>' + (item.caption ? '<span>' + escapeHtml(item.caption) + '</span>' : '') + '</button>';
    }).join("");
    var mediaLabel = flyerUrl ? (media.length > 1 ? "Flyer + media" : "Event flyer") : "Event media";
    var mediaSection = media.length ? (options.detail
      ? '<section class="calendar-event-detail-section calendar-event-detail-media"><h2>' + mediaLabel + '</h2><div class="calendar-media-grid">' + mediaMarkup + '</div></section>'
      : '<details class="calendar-event-media"><summary>View media (' + media.length + ')</summary><div class="calendar-media-grid">' + mediaMarkup + '</div></details>') : '';
    return '<article class="' + classes + '" id="' + eventAnchor(event) + '" data-subject="' + escapeHtml(primarySubject) + '"' + cardHrefAttribute + '>' +
      '<p class="calendar-event-meta">' + escapeHtml([relativeDateCue(event), eventDate(event)].filter(Boolean).join(" / ")) + '</p>' +
      (statusLabels.length ? '<p class="calendar-event-status">' + escapeHtml(statusLabels.join(" / ")) + '</p>' : '') +
      parent +
      '<' + headingTag + (options.detail ? ' class="venture-title hero-title"' : '') + '>' + escapeHtml(event.title) + '</' + headingTag + '>' +
      (accessNote ? '<p class="calendar-event-access"><strong>Access / </strong>' + escapeHtml(accessNote) + '</p>' : '') +
      (ticketNote ? '<p class="calendar-event-ticket"><strong>Tickets / </strong>' + escapeHtml(ticketNote) + '</p>' : '') +
      (event.visitingHoursLabel ? '<p class="calendar-event-hours"><strong>Gallery hours / </strong>' + escapeHtml(event.visitingHoursLabel) + (event.visitingHoursNote ? ' / ' + escapeHtml(event.visitingHoursNote) : '') + '</p>' : '') +
      description +
      (planningNote ? '<p class="calendar-event-planning"><strong>Visitor info / </strong>' + escapeHtml(planningNote) + '</p>' : '') +
      '<div class="calendar-event-facts">' +
        (event.organizer ? '<span><strong>organizer:</strong> ' + escapeHtml(event.organizer) + '</span>' : '') +
        (event.venueName ? '<span><strong>venue:</strong> ' + escapeHtml(event.venueName) + '</span>' : '') +
        addressFact(event, options.detail) +
        (sourceLabel ? '<span class="calendar-event-source">' + escapeHtml(sourceLabel) + '</span>' : '') +
      '</div>' +
      tagList(labels, options.detail) +
      relatedDisclosure(event, creditedLink, options.detail) +
      mediaSection +
      '<div class="calendar-event-actions">' + viewAction + officialAction + ticketAction + '<a class="is-secondary" href="/api/calendar/events/' + encodeURIComponent(event.id) + '.ics">Save date</a><button class="is-secondary" type="button" data-share-event data-share-title="' + escapeHtml(event.title) + '" data-share-url="' + escapeHtml(event.detailUrl || "") + '">Share</button></div>' +
      '</article>';
  }

  window.AtlantaCalendarRecord = {
    displayText:displayText,
    escapeHtml:escapeHtml,
    eventAnchor:eventAnchor,
    eventDate:eventDate,
    eventMedia:eventMedia,
    classificationEnd:classificationEnd,
    isPast:isPast,
    renderEvent:renderEvent,
  };
})();
