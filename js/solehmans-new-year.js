(function () {
  "use strict";

  var SLUG = "solehmans-new-year";
  var params = new URLSearchParams(window.location.search);
  var previewMode = params.get("preview") === "1";
  var fallbackOptions = [
    { id:"adm_sny_i_opening", slug:"exhibition-opening", title:"Exhibition Opening + Fashion Show", startsAt:"2027-10-15T19:00:00-04:00", priceCents:0, priceFormatted:"$0.00", free:true, capacity:null, seatsRemaining:null, registrationStatus:"open", open:true },
    { id:"adm_sny_i_viewing_sat", slug:"saturday-open-studio", title:"Saturday Open Studio Viewing", startsAt:"2027-10-16T11:00:00-04:00", priceCents:0, priceFormatted:"$0.00", free:true, capacity:null, seatsRemaining:null, registrationStatus:"open", open:true },
    { id:"adm_sny_i_live_in_person", slug:"live-tattoo-in-person", title:"Live Tattoo — In Person", startsAt:"2027-10-16T11:00:00-04:00", priceCents:10000, priceFormatted:"$100.00", free:false, capacity:12, seatsRemaining:12, registrationStatus:"closed", open:false },
    { id:"adm_sny_i_live_virtual", slug:"live-tattoo-virtual", title:"Live Tattoo — Virtual", startsAt:"2027-10-16T11:00:00-04:00", priceCents:5000, priceFormatted:"$50.00", free:false, capacity:null, seatsRemaining:null, registrationStatus:"closed", open:false },
    { id:"adm_sny_i_tattoo_party", slug:"tattoo-party", title:"Tattoo Party", startsAt:"2027-10-16T18:00:00-04:00", priceCents:6000, priceFormatted:"$60.00", free:false, capacity:10, seatsRemaining:10, registrationStatus:"closed", open:false },
    { id:"adm_sny_i_viewing_sun", slug:"sunday-open-studio", title:"Sunday Open Studio Viewing", startsAt:"2027-10-17T11:00:00-04:00", priceCents:0, priceFormatted:"$0.00", free:true, capacity:null, seatsRemaining:null, registrationStatus:"open", open:true },
    { id:"adm_sny_i_artist_talk", slug:"artist-talk-and-closing", title:"Artist Talk + Creative Ecosystem Showing + Closing", startsAt:"2027-10-17T15:00:00-04:00", priceCents:0, priceFormatted:"$0.00", free:true, capacity:null, seatsRemaining:null, registrationStatus:"open", open:true },
    { id:"adm_sny_i_bonus_viewing", slug:"bonus-open-studio", title:"Bonus Open Studio Viewing", startsAt:"2027-10-18T11:00:00-04:00", priceCents:0, priceFormatted:"$0.00", free:true, capacity:null, seatsRemaining:null, registrationStatus:"open", open:true },
  ];

  var stateEl = document.getElementById("eventState");
  var grid = document.getElementById("admissionGrid");
  var form = document.getElementById("registrationForm");
  var select = document.getElementById("admissionOption");
  var submit = document.getElementById("registerSubmit");
  var status = document.getElementById("registrationStatus");
  var currentOptions = [];
  var currentPublication = "draft";

  function setStatus(text, value) {
    status.textContent = text || "";
    status.dataset.state = value || "";
  }

  function optionLabel(option) {
    var price = option.free ? "Free RSVP" : option.priceFormatted;
    var availability = option.capacity === null
      ? (option.free ? "" : " · unlimited")
      : ` · ${option.seatsRemaining} of ${option.capacity} available`;
    return `${option.title} · ${price}${availability}`;
  }

  function cardButtonLabel(option, publicActions) {
    if (!publicActions) return option.free ? "Draft" : "Sales closed";
    if (option.soldOut) return "Sold out";
    if (!option.open) return option.free ? "RSVP closed" : "Sales closed";
    return option.free ? "RSVP" : "Get ticket";
  }

  function syncSubmit() {
    var selected = currentOptions.find(function (option) { return option.id === select.value; });
    var available = currentPublication === "published" && selected && selected.open;
    submit.disabled = !available;
    if (!selected) submit.textContent = currentPublication === "published" ? "Choose an option" : "Draft · registration unavailable";
    else if (!available) submit.textContent = selected.free ? "RSVP closed" : "Sales closed";
    else submit.textContent = selected.free ? "Confirm RSVP" : "Continue to payment";
    grid.querySelectorAll(".admission-card").forEach(function (card) {
      card.classList.toggle("is-selected", Boolean(selected && card.dataset.admission === selected.slug));
    });
  }

  function applyEvent(event) {
    currentPublication = event.publicationState || "draft";
    currentOptions = Array.isArray(event.admissionOptions) ? event.admissionOptions : [];
    var publicActions = currentPublication === "published";
    stateEl.dataset.state = currentPublication;
    stateEl.textContent = currentPublication === "published"
      ? "Published · RSVP open · paid sales closed"
      : currentPublication === "announced"
        ? "Announced · registration not open"
        : "Draft · RSVP and sales not public";

    currentOptions.forEach(function (option) {
      var card = grid.querySelector(`[data-admission="${option.slug}"]`);
      if (!card) return;
      var button = card.querySelector(".admission-action");
      var canChoose = publicActions && option.open;
      card.dataset.open = String(canChoose);
      button.disabled = !canChoose;
      button.textContent = cardButtonLabel(option, publicActions);
      button.onclick = canChoose ? function () {
        select.value = option.id;
        syncSubmit();
        document.getElementById("register").scrollIntoView({ behavior:"smooth", block:"start" });
        window.setTimeout(function () { select.focus(); }, 350);
      } : null;
    });

    select.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = publicActions ? "Choose one" : "Event is not published";
    select.appendChild(placeholder);
    currentOptions.forEach(function (option) {
      var element = document.createElement("option");
      element.value = option.id;
      element.textContent = optionLabel(option) + (option.open ? "" : " · closed");
      element.disabled = !publicActions || !option.open;
      select.appendChild(element);
    });
    select.disabled = !publicActions || !currentOptions.some(function (option) { return option.open; });
    if (publicActions) setStatus("Choose a free RSVP option. Paid-session sales are still closed.", "");
    else setStatus("This Event is saved as a draft. RSVP functionality is ready but not public.", "");
    syncSubmit();
  }

  function previewEvent() {
    var publication = params.get("state") === "published" ? "published" : "draft";
    return { publicationState:publication, admissionOptions:fallbackOptions };
  }

  select.addEventListener("change", syncSubmit);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submit.disabled || !form.reportValidity()) return;
    var values = new FormData(form);
    var payload = {
      admissionOptionId:String(values.get("admissionOptionId") || ""),
      name:String(values.get("name") || "").trim(),
      email:String(values.get("email") || "").trim(),
      phone:String(values.get("phone") || "").trim(),
      newsletter_consent:String(values.get("newsletter_consent") || ""),
      _gotcha:String(values.get("_gotcha") || ""),
      seats:1,
    };
    submit.disabled = true;
    submit.textContent = "Saving";
    setStatus("Saving your registration…", "");
    if (previewMode) {
      window.setTimeout(function () {
        setStatus("Preview · RSVP confirmed. A confirmation and reminder would be sent by email.", "ok");
        syncSubmit();
      }, 250);
      return;
    }
    fetch(`/api/events/${SLUG}/checkout`, {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify(payload),
    })
      .then(function (response) { return response.json().then(function (data) { return { ok:response.ok, data:data }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error(result.data.error || "Unable to register.");
        if (result.data.checkoutUrl) {
          window.location.href = result.data.checkoutUrl;
          return;
        }
        window.location.href = `/events/confirmed/?ticket=${encodeURIComponent(result.data.ticketId)}&event=${encodeURIComponent(SLUG)}`;
      })
      .catch(function (error) {
        setStatus(error.message || "Unable to register.", "error");
        syncSubmit();
      });
  });

  if (previewMode) {
    applyEvent(previewEvent());
  } else {
    fetch(`/api/events/${SLUG}/context`)
      .then(function (response) { return response.json().then(function (data) { return { ok:response.ok, data:data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data.event) throw new Error(result.data.error || "Event unavailable.");
        applyEvent(result.data.event);
      })
      .catch(function () {
        applyEvent({ publicationState:"draft", admissionOptions:fallbackOptions });
      });
  }
})();
