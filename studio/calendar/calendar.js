(function () {
  "use strict";
  var TOKEN_KEY = "swc_submissions_admin_token";
  var SUBJECTS = [["art","Art"],["film","Film"],["poetry-music","Poetry / Music"],["technology","Technology"],["ai","AI"],["creative-technology","Creative Technology"],["anthropology","Anthropology"],["engineering","Engineering"],["philosophy","Philosophy"]];
  var FORMATS = [["exhibition","Exhibition"],["screening","Screening"],["performance","Performance"],["experimental-event","Experimental Event"],["lecture-talk","Lecture / Talk"],["panel","Panel"],["workshop","Workshop"],["conference","Conference"]];
  var OCCURRENCE_TYPES = [["opening_reception","Opening Reception"],["artist_talk","Artist Talk"],["mixer","Mixer"],["screening","Screening"],["performance","Performance"],["workshop","Workshop"],["panel","Panel"],["lecture","Lecture"],["other","Related Program"]];
  var STATUSES = [["review","Review Queue"],["ready","Ready to Publish"],["published","Published"],["needs_verification","Needs Verification"],["rejected","Rejected"],["cancelled","Cancelled"],["duplicate","Duplicates"]];
  var token = localStorage.getItem(TOKEN_KEY) || "";
  var state = { candidates:[], sources:[], socialSources:[], connectors:[], profile:null, suggestions:[], runs:[], filter:"review", selectedId:"", draftNew:false, broadDiscoveryEnabled:false, activeCandidate:null, flyerPreviewUrl:"" };
  var tokenInput = document.getElementById("tokenInput");
  var authPanel = document.getElementById("authPanel");
  var app = document.getElementById("studioApp");
  var listRoot = document.getElementById("candidateList");
  var editorRoot = document.getElementById("candidateEditor");
  var toastTimer;

  tokenInput.value = token;

  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]; }); }
  function isInstagramUrl(value) { try { var host = new URL(value).hostname.toLowerCase(); return host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am" || host.endsWith(".instagr.am"); } catch (error) { return false; } }
  function displayDate(value) { var date = value ? new Date(value.length === 10 ? value + "T12:00:00" : value) : null; return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric", hour:value.length > 10 ? "numeric" : undefined, minute:value.length > 10 ? "2-digit" : undefined }).format(date) : "Date not confirmed"; }
  function toast(message) { var root = document.getElementById("toast"); root.textContent = message; root.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { root.classList.remove("is-visible"); }, 3200); }
  async function api(path, options) {
    var response = await fetch(path, Object.assign({}, options || {}, { headers:Object.assign({ authorization:"Bearer " + token, "content-type":"application/json" }, options && options.headers || {}) }));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(payload.error || "Request failed."); error.details = payload.errors || []; throw error; }
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
        includePublic:row.querySelector("[data-link-public]").checked
      };
    }).filter(function (link) { return link.url; });
    var occurrences = Array.from(editorRoot.querySelectorAll("[data-occurrence]")).map(function (row, index) {
      function occurrenceValue(name) { var control=row.querySelector('[data-occurrence-'+name+']');return control?control.value.trim():""; }
      return {
        id:row.dataset.occurrenceId||"", occurrenceType:occurrenceValue("type"), title:occurrenceValue("title"),
        factualDescription:occurrenceValue("description"), dateKind:occurrenceValue("date-kind"),
        startsAt:occurrenceValue("starts"), endsAt:occurrenceValue("ends"), timezone:occurrenceValue("timezone")||"America/New_York",
        venueName:occurrenceValue("venue"), venueAddress:occurrenceValue("address"), sourceUrl:occurrenceValue("source"),
        ticketUrl:occurrenceValue("ticket"), status:occurrenceValue("status"), verificationState:occurrenceValue("verification"),
        verificationNotes:occurrenceValue("notes"), sortOrder:index
      };
    });
    return {
      sourceId:value("candidateSourceId"), sourceEventId:value("candidateSourceEventId"), sourceUrl:value("candidateSourceUrl"), ticketUrl:value("candidateTicketUrl"),
      title:value("candidateTitle"), organizer:value("candidateOrganizer"), factualDescription:value("candidateDescription"), dateKind:value("candidateDateKind"),
      startsAt:value("candidateStartsAt"), endsAt:value("candidateEndsAt"), timezone:value("candidateTimezone") || "America/New_York", venueName:value("candidateVenueName"),
      venueAddress:value("candidateVenueAddress"), city:value("candidateCity") || "Atlanta", region:value("candidateRegion") || "GA", subjects:checked("subjects"), formats:checked("formats"),
      experimental:document.getElementById("candidateExperimental").checked, verificationState:value("candidateVerificationState"), verificationNotes:value("candidateVerificationNotes"),
      confidence:value("candidateConfidence") === "" ? null : Number(value("candidateConfidence")), privateRationale:value("candidatePrivateRationale"), attendanceUse:value("candidateAttendanceUse"),
      programmingIdeas:value("candidateProgrammingIdeas"), potentialCollaborators:value("candidateCollaborators"), internalNotes:value("candidateInternalNotes"), rejectionReason:value("candidateRejectionReason"), duplicateOf:value("candidateDuplicateOf"),
      relatedLinks:relatedLinks, occurrences:occurrences, flyerMediaId:value("candidateFlyerMediaId"), flyerSourceUrl:value("candidateFlyerSourceUrl"), flyerProvenanceUrl:value("candidateFlyerProvenanceUrl"), flyerPublicApproved:Boolean(document.getElementById("candidateFlyerPublic") && document.getElementById("candidateFlyerPublic").checked), flyerAltText:value("candidateFlyerAltText")
    };
  }
  function blankCandidate() { return { id:"", title:"", status:"needs_verification", verificationState:"needs_verification", dateKind:"timed", timezone:"America/New_York", city:"Atlanta", region:"GA", subjects:[], formats:[], revisions:[], relatedLinks:[], occurrences:[], flyerPublicApproved:false }; }

  function occurrenceOptions(choices, selected) { return choices.map(function (choice) { return '<option value="'+escapeHtml(choice[0])+'"'+(choice[0]===selected?' selected':'')+'>'+escapeHtml(choice[1])+'</option>'; }).join(''); }
  function occurrenceRow(occurrence) {
    occurrence=occurrence||{};
    return '<article class="occurrence-row" data-occurrence data-occurrence-id="'+escapeHtml(occurrence.id||"")+'">' +
      '<div class="occurrence-row-head"><strong>'+escapeHtml(occurrence.title||"Related program")+'</strong><button type="button" data-remove-occurrence>Remove</button></div>' +
      '<div class="field-grid">' +
      '<label class="field"><span>Program type</span><select data-occurrence-type>'+occurrenceOptions(OCCURRENCE_TYPES,occurrence.occurrenceType||"other")+'</select></label>' +
      '<label class="field"><span>Status</span><select data-occurrence-status>'+occurrenceOptions([["scheduled","Scheduled"],["tbd","Date TBD"],["cancelled","Cancelled"]],occurrence.status||"scheduled")+'</select></label>' +
      '<label class="field is-wide"><span>Public title</span><input data-occurrence-title value="'+escapeHtml(occurrence.title||"")+'"></label>' +
      '<label class="field"><span>Date type</span><select data-occurrence-date-kind>'+occurrenceOptions([["timed","Timed"],["all_day","All day"]],occurrence.dateKind||"timed")+'</select></label>' +
      '<label class="field"><span>Time zone</span><input data-occurrence-timezone value="'+escapeHtml(occurrence.timezone||"America/New_York")+'"></label>' +
      '<label class="field"><span>Starts</span><input data-occurrence-starts value="'+escapeHtml(occurrence.startsAt||"")+'"></label>' +
      '<label class="field"><span>Ends</span><input data-occurrence-ends value="'+escapeHtml(occurrence.endsAt||"")+'"></label>' +
      '<label class="field"><span>Venue override</span><input data-occurrence-venue value="'+escapeHtml(occurrence.venueName||"")+'"></label>' +
      '<label class="field"><span>Address override</span><input data-occurrence-address value="'+escapeHtml(occurrence.venueAddress||"")+'"></label>' +
      '<label class="field is-wide"><span>Factual description</span><textarea data-occurrence-description>'+escapeHtml(occurrence.factualDescription||"")+'</textarea></label>' +
      '<label class="field is-wide"><span>Official occurrence URL</span><input type="url" data-occurrence-source value="'+escapeHtml(occurrence.sourceUrl||"")+'"></label>' +
      '<label class="field is-wide"><span>Ticket URL</span><input type="url" data-occurrence-ticket value="'+escapeHtml(occurrence.ticketUrl||"")+'"></label>' +
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
      '<label class="field is-wide"><span>Provenance URL</span><input data-link-provenance type="url" value="' + escapeHtml(link.provenanceUrl || "") + '"></label>' +
      '</div><div class="related-link-actions"><label class="check-option"><input data-link-public type="checkbox"' + (link.includePublic ? ' checked' : '') + (instagramOnly ? ' disabled' : '') + '><span>' + (instagramOnly ? 'Private Instagram provenance' : 'Include publicly') + '</span></label>' +
      externalLink(link.url,"Open link") + externalLink(link.provenanceUrl,"Open provenance") + '<button type="button" data-remove-related-link>Remove</button></div></article>';
  }

  function flyerSection(candidate, isNew) {
    var flyer = candidate.flyer;
    return '<div class="editor-section"><h3>Optional flyer</h3><p class="section-guidance">One useful flyer may be proposed or uploaded. It remains private unless you explicitly include it.</p>' +
      '<input id="candidateFlyerMediaId" type="hidden" value="' + escapeHtml(candidate.flyerMediaId || "") + '">' +
      '<input id="candidateFlyerSourceUrl" type="hidden" value="' + escapeHtml(candidate.flyerSourceUrl || "") + '">' +
      '<input id="candidateFlyerProvenanceUrl" type="hidden" value="' + escapeHtml(candidate.flyerProvenanceUrl || "") + '">' +
      (flyer ? '<div class="flyer-review"><div class="flyer-preview"><img data-flyer-preview alt=""></div><div class="flyer-controls">' +
        field("candidateFlyerAltText","Public image description",flyer.altText || candidate.flyerAltText,{type:"textarea"}) +
        '<label class="check-option"><input id="candidateFlyerPublic" type="checkbox"' + (candidate.flyerPublicApproved ? ' checked' : '') + '><span>Include flyer publicly</span></label>' +
        (candidate.flyerSourceUrl ? externalLink(candidate.flyerSourceUrl,"Open original flyer") : '') +
        (candidate.flyerProvenanceUrl ? externalLink(candidate.flyerProvenanceUrl,"Open flyer provenance") : '') +
        '<div class="flyer-buttons"><button type="button" data-upload-flyer>Replace flyer</button><button type="button" data-remove-flyer>Remove flyer</button></div></div></div>' :
        '<div class="flyer-empty"><p>No flyer attached.</p><input id="candidateFlyerAltText" type="hidden" value=""><input id="candidateFlyerPublic" type="checkbox" hidden><button type="button" data-upload-flyer' + (isNew ? ' disabled' : '') + '>Upload flyer</button>' + (isNew ? '<span>Save the candidate before uploading a flyer.</span>' : '') + '</div>') +
      '<input id="candidateFlyerFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden></div>';
  }

  function socialEvidenceSection(candidate) {
    var evidence = candidate.socialEvidence || [];
    if (!evidence.length) return '';
    return '<div class="editor-section"><h3>Private social evidence</h3><p class="section-guidance">Post excerpts, identity, trust, and corroboration stay inside Studio.</p><div class="social-evidence-list">' + evidence.map(function (item) {
      return '<article class="social-evidence-card"><div class="social-evidence-head"><strong>' + escapeHtml(item.platform + ' / @' + (item.authorHandle || 'unknown')) + '</strong><span>' + escapeHtml(item.evidenceRole + ' / ' + item.corroborationState) + '</span></div>' +
        '<p>' + escapeHtml(item.captionExcerpt || 'No caption excerpt captured.') + '</p><p class="source-meta">Posted: ' + escapeHtml(displayDate(item.postedAt)) + (item.authorIsVerified ? '<br>Platform verification badge observed — trust unchanged.' : '') + '</p><div class="social-evidence-links">' +
        externalLink(item.postUrl,'Open post') + externalLink(item.sourceProfileUrl,'Open registered profile') + '</div></article>';
    }).join('') + '</div></div>';
  }

  function matchesStatus(candidate, status) {
    if (status === "review") return candidate.status === "candidate" || candidate.status === "needs_verification";
    if (status === "ready") return candidate.status === "candidate" && candidate.verificationState === "verified" && !isInstagramUrl(candidate.sourceUrl);
    return candidate.status === status;
  }
  function lifecycleLabel(candidate) {
    if (candidate.status === "candidate" && candidate.verificationState === "verified" && !isInstagramUrl(candidate.sourceUrl)) return "ready to publish";
    return candidate.status.replace(/_/g," ");
  }
  function recordLabel(candidate) {
    if (candidate.status === "published") return "Published event record";
    if (candidate.status === "candidate" && candidate.verificationState === "verified" && !isInstagramUrl(candidate.sourceUrl)) return "Ready to publish";
    return "Candidate record";
  }

  function renderStatusFilters() {
    document.getElementById("statusFilters").innerHTML = STATUSES.map(function (item) { var count = state.candidates.filter(function (candidate) { return matchesStatus(candidate,item[0]); }).length; return '<button type="button" data-status="' + item[0] + '" class="' + (state.filter === item[0] ? 'is-active' : '') + '">' + escapeHtml(item[1]) + ' / ' + count + '</button>'; }).join("");
  }
  function renderCandidateList() {
    var candidates = state.candidates.filter(function (candidate) { return matchesStatus(candidate,state.filter); });
    listRoot.innerHTML = candidates.length ? candidates.map(function (candidate) { return '<article class="candidate-card' + (candidate.id === state.selectedId ? ' is-active' : '') + '"><button class="candidate-card-select" type="button" data-candidate-id="' + escapeHtml(candidate.id) + '"><span class="status">' + escapeHtml(lifecycleLabel(candidate)) + '</span><strong>' + escapeHtml(candidate.title) + '</strong><span>' + escapeHtml(displayDate(candidate.startsAt)) + '</span><span>' + escapeHtml(candidate.venueName || candidate.organizer || "Venue not confirmed") + '</span></button>' + externalLink(candidate.sourceUrl,"Open source","candidate-source-link") + '</article>'; }).join("") : '<p class="empty-state">No event records in this view.</p>';
  }
  function renderEditor(candidate) {
    if (state.flyerPreviewUrl) { URL.revokeObjectURL(state.flyerPreviewUrl); state.flyerPreviewUrl = ""; }
    state.activeCandidate = candidate;
    if (!candidate) { editorRoot.innerHTML = '<p class="empty-state">Select a candidate or start a manual intake.</p>'; return; }
    var isNew = !candidate.id;
    var revisions = candidate.revisions || [];
    var instagramSource = isInstagramUrl(candidate.sourceUrl) || isInstagramUrl(candidate.ticketUrl);
    var occurrencesReady = (candidate.occurrences||[]).every(function (occurrence) { return occurrence.status === "tbd" || (occurrence.verificationState === "verified" && occurrence.startsAt && !isInstagramUrl(occurrence.sourceUrl)); });
    var canPublish = !isNew && candidate.verificationState === "verified" && !instagramSource && occurrencesReady && !["rejected","cancelled","duplicate"].includes(candidate.status) && (candidate.status !== "published" || candidate.pendingRevisionId);
    var publishLabel = candidate.status === "published" ? "Approve + Update" : "Approve + Publish";
    editorRoot.innerHTML = '<div class="editor-head"><div><p class="eyebrow">' + (isNew ? 'Manual intake' : recordLabel(candidate)) + '</p><h2>' + escapeHtml(candidate.title || "New candidate") + '</h2></div><span class="status-badge">' + escapeHtml(lifecycleLabel(candidate)) + '</span></div>' +
      '<div class="editor-section"><h3>Public factual record</h3><div class="field-grid">' +
      '<label class="field"><span>Registry source</span><select id="candidateSourceId">' + sourceChoices(candidate.sourceId || "") + '</select></label>' +
      field("candidateSourceEventId","Source event ID",candidate.sourceEventId) + linkedField("candidateSourceUrl","Official source URL",candidate.sourceUrl,"Open official source",{wide:true}) + linkedField("candidateTicketUrl","Ticket URL",candidate.ticketUrl,"Open ticket link",{wide:true}) +
      (instagramSource ? '<p class="source-reliability-warning">Instagram is retained as private discovery evidence only. Search for an event-specific organizer, venue, or ticket-host page that confirms this event before publishing.</p>' : '') +
      field("candidateTitle","Title",candidate.title,{wide:true}) + field("candidateOrganizer","Organizer",candidate.organizer) + field("candidateDateKind","Date type",candidate.dateKind,{type:"select",choices:[["timed","Timed"],["all_day","All day"],["date_range","Date range"]]}) +
      field("candidateStartsAt","Starts (ISO or YYYY-MM-DD)",candidate.startsAt) + field("candidateEndsAt","Ends (ISO or YYYY-MM-DD)",candidate.endsAt) + field("candidateTimezone","Time zone",candidate.timezone) + field("candidateVenueName","Venue",candidate.venueName) +
      field("candidateVenueAddress","Venue address",candidate.venueAddress,{wide:true}) + field("candidateCity","City",candidate.city) + field("candidateRegion","State / region",candidate.region) + field("candidateDescription","Factual description",candidate.factualDescription,{type:"textarea",wide:true}) +
      '</div><p class="field-label">Subjects</p>' + checkboxes("subjects",SUBJECTS,candidate.subjects) + '<p class="field-label">Formats</p>' + checkboxes("formats",FORMATS,candidate.formats) +
      '<label class="check-option"><input id="candidateExperimental" type="checkbox"' + (candidate.experimental ? ' checked' : '') + '><span>Experimental attribute</span></label></div>' +
      occurrenceSection(candidate) +
      '<div class="editor-section"><div class="section-title-row"><h3>Related links</h3><button type="button" data-add-related-link>Add link</button></div><p class="section-guidance">Links remain private unless Include publicly is checked and the event is approved.</p><div class="related-link-list" id="candidateRelatedLinks">' + ((candidate.relatedLinks || []).map(relatedLinkRow).join("") || '<p class="related-links-empty">No related links captured.</p>') + '</div></div>' +
      flyerSection(candidate,isNew) +
      socialEvidenceSection(candidate) +
      '<div class="editor-section"><h3>Verification + provenance</h3><div class="field-grid">' +
      field("candidateVerificationState","Verification",candidate.verificationState,{type:"select",choices:[["verified","Verified"],["unverified","Unverified"],["needs_verification","Needs verification"]]}) + field("candidateConfidence","Confidence",candidate.confidence,{type:"number",step:"0.01"}) +
      field("candidateVerificationNotes","Verification notes",candidate.verificationNotes,{type:"textarea",wide:true}) + field("candidateRejectionReason","Rejection reason",candidate.rejectionReason) + field("candidateDuplicateOf","Duplicate of",candidate.duplicateOf) + '</div></div>' +
      '<div class="editor-section"><h3>Private review intelligence</h3><p class="section-guidance">The Scout generates these private fields for every discovered event. They remain editable here and never appear on the public calendar or feeds.</p><div class="field-grid">' + field("candidatePrivateRationale","Why it fits",candidate.privateRationale,{type:"textarea",wide:true}) + field("candidateAttendanceUse","Best use",candidate.attendanceUse,{type:"textarea"}) + field("candidateProgrammingIdeas","Programming model worth studying",candidate.programmingIdeas,{type:"textarea"}) + field("candidateCollaborators","Potential collaborators",candidate.potentialCollaborators,{type:"textarea"}) + field("candidateInternalNotes","Internal notes",candidate.internalNotes,{type:"textarea"}) + '</div></div>' +
      (!isNew ? '<div class="editor-section"><h3>Detected changes + revisions</h3><div class="revision-list">' + (revisions.length ? revisions.map(function (revision) { return '<article class="revision"><strong>Revision ' + revision.revisionNumber + ' / ' + escapeHtml(revision.revisionState) + '</strong><br>' + escapeHtml(revision.changeSummary || "Saved candidate snapshot") + '<br>' + escapeHtml(displayDate(revision.createdAt)) + '</article>'; }).join("") : '<p class="empty-state">No revisions recorded.</p>') + '</div></div>' : '') +
      '<div class="editor-actions"><button type="button" data-action="save">' + (isNew ? 'Create candidate' : 'Save') + '</button>' + (!isNew ? (candidate.pendingRevisionId ? '<button type="button" data-action="review-change">Review Detected Change</button>' : '') + (canPublish ? '<button type="button" data-action="approve">' + publishLabel + '</button>' : '') + '<button type="button" data-action="reject">Reject</button><button type="button" data-action="duplicate">Mark Duplicate</button><button type="button" data-action="cancel">Mark Cancelled</button>' : '') + '</div>';
    hydrateFlyerPreview(candidate);
  }
  async function hydrateFlyerPreview(candidate) {
    var image = editorRoot.querySelector("[data-flyer-preview]");
    if (!image || !candidate.flyer || !candidate.flyer.adminUrl) return;
    try {
      var response = await fetch(candidate.flyer.adminUrl, { headers:{ authorization:"Bearer " + token } });
      if (!response.ok) throw new Error("Flyer preview unavailable.");
      var blob = await response.blob();
      if (state.flyerPreviewUrl) URL.revokeObjectURL(state.flyerPreviewUrl);
      state.flyerPreviewUrl = URL.createObjectURL(blob);
      image.src = state.flyerPreviewUrl;
      image.alt = candidate.flyer.altText || candidate.title + " event flyer";
    } catch (error) { toast(error.message); }
  }
  async function uploadFlyer(file) {
    if (!state.selectedId || !file) return;
    if (!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type)) { toast("Use a JPEG, PNG, WebP, or GIF flyer."); return; }
    if (file.size > 15 * 1024 * 1024) { toast("Flyers cannot exceed 15 MB."); return; }
    var form = new FormData();
    form.append("file",file);
    form.append("privacy","internal");
    form.append("consent_status","not-required");
    form.append("public_presentation","hidden");
    form.append("alt_text",value("candidateFlyerAltText") || ((state.activeCandidate && state.activeCandidate.title) ? state.activeCandidate.title + " event flyer" : "Event flyer"));
    var response = await fetch("/api/admin/media", { method:"POST", headers:{ authorization:"Bearer " + token }, body:form });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || "Flyer upload failed.");
    document.getElementById("candidateFlyerMediaId").value = payload.record.id;
    document.getElementById("candidateFlyerSourceUrl").value = "";
    document.getElementById("candidateFlyerProvenanceUrl").value = "";
    document.getElementById("candidateFlyerPublic").checked = false;
    await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId), { method:"PATCH", body:JSON.stringify(candidatePayload()) });
    toast("Flyer uploaded privately. Choose Include flyer publicly when it is ready.");
    await refreshCandidates(state.selectedId);
  }
  async function removeFlyer() {
    if (!state.selectedId) return;
    document.getElementById("candidateFlyerMediaId").value = "";
    document.getElementById("candidateFlyerSourceUrl").value = "";
    document.getElementById("candidateFlyerProvenanceUrl").value = "";
    document.getElementById("candidateFlyerPublic").checked = false;
    await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId), { method:"PATCH", body:JSON.stringify(candidatePayload()) });
    toast("Flyer removed from the candidate.");
    await refreshCandidates(state.selectedId);
  }
  async function selectCandidate(id) {
    state.selectedId = id; state.draftNew = false; renderCandidateList();
    try { var payload = await api("/api/admin/calendar/candidates/" + encodeURIComponent(id)); var index = state.candidates.findIndex(function (candidate) { return candidate.id === id; }); if (index >= 0) state.candidates[index] = payload.candidate; renderEditor(payload.candidate); }
    catch (error) { toast(error.message); }
  }
  async function refreshCandidates(selectId) {
    var payload = await api("/api/admin/calendar/candidates"); state.candidates = payload.candidates || []; renderStatusFilters(); renderCandidateList();
    if (selectId) selectCandidate(selectId); else if (state.selectedId && state.candidates.some(function (candidate) { return candidate.id === state.selectedId; })) selectCandidate(state.selectedId); else renderEditor(null);
  }
  async function editorAction(action) {
    if (action === "review-change") { var revisions = editorRoot.querySelector(".revision-list"); if (revisions) revisions.scrollIntoView({ behavior:"smooth", block:"center" }); return; }
    var body = candidatePayload();
    try {
      if (!state.selectedId) { var created = await api("/api/admin/calendar/candidates", { method:"POST", body:JSON.stringify(body) }); state.selectedId = created.candidate.id; toast(created.duplicate ? "Candidate created and flagged as a duplicate." : "Candidate created."); await refreshCandidates(state.selectedId); return; }
      if (action === "save") { await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId), { method:"PATCH", body:JSON.stringify(body) }); toast("Candidate saved."); }
      if (action === "approve") { var wasPublished = state.candidates.some(function (candidate) { return candidate.id === state.selectedId && candidate.status === "published"; }); await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId), { method:"PATCH", body:JSON.stringify(body) }); await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId) + "/approve", { method:"POST", body:"{}" }); state.filter="published"; toast(wasPublished ? "Approved changes updated the published event." : "Event moved to Published and added to the calendar."); }
      if (action === "reject") { await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId) + "/reject", { method:"POST", body:JSON.stringify({ reason:body.rejectionReason }) }); toast("Candidate rejected. It remains private."); }
      if (action === "duplicate") { await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId) + "/duplicate", { method:"POST", body:JSON.stringify({ duplicateOf:body.duplicateOf }) }); toast("Candidate marked as duplicate."); }
      if (action === "cancel") { await api("/api/admin/calendar/candidates/" + encodeURIComponent(state.selectedId) + "/cancel", { method:"POST", body:"{}" }); toast("Cancellation recorded."); }
      await refreshCandidates(state.selectedId);
    } catch (error) { toast(error.details && error.details.length ? error.details.join(" ") : error.message); }
  }

  function renderSources() {
    document.getElementById("sourceList").innerHTML = state.sources.map(function (source) { return '<article class="source-card" data-source-id="' + escapeHtml(source.id) + '">' + field("sourceName-"+source.id,"Name",source.name) + '<div class="source-url-field">' + field("sourceUrl-"+source.id,"URL",source.url,{type:"url"}) + externalLink(source.url,"Open source") + '</div>' + field("sourceCadence-"+source.id,"Cadence hours",source.cadenceHours,{type:"number"}) + '<label class="field"><span>Enabled</span><select id="sourceEnabled-' + source.id + '"><option value="1"' + (source.enabled?' selected':'') + '>Enabled</option><option value="0"' + (!source.enabled?' selected':'') + '>Paused</option></select></label><label class="field"><span>Source type</span><select id="sourceType-' + source.id + '">' + [["official_html","Official HTML"],["calendar","Calendar"],["json","JSON"],["rss","RSS"],["discovery","Discovery"]].map(function(option){return '<option value="'+option[0]+'"'+(source.sourceType===option[0]?' selected':'')+'>'+option[1]+'</option>';}).join('') + '</select></label><label class="field"><span>Trust</span><select id="sourceTrust-' + source.id + '">' + [["official","Official"],["trusted","Trusted"],["discovery","Discovery"]].map(function(option){return '<option value="'+option[0]+'"'+(source.trustLevel===option[0]?' selected':'')+'>'+option[1]+'</option>';}).join('') + '</select></label><button type="button" data-save-source>Save</button><p class="source-meta is-wide-mobile">Last success: ' + escapeHtml(displayDate(source.lastSuccessAt)) + '<br>Acceptance: ' + (source.acceptanceRate === null ? 'No decisions yet' : Math.round(source.acceptanceRate*100)+'%') + (source.lastError ? '<br>Error: '+escapeHtml(source.lastError) : '') + '</p></article>'; }).join("");
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
    document.getElementById("profileForm").innerHTML = field("profileName","Profile name",profile.name) + field("profileModel","Model",profile.model) + field("profileSubjects","Weighted subjects / JSON",JSON.stringify(profile.weightedSubjects,null,2),{type:"textarea"}) + field("profileFormats","Weighted formats / JSON",JSON.stringify(profile.weightedFormats,null,2),{type:"textarea"}) + field("profilePositive","Positive concepts",commaList(profile.positiveConcepts),{type:"textarea",wide:true}) + field("profileNegative","Negative terms",commaList(profile.negativeTerms),{type:"textarea",wide:true}) + field("profileGeography","Geographic rules / JSON",JSON.stringify(profile.geographicRules,null,2),{type:"textarea",wide:true}) + field("profileSocialSettings","Platform keywords, tags, cadence, and limits / JSON",JSON.stringify(profile.socialSettings,null,2),{type:"textarea",wide:true}) + field("profileHorizon","Date horizon / days",profile.dateHorizonDays,{type:"number"}) + field("profileThreshold","Relevance threshold",profile.relevanceThreshold,{type:"number",step:"0.01"}) + field("profileDuplicate","Duplicate sensitivity",profile.duplicateSensitivity,{type:"number",step:"0.01"}) + field("profileLimit","Per-run limit",profile.perRunLimit,{type:"number"}) + field("profileSourceCadence","Source cadence / hours",profile.sourceCadenceHours,{type:"number"}) + field("profileWebCadence","Web cadence / hours",profile.webCadenceHours,{type:"number"}) + '<button type="submit">Save Scout Profile</button>';
  }
  async function loadSuggestions() {
    var payload = await api("/api/admin/calendar/suggestions"); state.suggestions = payload.suggestions || [];
    document.getElementById("suggestionList").innerHTML = state.suggestions.filter(function (item) { return item.status === "pending"; }).map(function (item) { return '<article class="suggestion-card"><strong>' + escapeHtml(item.rationale) + '</strong><p>' + escapeHtml(JSON.stringify(item.proposedPatch)) + '</p><div class="suggestion-actions"><button data-suggestion-action="accept" data-id="' + item.id + '">Accept</button><button data-suggestion-action="dismiss" data-id="' + item.id + '">Dismiss</button></div></article>'; }).join("") || '<p class="empty-state">No pending adjustments.</p>';
  }
  async function loadRuns() {
    var payload = await api("/api/admin/calendar/runs"); state.runs = payload.runs || [];
    document.getElementById("runList").innerHTML = state.runs.map(function (run) { return '<article class="run-card"><div><h3>' + escapeHtml(run.status) + '</h3><p class="run-meta">' + escapeHtml(displayDate(run.startedAt)) + '<br>' + escapeHtml(run.runKind) + ' / ' + escapeHtml(run.model || "direct sources only") + '<br>' + run.candidateCount + ' candidates / ' + run.duplicateCount + ' duplicates / ' + run.failureCount + ' failures</p></div><pre>' + escapeHtml(JSON.stringify({ sources:run.sourcesSearched, queries:run.queries, citations:run.citations, results:run.sourceResults, usage:run.openaiUsage, error:run.errorMessage }, null, 2)) + '</pre></article>'; }).join("") || '<p class="empty-state">No scout runs recorded.</p>';
  }
  async function connect() {
    token = tokenInput.value.trim(); if (!token) return;
    try {
      var payload = await api("/api/admin/calendar"); localStorage.setItem(TOKEN_KEY, token); state.candidates=payload.candidates||[]; state.sources=payload.sources||[]; state.socialSources=payload.socialSources||[]; state.connectors=payload.connectors||[]; state.profile=payload.profile; state.broadDiscoveryEnabled=payload.broadDiscoveryEnabled;
      authPanel.hidden=true; app.hidden=false; renderStatusFilters(); renderCandidateList(); renderSources(); renderSocialSources(); renderConnectors(); renderProfile(); await Promise.all([loadSuggestions(),loadRuns()]);
    } catch (error) { document.getElementById("authMessage").textContent=error.message; }
  }

  document.getElementById("connectButton").addEventListener("click",connect); tokenInput.addEventListener("keydown",function(event){if(event.key==="Enter")connect();});
  document.querySelector(".studio-tabs").addEventListener("click",function(event){var button=event.target.closest("button[data-view]");if(!button)return;document.querySelectorAll(".studio-tabs button").forEach(function(item){item.classList.toggle("is-active",item===button);});document.querySelectorAll("[data-panel]").forEach(function(panel){panel.hidden=panel.dataset.panel!==button.dataset.view;});});
  document.getElementById("statusFilters").addEventListener("click",function(event){var button=event.target.closest("button[data-status]");if(!button)return;state.filter=button.dataset.status;renderStatusFilters();renderCandidateList();});
  listRoot.addEventListener("click",function(event){var button=event.target.closest("[data-candidate-id]");if(button)selectCandidate(button.dataset.candidateId);});
  editorRoot.addEventListener("click",function(event){
    var actionButton=event.target.closest("button[data-action]");if(actionButton){editorAction(actionButton.dataset.action);return;}
    if(event.target.closest("[data-add-occurrence]")){var occurrenceList=document.getElementById("candidateOccurrences");var occurrenceEmpty=occurrenceList.querySelector(".occurrences-empty");if(occurrenceEmpty)occurrenceEmpty.remove();occurrenceList.insertAdjacentHTML("beforeend",occurrenceRow({occurrenceType:"other",status:"scheduled",dateKind:"timed",timezone:value("candidateTimezone")||"America/New_York",verificationState:"needs_verification"}));return;}
    var removeOccurrence=event.target.closest("[data-remove-occurrence]");if(removeOccurrence){removeOccurrence.closest("[data-occurrence]").remove();var occurrences=document.getElementById("candidateOccurrences");if(!occurrences.querySelector("[data-occurrence]"))occurrences.innerHTML='<p class="occurrences-empty">No related schedule items.</p>';return;}
    if(event.target.closest("[data-add-related-link]")){var list=document.getElementById("candidateRelatedLinks");var empty=list.querySelector(".related-links-empty");if(empty)empty.remove();list.insertAdjacentHTML("beforeend",relatedLinkRow({ provenanceUrl:value("candidateSourceUrl") }));return;}
    var removeLink=event.target.closest("[data-remove-related-link]");if(removeLink){removeLink.closest("[data-related-link]").remove();var related=document.getElementById("candidateRelatedLinks");if(!related.querySelector("[data-related-link]"))related.innerHTML='<p class="related-links-empty">No related links captured.</p>';return;}
    if(event.target.closest("[data-upload-flyer]")){document.getElementById("candidateFlyerFile").click();return;}
    if(event.target.closest("[data-remove-flyer]")){removeFlyer().catch(function(error){toast(error.message);});}
  });
  editorRoot.addEventListener("change",function(event){if(event.target.id==="candidateFlyerFile"&&event.target.files&&event.target.files[0])uploadFlyer(event.target.files[0]).catch(function(error){toast(error.message);});});
  document.getElementById("newCandidate").addEventListener("click",function(){state.selectedId="";state.draftNew=true;renderCandidateList();renderEditor(blankCandidate());});
  document.getElementById("sourceList").addEventListener("click",async function(event){var button=event.target.closest("[data-save-source]");if(!button)return;var card=button.closest("[data-source-id]");var id=card.dataset.sourceId;try{await api("/api/admin/calendar/sources/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({name:value("sourceName-"+id),url:value("sourceUrl-"+id),cadenceHours:Number(value("sourceCadence-"+id)),enabled:value("sourceEnabled-"+id)==="1",sourceType:value("sourceType-"+id),trustLevel:value("sourceTrust-"+id)})});toast("Source saved.");}catch(error){toast(error.message);}});
  document.getElementById("addSource").addEventListener("click",async function(){var url=window.prompt("Official source URL");if(!url)return;var name=window.prompt("Source name")||new URL(url).hostname;try{var payload=await api("/api/admin/calendar/sources",{method:"POST",body:JSON.stringify({name:name,url:url})});state.sources.push(payload.source);renderSources();toast("Source added.");}catch(error){toast(error.message);}});
  document.getElementById("socialSourceList").addEventListener("click",async function(event){var button=event.target.closest("[data-save-social-source]");if(!button)return;var card=button.closest("[data-social-source-id]");var id=card.dataset.socialSourceId;try{var payload=await api("/api/admin/calendar/social-sources/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({name:value("socialName-"+id),platform:value("socialPlatform-"+id),handle:value("socialHandle-"+id),profileUrl:value("socialProfileUrl-"+id),trustLevel:value("socialTrust-"+id),enabled:value("socialEnabled-"+id)==="1",cadenceHours:Number(value("socialCadence-"+id))})});var index=state.socialSources.findIndex(function(item){return item.id===id;});if(index>=0)state.socialSources[index]=payload.socialSource;renderSocialSources();toast("Social account saved.");}catch(error){toast(error.message);}});
  document.getElementById("addSocialSource").addEventListener("click",async function(){var platform=(window.prompt("Platform: threads, instagram, or tiktok")||"").trim().toLowerCase();if(!platform)return;var handle=(window.prompt("Public handle without @")||"").trim();if(!handle)return;var profileUrl=window.prompt("Public profile URL");if(!profileUrl)return;var trust=(window.prompt("Trust: official, trusted, or discovery","trusted")||"trusted").trim().toLowerCase();try{var payload=await api("/api/admin/calendar/social-sources",{method:"POST",body:JSON.stringify({platform:platform,handle:handle,profileUrl:profileUrl,trustLevel:trust,enabled:false})});state.socialSources.push(payload.socialSource);renderSocialSources();toast("Social account added in a paused state.");}catch(error){toast(error.message);}});
  document.getElementById("connectorList").addEventListener("click",async function(event){var card=event.target.closest("[data-connector-id]");if(!card)return;var id=card.dataset.connectorId;if(event.target.closest("[data-save-connector]")){try{var payload=await api("/api/admin/calendar/connectors/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({enabled:value("connectorEnabled-"+id)==="1",cadenceHours:Number(value("connectorCadence-"+id)),perRunLimit:Number(value("connectorLimit-"+id))})});var index=state.connectors.findIndex(function(item){return item.id===id;});if(index>=0)state.connectors[index]=payload.connector;renderConnectors();toast("Connector saved.");}catch(error){toast(error.message);}return;}if(event.target.closest("[data-run-connector]")){var button=event.target.closest("[data-run-connector]");button.disabled=true;toast(connectorLabel(id)+" started.");try{var result=await api("/api/admin/calendar/scout/run",{method:"POST",body:JSON.stringify({channels:[id]})});toast(connectorLabel(id)+": "+result.candidates+" candidates, "+result.duplicates+" duplicates, "+result.failures+" failures.");await Promise.all([refreshCandidates(),loadRuns()]);var connectors=await api("/api/admin/calendar/connectors");state.connectors=connectors.connectors||[];renderConnectors();}catch(error){toast(error.message);}finally{button.disabled=false;}}});
  document.getElementById("profileForm").addEventListener("submit",async function(event){event.preventDefault();try{var payload=await api("/api/admin/calendar/profile",{method:"PATCH",body:JSON.stringify({name:value("profileName"),model:value("profileModel"),weightedSubjects:JSON.parse(value("profileSubjects")),weightedFormats:JSON.parse(value("profileFormats")),positiveConcepts:parseComma(value("profilePositive")),negativeTerms:parseComma(value("profileNegative")),geographicRules:JSON.parse(value("profileGeography")),socialSettings:JSON.parse(value("profileSocialSettings")),dateHorizonDays:Number(value("profileHorizon")),relevanceThreshold:Number(value("profileThreshold")),duplicateSensitivity:Number(value("profileDuplicate")),perRunLimit:Number(value("profileLimit")),sourceCadenceHours:Number(value("profileSourceCadence")),webCadenceHours:Number(value("profileWebCadence"))})});state.profile=payload.profile;renderProfile();toast("Scout profile saved.");}catch(error){toast(error.message);}});
  document.getElementById("runScout").addEventListener("click",async function(){this.disabled=true;toast("Enabled scout lanes started.");try{var result=await api("/api/admin/calendar/scout/run",{method:"POST",body:"{}"});toast("Scout finished: "+result.candidates+" candidates, "+result.duplicates+" duplicates, "+result.failures+" failures.");await Promise.all([refreshCandidates(),loadRuns()]);var connectors=await api("/api/admin/calendar/connectors");state.connectors=connectors.connectors||[];renderConnectors();}catch(error){toast(error.message);}finally{this.disabled=false;}});
  document.getElementById("refreshRuns").addEventListener("click",loadRuns);
  document.getElementById("suggestionList").addEventListener("click",async function(event){var button=event.target.closest("[data-suggestion-action]");if(!button)return;try{await api("/api/admin/calendar/suggestions/"+encodeURIComponent(button.dataset.id)+"/"+button.dataset.suggestionAction,{method:"POST",body:"{}"});await loadSuggestions();var profile=await api("/api/admin/calendar/profile");state.profile=profile.profile;renderProfile();toast("Suggestion "+button.dataset.suggestionAction+"ed.");}catch(error){toast(error.message);}});
  if (token) connect();
})();
