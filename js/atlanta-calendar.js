(function () {
  "use strict";

  var SUBJECT_LABELS = { art:"Art", film:"Film", "poetry-music":"Poetry / Music", technology:"Technology", ai:"AI", "creative-technology":"Creative Technology", anthropology:"Anthropology", engineering:"Engineering", philosophy:"Philosophy" };
  var FORMAT_LABELS = { exhibition:"Exhibitions / Art Openings", screening:"Screening", performance:"Performance", "experimental-event":"Experimental Event", "lecture-talk":"Lecture / Talk", panel:"Panel", workshop:"Workshop", conference:"Conference" };
  var AFFILIATION_LABELS = { gsu:"GSU Events" };
  var MODE_LABELS = { virtual:"Virtual" };
  var OCCURRENCE_LABELS = { opening_reception:"Opening Reception", artist_talk:"Artist Talk", mixer:"Mixer", screening:"Screening", performance:"Performance", workshop:"Workshop", panel:"Panel", lecture:"Lecture", other:"Related Program" };
  var TIME_ZONE = "America/New_York";
  var allEvents = [];
  var filtered = [];
  var activeMonth = new Date();
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

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[character];
    });
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
      var haystack = [event.title, event.description, event.organizer, event.venueName, event.venueAddress, event.accessNotes].concat(event.audiences || [], event.subjects, event.formats).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  function eventCard(event) {
    var primarySubject = event.subjects[0] || "";
    var labels = event.subjects.map(function (value) { return SUBJECT_LABELS[value] || value; }).concat(event.formats.map(function (value) { return FORMAT_LABELS[value] || value; }), (event.affiliations || []).map(function (value) { return AFFILIATION_LABELS[value] || value; }), event.virtual ? [MODE_LABELS.virtual] : []);
    var location = [event.venueName, event.venueAddress].filter(function (value, index, list) { return value && list.indexOf(value) === index; }).join(" / ");
    var sourceLabel = event.origin === "sixwell" ? "Six.Well event" : (event.affiliations || []).includes("gsu") ? "Georgia State University event" : "Selected Atlanta listing";
    var relatedLinks = Array.isArray(event.relatedLinks) ? event.relatedLinks : [];
    var relatedOccurrences = Array.isArray(event.relatedOccurrences) ? event.relatedOccurrences : [];
    var flyer = event.flyer && event.flyer.url ? event.flyer : null;
    var accessNote = event.accessStatus === "restricted" ? (event.accessNotes || "Attendance is restricted. Check the official details for eligibility.") : "";
    var organizerFact = event.organizer ? (event.organizerUrl ? '<a href="' + escapeHtml(event.organizerUrl) + '" target="_blank" rel="noopener noreferrer">Organizer / ' + escapeHtml(event.organizer) + '</a>' : '<span>Organizer / ' + escapeHtml(event.organizer) + '</span>') : '';
    var venueFact = location ? (event.venueUrl ? '<a href="' + escapeHtml(event.venueUrl) + '" target="_blank" rel="noopener noreferrer">Venue / ' + escapeHtml(location) + '</a>' : '<span>Venue / ' + escapeHtml(location) + '</span>') : '';
    return '<article class="calendar-event-card' + (event.status === "cancelled" ? ' is-cancelled' : '') + '" id="' + eventAnchor(event) + '" data-subject="' + escapeHtml(primarySubject) + '">' +
      '<p class="calendar-event-meta">' + escapeHtml(event.status === "cancelled" ? "Cancelled / " + eventDate(event) : eventDate(event)) + '</p>' +
      (event.isOccurrence ? '<p class="calendar-event-series">Part of / ' + (event.parentEventStructure === "exhibition" ? '<a href="#' + eventAnchor({id:event.seriesId}) + '">' + escapeHtml(event.parentTitle) + '</a>' : escapeHtml(event.parentTitle)) + ' / ' + escapeHtml(OCCURRENCE_LABELS[event.occurrenceType] || "Related Program") + '</p>' : '') +
      '<h3>' + escapeHtml(event.title) + '</h3>' +
      (accessNote ? '<p class="calendar-event-access"><strong>Access / </strong>' + escapeHtml(accessNote) + '</p>' : '') +
      (event.description ? '<p class="calendar-event-description">' + escapeHtml(event.description) + '</p>' : '') +
      '<div class="calendar-event-facts">' + organizerFact + venueFact + '<span>' + escapeHtml(sourceLabel) + '</span></div>' +
      '<div class="calendar-tags">' + labels.map(function (label) { return '<span class="calendar-tag">' + escapeHtml(label) + '</span>'; }).join("") + '</div>' +
      (relatedOccurrences.length ? '<div class="calendar-related-schedule"><span>Related schedule</span>' + relatedOccurrences.map(function (occurrence) { return '<a href="#' + eventAnchor(occurrence) + '"><strong>' + escapeHtml(occurrence.occurrenceLabel || occurrence.title) + '</strong><small>' + escapeHtml(eventDate(occurrence)) + '</small></a>'; }).join("") + '</div>' : '') +
      (relatedLinks.length ? '<div class="calendar-related-links"><span>Related</span>' + relatedLinks.map(function (link) { return '<a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(link.label) + '</a>'; }).join("") + '</div>' : '') +
      (flyer ? '<details class="calendar-event-flyer"><summary>Show flyer</summary><div><img src="' + escapeHtml(flyer.url) + '" alt="' + escapeHtml(flyer.altText || event.title + " event flyer") + '" loading="lazy" decoding="async"' + (flyer.width ? ' width="' + Number(flyer.width) + '"' : '') + (flyer.height ? ' height="' + Number(flyer.height) + '"' : '') + '></div></details>' : '') +
      '<div class="calendar-event-actions"><a href="' + escapeHtml(event.actionUrl || event.sourceUrl) + '">Official details</a><a class="is-secondary" href="/api/calendar/events/' + encodeURIComponent(event.id) + '.ics">Add this event</a></div>' +
      '</article>';
  }

  function renderLists() {
    var onView = filtered.filter(isOnViewExhibition);
    var dated = filtered.filter(function (event) { return !isOnViewExhibition(event); });
    var upcoming = dated.filter(function (event) { return !isPast(event); });
    var past = dated.filter(isPast).reverse();
    var monthName = new Intl.DateTimeFormat("en-US", { month:"long", year:"numeric" }).format(activeMonth);
    onViewTitle.textContent = "On View in " + monthName;
    onViewSection.hidden = !onView.length;
    onViewRoot.innerHTML = onView.map(eventCard).join("");
    resultCount.textContent = filtered.length + (filtered.length === 1 ? " event" : " events") + " shown in " + monthName;
    upcomingRoot.innerHTML = upcoming.length ? upcoming.map(eventCard).join("") : '<p class="calendar-empty">No upcoming approved events match these filters.</p>';
    pastRoot.innerHTML = past.length ? past.map(eventCard).join("") : '<p class="calendar-empty">No past events match these filters.</p>';
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
    var events = dayEvents(key);
    agenda.innerHTML = events.map(function (event) {
      return '<a href="#' + eventAnchor(event) + '"><strong>' + escapeHtml(event.title) + '</strong><small>' + escapeHtml(eventDate(event)) + '</small></a>';
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
    renderLists();
    renderMonth();
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
  document.getElementById("clearFilters").addEventListener("click", function () {
    search.value = "";
    Array.from(document.querySelectorAll(".filter-chip input")).forEach(function (input) { input.checked = false; });
    applyFilters();
  });
  document.getElementById("previousMonth").addEventListener("click", function () { activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() - 1, 1); applyFilters(); });
  document.getElementById("nextMonth").addEventListener("click", function () { activeMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1); applyFilters(); });
  grid.addEventListener("click", function (event) { var button = event.target.closest("button[data-date]"); if (button) renderAgenda(button.dataset.date); });

  fetch("/api/calendar/events")
    .then(function (response) { if (!response.ok) throw new Error("Calendar request failed."); return response.json(); })
    .then(function (payload) {
      allEvents = Array.isArray(payload.events) ? payload.events.filter(function (event) { return !event.isSeriesParent; }) : [];
      applyFilters();
      requestAnimationFrame(function () { document.documentElement.classList.add("is-ready"); });
    })
    .catch(function () {
      resultCount.textContent = "Calendar unavailable";
      upcomingRoot.innerHTML = '<p class="calendar-empty">The calendar could not be loaded. Try again shortly.</p>';
      pastRoot.innerHTML = "";
      renderMonth();
    });
})();
