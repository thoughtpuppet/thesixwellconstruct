(function tattooSpecialsPage(global, document) {
  "use strict";

  const stateEl = document.getElementById("specialsState");
  const stateTitle = document.getElementById("stateTitle");
  const stateCopy = document.getElementById("stateCopy");
  const offersSection = document.getElementById("specialsOffersSection");
  const offersEl = document.getElementById("specialsOffers");
  const formSection = document.getElementById("specialsFormSection");
  const form = document.getElementById("specialsForm");
  const receipt = document.getElementById("specialsReceipt");
  const purchaserFieldset = document.getElementById("specialsPurchaserFieldset");
  const projectFieldset = document.getElementById("specialsProjectFieldset");
  const submitButton = document.getElementById("specialsSubmit");
  const pendingAnalytics = [];
  const trackedStages = new Set();
  const viewedOffers = new Set();
  const offerViewTimers = new Map();
  let payload = null;
  let selectedOffer = null;
  let leadFired = false;

  document.querySelectorAll('input[type="email"][pattern]').forEach((input) => {
    input.addEventListener("invalid", () => {
      if (input.validity.patternMismatch) input.setCustomValidity(input.title);
    });
    input.addEventListener("input", () => input.setCustomValidity(""));
  });

  function createIdempotencyKey() {
    const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `specials-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  let idempotencyKey = createIdempotencyKey();
  const utmField = document.getElementById("specialsUtm");
  if (utmField && typeof URLSearchParams !== "undefined" && typeof location !== "undefined") {
    const params = new URLSearchParams(location.search);
    utmField.value = ["utm_source", "utm_medium", "utm_campaign", "utm_content"].map((key) => {
      const value = (params.get(key) || "").trim().slice(0, 120);
      return value ? `${key}=${value}` : "";
    }).filter(Boolean).join("|");
  }

  const money = (cents) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
  const date = (value) => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
  const escape = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);

  function flushPendingAnalytics() {
    if (!global.SixWellAnalytics?.track) return;
    while (pendingAnalytics.length) {
      const event = pendingAnalytics.shift();
      global.SixWellAnalytics.track(event.name, event.properties);
    }
  }

  function analyticsTrack(name, action, offerId = selectedOffer?.id || "") {
    const event = {
      name,
      properties: {
        action,
        sectionId: payload?.campaignId || "",
        itemId: offerId || "",
      },
    };
    if (global.SixWellAnalytics?.track) global.SixWellAnalytics.track(event.name, event.properties);
    else pendingAnalytics.push(event);
  }

  global.addEventListener("sixwell:analytics-ready", flushPendingAnalytics);
  global.addEventListener("load", flushPendingAnalytics, { once: true });

  function trackStageOnce(action, name = "interactive_milestone", offerId = selectedOffer?.id || "") {
    if (trackedStages.has(action)) return;
    trackedStages.add(action);
    analyticsTrack(name, action, offerId);
  }

  function trackOfferViewed(offerId) {
    if (!offerId || viewedOffers.has(offerId)) return;
    viewedOffers.add(offerId);
    analyticsTrack("interactive_milestone", "offer_viewed", offerId);
  }

  function observeOffers() {
    if (!("IntersectionObserver" in global)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const offerId = entry.target.dataset.offerCard || "";
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && !viewedOffers.has(offerId)) {
          if (offerViewTimers.has(offerId)) continue;
          offerViewTimers.set(offerId, global.setTimeout(() => {
            offerViewTimers.delete(offerId);
            if (entry.target.isConnected) trackOfferViewed(offerId);
          }, 1000));
        } else if (offerViewTimers.has(offerId)) {
          global.clearTimeout(offerViewTimers.get(offerId));
          offerViewTimers.delete(offerId);
        }
      }
    }, { threshold: [0, 0.5] });
    offersEl.querySelectorAll("[data-offer-card]").forEach((card) => observer.observe(card));
  }

  function renderClosed(state) {
    stateEl.hidden = false;
    stateTitle.textContent = state === "scheduled" ? "This sales window has not opened yet." : "There are no special available at this time.";
    stateCopy.innerHTML = state === "scheduled"
      ? `Sales open ${escape(date(payload.salesOpensAt))}. You can use the <a href="${escape(payload.normalInquiryUrl)}">normal tattoo inquiry</a> in the meantime.`
      : `Check back another time or <a href="${escape(payload.normalInquiryUrl)}">submit a normal tattoo request</a>.`;
  }

  function renderOpen() {
    stateEl.hidden = true;
    offersSection.hidden = false;
    document.getElementById("specialsDates").textContent = `from ${date(payload.salesOpensAt)} through ${date(payload.salesClosesAt)}`;
    document.getElementById("specialsDeposit").textContent = payload.defaultDeposit;
    offersEl.innerHTML = payload.offers.map((offer) => `<article class="special-card" data-mode="${escape(offer.mode)}" data-offer-card="${escape(offer.id)}"><h3>${escape(offer.title)}</h3><p>${escape(offer.description)}</p><p class="special-card__prices">${offer.variants.map((variant) => `${escape(variant.label)} ${escape(variant.price)}`).join(" Â· ")}</p><button type="button" data-offer="${escape(offer.id)}">Choose this special â†’</button></article>`).join("");
    trackStageOnce("campaign_opened", "interactive_start", "");
    observeOffers();
  }

  function updateScriptWordCount() {
    const input = document.getElementById("specialsScriptText");
    const output = document.getElementById("scriptWordCount");
    const maximum = Number(selectedOffer?.maxWordCount || 0);
    const count = input.value.trim() ? input.value.trim().split(/\s+/).length : 0;
    output.textContent = maximum ? `${count} of ${maximum} words` : "";
    input.setCustomValidity(maximum && count > maximum ? `Keep the script to ${maximum} words or fewer.` : "");
  }

  function updateSecondParticipantRequirement() {
    const fieldset = document.getElementById("participant2Fieldset");
    const inputs = Array.from(fieldset.querySelectorAll("input"));
    const started = !fieldset.hidden && inputs.some((input) => input.type === "checkbox" ? input.checked : Boolean(input.value.trim()));
    inputs.forEach((input) => { input.required = started; });
  }

  function hasReference() {
    return Boolean(document.getElementById("specialsReferenceLink").value.trim() || document.getElementById("specialsReferences").files?.length);
  }

  function requiredFieldsComplete(fieldset) {
    return Array.from(fieldset.querySelectorAll("input[required],select[required],textarea[required]"))
      .filter((control) => !control.closest("[hidden]"))
      .every((control) => control.checkValidity());
  }

  function renderSelection() {
    if (!selectedOffer) return;
    document.getElementById("offerId").value = selectedOffer.id;
    document.getElementById("selectedOfferSummary").textContent = `${selectedOffer.title} Â· ${selectedOffer.duration} Â· ${money(selectedOffer.depositCents)} deposit.`;
    const select = document.getElementById("variantId");
    select.innerHTML = selectedOffer.variants.map((variant) => `<option value="${escape(variant.id)}">${escape(variant.label)} â€” ${escape(variant.price)}</option>`).join("");
    const participant2 = document.getElementById("participant2Fieldset");
    participant2.hidden = selectedOffer.participantCount !== 2;
    updateSecondParticipantRequirement();
    const referenceRequired = selectedOffer.referenceRequirement === "required";
    document.getElementById("referenceLinkHint").textContent = referenceRequired ? "(image or link required)" : "(optional)";
    document.getElementById("referenceFileHint").textContent = referenceRequired ? "(image or link required)" : "(optional)";
    const maximum = Number(selectedOffer.maxWordCount || 0);
    const scriptField = document.getElementById("scriptTextField");
    const scriptInput = document.getElementById("specialsScriptText");
    scriptField.hidden = !maximum;
    scriptInput.required = Boolean(maximum);
    document.getElementById("scriptTextHint").textContent = maximum ? `(${maximum} words maximum)` : "";
    updateScriptWordCount();
    document.getElementById("selectionTerms").textContent = "Requests are reviewed before booking. After approval, a private link will make it easy to choose an available time and complete the deposit.";
    formSection.hidden = false;
    formSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function evaluateFormProgress(target) {
    if (!selectedOffer) return;
    trackStageOnce("form_started");
    if (target.closest("#specialsPurchaserFieldset") && requiredFieldsComplete(purchaserFieldset)) {
      trackStageOnce("purchaser_completed");
    }
    if (target.closest("#specialsProjectFieldset")) {
      trackStageOnce("project_started");
      if (hasReference()) trackStageOnce("reference_added");
      const referenceComplete = selectedOffer.referenceRequirement !== "required" || hasReference();
      if (referenceComplete && requiredFieldsComplete(projectFieldset)) trackStageOnce("project_completed");
    }
  }

  document.getElementById("specialsScriptText").addEventListener("input", updateScriptWordCount);
  document.getElementById("participant2Fieldset").addEventListener("input", updateSecondParticipantRequirement);
  document.getElementById("participant2Fieldset").addEventListener("change", updateSecondParticipantRequirement);
  form.addEventListener("input", (event) => evaluateFormProgress(event.target));
  form.addEventListener("change", (event) => evaluateFormProgress(event.target));
  submitButton.addEventListener("click", () => trackStageOnce("submit_attempted"));

  offersEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-offer]");
    if (!button) return;
    trackOfferViewed(button.dataset.offer);
    selectedOffer = payload.offers.find((offer) => offer.id === button.dataset.offer) || null;
    if (!selectedOffer) return;
    analyticsTrack("interactive_milestone", "offer_selected", selectedOffer.id);
    renderSelection();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    trackStageOnce("submit_attempted");
    const status = document.getElementById("specialsFormStatus");
    submitButton.disabled = true;
    status.textContent = "Sending your Tattoo Special requestâ€¦";
    const data = new FormData(form);
    data.set("idempotencyKey", idempotencyKey);
    try {
      const response = await fetch("/api/tattoo/specials/submissions", {
        method: "POST", headers: { "idempotency-key": idempotencyKey }, body: data,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to submit.");
      trackStageOnce("request_accepted", "interactive_complete");
      global.dispatchEvent(new CustomEvent("sixwell:form-complete", { detail: { formId: "specialsForm" } }));
      if (!leadFired && typeof global.fbq === "function") {
        leadFired = true;
        global.fbq("track", "Lead");
      }
      if (result.bookingUrl) {
        status.textContent = "Opening the calendarâ€¦";
        global.SixWellAnalytics?.flush(true);
        location.assign(result.bookingUrl);
        return;
      }
      formSection.hidden = true;
      receipt.hidden = false;
      document.getElementById("receiptTitle").textContent = "Request received.";
      document.getElementById("receiptCopy").textContent = result.receipt || "Thanks for sending this in. A follow-up will arrive soon.";
      receipt.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      analyticsTrack("form_error", "submission_failed", selectedOffer?.id || "");
      status.textContent = error.message;
      submitButton.disabled = false;
    }
  });

  fetch("/api/tattoo/specials", { cache: "no-store", headers: { accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error();
      return response.json();
    })
    .then((data) => {
      payload = data;
      if (data.state !== "open") renderClosed(data.state);
      else renderOpen();
    })
    .catch(() => {
      stateTitle.textContent = "Tattoo Specials are temporarily unavailable.";
      stateCopy.innerHTML = 'The <a href="/tattoos/inquire/">regular tattoo inquiry</a> is still available.';
    });
})(window, document);
