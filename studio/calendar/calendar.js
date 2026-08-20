(function () {
  "use strict";
  var TOKEN_KEY = "swc_submissions_admin_token";
  var SUBJECTS = [["art","Art"],["art-making","Art Making"],["film","Film"],["poetry-music","Poetry / Music"],["technology","Technology"],["ai","AI"],["creative-technology","Creative Technology"],["anthropology","Anthropology"],["engineering","Engineering"],["philosophy","Philosophy"]];
  var FORMATS = [["exhibition","Exhibition"],["screening","Screening"],["performance","Performance"],["experimental-event","Experimental Event"],["lecture-talk","Lecture / Talk"],["panel","Panel"],["workshop","Workshop"],["conference","Conference"]];
  var OCCURRENCE_TYPES = [["opening_reception","Opening Reception"],["artist_talk","Artist Talk"],["mixer","Mixer"],["screening","Screening"],["performance","Performance"],["workshop","Workshop"],["panel","Panel"],["lecture","Lecture"],["other","Related Program"]];
  var TICKET_STATUSES = [["unknown","Unknown"],["not_required","No ticket required"],["not_yet_on_sale","Not yet on sale"],["on_sale","On sale"],["sold_out","Sold out"],["registration_open","Registration open"],["registration_closed","Registration closed"]];
  var STATUSES = [["review","Review Queue"],["updates","Updates"],["ready","Ready to Publish"],["published","Published"],["needs_verification","Needs Verification"],["rejected","Rejected"],["cancelled","Cancelled"],["duplicate","Duplicates"]];
  var token = localStorage.getItem(TOKEN_KEY) || "";
  var state = { candidates:[], sources:[], socialSources:[], connectors:[], knownOrganizations:[], strongPicks:[], profile:null, suggestions:[], runs:[], filter:"review", selectedId:"", draftNew:false, broadDiscoveryEnabled:false, activeCandidate:null, research:null, mediaPreviewUrls:[] };
  var tokenInput = document.getElementById("tokenInput");
  var authPanel = document.getElementById("authPanel");
  var app = document.getElementById("studioApp");
  var listRoot = document.getElementById("candidateList");
  var editorRoot = document.getElementById("candidateEditor");
  var toastTimer;

  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]; }); }
  function isInstagramUrl(value) { try { var host = new URL(value).hostname.toLowerCase(); return host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am" || host.endsWith(".instagr.am"); } catch (error) { return false; } }
  function isSocialUrl(value) { try { var host = new URL(value).hostname.toLowerCase().replace(/^www\./,""); return ["instagram.com","instagr.am","threads.net","tiktok.com"].some(function(domain){return host===domain||host.endsWith("."+domain);}); } catch (error) { return false; } }
  function displayDate(value) { var date = value ? new Date(value.length === 10 ? value + "T12:00:00" : value) : null; return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric", hour:value.length > 10 ? "numeric" : undefined, minute:value.length > 10 ? "2-digit" : undefined }).format(date) : "Date not confirmed"; }
  function toast(message) { var root = document.getElementById("toast"); root.textContent = message; root.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { root.classList.remove("is-visible"); }, 3200); }
  async function api(path, options) {
    var response = await fetch(path, Object.assign({}, options || {}, { headers:Object.assign({ authorization:"Bearer " + token, "content-type":"application/json" }, options && options.headers || {}) }));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(payload.error || "Request failed."); error.status = response.status; error.details = payload.errors || []; throw error; }
    return payload;
  }
  function value(id) { var field = document.getElementById(id); return field ? field.value.trim() : ""; }
  function checked(name) { return Array.from(editorRoot.querySelectorAll('input[name="' + name + '"]:checked')).map(function (input) { return input.value; }); }
  function checkboxes(name, choices, selected) { return '<div class="checkbox-grid">' + choices.map(function (choice) { return '<label class="check-option"><input type="checkbox" name="' + name + '" value="' + choice[0] + '"' + ((selected || []).includes(choice[0]) ? ' checked' : '') + '><span>' + escapeHtml(choice[1]) + '</span></label>'; }).join("") + '</div>'; }
  function field(id, label, value, options) {
    options = options || {};
    var control = options.type === "textarea" ? '<textarea id="' + id + '">' + escapeHtml(value || "") + '</textarea>' : options.type === "select" ? '<select id="' + id + '">' + options.choices.map(function (choice) { return '<option value="' + escapeHtml(choice[0]) + '"' + (choice[0] === value ? ' selected' : '') + '>' + escapeHtml(choice[1]) + '</option>'; }).join("") + '</select>' : '<input id="' + id + '" type="' + (options.type || "text") + '" value="' + escapeHtml(value || "") + '"' + (options.step ? ' step="' + options.step + '"' : '') + '>';
    return '<label class="field' + (options.wide ? ' is-wide' : '') + '"><span>' + escapeHtml(label) + '</span>' + control + '</label>';
  }
  function calendarControlValue(dateKind,dateValue){var raw=String(dateValue||"");if(!raw)return "";if(dateKind==="timed"){if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw))return raw.slice(0,16);return /^\d{4}-\d{2}-\d{2}/.test(raw)?raw.slice(0,10)+"T12:00":"";}return /^\d{4}-\d{2}-\d{2}/.test(raw)?raw.slice(0,10):"";}
  function timeZoneOffset(localValue,timeZone){var match=String(localValue||"").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);if(!match)return "";var guess=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]));function offsetAt(timestamp){var parts=new Intl.DateTimeFormat("en-US",{timeZone:timeZone||"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(timestamp)).reduce(function(values,part){values[part.type]=part.value;return values;},{});return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second))-timestamp;}try{var offset=offsetAt(guess);offset=offsetAt(guess-offset);var sign=offset>=0?"+":"-";var minutes=Math.abs(Math.round(offset/60000));return sign+String(Math.floor(minutes/60)).padStart(2,"0")+":"+String(minutes%60).padStart(2,"0");}catch(error){return "";}}
  function calendarPayloadValue(dateKind,controlValue,timeZone){var raw=String(controlValue||"").trim();if(!raw)return "";if(dateKind!=="timed")return raw.slice(0,10);var offset=timeZoneOffset(raw,timeZone);return offset?raw+":00"+offset:raw;}
  function scheduleGuidance(){var root=document.getElementById("candidateScheduleGuidance");if(!root)return;var kind=value("candidateDateKind")||"timed";var structure=value("candidateEventStructure")||"single";var occurrences=Array.from(editorRoot.querySelectorAll("[data-occurrence]")).filter(function(row){var status=row.querySelector("[data-occurrence-status]");var starts=row.querySelector("[data-occurrence-starts]");return status&&status.value!=="tbd"&&starts&&starts.value;});var messages=[];if(kind==="timed")messages.push("Choose the local date and time. Studio adds the time-zone offset automatically.");if(kind==="all_day")messages.push("Choose one calendar date. No time is required.");if(kind==="date_range")messages.push("Choose the first and last on-view or festival dates. No time is required.");if(structure==="series"&&!occurrences.length)messages.push("Series means multiple separately dated programs. Add a confirmed occurrence below, or use Single event for one festival spanning several days.");if(structure==="exhibition"&&kind!=="date_range")messages.push("Exhibitions need Runs across multiple dates so the on-view period is clear.");root.innerHTML=messages.map(function(message){return '<p>'+escapeHtml(message)+'</p>';}).join("")+(structure==="series"&&!occurrences.length?'<button type="button" data-use-single-event>Use single event</button>':'');root.classList.toggle("has-warning",(structure==="series"&&!occurrences.length)||(structure==="exhibition"&&kind!=="date_range"));}
  function syncPrimaryDateControls(){var kind=value("candidateDateKind")||"timed";var type=kind==="timed"?"datetime-local":"date";["candidateStartsAt","candidateEndsAt"].forEach(function(id){var control=document.getElementById(id);if(!control)return;var nextValue=calendarControlValue(kind,control.value);control.type=type;control.value=nextValue;});var startControl=document.getElementById("candidateStartsAt");var endControl=document.getElementById("candidateEndsAt");var startLabel=startControl&&startControl.closest("label")?startControl.closest("label").querySelector("span"):null;var endLabel=endControl&&endControl.closest("label")?endControl.closest("label").querySelector("span"):null;if(startLabel)startLabel.textContent=kind==="date_range"?"First date":kind==="all_day"?"Event date":"Starts";if(endLabel)endLabel.textContent=kind==="date_range"?"Last date":"Ends (optional)";scheduleGuidance();}
  function syncOccurrenceDateControls(row){if(!row)return;var kind=(row.querySelector("[data-occurrence-date-kind]")||{}).value||"timed";var type=kind==="timed"?"datetime-local":"date";["[data-occurrence-starts]","[data-occurrence-ends]"].forEach(function(selector){var control=row.querySelector(selector);if(!control)return;var nextValue=calendarControlValue(kind,control.value);control.type=type;control.value=nextValue;});scheduleGuidance();}
  function scheduleClientErrors(){var errors=[];var kind=value("candidateDateKind")||"timed";var structure=value("candidateEventStructure")||"single";if(!value("candidateStartsAt"))errors.push(kind==="timed"?"Choose the event date and start time.":"Choose the event date.");if(kind==="date_range"&&!value("candidateEndsAt"))errors.push("Choose the last date for this date range.");if(structure==="exhibition"&&kind!=="date_range")errors.push("Set the exhibition schedule to Runs across multiple dates.");if(structure==="series"){var confirmed=Array.from(editorRoot.querySelectorAll("[data-occurrence]")).some(function(row){var status=row.querySelector("[data-occurrence-status]");var starts=row.querySelector("[data-occurrence-starts]");return status&&status.value!=="tbd"&&starts&&starts.value;});if(!confirmed)errors.push("Add a dated occurrence, or use Single event if this is one festival or program.");}return errors;}
  function externalLink(url, label, className) {
    return url ? '<a class="' + escapeHtml(className || "verify-link") + '" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>' : '';
  }
  function linkedField(id, label, currentValue, linkLabel, options) {
    options = options || {};
    return '<div class="linked-field' + (options.wide ? ' is-wide' : '') + '">' + field(id,label,currentValue,{type:options.type||"url"}) + externalLink(currentValue,linkLabel) + '</div>';
  }
  function sourceChoices(selected) { return [["","No registry source"]].concat(state.sources.map(function (source) { return [source.id, source.name]; })).map(function (choice) { return '<option value="' + escapeHtml(choice[0]) + '"' + (choice[0] === selected ? ' selected' : '') + '>' + escapeHtml(choice[1]) + '</option>'; }).join(""); }
  function candidatePayload() {
    var relatedLinks = Array.from(editorRoot.querySelectorAll("[data-related-link]")).map(function (row) {
      return {
        id:row.dataset.linkId || "",
        label:row.querySelector("[data-link-label]").value.trim(),
        url:row.querySelector("[data-link-url]").value.trim(),
        provenanceUrl:row.querySelector("[data-link-provenance]").value.trim(),
        role:row.querySelector("[data-link-role]").value,
        includePublic:row.querySelector("[data-link-public]").checked
      };
    }).filter(function (link) { return link.url; });
    var occurrences = Array.from(editorRoot.querySelectorAll("[data-occurrence]")).map(function (row, index) {
      function occurrenceValue(name) { var control=row.querySelector('[data-occurrence-'+name+']');return control?control.value.trim():""; }
      return {
        id:row.dataset.occurrenceId||"", sourceEventId:occurrenceValue("source-id"), occurrenceType:occurrenceValue("type"), title:occurrenceValue("title"),
        factualDescription:occurrenceValue("description"), dateKind:occurrenceValue("date-kind"),
        accessStatus:occurrenceValue("access-status"), accessNotes:occurrenceValue("access-notes"),
        audiences:occurrenceValue("audiences").split(",").map(function (item) { return item.trim(); }).filter(Boolean),
        startsAt:calendarPayloadValue(occurrenceValue("date-kind"),occurrenceValue("starts"),occurrenceValue("timezone")||"America/New_York"), endsAt:calendarPayloadValue(occurrenceValue("date-kind"),occurrenceValue("ends"),occurrenceValue("timezone")||"America/New_York"), timezone:occurrenceValue("timezone")||"America/New_York",
        venueName:occurrenceValue("venue"), venueAddress:occurrenceValue("address"), sourceUrl:occurrenceValue("source"),
        ticketUrl:occurrenceValue("ticket"), ticketStatus:occurrenceValue("ticket-status"), ticketOnSaleAt:occurrenceValue("ticket-on-sale"), ticketNotes:occurrenceValue("ticket-notes"), status:occurrenceValue("status"), verificationState:occurrenceValue("verification"),
        verificationNotes:occurrenceValue("notes"), sortOrder:index
      };
    });
    var media = Array.from(editorRoot.querySelectorAll("[data-candidate-media]")).map(function(row,index){
      return {id:row.dataset.candidateMediaId||"",mediaId:row.dataset.mediaId||"",sourceUrl:(row.querySelector("[data-media-source]")||{}).value||"",provenanceUrl:(row.querySelector("[data-media-provenance]")||{}).value||"",role:(row.querySelector("[data-media-role]")||{}).value||"gallery",altText:(row.querySelector("[data-media-alt]")||{}).value||"",caption:(row.querySelector("[data-media-caption]")||{}).value||"",includePublic:Boolean(row.querySelector("[data-media-public]")&&row.querySelector("[data-media-public]").checked),sortOrder:index};
    }).filter(function(item){return item.mediaId;});
    var primaryMedia=media.find(function(item){return item.role==="primary";})||media.find(function(item){return item.role==="flyer";})||media[0]||{};
    return {
      sourceId:value("candidateSourceId"), sourceEventId:value("candidateSourceEventId"), sourceUrl:value("candidateSourceUrl"), ticketUrl:value("candidateTicketUrl"),
      scheduleStatus:value("candidateScheduleStatus"), ticketStatus:value("candidateTicketStatus"), ticketOnSaleAt:value("candidateTicketOnSaleAt"), ticketNotes:value("candidateTicketNotes"),
      discoveryUrl:value("candidateDiscoveryUrl"), organizerUrl:value("candidateOrganizerUrl"), venueUrl:value("candidateVenueUrl"), sourceAuthority:value("candidateSourceAuthority"), sourceResolutionNotes:value("candidateSourceResolutionNotes"),
      title:value("candidateTitle"), organizer:value("candidateOrganizer"), factualDescription:value("candidateDescription"), eventStructure:value("candidateEventStructure"), dateKind:value("candidateDateKind"),
      accessStatus:value("candidateAccessStatus"), accessNotes:value("candidateAccessNotes"), audiences:value("candidateAudiences").split(",").map(function (item) { return item.trim(); }).filter(Boolean),
      startsAt:calendarPayloadValue(value("candidateDateKind"),value("candidateStartsAt"),value("candidateTimezone")||"America/New_York"), endsAt:calendarPayloadValue(value("candidateDateKind"),value("candidateEndsAt"),value("candidateTimezone")||"America/New_York"), timezone:value("candidateTimezone") || "America/New_York", venueName:value("candidateVenueName"),
      venueAddress:value("candidateVenueAddress"), city:value("candidateCity") || "Atlanta", region:value("candidateRegion") || "GA", subjects:checked("subjects"), formats:checked("formats"),
      experimental:document.getElementById("candidateExperimental").checked, verificationState:value("candidateVerificationState"), verificationNotes:value("candidateVerificationNotes"),
      confidence:value("candidateConfidence") === "" ? null : Number(value("candidateConfidence")), privateRationale:value("candidatePrivateRationale"), attendanceUse:value("candidateAttendanceUse"),
      programmingIdeas:value("candidateProgrammingIdeas"), potentialCollaborators:value("candidateCollaborators"), internalNotes:value("candidateInternalNotes"), rejectionReason:value("candidateRejectionReason"), duplicateOf:value("candidateDuplicateOf"),
      relatedLinks:relatedLinks, occurrences:occurrences, media:media, flyerMediaId:primaryMedia.mediaId||"", flyerSourceUrl:primaryMedia.sourceUrl||"", flyerProvenanceUrl:primaryMedia.provenanceUrl||"", flyerPublicApproved:Boolean(primaryMedia.includePublic), flyerAltText:primaryMedia.altText||"",
      monitoringEnabled:Boolean(document.getElementById("candidateMonitoringEnabled") && document.getElementById("candidateMonitoringEnabled").checked), monitoringCadenceHours:Number(value("candidateMonitoringCadenceHours")) || 24
    };
  }
  function blankCandidate() { return { id:"", title:"", status:"needs_verification", scheduleStatus:"scheduled", ticketStatus:"unknown", ticketOnSaleAt:"", ticketNotes:"", verificationState:"needs_verification", sourceAuthority:"unresolved", accessStatus:"unknown", accessNotes:"Attendance eligibility has not been confirmed.", audiences:[], eventStructure:"single", dateKind:"timed", timezone:"America/New_York", city:"Atlanta", region:"GA", subjects:[], formats:[], revisions:[], relatedLinks:[], occurrences:[], media:[], monitoringEnabled:false, monitoringCadenceHours:24, lastCheckStatus:"never" }; }

  function strongPickWhen(pick) {
    var start=displayDate(pick.startsAt);
    var end=pick.endsAt?displayDate(pick.endsAt):"";
    return [start+(end&&end!==start?" – "+end:""),pick.venueName,pick.venueAddress].filter(Boolean).join(" · ");
  }
  function strongPickChanges(pick) {
    var labels=(pick.changes||[]).map(function(change){return change.label||change.field;}).filter(Boolean);
    return labels.length?'Material update: '+labels.join(", "):'';
  }
  function renderStrongPicks() {
    var root=document.getElementById("strongPicksList");
    root.innerHTML=state.strongPicks.length?state.strongPicks.map(function(pick){
      var changeCopy=strongPickChanges(pick);
      return '<article class="strong-pick-card is-'+escapeHtml(pick.kind||"new")+'">'+
        '<div class="strong-pick-meta"><span class="strong-pick-kind">'+escapeHtml(pick.kind==="material_update"?"Material update":"New strong pick")+'</span><span class="strong-pick-detected">Found '+escapeHtml(displayDate(pick.detectedAt))+'</span><span class="strong-pick-status">'+escapeHtml((pick.candidateStatus||"candidate").replace(/_/g," "))+'</span></div>'+
        '<h3>'+escapeHtml(pick.title||"Untitled event")+'</h3><p class="strong-pick-when">'+escapeHtml(strongPickWhen(pick))+'</p>'+
        (pick.factualDescription?'<p class="strong-pick-description">'+escapeHtml(pick.factualDescription)+'</p>':'')+
        '<dl class="strong-pick-intelligence"><div><dt>Why it fits</dt><dd>'+escapeHtml(pick.privateRationale||"Review the candidate intelligence.")+'</dd></div><div><dt>Best use</dt><dd>'+escapeHtml(pick.attendanceUse||"Review in Studio.")+'</dd></div><div><dt>Programming model</dt><dd>'+escapeHtml(pick.programmingIdeas||"No model note recorded.")+'</dd></div><div><dt>Potential collaborators</dt><dd>'+escapeHtml(pick.potentialCollaborators||"No collaborator note recorded.")+'</dd></div></dl>'+
        (changeCopy?'<p class="strong-pick-changes">'+escapeHtml(changeCopy)+'</p>':'')+
        '<div class="strong-pick-actions"><button type="button" data-review-strong-pick="'+escapeHtml(pick.candidateId)+'">Review Candidate</button>'+externalLink(pick.sourceUrl,"Official / announcement link")+externalLink(pick.ticketUrl,"Tickets")+'</div></article>';
    }).join(""):'<p class="empty-state">No strong picks yet. The Scout adds an entry only when it finds a strong new match or a material update.</p>';
  }
  async function loadStrongPicks() {
    var payload=await api("/api/admin/calendar/strong-picks");state.strongPicks=payload.strongPicks||[];renderStrongPicks();
  }

  function occurrenceOptions(choices, selected) { return choices.map(function (choice) { return '<option value="'+escapeHtml(choice[0])+'"'+(choice[0]===selected?' selected':'')+'>'+escapeHtml(choice[1])+'</option>'; }).join(''); }
  function occurrenceRow(occurrence) {
    occurrence=occurrence||{};
    return '<article class="occurrence-row" data-occurrence data-occurrence-id="'+escapeHtml(occurrence.id||"")+'">' +
      '<div class="occurrence-row-head"><strong>'+escapeHtml(occurrence.title||"Related program")+'</strong><button type="button" data-remove-occurrence>Remove</button></div>' +
      '<div class="field-grid">' +
      '<label class="field"><span>Program type</span><select data-occurrence-type>'+occurrenceOptions(OCCURRENCE_TYPES,occurrence.occurrenceType||"other")+'</select></label>' +
      '<label class="field"><span>Status</span><select data-occurrence-status>'+occurrenceOptions([["scheduled","Scheduled"],["tbd","Date TBD"],["cancelled","Cancelled"]],occurrence.status||"scheduled")+'</select></label>' +
      '<label class="field is-wide"><span>Source event ID (private)</span><input data-occurrence-source-id value="'+escapeHtml(occurrence.sourceEventId||"")+'"></label>' +
      '<label class="field is-wide"><span>Public title</span><input data-occurrence-title value="'+escapeHtml(occurrence.title||"")+'"></label>' +
      '<label class="field"><span>Date setup</span><select data-occurrence-date-kind>'+occurrenceOptions([["timed","Date and time"],["all_day","All day / no time"]],occurrence.dateKind||"timed")+'</select></label>' +
      '<label class="field"><span>Time zone</span><input data-occurrence-timezone value="'+escapeHtml(occurrence.timezone||"America/New_York")+'"></label>' +
      '<label class="field"><span>Starts</span><input type="'+(occurrence.dateKind==="all_day"?'date':'datetime-local')+'" data-occurrence-starts value="'+escapeHtml(calendarControlValue(occurrence.dateKind||"timed",occurrence.startsAt))+'"></label>' +
      '<label class="field"><span>Ends (optional)</span><input type="'+(occurrence.dateKind==="all_day"?'date':'datetime-local')+'" data-occurrence-ends value="'+escapeHtml(calendarControlValue(occurrence.dateKind||"timed",occurrence.endsAt))+'"></label>' +
      '<label class="field"><span>Venue override</span><input data-occurrence-venue value="'+escapeHtml(occurrence.venueName||"")+'"></label>' +
      '<label class="field"><span>Address override</span><input data-occurrence-address value="'+escapeHtml(occurrence.venueAddress||"")+'"></label>' +
      '<label class="field is-wide"><span>Factual description</span><textarea data-occurrence-description>'+escapeHtml(occurrence.factualDescription||"")+'</textarea></label>' +
      '<label class="field"><span>Attendance access</span><select data-occurrence-access-status>'+occurrenceOptions([["public","Open to the public"],["restricted","Restricted audience"],["unknown","Needs access verification"]],occurrence.accessStatus||"unknown")+'</select></label>' +
      '<label class="field"><span>Eligible audiences (comma-separated)</span><input data-occurrence-audiences value="'+escapeHtml((occurrence.audiences||[]).join(", "))+'"></label>' +
      '<label class="field is-wide"><span>Public access note</span><textarea data-occurrence-access-notes>'+escapeHtml(occurrence.accessNotes||"")+'</textarea></label>' +
      '<label class="field is-wide"><span>Official occurrence URL</span><input type="url" data-occurrence-source value="'+escapeHtml(occurrence.sourceUrl||"")+'"></label>' +
      '<label class="field is-wide"><span>Ticket URL</span><input type="url" data-occurrence-ticket value="'+escapeHtml(occurrence.ticketUrl||"")+'"></label>' +
      '<label class="field"><span>Ticket status</span><select data-occurrence-ticket-status>'+occurrenceOptions(TICKET_STATUSES,occurrence.ticketStatus||"unknown")+'</select></label>' +
      '<label class="field"><span>Tickets on sale</span><input data-occurrence-ticket-on-sale value="'+escapeHtml(occurrence.ticketOnSaleAt||"")+'"></label>' +
      '<label class="field is-wide"><span>Public ticket note</span><textarea data-occurrence-ticket-notes>'+escapeHtml(occurrence.ticketNotes||"")+'</textarea></label>' +
      '<label class="field"><span>Verification</span><select data-occurrence-verification>'+occurrenceOptions([["verified","Verified"],["unverified","Unverified"],["needs_verification","Needs verification"]],occurrence.verificationState||"needs_verification")+'</select></label>' +
      '<label class="field is-wide"><span>Verification notes</span><textarea data-occurrence-notes>'+escapeHtml(occurrence.verificationNotes||"")+'</textarea></label>' +
      '</div></article>';
  }

  function occurrenceSection(candidate) {
    return '<div class="editor-section"><div class="section-title-row"><div><h3>Related schedule</h3><p class="section-guidance">Keep the exhibition or primary event above. Add its opening, talks, screenings, workshops, and other dated programs here. Date-TBD items remain private until scheduled. Removing a program that was already published records it as cancelled in subscribed calendars.</p></div><button type="button" data-add-occurrence>Add occurrence</button></div><div class="occurrence-list" id="candidateOccurrences">'+((candidate.occurrences||[]).map(occurrenceRow).join("")||'<p class="occurrences-empty">No related schedule items.</p>')+'</div></div>';
  }

  function relatedLinkRow(link) {
    link = link || {};
    var instagramOnly = isInstagramUrl(link.url);
    return '<article class="related-link-row" data-related-link data-link-id="' + escapeHtml(link.id || "") + '">' +
      '<div class="field-grid">' +
      '<label class="field"><span>Label</span><input data-link-label value="' + escapeHtml(link.label || "") + '"></label>' +
      '<label class="field"><span>URL</span><input data-link-url type="url" value="' + escapeHtml(link.url || "") + '"></label>' +
      '<label class="field"><span>Role</span><select data-link-role>' + occurrenceOptions([["organizer","Organizer"],["venue","Venue"],["ticket","Tickets"],["supporting","Supporting"],["discovery","Discovery lead"]],link.role||"supporting") + '</select></label>' +
      '<label class="field is-wide"><span>Provenance URL</span><input data-link-provenance type="url" value="' + escapeHtml(link.provenanceUrl || "") + '"></label>' +
      '</div><div class="related-link-actions"><label class="check-option"><input data-link-public type="checkbox"' + (link.includePublic ? ' checked' : '') + (instagramOnly ? ' disabled' : '') + '><span>' + (instagramOnly ? 'Private Instagram provenance' : 'Include publicly') + '</span></label>' +
      externalLink(link.url,"Open link") + externalLink(link.provenanceUrl,"Open provenance") + '<button type="button" data-remove-related-link>Remove</button></div></article>';
  }

  function mediaRoleOptions(selected){return [["primary","Primary"],["flyer","Flyer"],["gallery","Gallery"],["supporting","Supporting"]].map(function(option){return '<option value="'+option[0]+'"'+(option[0]===selected?' selected':'')+'>'+option[1]+'</option>';}).join("");}
  function mediaRow(item,index){item=item||{};return '<article class="candidate-media-card" data-candidate-media data-candidate-media-id="'+escapeHtml(item.id||"")+'" data-media-id="'+escapeHtml(item.mediaId||"")+'">'+
    '<div class="candidate-media-preview"><img data-media-preview data-media-url="'+escapeHtml(item.adminUrl||"")+'" alt=""></div><div class="candidate-media-controls"><div class="candidate-media-head"><strong>Media '+(index+1)+'</strong><div><button type="button" data-move-media="up" aria-label="Move media earlier">Up</button><button type="button" data-move-media="down" aria-label="Move media later">Down</button><button type="button" data-remove-media>Remove</button></div></div><div class="field-grid">'+
    '<label class="field"><span>Role</span><select data-media-role>'+mediaRoleOptions(item.role||"gallery")+'</select></label><label class="check-option"><input type="checkbox" data-media-public'+(item.includePublic?' checked':'')+'><span>Include publicly</span></label>'+
    '<label class="field is-wide"><span>Image description</span><textarea data-media-alt>'+escapeHtml(item.altText||"")+'</textarea></label><label class="field is-wide"><span>Caption</span><textarea data-media-caption>'+escapeHtml(item.caption||"")+'</textarea></label>'+
    '<label class="field is-wide"><span>Original image URL</span><input type="url" data-media-source value="'+escapeHtml(item.sourceUrl||"")+'"></label><label class="field is-wide"><span>Provenance URL</span><input type="url" data-media-provenance value="'+escapeHtml(item.provenanceUrl||"")+'"></label></div><div class="candidate-media-links">'+externalLink(item.sourceUrl,"Open original image")+externalLink(item.provenanceUrl,"Open provenance")+'</div></div></article>';}
  function mediaSection(candidate,isNew){var media=candidate.media||[];return '<div class="editor-section"><div class="section-title-row"><div><h3>Event media</h3><p class="section-guidance">Upload or approve any number of flyers and related images. Every item stays private until Include publicly is checked and the event is approved.</p></div><button type="button" data-upload-media'+(isNew?' disabled':'')+'>Upload media</button></div><div class="candidate-media-list" id="candidateMediaList">'+(media.length?media.map(mediaRow).join(""):'<p class="media-empty">No event media captured.</p>')+'</div><input id="candidateMediaFiles" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden></div>';}

  function socialEvidenceSection(candidate) {
    var evidence = candidate.socialEvidence || [];
    if (!evidence.length) return '';
    return '<div class="editor-section"><h3>Private social evidence</h3><p class="section-guidance">Post excerpts, identity, trust, and corroboration stay inside Studio.</p><div class="social-evidence-list">' + evidence.map(function (item) {
      return '<article class="social-evidence-card"><div class="social-evidence-head"><strong>' + escapeHtml(item.platform + ' / @' + (item.authorHandle || 'unknown')) + '</strong><span>' + escapeHtml(item.evidenceRole + ' / ' + item.corroborationState) + '</span></div>' +
        '<p>' + escapeHtml(item.captionExcerpt || 'No caption excerpt captured.') + '</p><p class="source-meta">Posted: ' + escapeHtml(displayDate(item.postedAt)) + (item.authorIsVerified ? '<br>Platform verification badge observed — trust unchanged.' : '') + '</p><div class="social-evidence-links">' +
        externalLink(item.postUrl,'Open post') + externalLink(item.sourceProfileUrl,'Open registered profile') + '</div></article>';
    }).join('') + '</div></div>';
  }

  function changeValue(value) {
    if (value === null || value === undefined || value === "") return "Not set";
    if (Array.isArray(value)) return value.length ? value.map(function (item) { return typeof item === "object" ? JSON.stringify(item) : String(item); }).join(", ") : "None";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }
  function revisionMarkup(revision) {
    var changes = Array.isArray(revision.changes) ? revision.changes : [];
    return '<article class="revision"><strong>Revision ' + revision.revisionNumber + ' / ' + escapeHtml(revision.revisionState) + '</strong><br>' + escapeHtml(revision.changeSummary || "Saved candidate snapshot") + '<br>' + escapeHtml(displayDate(revision.createdAt)) + (changes.length ? '<dl class="revision-changes">' + changes.map(function (change) { return '<div><dt>' + escapeHtml(change.label || change.field) + '</dt><dd><span>' + escapeHtml(changeValue(change.before)) + '</span><strong>to</strong><span>' + escapeHtml(changeValue(change.after)) + '</span></dd></div>'; }).join("") + '</dl>' : '') + '</article>';
  }
  function sourceMonitoringSection(candidate, isNew) {
    var status = candidate.lastCheckStatus || "never";
    return '<div class="editor-section source-monitoring"><div class="section-title-row"><div><h3>Source monitoring</h3><p class="section-guidance">Rechecks compare this event-specific source with the private candidate. Published facts remain unchanged until Approve + Update.</p></div>' + (!isNew ? '<button type="button" data-action="recheck"' + (!candidate.sourceUrl ? ' disabled' : '') + '>Recheck Source</button>' : '') + '</div>' +
      '<div class="source-check-state is-' + escapeHtml(status) + '"><strong>' + escapeHtml(status.replace(/_/g," ")) + '</strong><span>Last checked / ' + escapeHtml(candidate.lastCheckedAt ? displayDate(candidate.lastCheckedAt) : "Never") + '</span><p>' + escapeHtml(candidate.lastCheckSummary || "No source check has run for this event.") + '</p></div>' +
      '<div class="field-grid"><label class="check-option"><input id="candidateMonitoringEnabled" type="checkbox"' + (candidate.monitoringEnabled ? ' checked' : '') + '><span>Monitor automatically until the event ends</span></label>' + field("candidateMonitoringCadenceHours","Monitoring cadence / hours",candidate.monitoringCadenceHours||24,{type:"number"}) + (candidate.nextCheckAt ? '<p class="section-guidance is-wide">Next scheduled check / ' + escapeHtml(displayDate(candidate.nextCheckAt)) + '</p>' : '') + '</div></div>';
  }

  function sourceResolutionAttemptsSection(candidate) {
    var attempts = candidate.sourceResolutionAttempts || [];
    if (!attempts.length) return '';
    return '<div class="editor-section"><h3>Source-resolution audit</h3><p class="section-guidance">This records the bounded searches, pages considered, selected source, and final reason. It remains private.</p><div class="resolution-attempt-list">' + attempts.map(function (attempt) {
      return '<article class="resolution-attempt-card is-' + escapeHtml(attempt.status) + '"><strong>' + escapeHtml(attempt.status.replace(/_/g,' ')) + ' / ' + escapeHtml(displayDate(attempt.createdAt)) + '</strong><p class="source-meta">' + escapeHtml(attempt.notes || 'No resolution note recorded.') + '</p>' + externalLink(attempt.leadUrl,'Open discovery lead') + externalLink(attempt.selectedUrl,'Open selected source') + '<pre>' + escapeHtml(JSON.stringify({queries:attempt.searchQueries,attemptedUrls:attempt.attemptedUrls},null,2)) + '</pre></article>';
    }).join('') + '</div></div>';
  }

  var RESEARCH_SHORTCUTS=[
    "Verify the date, time, and time zone.","Confirm exactly who may attend and whether this is public.","Find the original organizer or venue event source.","Find tickets or registration and confirm availability.","Find related openings, talks, screenings, performances, panels, or workshops with their own links.","Find official flyers and related event images with provenance.","Find useful organizer, venue, artist, and speaker links.","Improve the factual description using only sourced facts.","Regenerate the private review and programming intelligence.","Inspect every missing or conflicting field and propose corrections."
  ];
  function researchSection(candidate,isNew){return '<div class="editor-section research-section"><div class="section-title-row"><div><h3>Research with Scout</h3><p class="section-guidance">This private conversation researches only this event. Findings remain inert until you apply selected changes, and publication still requires approval.</p></div></div>'+(isNew?'<p class="empty-state">Save the candidate before starting its research conversation.</p>':'<div id="candidateResearch"><p class="empty-state">Loading this event\'s Scout conversation…</p></div>')+'</div>';}
  function researchCitations(citations){return (citations||[]).map(function(item){var url=typeof item==="string"?item:item.url;var label=typeof item==="string"?"Open source":item.title||"Open source";return externalLink(url,label);}).join("");}
  function proposalMarkup(proposal){
    var applied=proposal.appliedChangeIds||[];
    var open=["pending","partially_applied"].includes(proposal.state);
    var findings=(proposal.findings||[]).map(function(finding){return '<div class="research-finding is-'+escapeHtml(finding.status)+'"><strong>'+escapeHtml(finding.status)+'</strong><p>'+escapeHtml(finding.text)+'</p>'+researchCitations(finding.citations)+'</div>';}).join("");
    var changes=(proposal.changes||[]).map(function(change,index){var done=applied.includes(change.id);var inputId='research-change-'+proposal.id+'-'+index;return '<div class="research-change'+(done?' is-applied':'')+'"><input id="'+escapeHtml(inputId)+'" type="checkbox" data-research-change="'+escapeHtml(change.id)+'" aria-label="Select '+escapeHtml(change.label||change.path)+'"'+(!open||done?' disabled':'')+'><div class="research-change-body"><label class="research-change-copy" for="'+escapeHtml(inputId)+'"><strong>'+escapeHtml(change.label||change.path)+'</strong><small>'+escapeHtml(changeValue(change.before))+' → '+escapeHtml(changeValue(change.value))+'</small><em>'+escapeHtml(change.rationale||"")+'</em><span class="research-confidence">Confidence '+Math.round((Number(change.confidence)||0)*100)+'%</span></label><div class="research-change-citations">'+researchCitations(change.citations)+'</div></div></div>';}).join("")||'<p class="section-guidance">The Scout answered without proposing record changes.</p>';
    return '<article class="research-proposal is-'+escapeHtml(proposal.state)+'"><div class="research-proposal-head"><strong>Proposed changes</strong><span>'+escapeHtml(proposal.state.replace(/_/g," "))+'</span></div>'+findings+'<div class="research-change-list">'+changes+'</div>'+(open?'<div class="research-proposal-actions"><span class="research-selection-status" aria-live="polite">0 changes selected</span><button type="button" data-select-research="all">Select all remaining</button><button type="button" data-apply-research="'+escapeHtml(proposal.id)+'" disabled>Apply selected changes</button><button type="button" data-dismiss-research="'+escapeHtml(proposal.id)+'">Dismiss proposal</button></div>':'')+'</article>';
  }
  function syncResearchSelection(proposal){if(!proposal)return;var selected=proposal.querySelectorAll("[data-research-change]:checked").length;var status=proposal.querySelector(".research-selection-status");var apply=proposal.querySelector("[data-apply-research]");if(status)status.textContent=selected+(selected===1?" change selected":" changes selected");if(apply)apply.disabled=selected===0;}
  function renderResearch(payload){var root=document.getElementById("candidateResearch");if(!root)return;state.research=payload;var messages=payload.messages||[];var eventRules=(payload.rules||[]).filter(function(rule){return rule.scope==="event"&&rule.status==="active";});var sourceRules=(payload.rules||[]).filter(function(rule){return rule.scope==="source"&&rule.status==="pending";});root.innerHTML='<div class="research-shortcuts">'+RESEARCH_SHORTCUTS.map(function(prompt){return '<button type="button" data-research-shortcut="'+escapeHtml(prompt)+'">'+escapeHtml(prompt)+'</button>';}).join("")+'</div><div class="research-memory"><h4>Remembered for this event</h4>'+(eventRules.length?eventRules.map(function(rule){return '<div><span>'+escapeHtml(rule.instruction)+'</span><button type="button" data-delete-research-rule="'+escapeHtml(rule.id)+'">Forget</button></div>';}).join(""):'<p>No event-specific instructions remembered yet.</p>')+(sourceRules.length?'<h4>Suggested source rules</h4>'+sourceRules.map(function(rule){return '<div><span>'+escapeHtml(rule.instruction)+'</span><button type="button" data-research-rule-action="accept" data-rule-id="'+escapeHtml(rule.id)+'">Use for this source</button><button type="button" data-research-rule-action="dismiss" data-rule-id="'+escapeHtml(rule.id)+'">Dismiss</button></div>';}).join(""):'')+'</div><div class="research-transcript">'+(messages.length?messages.map(function(message){return '<article class="research-message is-'+escapeHtml(message.role)+'"><span>'+escapeHtml(message.role==="user"?"You":"Scout")+'</span><p>'+escapeHtml(message.body)+'</p>'+researchCitations(message.citations)+'</article>';}).join(""):'<p class="empty-state">Ask the Scout to verify or find something about this event.</p>')+'</div><div class="research-proposals">'+(payload.proposals||[]).map(proposalMarkup).join("")+'</div><form class="research-composer" data-research-form><label><span>Instruction for this event</span><textarea id="candidateResearchMessage" maxlength="4000" placeholder="Find the actual opening time, confirm public access, and separate any artist talks…"></textarea></label><button type="submit"'+(payload.broadDiscoveryEnabled===false?' disabled':'')+'>Research this event</button></form>'+(payload.broadDiscoveryEnabled===false?'<p class="source-reliability-warning">Candidate research is unavailable until OPENAI_API_KEY is configured. Source monitoring still works independently.</p>':'');var transcript=root.querySelector(".research-transcript");if(transcript)transcript.scrollTop=transcript.scrollHeight;}
  async function loadCandidateResearch(candidateId){var payload=await api("/api/admin/calendar/candidates/"+encodeURIComponent(candidateId)+"/research");payload.research.broadDiscoveryEnabled=payload.broadDiscoveryEnabled;renderResearch(payload.research);}

  function accessReady(record) {
    return record.accessStatus === "public" || (record.accessStatus === "restricted" && Boolean(record.accessNotes) && Array.isArray(record.audiences) && record.audiences.length > 0);
  }

  function verifiedInstagramSource(record) {
    return record.verificationState === "verified" && isInstagramUrl(record.sourceUrl);
  }

  function sourceReady(record) {
    return verifiedInstagramSource(record) || (record.sourceAuthority !== "unresolved" && !isSocialUrl(record.sourceUrl));
  }

  function matchesStatus(candidate, status) {
    if (status === "review") return candidate.status === "candidate" || candidate.status === "needs_verification";
    if (status === "updates") return candidate.status === "published" && Boolean(candidate.pendingRevisionId);
    if (status === "ready") return ["candidate","needs_verification"].includes(candidate.status) && candidate.verificationState === "verified" && sourceReady(candidate) && accessReady(candidate);
    return candidate.status === status;
  }
  function lifecycleLabel(candidate) {
    if (candidate.status === "published" && candidate.pendingRevisionId) return "update awaiting review";
    if (["candidate","needs_verification"].includes(candidate.status) && candidate.verificationState === "verified" && sourceReady(candidate) && accessReady(candidate)) return "ready to publish";
    return candidate.status.replace(/_/g," ");
  }
  function recordLabel(candidate) {
    if (candidate.status === "published" && candidate.pendingRevisionId) return "Published event update";
    if (candidate.status === "published") return "Published event record";
    if (["candidate","needs_verification"].includes(candidate.status) && candidate.verificationState === "verified" && sourceReady(candidate) && accessReady(candidate)) return "Ready to publish";
    return "Candidate record";
  }

  function renderStatusFilters() {
    document.getElementById("statusFilters").innerHTML = STATUSES.map(function (item) { var count = state.candidates.filter(function (candidate) { return matchesStatus(candidate,item[0]); }).length; return '<button type="button" data-status="' + item[0] + '" class="' + (state.filter === item[0] ? 'is-active' : '') + '">' + escapeHtml(item[1]) + ' / ' + count + '</button>'; }).join("");
  }
  function renderCandidateList() {
    var candidates = state.candidates.filter(function (candidate) { return matchesStatus(candidate,state.filter); });
    listRoot.innerHTML = candidates.length ? candidates.map(function (candidate) { return '<article class="candidate-card' + (candidate.id === state.selectedId ? ' is-active' : '') + '"><button class="candidate-card-select" type="button" data-candidate-id="' + escapeHtml(candidate.id) + '"><span class="status">' + escapeHtml(lifecycleLabel(candidate)) + '</span><strong>' + escapeHtml(candidate.title) + '</strong><span>' + escapeHtml(displayDate(candidate.startsAt)) + '</span><span>' + escapeHtml(candidate.venueName || candidate.organizer || "Venue not confirmed") + '</span>' + (candidate.lastCheckStatus && candidate.lastCheckStatus !== "never" ? '<span>Source check / ' + escapeHtml(candidate.lastCheckStatus.replace(/_/g," ")) + '</span>' : '') + '</button>' + externalLink(candidate.sourceUrl,"Open source","candidate-source-link") + '</article>'; }).join("") : '<p class="empty-state">No event records in this view.</p>';
  }
  function skipCandidate() {
    var queue = state.candidates.filter(function (candidate) { return matchesStatus(candidate,state.filter); });
    if (!queue.length) { toast("There are no events in this view."); return; }
    var currentIndex = queue.findIndex(function (candidate) { return candidate.id === state.selectedId; });
    var nextCandidate = currentIndex < 0 ? queue[0] : queue[(currentIndex + 1) % queue.length];
    if (!nextCandidate || nextCandidate.id === state.selectedId) { toast("There are no other events in this view."); return; }
    toast("Skipped. No changes were saved.");
    selectCandidate(nextCandidate.id);
  }
  function renderEditor(candidate) {
    state.mediaPreviewUrls.forEach(function(url){URL.revokeObjectURL(url);});state.mediaPreviewUrls=[];state.research=null;
    state.activeCandidate = candidate;
    if (!candidate) { editorRoot.innerHTML = '<p class="empty-state">Select a candidate or start a manual intake.</p>'; return; }
    var isNew = !candidate.id;
    var revisions = candidate.revisions || [];
    var instagramSource = isInstagramUrl(candidate.sourceUrl);
    var instagramTicket = isInstagramUrl(candidate.ticketUrl);
    var verifiedInstagram = verifiedInstagramSource(candidate);
    var occurrencesReady = (candidate.occurrences||[]).every(function (occurrence) { var occurrenceSource=occurrence.sourceUrl||candidate.sourceUrl;var occurrenceSourceReady=!isSocialUrl(occurrenceSource)||(isInstagramUrl(occurrenceSource)&&occurrence.verificationState==="verified");return occurrence.status === "tbd" || (occurrence.verificationState === "verified" && accessReady(occurrence) && occurrence.startsAt && occurrenceSourceReady); });
    var canPublish = !isNew && candidate.verificationState === "verified" && sourceReady(candidate) && accessReady(candidate) && !instagramTicket && occurrencesReady && !["rejected","cancelled","duplicate"].includes(candidate.status) && (candidate.status !== "published" || candidate.pendingRevisionId);
    var publishLabel = candidate.status === "published" ? "Approve + Update" : "Approve + Publish";
    editorRoot.innerHTML = '<div class="editor-head"><div><p class="eyebrow">' + (isNew ? 'Manual intake' : recordLabel(candidate)) + '</p><h2>' + escapeHtml(candidate.title || "New candidate") + '</h2></div><span class="status-badge">' + escapeHtml(lifecycleLabel(candidate)) + '</span></div>' +
      '<div class="editor-section"><h3>Public factual record</h3><div class="field-grid">' +
      '<label class="field"><span>Registry source</span><select id="candidateSourceId">' + sourceChoices(candidate.sourceId || "") + '</select></label>' +
      field("candidateSourceEventId","Source event ID",candidate.sourceEventId) +
      linkedField("candidateDiscoveryUrl","Discovery lead URL (private)",candidate.discoveryUrl,"Open discovery lead",{wide:true}) +
      field("candidateSourceAuthority","Source authority",candidate.sourceAuthority||"unresolved",{type:"select",choices:[["unresolved",instagramSource?"Instagram source - verify manually":"Unresolved - cannot publish"],["organizer_event","Organizer event page"],["venue_event","Venue event page"],["official_calendar","Official organization calendar"],["authorized_ticket_host","Authorized ticket host"]]}) +
      linkedField("candidateSourceUrl","Original event source URL",candidate.sourceUrl,"Open original source",{wide:true}) + linkedField("candidateTicketUrl","Ticket URL",candidate.ticketUrl,"Open ticket link",{wide:true}) +
      field("candidateScheduleStatus","Schedule status",candidate.scheduleStatus||"scheduled",{type:"select",choices:[["scheduled","Scheduled"],["postponed","Postponed"],["rescheduled","Rescheduled"],["cancelled","Cancelled"],["moved_online","Moved online"]]}) + field("candidateTicketStatus","Ticket status",candidate.ticketStatus||"unknown",{type:"select",choices:TICKET_STATUSES}) +
      field("candidateTicketOnSaleAt","Tickets on sale (ISO, optional)",candidate.ticketOnSaleAt) + field("candidateTicketNotes","Public ticket note",candidate.ticketNotes,{type:"textarea"}) +
      linkedField("candidateOrganizerUrl","Organizer website (optional when source is organizer page)",candidate.organizerUrl,"Open organizer",{wide:true}) + linkedField("candidateVenueUrl","Venue website (optional when source is venue page)",candidate.venueUrl,"Open venue",{wide:true}) +
      field("candidateSourceResolutionNotes","Source-resolution notes (private)",candidate.sourceResolutionNotes,{type:"textarea",wide:true}) +
      (candidate.sourceAuthority === "unresolved" && !instagramSource ? '<p class="source-reliability-warning">This is still a lead. Find an event-specific organizer or venue page, or an authorized ticket listing supported by the organizer or venue website, before publishing.</p>' : '') +
      (instagramSource ? '<p class="source-reliability-warning">' + (verifiedInstagram ? 'Human-verified Instagram source. It may publish as Official details; keep tickets or registration on a separate non-social URL.' : 'Instagram may be the public source when no other event page exists. Correct the factual fields, set Verification to Verified, save, then approve the event.') + '</p>' : '') +
      (instagramTicket ? '<p class="source-reliability-warning">Instagram cannot be used as the ticket or registration URL.</p>' : '') +
      field("candidateTitle","Title",candidate.title,{wide:true}) + field("candidateOrganizer","Organizer",candidate.organizer) + field("candidateEventStructure","Event structure",candidate.eventStructure||"single",{type:"select",choices:[["single","Single event / one continuous run"],["series","Series / separate dated programs"],["exhibition","Exhibition / on-view period"]]}) + field("candidateDateKind","Schedule",candidate.dateKind,{type:"select",choices:[["timed","Has a date and time"],["all_day","All day on one date"],["date_range","Runs across multiple dates"]]}) +
      field("candidateStartsAt",candidate.dateKind==="date_range"?"First date":candidate.dateKind==="all_day"?"Event date":"Starts",calendarControlValue(candidate.dateKind,candidate.startsAt),{type:candidate.dateKind==="timed"?"datetime-local":"date"}) + field("candidateEndsAt",candidate.dateKind==="date_range"?"Last date":"Ends (optional)",calendarControlValue(candidate.dateKind,candidate.endsAt),{type:candidate.dateKind==="timed"?"datetime-local":"date"}) + field("candidateTimezone","Time zone",candidate.timezone) + '<div class="candidate-schedule-guidance is-wide" id="candidateScheduleGuidance"></div>' + field("candidateVenueName","Venue",candidate.venueName) +
      field("candidateVenueAddress","Venue address",candidate.venueAddress,{wide:true}) + field("candidateCity","City",candidate.city) + field("candidateRegion","State / region",candidate.region) + field("candidateDescription","Factual description",candidate.factualDescription,{type:"textarea",wide:true}) +
      field("candidateAccessStatus","Attendance access",candidate.accessStatus||"unknown",{type:"select",choices:[["public","Open to the public"],["restricted","Restricted audience"],["unknown","Needs access verification"]]}) + field("candidateAudiences","Eligible audiences (comma-separated)",(candidate.audiences||[]).join(", ")) + field("candidateAccessNotes","Public access note",candidate.accessNotes,{type:"textarea",wide:true}) +
      '<p class="section-guidance is-wide">Restricted access is published on the event card, API, and calendar feeds. Verification notes below remain private.</p>' +
      '</div><p class="field-label">Subjects</p>' + checkboxes("subjects",SUBJECTS,candidate.subjects) + '<p class="field-label">Formats</p>' + checkboxes("formats",FORMATS,candidate.formats) +
      '<label class="check-option"><input id="candidateExperimental" type="checkbox"' + (candidate.experimental ? ' checked' : '') + '><span>Experimental attribute</span></label></div>' +
      occurrenceSection(candidate) +
      '<div class="editor-section"><div class="section-title-row"><h3>Related links</h3><button type="button" data-add-related-link>Add link</button></div><p class="section-guidance">Links remain private unless Include publicly is checked and the event is approved.</p><div class="related-link-list" id="candidateRelatedLinks">' + ((candidate.relatedLinks || []).map(relatedLinkRow).join("") || '<p class="related-links-empty">No related links captured.</p>') + '</div></div>' +
      mediaSection(candidate,isNew) +
      socialEvidenceSection(candidate) +
      sourceResolutionAttemptsSection(candidate) +
      sourceMonitoringSection(candidate,isNew) +
      researchSection(candidate,isNew) +
      '<div class="editor-section"><h3>Verification + provenance</h3><div class="field-grid">' +
      field("candidateVerificationState","Verification",candidate.verificationState,{type:"select",choices:[["verified","Verified"],["unverified","Unverified"],["needs_verification","Needs verification"]]}) + field("candidateConfidence","Confidence",candidate.confidence,{type:"number",step:"0.01"}) +
      field("candidateVerificationNotes","Verification notes",candidate.verificationNotes,{type:"textarea",wide:true}) + field("candidateRejectionReason","Rejection reason",candidate.rejectionReason) + field("candidateDuplicateOf","Duplicate of",candidate.duplicateOf) + '</div></div>' +
      '<div class="editor-section"><h3>Private review intelligence</h3><p class="section-guidance">The Scout generates these private fields for every discovered event. They remain editable here and never appear on the public calendar or feeds.</p><div class="field-grid">' + field("candidatePrivateRationale","Why it fits",candidate.privateRationale,{type:"textarea",wide:true}) + field("candidateAttendanceUse","Best use",candidate.attendanceUse,{type:"textarea"}) + field("candidateProgrammingIdeas","Programming model worth studying",candidate.programmingIdeas,{type:"textarea"}) + field("candidateCollaborators","Potential collaborators",candidate.potentialCollaborators,{type:"textarea"}) + field("candidateInternalNotes","Internal notes",candidate.internalNotes,{type:"textarea"}) + '</div></div>' +
      (!isNew ? '<div class="editor-section"><h3>Detected changes + revisions</h3><div class="revision-list">' + (revisions.length ? revisions.map(revisionMarkup).join("") : '<p class="empty-state">No revisions recorded.</p>') + '</div></div>' : '') +
      '<div class="editor-actions"><button type="button" data-action="save">' + (isNew ? 'Create candidate' : 'Save') + '</button>' + (!isNew ? '<button type="button" data-action="skip">Skip</button><button type="button" data-action="recheck"' + (!candidate.sourceUrl ? ' disabled' : '') + '>Recheck Source</button>' + (candidate.pendingRevisionId ? '<button type="button" data-action="review-change">Review Detected Change</button>' : '') + (canPublish ? '<button type="button" data-action="approve">' + publishLabel + '</button>' : '') + '<button type="button" data-action="reject">Reject</button><button type="button" data-action="duplicate">Mark Duplicate</button><button type="button" data-action="cancel">Mark Cancelled</button>' : '') + '</div>';
    scheduleGuidance();
    hydrateMediaPreviews();
    if(!isNew)loadCandidateResearch(candidate.id).catch(function(error){var root=document.getElementById("candidateResearch");if(root)root.innerHTML='<p class="source-reliability-warning">'+escapeHtml(error.message)+'</p>';});
  }
  async function hydrateMediaPreviews(){var images=Array.from(editorRoot.querySelectorAll("[data-media-preview]"));await Promise.all(images.map(async function(image){if(!image.dataset.mediaUrl)return;try{var response=await fetch(image.dataset.mediaUrl,{headers:{authorization:"Bearer "+token}});if(!response.ok)throw new Error("Media preview unavailable.");var blob=await response.blob();var url=URL.createObjectURL(blob);state.mediaPreviewUrls.push(url);image.src=url;image.alt=(image.closest("[data-candidate-media]").querySelector("[data-media-alt]")||{}).value||"Event media preview";}catch(error){toast(error.message);}}));}
  async function uploadMedia(files){if(!state.selectedId||!files.length)return;var current=candidatePayload();for(var file of files){if(!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type))throw new Error("Use JPEG, PNG, WebP, or GIF images.");if(file.size>15*1024*1024)throw new Error("Each image must be 15 MB or smaller.");var form=new FormData();form.append("file",file);form.append("privacy","internal");form.append("consent_status","not-required");form.append("public_presentation","hidden");form.append("alt_text",(state.activeCandidate.title||"Event")+" image");var response=await fetch("/api/admin/media",{method:"POST",headers:{authorization:"Bearer "+token},body:form});var payload=await response.json().catch(function(){return {};});if(!response.ok)throw new Error(payload.error||"Media upload failed.");current.media.push({id:"",mediaId:payload.record.id,sourceUrl:"",provenanceUrl:"",role:current.media.length?"gallery":"primary",altText:(state.activeCandidate.title||"Event")+" image",caption:"",includePublic:false,sortOrder:current.media.length});}await api("/api/admin/calendar/candidates/"+encodeURIComponent(state.selectedId),{method:"PATCH",body:JSON.stringify(current)});toast(files.length+" media item"+(files.length===1?"":"s")+" uploaded privately.");await refreshCandidates(state.selectedId);}
  async function selectCandidate(id) {
    state.selectedId = id; state.draftNew = false; renderCandidateList();
    try { var payload = await api("/api/admin/calendar/candidates/" + encodeURIComponent(id)); var index = state.candidates.findIndex(function (candidate) { return candidate.id === id; }); if (index >= 0) state.candidates[index] = payload.candidate; renderEditor(payload.candidate); }
    catch (error) { toast(error.message); }
  }
  async function refreshCandidates(selectId, options) {
    options = options || {};
    var payload = await api("/api/admin/calendar/candidates");
    state.candidates = payload.candidates || [];
    if (options.nextQueue) {
      state.filter = options.nextQueue;
      var remainingReview = state.candidates.filter(function (candidate) {
        return candidate.id !== options.excludeId && matchesStatus(candidate,options.nextQueue);
      });
      var nextIndex = Math.min(Math.max(Number(options.reviewIndex) || 0, 0), Math.max(remainingReview.length - 1, 0));
      var nextCandidate = remainingReview[nextIndex];
      state.selectedId = nextCandidate ? nextCandidate.id : "";
      renderStatusFilters();
      renderCandidateList();
      if (nextCandidate) await selectCandidate(nextCandidate.id); else renderEditor(null);
      return;
    }
    renderStatusFilters();
    renderCandidateList();
    if (selectId) await selectCandidate(selectId);
    else if (state.selectedId && state.candidates.some(function (candidate) { return candidate.id === state.selectedId; })) await selectCandidate(state.selectedId);
    else { state.selectedId = ""; renderEditor(null); }
  }
  async function scoutPastedLink(event) {
    event.preventDefault();
    var input = document.getElementById("eventLinkInput");
    var button = document.getElementById("scoutLinkButton");
    var status = document.getElementById("linkIntakeStatus");
    var pastedUrl = input.value.trim();
    if (!pastedUrl || !input.reportValidity()) return;
    button.disabled = true;
    button.textContent = "Scouting…";
    status.className = "";
    status.textContent = "Reading the event page and extracting a private candidate…";
    try {
      var payload = await api("/api/admin/calendar/candidates/from-url", { method:"POST", body:JSON.stringify({ url:pastedUrl }) });
      var message = payload.existing ? "Existing private candidate refreshed from the pasted link." : "Private candidate created from the pasted link.";
      input.value = "";
      status.className = "is-success";
      status.textContent = message + " Review every extracted field before publishing.";
      toast(message);
      state.filter = "review";
      await refreshCandidates(payload.candidate.id);
    } catch (error) {
      status.className = "is-error";
      status.textContent = error.message;
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Scout Link";
    }
  }
  async function editorAction(action) {
    if (action === "skip") { skipCandidate(); return; }
    if (action === "review-change") { var revisions = editorRoot.querySelector(".revision-list"); if (revisions) revisions.scrollIntoView({ behavior:"smooth", block:"center" }); return; }
    if (action === "recheck") {
      if (!state.selectedId) return;
      var recheckButtons=Array.from(editorRoot.querySelectorAll('button[data-action="recheck"]'));recheckButtons.forEach(function(button){button.disabled=true;});toast("Checking the event source for changes.");
      try { var result=await api("/api/admin/calendar/candidates/"+encodeURIComponent(state.selectedId)+"/recheck",{method:"POST",body:"{}"});toast(result.checkStatus==="changes_detected"?"Source changes found. Review them before updating the public event.":result.summary||"Source check complete.");await refreshCandidates(state.selectedId); }
      catch(error){toast(error.message);}finally{recheckButtons.forEach(function(button){button.disabled=false;});}
      return;
    }
    var body = candidatePayload();
    try {
      if(action==="approve"){var scheduleErrors=scheduleClientErrors();if(scheduleErrors.length){var scheduleRoot=document.getElementById("candidateScheduleGuidance");if(scheduleRoot){scheduleRoot.classList.add("has-warning");scheduleRoot.innerHTML=scheduleErrors.map(function(message){return '<p>'+escapeHtml(message)+'</p>';}).join("");scheduleRoot.scrollIntoView({behavior:"smooth",block:"center"});}toast("Fix the highlighted schedule before publishing.");return;}}
      if (!state.selectedId) { var created = await api("/api/admin/calendar/candidates", { method:"POST", body:JSON.stringify(body) }); state.selectedId = created.candidate.id; toast(created.duplicate ? "Candidate created and flagged as a duplicate." : "Candidate created."); await refreshCandidates(state.selectedId); return; }
      if (action === "save") { await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId), { method:"PATCH", body:JSON.stringify(body) }); toast("Candidate saved."); }
      if (action === "approve") { var approvedId = state.selectedId; var wasPublished = state.candidates.some(function (candidate) { return candidate.id === approvedId && candidate.status === "published"; }); var queueName=wasPublished?"updates":"review"; var reviewQueue = state.candidates.filter(function (candidate) { return matchesStatus(candidate,queueName); }); var reviewIndex = Math.max(reviewQueue.findIndex(function (candidate) { return candidate.id === approvedId; }),0); await api("/api/admin/calendar/candidates/" + encodeURIComponent(approvedId), { method:"PATCH", body:JSON.stringify(body) }); await api("/api/admin/calendar/candidates/" + encodeURIComponent(approvedId) + "/approve", { method:"POST", body:"{}" }); toast(wasPublished ? "Approved changes updated the published event. Moving to the next update." : "Event published. Moving to the next review."); await refreshCandidates("", { nextQueue:queueName, excludeId:approvedId, reviewIndex:reviewIndex }); return; }
      if (action === "reject") { await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId) + "/reject", { method:"POST", body:JSON.stringify({ reason:body.rejectionReason }) }); toast("Candidate rejected. It remains private."); }
      if (action === "duplicate") { await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId) + "/duplicate", { method:"POST", body:JSON.stringify({ duplicateOf:body.duplicateOf }) }); toast("Candidate marked as duplicate."); }
      if (action === "cancel") { await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId) + "/cancel", { method:"POST", body:"{}" }); toast("Cancellation recorded."); }
      await refreshCandidates(state.selectedId);
    } catch (error) { toast(error.details && error.details.length ? error.details.join(" ") : error.message); }
  }

  function renderSources() {
    document.getElementById("sourceList").innerHTML = state.sources.map(function (source) {
      return '<article class="source-card" data-source-id="' + escapeHtml(source.id) + '">' +
        field("sourceName-"+source.id,"Name",source.name) +
        '<div class="source-url-field">' + field("sourceUrl-"+source.id,"URL",source.url,{type:"url"}) + externalLink(source.url,"Open source") + '</div>' +
        field("sourceCadence-"+source.id,"Cadence hours",source.cadenceHours,{type:"number"}) +
        '<label class="field"><span>Enabled</span><select id="sourceEnabled-' + source.id + '"><option value="1"' + (source.enabled?' selected':'') + '>Enabled</option><option value="0"' + (!source.enabled?' selected':'') + '>Paused</option></select></label>' +
        '<label class="field"><span>Source type</span><select id="sourceType-' + source.id + '">' + [["official_html","Official HTML"],["calendar","Calendar"],["json","JSON"],["rss","RSS"],["discovery","Discovery"]].map(function(option){return '<option value="'+option[0]+'"'+(source.sourceType===option[0]?' selected':'')+'>'+option[1]+'</option>';}).join('') + '</select></label>' +
        '<label class="field"><span>Adapter</span><select id="sourceAdapter-' + source.id + '">' + [["automatic","Automatic"],["squarespace","Squarespace Events"],["high_art_making","High Art Making"],["eyedrum","Eyedrum"],["rampant","Rampant Gallery"],["eventbrite","Eventbrite discovery"],["posh","Posh discovery"],["wix","Wix"],["localist","Localist"],["out_of_hand","Out of Hand"],["json","JSON"],["icalendar","iCalendar"],["rss","RSS"]].map(function(option){return '<option value="'+option[0]+'"'+((source.adapterKey||"automatic")===option[0]?' selected':'')+'>'+option[1]+'</option>';}).join('') + '</select></label>' +
        '<label class="field"><span>Rendering</span><select id="sourceRenderMode-' + source.id + '"><option value="static"'+((source.renderMode||"static")==="static"?' selected':'')+'>Static / API first</option><option value="dynamic-fallback"'+(source.renderMode==="dynamic-fallback"?' selected':'')+'>Dynamic fallback</option></select></label>' +
        field("sourceAdapterConfig-"+source.id,"Adapter configuration (JSON)",JSON.stringify(source.adapterConfig||{}),{wide:true}) +
        '<label class="field"><span>Trust</span><select id="sourceTrust-' + source.id + '">' + [["official","Official"],["trusted","Trusted"],["discovery","Discovery"]].map(function(option){return '<option value="'+option[0]+'"'+(source.trustLevel===option[0]?' selected':'')+'>'+option[1]+'</option>';}).join('') + '</select></label>' +
        '<p class="section-guidance is-wide-mobile">' + (source.sourceType === "discovery" || source.trustLevel === "discovery" ? 'Lead source: the scout must search past each listing to an original organizer, venue, or authorized ticket page.' : 'Direct source: cite this organization only when its own event page confirms the facts.') + '</p>' +
        '<div class="source-actions"><button type="button" data-save-source>Save</button><button type="button" data-run-source>Run This Source</button></div>' +
        '<p class="source-meta is-wide-mobile">Last attempt: ' + escapeHtml(displayDate(source.lastAttemptAt)) + '<br>Last success: ' + escapeHtml(displayDate(source.lastSuccessAt)) + '<br>Acceptance: ' + (source.acceptanceRate === null ? 'No decisions yet' : Math.round(source.acceptanceRate*100)+'%') + (source.lastError ? '<br>Error: '+escapeHtml(source.lastError) : '') + '</p></article>';
    }).join("");
  }

  function sourcePayload(id) {
    var adapterConfig={};
    try { adapterConfig=JSON.parse(value("sourceAdapterConfig-"+id)||"{}"); } catch { throw new Error("Adapter configuration must be valid JSON."); }
    return {
      name:value("sourceName-"+id), url:value("sourceUrl-"+id), cadenceHours:Number(value("sourceCadence-"+id)),
      enabled:value("sourceEnabled-"+id)==="1", sourceType:value("sourceType-"+id), trustLevel:value("sourceTrust-"+id),
      adapterKey:value("sourceAdapter-"+id), renderMode:value("sourceRenderMode-"+id), adapterConfig:adapterConfig,
    };
  }

  async function refreshSources() {
    var payload=await api("/api/admin/calendar/sources");
    state.sources=payload.sources||[];
    renderSources();
  }
  function renderSocialSources() {
    document.getElementById("socialSourceList").innerHTML = state.socialSources.length ? state.socialSources.map(function (source) {
      var id=source.id;
      return '<article class="social-source-card" data-social-source-id="' + escapeHtml(id) + '">' +
        field("socialName-"+id,"Name",source.name) +
        '<label class="field"><span>Platform</span><select id="socialPlatform-' + id + '">' + [["threads","Threads"],["instagram","Instagram"],["tiktok","TikTok"]].map(function(option){return '<option value="'+option[0]+'"'+(source.platform===option[0]?' selected':'')+'>'+option[1]+'</option>';}).join('') + '</select></label>' +
        field("socialHandle-"+id,"Handle",source.handle) +
        '<div class="source-url-field is-wide-mobile">' + field("socialProfileUrl-"+id,"Profile URL",source.profileUrl,{type:"url"}) + externalLink(source.profileUrl,"Open profile") + '</div>' +
        '<label class="field"><span>Trust</span><select id="socialTrust-' + id + '">' + [["official","Official"],["trusted","Trusted"],["discovery","Discovery"]].map(function(option){return '<option value="'+option[0]+'"'+(source.trustLevel===option[0]?' selected':'')+'>'+option[1]+'</option>';}).join('') + '</select></label>' +
        '<label class="field"><span>Enabled</span><select id="socialEnabled-' + id + '"><option value="1"'+(source.enabled?' selected':'')+'>Enabled</option><option value="0"'+(!source.enabled?' selected':'')+'>Paused</option></select></label>' +
        field("socialCadence-"+id,"Cadence hours",source.cadenceHours,{type:"number"}) + '<button type="button" data-save-social-source>Save</button>' +
        '<p class="source-meta is-wide-mobile">Last success: ' + escapeHtml(displayDate(source.lastSuccessAt)) + '<br>Acceptance: ' + (source.acceptanceRate===null?'No decisions yet':Math.round(source.acceptanceRate*100)+'%') + (source.lastError?'<br>Error: '+escapeHtml(source.lastError):'') + '</p></article>';
    }).join('') : '<p class="empty-state">No social accounts registered. New accounts remain paused until you enable them.</p>';
  }
  function connectorLabel(id) { return ({direct:"Official sources",general_web:"General web search",threads_api:"Threads API",instagram_api:"Instagram API",threads_web:"Threads web search",instagram_web:"Instagram web search",tiktok_web:"TikTok web search"})[id] || id; }
  function renderConnectors() {
    document.getElementById("connectorList").innerHTML = state.connectors.map(function (connector) {
      var id=connector.id;
      return '<article class="connector-card" data-connector-id="' + escapeHtml(id) + '"><div class="connector-title"><strong>' + escapeHtml(connectorLabel(id)) + '</strong><span class="connector-status is-' + escapeHtml(connector.status) + '">' + escapeHtml(connector.status.replace(/_/g,' ')) + '</span></div>' +
        '<label class="field"><span>Enabled</span><select id="connectorEnabled-' + id + '"><option value="1"'+(connector.enabled?' selected':'')+'>Enabled</option><option value="0"'+(!connector.enabled?' selected':'')+'>Disabled</option></select></label>' +
        field("connectorCadence-"+id,"Cadence hours",connector.cadenceHours,{type:"number"}) + field("connectorLimit-"+id,"Per-run limit",connector.perRunLimit,{type:"number"}) +
        '<div class="connector-actions"><button type="button" data-save-connector>Save</button><button type="button" data-run-connector>Run Now</button></div>' +
        '<p class="source-meta">Last success: ' + escapeHtml(displayDate(connector.lastSuccessAt)) + (connector.lastError?'<br>'+escapeHtml(connector.lastError):'') + '</p></article>';
    }).join('');
  }
  function commaList(values) { return (values || []).join(", "); }
  function parseComma(value) { return value.split(",").map(function (item) { return item.trim(); }).filter(Boolean); }
  function renderProfile() {
    var profile = state.profile;
    document.getElementById("discoveryState").textContent = state.broadDiscoveryEnabled ? "Broad discovery is enabled. Official-source monitoring and OpenAI web search can both run." : "Broad discovery is disabled because OPENAI_API_KEY is not configured. Official-source monitoring remains available.";
    if (!profile) return;
    document.getElementById("profileForm").innerHTML = '<h3 class="profile-section-title">Discovery guidance</h3>' + field("profileScoutBrief","Scout Brief",profile.scoutBrief,{type:"textarea",wide:true}) + '<h3 class="profile-section-title">Source-resolution guidance</h3>' + field("profileSourceResolutionRules","Source Resolution Rules",profile.sourceResolutionRules,{type:"textarea",wide:true}) + field("profileSourceResolutionPasses","Maximum resolution passes",profile.sourceResolutionPasses,{type:"number"}) + '<h3 class="profile-section-title">Scoring + cadence</h3>' + field("profileName","Profile name",profile.name) + field("profileModel","Model",profile.model) + field("profileSubjects","Weighted subjects / JSON",JSON.stringify(profile.weightedSubjects,null,2),{type:"textarea"}) + field("profileFormats","Weighted formats / JSON",JSON.stringify(profile.weightedFormats,null,2),{type:"textarea"}) + field("profilePositive","Positive concepts",commaList(profile.positiveConcepts),{type:"textarea",wide:true}) + field("profileNegative","Negative terms",commaList(profile.negativeTerms),{type:"textarea",wide:true}) + field("profileGeography","Geographic rules / JSON",JSON.stringify(profile.geographicRules,null,2),{type:"textarea",wide:true}) + field("profileSocialSettings","Platform keywords, tags, cadence, and limits / JSON",JSON.stringify(profile.socialSettings,null,2),{type:"textarea",wide:true}) + field("profileHorizon","Date horizon / days",profile.dateHorizonDays,{type:"number"}) + field("profileThreshold","Relevance threshold",profile.relevanceThreshold,{type:"number",step:"0.01"}) + field("profileDuplicate","Duplicate sensitivity",profile.duplicateSensitivity,{type:"number",step:"0.01"}) + field("profileLimit","Per-run limit",profile.perRunLimit,{type:"number"}) + field("profileSourceCadence","Source cadence / hours",profile.sourceCadenceHours,{type:"number"}) + field("profileWebCadence","Web cadence / hours",profile.webCadenceHours,{type:"number"}) + '<button type="submit">Save Scout Profile</button>';
  }

  function renderKnownOrganizations() {
    var root = document.getElementById("knownOrganizationList");
    root.innerHTML = state.knownOrganizations.length ? state.knownOrganizations.map(function (organization) {
      var id=organization.id;
      return '<article class="known-organization-card" data-known-organization-id="' + escapeHtml(id) + '">' +
        field("knownName-"+id,"Name",organization.name) + field("knownType-"+id,"Role",organization.organizationType,{type:"select",choices:[["both","Organizer + venue"],["organizer","Organizer"],["venue","Venue"]]}) +
        field("knownAliases-"+id,"Aliases",commaList(organization.aliases),{wide:true}) + field("knownOfficialDomains-"+id,"Official domains",commaList(organization.officialDomains),{wide:true}) +
        field("knownEventPaths-"+id,"Event path prefixes",commaList(organization.eventPaths),{wide:true}) + field("knownTicketDomains-"+id,"Trusted ticket domains",commaList(organization.trustedTicketDomains),{wide:true}) +
        field("knownDiscoveryDomains-"+id,"Discovery-only domains",commaList(organization.discoveryOnlyDomains),{wide:true}) + field("knownNotes-"+id,"Private notes",organization.notes,{type:"textarea",wide:true}) +
        field("knownEnabled-"+id,"Status",organization.enabled?"1":"0",{type:"select",choices:[["1","Enabled"],["0","Paused"]]}) +
        '<div class="known-organization-actions"><button type="button" data-save-known-organization>Save Organization</button><button type="button" data-delete-known-organization>Remove</button></div></article>';
    }).join('') : '<p class="empty-state">No organization records yet. Registered direct sources still provide limited domain context; add recurring organizers and venues here for stronger matching.</p>';
  }
  async function loadSuggestions() {
    var payload = await api("/api/admin/calendar/suggestions"); state.suggestions = payload.suggestions || [];
    document.getElementById("suggestionList").innerHTML = state.suggestions.filter(function (item) { return item.status === "pending"; }).map(function (item) { return '<article class="suggestion-card"><strong>' + escapeHtml(item.rationale) + '</strong><p>' + escapeHtml(JSON.stringify(item.proposedPatch)) + '</p><div class="suggestion-actions"><button data-suggestion-action="accept" data-id="' + item.id + '">Accept</button><button data-suggestion-action="dismiss" data-id="' + item.id + '">Dismiss</button></div></article>'; }).join("") || '<p class="empty-state">No pending adjustments.</p>';
  }
  async function loadRuns() {
    var payload = await api("/api/admin/calendar/runs"); state.runs = payload.runs || [];
    document.getElementById("runList").innerHTML = state.runs.map(function (run) { return '<article class="run-card"><div><h3>' + escapeHtml(run.status) + '</h3><p class="run-meta">' + escapeHtml(displayDate(run.startedAt)) + '<br>' + escapeHtml(run.runKind) + ' / ' + escapeHtml(run.model || "direct sources only") + '<br>' + (run.strongPickCount||0) + ' strong picks / ' + (run.materialUpdateCount||0) + ' material updates<br>' + run.candidateCount + ' candidates / ' + run.duplicateCount + ' duplicates / ' + (run.warningCount||0) + ' warnings / ' + run.failureCount + ' failures</p></div><pre>' + escapeHtml(JSON.stringify({ sources:run.sourcesSearched, queries:run.queries, citations:run.citations, results:run.sourceResults, usage:run.openaiUsage, error:run.errorMessage }, null, 2)) + '</pre></article>'; }).join("") || '<p class="empty-state">No scout runs recorded.</p>';
  }
  async function connect() {
    var submittedToken = tokenInput.value.trim();
    if (submittedToken) token = submittedToken;
    if (!token) { authPanel.hidden=false; return; }
    document.getElementById("authMessage").textContent="";
    try {
      var payload = await api("/api/admin/calendar"); localStorage.setItem(TOKEN_KEY, token); state.candidates=payload.candidates||[]; state.sources=payload.sources||[]; state.socialSources=payload.socialSources||[]; state.connectors=payload.connectors||[]; state.knownOrganizations=payload.knownOrganizations||[]; state.strongPicks=payload.strongPicks||[]; state.profile=payload.profile; state.broadDiscoveryEnabled=payload.broadDiscoveryEnabled;
      tokenInput.value=""; authPanel.hidden=true; app.hidden=false; renderStatusFilters(); renderCandidateList(); renderStrongPicks(); renderSources(); renderSocialSources(); renderConnectors(); renderProfile(); renderKnownOrganizations(); await Promise.all([loadSuggestions(),loadRuns()]);
    } catch (error) {
      if (error.status === 401 || error.status === 403) { token=""; localStorage.removeItem(TOKEN_KEY); tokenInput.value=""; }
      app.hidden=true; authPanel.hidden=false; document.getElementById("authMessage").textContent=error.message;
    }
  }

  document.getElementById("connectButton").addEventListener("click",connect); tokenInput.addEventListener("keydown",function(event){if(event.key==="Enter")connect();});
  if (token) { authPanel.hidden=true; connect(); } else { authPanel.hidden=false; }
  document.querySelector(".studio-tabs").addEventListener("click",function(event){var button=event.target.closest("button[data-view]");if(!button)return;document.querySelectorAll(".studio-tabs button").forEach(function(item){item.classList.toggle("is-active",item===button);});document.querySelectorAll("[data-panel]").forEach(function(panel){panel.hidden=panel.dataset.panel!==button.dataset.view;});});
  document.getElementById("statusFilters").addEventListener("click",function(event){var button=event.target.closest("button[data-status]");if(!button)return;state.filter=button.dataset.status;renderStatusFilters();renderCandidateList();});
  document.getElementById("refreshStrongPicks").addEventListener("click",function(){loadStrongPicks().catch(function(error){toast(error.message);});});
  document.getElementById("strongPicksList").addEventListener("click",async function(event){var button=event.target.closest("[data-review-strong-pick]");if(!button)return;var candidateId=button.dataset.reviewStrongPick;if(!state.candidates.some(function(candidate){return candidate.id===candidateId;}))await refreshCandidates();state.filter="review";renderStatusFilters();renderCandidateList();await selectCandidate(candidateId);document.getElementById("candidateEditor").scrollIntoView({behavior:"smooth",block:"start"});});
  listRoot.addEventListener("click",function(event){var button=event.target.closest("[data-candidate-id]");if(button)selectCandidate(button.dataset.candidateId);});
  editorRoot.addEventListener("click",function(event){
    var actionButton=event.target.closest("button[data-action]");if(actionButton){editorAction(actionButton.dataset.action);return;}
    if(event.target.closest("[data-add-occurrence]")){var occurrenceList=document.getElementById("candidateOccurrences");var occurrenceEmpty=occurrenceList.querySelector(".occurrences-empty");if(occurrenceEmpty)occurrenceEmpty.remove();occurrenceList.insertAdjacentHTML("beforeend",occurrenceRow({occurrenceType:"other",status:"scheduled",ticketStatus:"unknown",dateKind:"timed",timezone:value("candidateTimezone")||"America/New_York",accessStatus:value("candidateAccessStatus")||"unknown",accessNotes:value("candidateAccessNotes"),audiences:value("candidateAudiences").split(",").map(function(item){return item.trim();}).filter(Boolean),verificationState:"needs_verification"}));return;}
    var removeOccurrence=event.target.closest("[data-remove-occurrence]");if(removeOccurrence){removeOccurrence.closest("[data-occurrence]").remove();var occurrences=document.getElementById("candidateOccurrences");if(!occurrences.querySelector("[data-occurrence]"))occurrences.innerHTML='<p class="occurrences-empty">No related schedule items.</p>';return;}
    if(event.target.closest("[data-add-related-link]")){var list=document.getElementById("candidateRelatedLinks");var empty=list.querySelector(".related-links-empty");if(empty)empty.remove();list.insertAdjacentHTML("beforeend",relatedLinkRow({ provenanceUrl:value("candidateSourceUrl") }));return;}
    var removeLink=event.target.closest("[data-remove-related-link]");if(removeLink){removeLink.closest("[data-related-link]").remove();var related=document.getElementById("candidateRelatedLinks");if(!related.querySelector("[data-related-link]"))related.innerHTML='<p class="related-links-empty">No related links captured.</p>';return;}
    if(event.target.closest("[data-upload-media]")){document.getElementById("candidateMediaFiles").click();return;}
    var removeMedia=event.target.closest("[data-remove-media]");if(removeMedia){var card=removeMedia.closest("[data-candidate-media]");card.remove();var mediaList=document.getElementById("candidateMediaList");if(!mediaList.querySelector("[data-candidate-media]"))mediaList.innerHTML='<p class="media-empty">No event media captured.</p>';return;}
    var moveMedia=event.target.closest("[data-move-media]");if(moveMedia){var mediaCard=moveMedia.closest("[data-candidate-media]");var sibling=moveMedia.dataset.moveMedia==="up"?mediaCard.previousElementSibling:mediaCard.nextElementSibling;if(sibling&&sibling.matches("[data-candidate-media]")){if(moveMedia.dataset.moveMedia==="up")mediaCard.parentNode.insertBefore(mediaCard,sibling);else mediaCard.parentNode.insertBefore(sibling,mediaCard);}return;}
    var shortcut=event.target.closest("[data-research-shortcut]");if(shortcut){var researchInput=document.getElementById("candidateResearchMessage");if(researchInput){researchInput.value=shortcut.dataset.researchShortcut;researchInput.focus();}return;}
    if(event.target.closest("[data-use-single-event]")){var structure=document.getElementById("candidateEventStructure");if(structure){structure.value="single";scheduleGuidance();}return;}
    var selectResearch=event.target.closest("[data-select-research]");if(selectResearch){var selectProposal=selectResearch.closest(".research-proposal");selectProposal.querySelectorAll("[data-research-change]:not(:disabled)").forEach(function(input){input.checked=true;});syncResearchSelection(selectProposal);return;}
    var applyResearch=event.target.closest("[data-apply-research]");if(applyResearch){var proposal=applyResearch.closest(".research-proposal");var changeIds=Array.from(proposal.querySelectorAll("[data-research-change]:checked")).map(function(input){return input.dataset.researchChange;});applyResearch.disabled=true;api("/api/admin/calendar/candidates/"+encodeURIComponent(state.selectedId)+"/research/proposals/"+encodeURIComponent(applyResearch.dataset.applyResearch)+"/apply",{method:"POST",body:JSON.stringify({changeIds:changeIds})}).then(function(result){toast(result.failures&&result.failures.length?"Selected changes applied; some media could not be captured.":"Selected changes applied to the private candidate.");return refreshCandidates(state.selectedId);}).catch(function(error){toast(error.message);applyResearch.disabled=false;});return;}
    var dismissResearch=event.target.closest("[data-dismiss-research]");if(dismissResearch){api("/api/admin/calendar/candidates/"+encodeURIComponent(state.selectedId)+"/research/proposals/"+encodeURIComponent(dismissResearch.dataset.dismissResearch)+"/dismiss",{method:"POST",body:"{}"}).then(function(){toast("Research proposal dismissed.");return loadCandidateResearch(state.selectedId);}).catch(function(error){toast(error.message);});return;}
    var ruleAction=event.target.closest("[data-research-rule-action]");if(ruleAction){api("/api/admin/calendar/candidates/"+encodeURIComponent(state.selectedId)+"/research/rules/"+encodeURIComponent(ruleAction.dataset.ruleId)+"/"+ruleAction.dataset.researchRuleAction,{method:"POST",body:"{}"}).then(function(){toast(ruleAction.dataset.researchRuleAction==="accept"?"Source rule activated.":"Source rule dismissed.");return loadCandidateResearch(state.selectedId);}).catch(function(error){toast(error.message);});return;}
    var deleteRule=event.target.closest("[data-delete-research-rule]");if(deleteRule){api("/api/admin/calendar/candidates/"+encodeURIComponent(state.selectedId)+"/research/rules/"+encodeURIComponent(deleteRule.dataset.deleteResearchRule),{method:"DELETE"}).then(function(){toast("Event instruction forgotten.");return loadCandidateResearch(state.selectedId);}).catch(function(error){toast(error.message);});return;}
  });
  editorRoot.addEventListener("change",function(event){if(event.target.matches("[data-research-change]")){syncResearchSelection(event.target.closest(".research-proposal"));return;}if(event.target.id==="candidateDateKind"){syncPrimaryDateControls();return;}if(event.target.id==="candidateEventStructure"){scheduleGuidance();return;}if(event.target.matches("[data-occurrence-date-kind]")){syncOccurrenceDateControls(event.target.closest("[data-occurrence]"));return;}if(event.target.matches("[data-occurrence-status],[data-occurrence-starts]")){scheduleGuidance();return;}if(event.target.id==="candidateMediaFiles"&&event.target.files&&event.target.files.length)uploadMedia(Array.from(event.target.files)).catch(function(error){toast(error.message);});});
  editorRoot.addEventListener("submit",function(event){var form=event.target.closest("[data-research-form]");if(!form)return;event.preventDefault();var input=document.getElementById("candidateResearchMessage");var message=input.value.trim();if(!message)return;var button=form.querySelector("button[type=submit]");button.disabled=true;button.textContent="Researching…";api("/api/admin/calendar/candidates/"+encodeURIComponent(state.selectedId)+"/research/messages",{method:"POST",body:JSON.stringify({message:message})}).then(function(result){result.research.broadDiscoveryEnabled=true;renderResearch(result.research);toast("Research complete. Review the sourced proposal.");}).catch(function(error){toast(error.message);button.disabled=false;button.textContent="Research this event";});});
  document.getElementById("newCandidate").addEventListener("click",function(){state.selectedId="";state.draftNew=true;renderCandidateList();renderEditor(blankCandidate());});
  document.getElementById("linkIntakeForm").addEventListener("submit",scoutPastedLink);
  document.getElementById("sourceList").addEventListener("click",async function(event){
    var button=event.target.closest("[data-save-source],[data-run-source]");
    if(!button)return;
    var card=button.closest("[data-source-id]");
    var id=card.dataset.sourceId;
    button.disabled=true;
    try{
      await api("/api/admin/calendar/sources/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(sourcePayload(id))});
      if(button.matches("[data-save-source]")){toast("Source saved.");await refreshSources();return;}
      toast("Running only this source.");
      var result=await api("/api/admin/calendar/sources/"+encodeURIComponent(id)+"/run",{method:"POST",body:"{}"});
      toast("Source finished: "+result.candidates+" candidates, "+result.duplicates+" duplicates, "+(result.warnings||0)+" warnings, "+result.failures+" failures.");
      await Promise.all([refreshCandidates(),refreshSources(),loadRuns(),loadStrongPicks()]);
    }catch(error){toast(error.message);}finally{button.disabled=false;}
  });
  document.getElementById("addSource").addEventListener("click",async function(){var url=window.prompt("Scoutable source URL");if(!url)return;var name=window.prompt("Source name")||new URL(url).hostname;var kind=(window.prompt("Source kind: direct or discovery","discovery")||"discovery").trim().toLowerCase();var discovery=kind!=="direct";try{var payload=await api("/api/admin/calendar/sources",{method:"POST",body:JSON.stringify({name:name,url:url,sourceType:discovery?"discovery":"official_html",trustLevel:discovery?"discovery":"official"})});state.sources.push(payload.source);renderSources();var card=document.querySelector('[data-source-id="'+payload.source.id+'"]');if(card)card.scrollIntoView({behavior:"smooth",block:"center"});toast(discovery?"Lead source added. Its events must resolve to original sources.":"Direct source added. Use Run This Source when ready.");}catch(error){toast(error.message);}});
  document.getElementById("socialSourceList").addEventListener("click",async function(event){var button=event.target.closest("[data-save-social-source]");if(!button)return;var card=button.closest("[data-social-source-id]");var id=card.dataset.socialSourceId;try{var payload=await api("/api/admin/calendar/social-sources/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({name:value("socialName-"+id),platform:value("socialPlatform-"+id),handle:value("socialHandle-"+id),profileUrl:value("socialProfileUrl-"+id),trustLevel:value("socialTrust-"+id),enabled:value("socialEnabled-"+id)==="1",cadenceHours:Number(value("socialCadence-"+id))})});var index=state.socialSources.findIndex(function(item){return item.id===id;});if(index>=0)state.socialSources[index]=payload.socialSource;renderSocialSources();toast("Social account saved.");}catch(error){toast(error.message);}});
  document.getElementById("addSocialSource").addEventListener("click",async function(){var platform=(window.prompt("Platform: threads, instagram, or tiktok")||"").trim().toLowerCase();if(!platform)return;var handle=(window.prompt("Public handle without @")||"").trim();if(!handle)return;var profileUrl=window.prompt("Public profile URL");if(!profileUrl)return;var trust=(window.prompt("Trust: official, trusted, or discovery","trusted")||"trusted").trim().toLowerCase();try{var payload=await api("/api/admin/calendar/social-sources",{method:"POST",body:JSON.stringify({platform:platform,handle:handle,profileUrl:profileUrl,trustLevel:trust,enabled:false})});state.socialSources.push(payload.socialSource);renderSocialSources();toast("Social account added in a paused state.");}catch(error){toast(error.message);}});
  document.getElementById("connectorList").addEventListener("click",async function(event){var card=event.target.closest("[data-connector-id]");if(!card)return;var id=card.dataset.connectorId;if(event.target.closest("[data-save-connector]")){try{var payload=await api("/api/admin/calendar/connectors/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({enabled:value("connectorEnabled-"+id)==="1",cadenceHours:Number(value("connectorCadence-"+id)),perRunLimit:Number(value("connectorLimit-"+id))})});var index=state.connectors.findIndex(function(item){return item.id===id;});if(index>=0)state.connectors[index]=payload.connector;renderConnectors();toast("Connector saved.");}catch(error){toast(error.message);}return;}if(event.target.closest("[data-run-connector]")){var button=event.target.closest("[data-run-connector]");button.disabled=true;toast(connectorLabel(id)+" started.");try{var result=await api("/api/admin/calendar/scout/run",{method:"POST",body:JSON.stringify({channels:[id]})});toast(connectorLabel(id)+": "+(result.strongPicks||0)+" strong picks, "+result.candidates+" candidates, "+result.failures+" failures.");await Promise.all([refreshCandidates(),loadRuns(),loadStrongPicks()]);var connectors=await api("/api/admin/calendar/connectors");state.connectors=connectors.connectors||[];renderConnectors();}catch(error){toast(error.message);}finally{button.disabled=false;}}});
  document.getElementById("profileForm").addEventListener("submit",async function(event){event.preventDefault();try{var payload=await api("/api/admin/calendar/profile",{method:"PATCH",body:JSON.stringify({scoutBrief:value("profileScoutBrief"),sourceResolutionRules:value("profileSourceResolutionRules"),sourceResolutionPasses:Number(value("profileSourceResolutionPasses")),name:value("profileName"),model:value("profileModel"),weightedSubjects:JSON.parse(value("profileSubjects")),weightedFormats:JSON.parse(value("profileFormats")),positiveConcepts:parseComma(value("profilePositive")),negativeTerms:parseComma(value("profileNegative")),geographicRules:JSON.parse(value("profileGeography")),socialSettings:JSON.parse(value("profileSocialSettings")),dateHorizonDays:Number(value("profileHorizon")),relevanceThreshold:Number(value("profileThreshold")),duplicateSensitivity:Number(value("profileDuplicate")),perRunLimit:Number(value("profileLimit")),sourceCadenceHours:Number(value("profileSourceCadence")),webCadenceHours:Number(value("profileWebCadence"))})});state.profile=payload.profile;renderProfile();toast("Scout profile saved.");}catch(error){toast(error.message);}});
  document.getElementById("knownOrganizationList").addEventListener("click",async function(event){var card=event.target.closest("[data-known-organization-id]");if(!card)return;var id=card.dataset.knownOrganizationId;if(event.target.closest("[data-save-known-organization]")){try{var payload=await api("/api/admin/calendar/known-organizations/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({name:value("knownName-"+id),organizationType:value("knownType-"+id),aliases:parseComma(value("knownAliases-"+id)),officialDomains:parseComma(value("knownOfficialDomains-"+id)),eventPaths:parseComma(value("knownEventPaths-"+id)),trustedTicketDomains:parseComma(value("knownTicketDomains-"+id)),discoveryOnlyDomains:parseComma(value("knownDiscoveryDomains-"+id)),notes:value("knownNotes-"+id),enabled:value("knownEnabled-"+id)==="1"})});var index=state.knownOrganizations.findIndex(function(item){return item.id===id;});if(index>=0)state.knownOrganizations[index]=payload.organization;renderKnownOrganizations();toast("Known organization saved.");}catch(error){toast(error.message);}return;}if(event.target.closest("[data-delete-known-organization]")){if(!window.confirm("Remove this known organization from Scout source memory?"))return;try{await api("/api/admin/calendar/known-organizations/"+encodeURIComponent(id),{method:"DELETE"});state.knownOrganizations=state.knownOrganizations.filter(function(item){return item.id!==id;});renderKnownOrganizations();toast("Known organization removed.");}catch(error){toast(error.message);}}});
  document.getElementById("addKnownOrganization").addEventListener("click",async function(){var name=(window.prompt("Organizer or venue name")||"").trim();if(!name)return;var domain=(window.prompt("Official domain, for example gallery.org")||"").trim();if(!domain)return;try{var payload=await api("/api/admin/calendar/known-organizations",{method:"POST",body:JSON.stringify({name:name,organizationType:"both",officialDomains:[domain],enabled:true})});state.knownOrganizations.push(payload.organization);state.knownOrganizations.sort(function(a,b){return a.name.localeCompare(b.name);});renderKnownOrganizations();var card=document.querySelector('[data-known-organization-id="'+payload.organization.id+'"]');if(card)card.scrollIntoView({behavior:"smooth",block:"center"});toast("Known organization added. Add aliases, event paths, and ticket domains when useful.");}catch(error){toast(error.message);}});
  document.getElementById("runScout").addEventListener("click",async function(){this.disabled=true;toast("Enabled scout lanes started.");try{var result=await api("/api/admin/calendar/scout/run",{method:"POST",body:"{}"});toast("Scout finished: "+(result.strongPicks||0)+" strong picks, "+(result.materialUpdates||0)+" material updates, "+result.candidates+" candidates, "+result.failures+" failures.");await Promise.all([refreshCandidates(),loadRuns(),loadStrongPicks()]);var connectors=await api("/api/admin/calendar/connectors");state.connectors=connectors.connectors||[];renderConnectors();}catch(error){toast(error.message);}finally{this.disabled=false;}});
  document.getElementById("refreshRuns").addEventListener("click",loadRuns);
  document.getElementById("suggestionList").addEventListener("click",async function(event){var button=event.target.closest("[data-suggestion-action]");if(!button)return;try{await api("/api/admin/calendar/suggestions/"+encodeURIComponent(button.dataset.id)+"/"+button.dataset.suggestionAction,{method:"POST",body:"{}"});await loadSuggestions();var profile=await api("/api/admin/calendar/profile");state.profile=profile.profile;renderProfile();toast("Suggestion "+button.dataset.suggestionAction+"ed.");}catch(error){toast(error.message);}});
})();
