(function () {
  "use strict";

  var SUBJECT_LABELS = { art:"Art", "art-making":"Art Making", film:"Film", "poetry-music":"Poetry / Music", technology:"Technology", ai:"AI", "creative-technology":"Creative Technology", anthropology:"Anthropology", engineering:"Engineering", philosophy:"Philosophy" };
  var FORMAT_LABELS = { exhibition:"Exhibitions / Art Openings", screening:"Screening", performance:"Performance", "experimental-event":"Experimental Event", "lecture-talk":"Lecture / Talk", panel:"Panel", workshop:"Workshop", conference:"Conference" };
  var AFFILIATION_LABELS = { gsu:"GSU Events" };
  var MODE_LABELS = { virtual:"Virtual" };
  var OCCURRENCE_LABELS = { opening_reception:"Opening Reception", artist_talk:"Artist Talk", mixer:"Mixer", screening:"Screening", performance:"Performance", workshop:"Workshop", panel:"Panel", lecture:"Lecture", other:"Related Program" };
  var SCHEDULE_LABELS = { postponed:"Postponed", rescheduled:"Rescheduled", cancelled:"Cancelled", moved_online:"Moved Online" };
  var TICKET_LABELS = { not_required:"No Ticket Required", not_yet_on_sale:"Tickets Not Yet On Sale", on_sale:"Tickets On Sale", sold_out:"Sold Out", registration_open:"Registration Open", registration_closed:"Registration Closed" };
  var TIME_ZONE = "America/New_York";
  var allEvents = [];
  var filtered = [];
  var activeView = "upcoming";
  var viewBuckets = { upcoming:[], onView:[], past:[] };
  var currentMonthName = "";
  var activeMonth = new Date();
  var selectedDate = "";
  var descriptionSyncFrame = 0;
  var galleryEvents = {};
  var activeGallery = null;
  var RETURN_STATE_KEY = "atlanta-calendar-return-state-v1";
  activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1);

  var search = document.getElementById("calendarSearch");
  var subjectRoot = document.getElementById("subjectFilters");
  var formatRoot = document.getElementById("formatFilters");
  var affiliationRoot = document.getElementById("affiliationFilters");
  var modeRoot = document.getElementById("modeFilters");
  var resultCount = document.getElementById("resultCount");
  var onViewSection = document.getElementById("on-view");
  var onViewTitle = document.getElementById("on-view-title");
  var onViewRoot = document.getElementById("onViewEvents");
  var upcomingRoot = document.getElementById("upcomingEvents");
  var pastRoot = document.getElementById("pastEvents");
  var grid = document.getElementById("calendarGrid");
  var agenda = document.getElementById("dayAgenda");
  var monthLabel = document.getElementById("monthLabel");
  var filterPanel = document.getElementById("calendarFilterPanel");
  var filterToggle = document.getElementById("toggleFilters");
  var filterCount = document.getElementById("activeFilterCount");
  var clearFilters = document.getElementById("clearFilters");
  var viewButtons = Array.from(document.querySelectorAll("[data-calendar-view]"));
  var viewPanels = Array.from(document.querySelectorAll(".calendar-view-panel"));
  var pastDisclosure = document.getElementById("pastEventsDisclosure");
  var pastEventCount = document.getElementById("pastEventCount");

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

  function eventDate(event) {
    if (event.dateKind === "all_day") return new Intl.DateTimeFormat("en-US", { weekday:"short", month:"short", day:"numeric", year:"numeric", timeZone:"UTC" }).format(new Date(event.startsAt + "T12:00:00Z"));
    if (event.dateKind === "date_range" || isOnViewExhibition(event)) {
      var start = new Date(dateKey(event.startsAt) + "T12:00:00Z");
      var end = new Date(dateKey(event.endsAt || event.startsAt) + "T12:00:00Z");
      return new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric", timeZone:"UTC" }).format(start) + " - " + new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric", timeZone:"UTC" }).format(end);
    }
    var startDate = validDate(event.startsAt);
    if (!startDate) return "Date unavailable";
    var endDate = validDate(event.endsAt);
    var fullFormatter = new Intl.DateTimeFormat("en-US", { weekday:"short", month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit", timeZone:TIME_ZONE });
    var startLabel = fullFormatter.format(startDate);
    if (!endDate) return startLabel;
    if (dateKey(event.startsAt) === dateKey(event.endsAt)) {
      var timeFormatter = new Intl.DateTimeFormat("en-US", { hour:"numeric", minute:"2-digit", timeZone:TIME_ZONE });
      return startLabel + " - " + timeFormatter.format(endDate);
    }
    return startLabel + " - " + fullFormatter.format(endDate);
  }

  function isPast(event) {
    var end = validDate(event.endsAt) || validDate(event.startsAt);
    return end ? end.getTime() < Date.now() : false;
  }

  function checkedValues(root) {
    return Array.from(root.querySelectorAll("input:checked")).map(function (input) { return input.value; });
  }

  function eventAnchor(event) { return "event-" + String(event.id || "").replace(/[^a-z0-9_-]+/gi, "-"); }

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
    var endKey = dateKey(event.endsAt || event.startsAt);
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

  function addressFact(event) {
    var address = String(event.venueAddress || "").trim();
    var venue = String(event.venueName || "").trim();
    var movedOnline = event.scheduleStatus === "moved_online";
    var isPhysicalAddress = address && normalizedLabel(address) !== normalizedLabel(venue) && !event.virtual && !movedOnline;
    if (!address || normalizedLabel(address) === normalizedLabel(venue)) return "";
    if (!isPhysicalAddress) return '<span>' + escapeHtml(address) + '</span>';
    var destination = encodeURIComponent(mapDestination(event));
    var googleUrl = "https://www.google.com/maps/dir/?api=1&destination=" + destination;
    var appleUrl = "https://maps.apple.com/?daddr=" + destination + "&dirflg=d";
    return '<details class="calendar-map-choices"><summary>' + escapeHtml(address) + '</summary>' +
      '<div><a href="' + escapeHtml(googleUrl) + '" target="_blank" rel="noopener noreferrer">Google Maps</a>' +
      '<a href="' + escapeHtml(appleUrl) + '" target="_blank" rel="noopener noreferrer">Apple Maps</a></div></details>';
  }

  function tagList(labels) {
    var visible = labels.slice(0, 3);
    var hidden = labels.slice(3);
    return '<div class="calendar-tags">' +
      visible.map(function (label) { return '<span class="calendar-tag">' + escapeHtml(label) + '</span>'; }).join("") +
      hidden.map(function (label) { return '<span class="calendar-tag is-extra" hidden>' + escapeHtml(label) + '</span>'; }).join("") +
      (hidden.length ? '<button class="calendar-tag-toggle" type="button" data-tag-toggle aria-expanded="false">+' + hidden.length + ' more</button>' : '') +
      '</div>';
  }

  function relatedDisclosure(relatedOccurrences, artistLinks, participantLinks, organizerLinks, otherRelatedLinks, creditedLink) {
    var peopleCount = artistLinks.length + participantLinks.length + organizerLinks.length + otherRelatedLinks.length;
    var schedule = relatedOccurrences.length ? '<details class="calendar-event-disclosure"><summary>Related schedule (' + relatedOccurrences.length + ')</summary><div class="calendar-disclosure-content calendar-related-schedule">' + relatedOccurrences.map(function (occurrence) { return '<a href="#' + eventAnchor(occurrence) + '"><strong>' + escapeHtml(occurrence.occurrenceLabel || occurrence.title) + '</strong><small>' + escapeHtml(eventDate(occurrence)) + '</small></a>'; }).join("") + '</div></details>' : '';
    var people = peopleCount ? '<details class="calendar-event-disclosure"><summary>People + related (' + peopleCount + ')</summary><div class="calendar-disclosure-content">' +
      (artistLinks.length ? '<div class="calendar-related-links calendar-artist-links"><span>Artists</span>' + artistLinks.map(creditedLink).join("") + '</div>' : '') +
      (participantLinks.length ? '<div class="calendar-related-links"><span>Participants</span>' + participantLinks.map(creditedLink).join("") + '</div>' : '') +
      (organizerLinks.length ? '<div class="calendar-related-links"><span>Additional organizers</span>' + organizerLinks.map(creditedLink).join("") + '</div>' : '') +
      (otherRelatedLinks.length ? '<div class="calendar-related-links"><span>Related</span>' + otherRelatedLinks.map(creditedLink).join("") + '</div>' : '') +
      '</div></details>' : '';
    return schedule + people;
  }

  function syncDescriptionToggles() {
    Array.from(document.querySelectorAll(".calendar-event-description")).forEach(function (description) {
      var control = document.querySelector('[data-description-toggle][aria-controls="' + description.id + '"]');
      if (!control) return;
      if (control.getAttribute("aria-expanded") === "true") {
        control.hidden = false;
        return;
      }
      description.classList.add("is-collapsed");
      control.hidden = !(description.scrollHeight > description.clientHeight + 1);
    });
  }

  function scheduleDescriptionSync() {
    if (descriptionSyncFrame) cancelAnimationFrame(descriptionSyncFrame);
    descriptionSyncFrame = requestAnimationFrame(function () {
      descriptionSyncFrame = 0;
      syncDescriptionToggles();
    });
  }

  function renderFilters(root, labels, name) {
    root.innerHTML = Object.keys(labels).map(function (value) {
      return '<label class="filter-chip"><input type="checkbox" name="' + name + '" value="' + escapeHtml(value) + '"><span>' + escapeHtml(labels[value]) + '</span></label>';
    }).join("");
  }

  function matches(event) {
    var query = search.value.trim().toLowerCase();
    var subjects = checkedValues(subjectRoot);
    var formats = checkedValues(formatRoot);
    var affiliations = checkedValues(affiliationRoot);
    var modes = checkedValues(modeRoot);
    if (subjects.length && !subjects.some(function (value) { return event.subjects.includes(value); })) return false;
    if (formats.length && !formats.some(function (value) { return event.formats.includes(value); })) return false;
    if (affiliations.length && !affiliations.some(function (value) { return (event.affiliations || []).includes(value); })) return false;
    if (modes.includes("virtual") && !event.virtual) return false;
    if (query) {
      var relatedSearch = (event.relatedLinks || []).reduce(function (values, link) { return values.concat([link.label, link.url, link.role, link.creditRole]); }, []);
      var occurrenceSearch = (event.relatedOccurrences || []).reduce(function (values, occurrence) { return values.concat([occurrence.title, occurrence.occurrenceLabel, occurrence.startsAt]); }, []);
      var haystack = [event.title, event.description, event.organizer, event.venueName, event.venueAddress, event.accessNotes, event.ticketNotes].concat(event.audiences || [], event.subjects, event.formats, relatedSearch, occurrenceSearch).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  function legacyEventCard(event) {
    var primarySubject = event.subjects[0] || "";
    var labels = event.subjects.map(function (value) { return SUBJECT_LABELS[value] || value; }).concat(event.formats.map(function (value) { return FORMAT_LABELS[value] || value; }), (event.affiliations || []).map(function (value) { return AFFILIATION_LABELS[value] || value; }), event.virtual ? [MODE_LABELS.virtual] : []);
    var sourceLabel = event.origin === "sixwell" ? "Six.Well event" : (event.affiliations || []).includes("gsu") ? "Georgia State University event" : "";
    var relatedLinks = Array.isArray(event.relatedLinks) ? event.relatedLinks : [];
    var artistLinks = relatedLinks.filter(function (link) { return link.role === "artist"; });
    var participantLinks = relatedLinks.filter(function (link) { return link.role === "participant"; });
    var organizerLinks = relatedLinks.filter(function (link) { return link.role === "organizer"; });
    var otherRelatedLinks = relatedLinks.filter(function (link) { return !["artist","participant","organizer"].includes(link.role); });
    function creditedLink(link) { return '<a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(link.label) + (link.creditRole ? ' / ' + link.creditRole : '') + '</a>'; }
    var relatedOccurrences = Array.isArray(event.relatedOccurrences) ? event.relatedOccurrences : [];
    var flyer = event.flyer && event.flyer.url ? event.flyer : null;
    var media = Array.isArray(event.media) && event.media.length ? event.media : (flyer ? [flyer] : []);
    var galleryKey = eventAnchor(event);
    galleryEvents[galleryKey] = { title:event.title, media:media };
    var accessNote = event.accessStatus === "restricted" ? (event.accessNotes || "Attendance is restricted. Check the official details for eligibility.") : "";
    var scheduleLabel = SCHEDULE_LABELS[event.scheduleStatus] || "";
    var ticketLabel = TICKET_LABELS[event.ticketStatus] || "";
    var ticketNote = ticketCardNote(event, ticketLabel);
    var organizerFact = event.organizer ? '<span><strong>organizer:</strong> ' + escapeHtml(event.organizer) + '</span>' : '';
    var venueFact = event.venueName ? '<span><strong>venue:</strong> ' + escapeHtml(event.venueName) + '</span>' : '';
    var mapFact = addressFact(event);
    var officialUrl = event.sourceUrl || "";
    var ticketUrl = event.ticketUrl || "";
    if (!officialUrl && event.actionUrl) officialUrl = event.actionUrl;
    if (!officialUrl && ticketUrl) officialUrl = ticketUrl;
    var officialAction = officialUrl ? '<a href="' + escapeHtml(officialUrl) + '">Official details</a>' : '';
    var ticketAction = ticketUrl ? '<a href="' + escapeHtml(ticketUrl) + '">Tickets / Register</a>' : '';
    var relativeCue = relativeDateCue(event);
    var scheduleState = scheduleLabel || (event.status === "cancelled" ? "Cancelled" : "");
    var ticketState = ["sold_out","registration_closed"].includes(event.ticketStatus) ? ticketLabel : "";
    var statusLabels = [scheduleState, ticketState].filter(function (value, index, list) { return value && list.indexOf(value) === index; });
    var statusAlert = statusLabels.length ? '<p class="calendar-event-status">' + escapeHtml(statusLabels.join(" / ")) + '</p>' : '';
    var descriptionId = eventAnchor(event) + "-description";
    var cleanDescription = displayText(event.description);
    var description = cleanDescription ? '<p class="calendar-event-description is-collapsed" id="' + descriptionId + '">' + escapeHtml(cleanDescription) + '</p>' +
      '<button class="calendar-description-toggle" type="button" data-description-toggle aria-controls="' + descriptionId + '" aria-expanded="false" hidden>See more</button>' : '';
    return '<article class="calendar-event-card' + (event.status === "cancelled" ? ' is-cancelled' : '') + '" id="' + eventAnchor(event) + '" data-subject="' + escapeHtml(primarySubject) + '">' +
      '<p class="calendar-event-meta">' + escapeHtml([relativeCue, eventDate(event)].filter(Boolean).join(" / ")) + '</p>' +
      statusAlert +
      (event.isOccurrence ? '<p class="calendar-event-series">Part of / ' + (event.parentEventStructure === "exhibition" ? '<a href="#' + eventAnchor({id:event.seriesId}) + '">' + escapeHtml(event.parentTitle) + '</a>' : escapeHtml(event.parentTitle)) + ' / ' + escapeHtml(OCCURRENCE_LABELS[event.occurrenceType] || "Related Program") + '</p>' : '') +
      '<h3>' + escapeHtml(event.title) + '</h3>' +
      (accessNote ? '<p class="calendar-event-access"><strong>Access / </strong>' + escapeHtml(accessNote) + '</p>' : '') +
      (ticketNote ? '<p class="calendar-event-ticket"><strong>Tickets / </strong>' + escapeHtml(ticketNote) + '</p>' : '') +
      description +
      '<div class="calendar-event-facts">' + organizerFact + venueFact + mapFact + (sourceLabel ? '<span class="calendar-event-source">' + escapeHtml(sourceLabel) + '</span>' : '') + '</div>' +
      tagList(labels) +
      relatedDisclosure(relatedOccurrences, artistLinks, participantLinks, organizerLinks, otherRelatedLinks, creditedLink) +
      (media.length ? '<details class="calendar-event-media"><summary>View media ('+media.length+')</summary><div class="calendar-media-grid">'+media.map(function(item,index){return '<button type="button" data-gallery-event="'+escapeHtml(galleryKey)+'" data-gallery-index="'+index+'" aria-label="View '+escapeHtml(item.altText||event.title+' event image')+'"><img src="'+escapeHtml(item.url)+'" alt="'+escapeHtml(item.altText||event.title+' event image')+'" loading="lazy" decoding="async"'+(item.width?' width="'+Number(item.width)+'"':'')+(item.height?' height="'+Number(item.height)+'"':'')+'>'+(item.caption?'<span>'+escapeHtml(item.caption)+'</span>':'')+'</button>';}).join("")+'</div></details>' : '') +
      '<div class="calendar-event-actions">' + officialAction + ticketAction + '<a class="is-secondary" href="/api/calendar/events/' + encodeURIComponent(event.id) + '.ics">Save date</a><button class="is-secondary" type="button" data-share-event data-share-title="' + escapeHtml(event.title) + '" data-share-anchor="' + escapeHtml(eventAnchor(event)) + '">Share</button></div>' +
      '</article>';
  }

  function eventCard(event) {
    var record = window.AtlantaCalendarRecord;
    var media = record.eventMedia(event);
    galleryEvents[record.eventAnchor(event)] = { title:event.title, media:media };
    return record.renderEvent(event, { headingTag:"h3", includeViewEvent:true });
  }

  async function shareEvent(control) {
    var shareUrl = control.dataset.shareUrl ? new URL(control.dataset.shareUrl, location.origin).toString() : location.origin + location.pathname + "#" + control.dataset.shareAnchor;
    var shareData = { title:control.dataset.shareTitle || document.title, url:shareUrl };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
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

  function updateResultCount() {
    var count = activeView === "on-view" ? viewBuckets.onView.length : activeView === "month" ? filtered.length : viewBuckets.upcoming.length;
    var label = activeView === "on-view" ? " exhibition" : activeView === "month" ? " event" : " upcoming event";
    resultCount.textContent = count + label + (count === 1 ? "" : "s") + " in " + currentMonthName;
  }

  function renderVisibleCollections() {
    galleryEvents = {};
    upcomingRoot.innerHTML = activeView === "upcoming"
      ? (viewBuckets.upcoming.length ? viewBuckets.upcoming.map(eventCard).join("") : '<p class="calendar-empty">No upcoming approved events match these filters.</p>')
      : "";
    onViewRoot.innerHTML = activeView === "on-view"
      ? (viewBuckets.onView.length ? viewBuckets.onView.map(eventCard).join("") : '<p class="calendar-empty">No exhibitions on view match these filters.</p>')
      : "";
    pastRoot.innerHTML = pastDisclosure.open
      ? (viewBuckets.past.length ? viewBuckets.past.map(eventCard).join("") : '<p class="calendar-empty">No past events match these filters.</p>')
      : "";
    scheduleDescriptionSync();
  }

  function setView(view) {
    activeView = ["upcoming","on-view","month"].includes(view) ? view : "upcoming";
    viewButtons.forEach(function (button) {
      var selected = button.dataset.calendarView === activeView;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });
    viewPanels.forEach(function (panel) { panel.hidden = panel.id !== activeView; });
    renderVisibleCollections();
    updateResultCount();
  }

  function renderLists() {
    var onView = filtered.filter(isOnViewExhibition);
    var dated = filtered.filter(function (event) { return !isOnViewExhibition(event); });
    var upcoming = dated.filter(function (event) { return !isPast(event); });
    var past = dated.filter(isPast).reverse();
    var monthName = new Intl.DateTimeFormat("en-US", { month:"long", year:"numeric" }).format(activeMonth);
    currentMonthName = monthName;
    viewBuckets = { upcoming:upcoming, onView:onView, past:past };
    onViewTitle.textContent = "On View in " + monthName;
    document.getElementById("upcomingViewCount").textContent = upcoming.length;
    document.getElementById("onViewCount").textContent = onView.length;
    pastEventCount.textContent = past.length + (past.length === 1 ? " event" : " events");
    renderVisibleCollections();
    updateResultCount();
  }

  function dayEvents(key) {
    return filtered.filter(function (event) {
      if (isOnViewExhibition(event)) return false;
      var start = dateKey(event.startsAt);
      var end = dateKey(event.endsAt || event.startsAt);
      if (event.dateKind === "date_range") return key === start;
      return key >= start && key <= end;
    });
  }

  function renderAgenda(key) {
    selectedDate = key;
    var events = dayEvents(key);
    agenda.innerHTML = events.map(function (event) {
      return '<div class="calendar-day-agenda-item"><span><strong>' + escapeHtml(event.title) + '</strong><small>' + escapeHtml(eventDate(event)) + '</small></span><a href="' + escapeHtml(event.detailUrl || "#" + eventAnchor(event)) + '" data-calendar-detail-link>View event</a></div>';
    }).join("");
    Array.from(grid.querySelectorAll(".calendar-day")).forEach(function (day) { day.classList.toggle("is-selected", day.dataset.date === key); });
  }

  function renderMonth() {
    var year = activeMonth.getFullYear();
    var month = activeMonth.getMonth();
    monthLabel.textContent = new Intl.DateTimeFormat("en-US", { month:"long", year:"numeric" }).format(activeMonth);
    var first = new Date(year, month, 1);
    var cursor = new Date(year, month, 1 - first.getDay());
    var html = "";
    for (var index = 0; index < 42; index += 1) {
      var key = cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0") + "-" + String(cursor.getDate()).padStart(2, "0");
      var events = dayEvents(key);
      var outside = cursor.getMonth() !== month;
      if (events.length) {
        html += '<button class="calendar-day has-events' + (outside ? ' is-outside' : '') + '" type="button" role="gridcell" data-date="' + key + '" aria-label="' + escapeHtml(key + ", " + events.length + " events") + '"><span class="calendar-day-number">' + cursor.getDate() + '</span><span class="calendar-day-count" data-count="' + events.length + '">' + events.length + (events.length === 1 ? " event" : " events") + '</span></button>';
      } else {
        html += '<div class="calendar-day' + (outside ? ' is-outside' : '') + '" role="gridcell"><span class="calendar-day-number">' + cursor.getDate() + '</span></div>';
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.innerHTML = html;
    agenda.innerHTML = "";
    if (selectedDate && selectedDate.slice(0, 7) === year + "-" + String(month + 1).padStart(2, "0")) renderAgenda(selectedDate);
  }

  function calendarReturnState() {
    return {
      path:location.pathname,
      view:activeView,
      month:activeMonth.getFullYear() + "-" + String(activeMonth.getMonth() + 1).padStart(2, "0"),
      selectedDate:selectedDate,
      search:search.value,
      subjects:checkedValues(subjectRoot),
      formats:checkedValues(formatRoot),
      affiliations:checkedValues(affiliationRoot),
      modes:checkedValues(modeRoot),
      filtersOpen:!filterPanel.hidden,
      pastOpen:pastDisclosure.open,
      scrollY:Math.max(0, Math.round(window.scrollY || 0)),
      savedAt:Date.now(),
    };
  }

  function saveCalendarReturnState() {
    try { sessionStorage.setItem(RETURN_STATE_KEY, JSON.stringify(calendarReturnState())); } catch (error) { /* Navigation still works when storage is unavailable. */ }
  }

  function restoreCalendarReturnState() {
    var value = "";
    try {
      value = sessionStorage.getItem(RETURN_STATE_KEY) || "";
      sessionStorage.removeItem(RETURN_STATE_KEY);
    } catch (error) { return null; }
    if (!value) return null;
    try {
      var state = JSON.parse(value);
      if (!state || state.path !== "/calendar/" || Date.now() - Number(state.savedAt || 0) > 7200000) return null;
      if (/^\d{4}-\d{2}$/.test(state.month || "")) activeMonth = new Date(Number(state.month.slice(0, 4)), Number(state.month.slice(5, 7)) - 1, 1);
      search.value = String(state.search || "");
      var selected = new Set([].concat(state.subjects || [], state.formats || [], state.affiliations || [], state.modes || []));
      Array.from(document.querySelectorAll(".filter-chip input")).forEach(function (input) { input.checked = selected.has(input.value); });
      filterPanel.hidden = !state.filtersOpen;
      filterToggle.setAttribute("aria-expanded", state.filtersOpen ? "true" : "false");
      pastDisclosure.open = Boolean(state.pastOpen);
      selectedDate = String(state.selectedDate || "");
      return state;
    } catch (error) { return null; }
  }

  function applyFilters() {
    var monthStart = activeMonth.getFullYear() + "-" + String(activeMonth.getMonth() + 1).padStart(2, "0") + "-01";
    var monthEndDate = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 0);
    var monthEnd = monthEndDate.getFullYear() + "-" + String(monthEndDate.getMonth() + 1).padStart(2, "0") + "-" + String(monthEndDate.getDate()).padStart(2, "0");
    filtered = allEvents.filter(matches).filter(function (event) {
      var start = dateKey(event.startsAt);
      var end = dateKey(event.endsAt || event.startsAt);
      return start && start <= monthEnd && end >= monthStart;
    });
    var selectedFilters = checkedValues(subjectRoot).length + checkedValues(formatRoot).length + checkedValues(affiliationRoot).length + checkedValues(modeRoot).length;
    filterCount.textContent = selectedFilters ? " (" + selectedFilters + ")" : "";
    renderLists();
    renderMonth();
  }

  function eventForAnchor(anchor) {
    return allEvents.find(function (event) { return eventAnchor(event) === anchor; });
  }

  function navigateToEvent(anchor, updateHistory) {
    var event = eventForAnchor(anchor);
    if (!event) return false;
    if (isOnViewExhibition(event)) setView("on-view");
    else if (isPast(event)) {
      pastDisclosure.open = true;
      renderVisibleCollections();
    } else setView("upcoming");
    if (updateHistory && history.replaceState) history.replaceState(null, "", "#" + anchor);
    requestAnimationFrame(function () {
      var target = document.getElementById(anchor);
      if (target) target.scrollIntoView({ block:"start" });
    });
    return true;
  }

  function syncFromHash() {
    var anchor = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!anchor) return;
    if (["upcoming","on-view","month"].includes(anchor)) setView(anchor);
    else navigateToEvent(anchor, false);
  }

  renderFilters(subjectRoot, SUBJECT_LABELS, "subject");
  renderFilters(formatRoot, FORMAT_LABELS, "format");
  renderFilters(affiliationRoot, AFFILIATION_LABELS, "affiliation");
  renderFilters(modeRoot, MODE_LABELS, "mode");
  search.addEventListener("input", applyFilters);
  subjectRoot.addEventListener("change", applyFilters);
  formatRoot.addEventListener("change", applyFilters);
  affiliationRoot.addEventListener("change", applyFilters);
  modeRoot.addEventListener("change", applyFilters);
  filterToggle.addEventListener("click", function () {
    var shouldOpen = filterPanel.hidden;
    filterPanel.hidden = !shouldOpen;
    filterToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  });
  clearFilters.addEventListener("click", function () {
    search.value = "";
    Array.from(document.querySelectorAll(".filter-chip input")).forEach(function (input) { input.checked = false; });
    applyFilters();
  });
  viewButtons.forEach(function (button) {
    button.addEventListener("click", function () { setView(button.dataset.calendarView); });
  });
  pastDisclosure.addEventListener("toggle", renderVisibleCollections);
  document.getElementById("previousMonth").addEventListener("click", function () { selectedDate = ""; activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() - 1, 1); applyFilters(); });
  document.getElementById("nextMonth").addEventListener("click", function () { selectedDate = ""; activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1); applyFilters(); });
  grid.addEventListener("click", function (event) { var button = event.target.closest("button[data-date]"); if (button) renderAgenda(button.dataset.date); });
  document.addEventListener("click", function (event) {
    var detailLink = event.target.closest("[data-calendar-detail-link]");
    if (detailLink && detailLink.getAttribute("href") && !detailLink.getAttribute("href").startsWith("#")) saveCalendarReturnState();
    var viewLink = event.target.closest("[data-calendar-view-link]");
    if (viewLink) {
      event.preventDefault();
      var view = viewLink.dataset.calendarViewLink;
      setView(view);
      if (history.replaceState) history.replaceState(null, "", "#" + view);
      document.getElementById(view).scrollIntoView({ block:"start" });
      return;
    }
    var eventLink = event.target.closest('a[href^="#event-"]');
    if (eventLink) {
      var anchor = decodeURIComponent(eventLink.getAttribute("href").slice(1));
      if (eventForAnchor(anchor)) {
        event.preventDefault();
        navigateToEvent(anchor, true);
        return;
      }
    }
    var galleryButton=event.target.closest("[data-gallery-event]");
    if(galleryButton){openGallery(galleryButton.dataset.galleryEvent,Number(galleryButton.dataset.galleryIndex)||0);return;}
    var shareControl = event.target.closest("[data-share-event]");
    if (shareControl) { shareEvent(shareControl); return; }
    var tagControl = event.target.closest("[data-tag-toggle]");
    if (tagControl) {
      var expanded = tagControl.getAttribute("aria-expanded") !== "true";
      var tagRoot = tagControl.closest(".calendar-tags");
      tagRoot.querySelectorAll(".calendar-tag.is-extra").forEach(function (tag) { tag.hidden = !expanded; });
      tagControl.setAttribute("aria-expanded", expanded ? "true" : "false");
      tagControl.textContent = expanded ? "Show fewer" : "+" + tagRoot.querySelectorAll(".calendar-tag.is-extra").length + " more";
      return;
    }
    var control = event.target.closest("[data-description-toggle]");
    if (!control) return;
    var description = document.getElementById(control.getAttribute("aria-controls"));
    if (!description) return;
    var shouldExpand = control.getAttribute("aria-expanded") !== "true";
    control.setAttribute("aria-expanded", shouldExpand ? "true" : "false");
    control.textContent = shouldExpand ? "See less" : "See more";
    description.classList.toggle("is-collapsed", !shouldExpand);
  });
  function renderLightbox(){if(!activeGallery)return;var collection=galleryEvents[activeGallery.key];var item=collection&&collection.media[activeGallery.index];var dialog=document.getElementById("calendarMediaDialog");if(!dialog||!item)return;document.getElementById("calendarMediaTitle").textContent=collection.title+" / "+(activeGallery.index+1)+" of "+collection.media.length;var image=document.getElementById("calendarMediaImage");image.src=item.url;image.alt=item.altText||collection.title+" event image";document.getElementById("calendarMediaCaption").textContent=item.caption||"";document.getElementById("calendarMediaPrevious").disabled=collection.media.length<2;document.getElementById("calendarMediaNext").disabled=collection.media.length<2;}
  function openGallery(key,index){if(!galleryEvents[key]||!galleryEvents[key].media.length)return;activeGallery={key:key,index:index};renderLightbox();var dialog=document.getElementById("calendarMediaDialog");if(!dialog.open)dialog.showModal();}
  function shiftGallery(direction){if(!activeGallery)return;var collection=galleryEvents[activeGallery.key];activeGallery.index=(activeGallery.index+direction+collection.media.length)%collection.media.length;renderLightbox();}
  document.getElementById("calendarMediaPrevious").addEventListener("click",function(){shiftGallery(-1);});
  document.getElementById("calendarMediaNext").addEventListener("click",function(){shiftGallery(1);});
  document.getElementById("calendarMediaClose").addEventListener("click",function(){document.getElementById("calendarMediaDialog").close();});
  document.getElementById("calendarMediaDialog").addEventListener("click",function(event){if(event.target===this)this.close();});
  document.addEventListener("keydown",function(event){var dialog=document.getElementById("calendarMediaDialog");if(!dialog.open)return;if(event.key==="Escape"){event.preventDefault();dialog.close();activeGallery=null;return;}if(event.key==="ArrowLeft"){event.preventDefault();shiftGallery(-1);}if(event.key==="ArrowRight"){event.preventDefault();shiftGallery(1);}});
  window.addEventListener("resize", scheduleDescriptionSync);
  window.addEventListener("hashchange", syncFromHash);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleDescriptionSync);

  fetch("/api/calendar/events")
    .then(function (response) { if (!response.ok) throw new Error("Calendar request failed."); return response.json(); })
    .then(function (payload) {
      allEvents = Array.isArray(payload.events) ? payload.events.filter(function (event) { return !event.isSeriesParent; }) : [];
      var returnState = restoreCalendarReturnState();
      applyFilters();
      if (returnState) {
        setView(returnState.view);
        if (returnState.view === "month" && selectedDate) renderAgenda(selectedDate);
        requestAnimationFrame(function () { window.scrollTo(0, Math.max(0, Number(returnState.scrollY || 0))); });
      } else syncFromHash();
      requestAnimationFrame(function () { document.documentElement.classList.add("is-ready"); });
    })
    .catch(function () {
      resultCount.textContent = "Calendar unavailable";
      upcomingRoot.innerHTML = '<p class="calendar-empty">The calendar could not be loaded. Try again shortly.</p>';
      pastRoot.innerHTML = "";
      renderMonth();
    });
})();
