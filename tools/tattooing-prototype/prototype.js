(() => {
  "use strict";

  const revealHashTarget = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (target?.matches("details")) target.open = true;
  };
  revealHashTarget();
  window.addEventListener("hashchange", revealHashTarget);

  const existingPaths = {
    build: {
      title: "Build is an existing path",
      body: "Build Your Own uses selected marks and symbols to make a brief for Saiel to interpret. That guided system remains separate from the Custom inquiry shown in this prototype; its public route is currently closed while it is being developed.",
      href: "",
      link: "",
    },
    inPerson: {
      title: "In-person consultation is an existing path",
      body: "A paid, focused conversation at the studio can help resolve placement, cover-up, or project-planning questions. It is not itself a tattoo appointment. The prototype does not reserve a time or collect payment.",
      href: "https://thesixwellconstruct.com/tattoos/inquire/consultation/?type=consult_in_person",
      link: "Open live in-person consultation ↗",
    },
    virtual: {
      title: "Virtual consultation is an existing path",
      body: "A paid video conversation can help resolve placement, cover-up, or project-planning questions before a tattoo date is set. The prototype does not reserve a time or collect payment.",
      href: "https://thesixwellconstruct.com/tattoos/inquire/consultation/?type=consult_virtual",
      link: "Open live virtual consultation ↗",
    },
  };

  const dialog = document.getElementById("existingPathDialog");
  if (dialog) {
    const title = dialog.querySelector("[data-dialog-title]");
    const body = dialog.querySelector("[data-dialog-body]");
    const live = dialog.querySelector("[data-dialog-live]");
    document.querySelectorAll("[data-open-path]").forEach((button) => {
      button.addEventListener("click", () => {
        const path = existingPaths[button.dataset.openPath];
        if (!path) return;
        title.textContent = path.title;
        body.textContent = path.body;
        live.hidden = !path.href;
        if (path.href) {
          live.href = path.href;
          live.textContent = path.link;
          live.target = "_blank";
          live.rel = "noopener noreferrer";
        } else {
          live.removeAttribute("href");
        }
        dialog.showModal();
      });
    });
    dialog.querySelector("[data-close-dialog]")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  const planners = new Map();
  document.querySelectorAll("[data-planning-size]").forEach((sizeContainer) => {
    const path = sizeContainer.dataset.planningSize;
    const travelContainer = document.querySelector(`[data-planning-travel="${path}"]`);
    const scheduleContainer = document.querySelector(`[data-planning-schedule="${path}"]`);
    if (!travelContainer || !scheduleContainer) return;
    const prefix = `${path}Planning`;
    const pathNote = {
      custom: "Your answers help me propose a plan after reviewing the project. A ¼ sleeve may still be one appointment.",
      flash: "The chosen flash design may already have a set size or session structure. That takes priority over a scheduling preference here.",
      special: "Your size and scheduling answers help me propose a plan for this artist-led type. They do not guarantee a particular appointment count or pace.",
    }[path];
    sizeContainer.innerHTML = `
      <div class="prototype-field-grid">
        <div class="prototype-field"><label for="${prefix}Size">Estimated size <span class="prototype-required">*</span></label><select id="${prefix}Size">
          <option value="">Choose the closest size</option>
          <option value="small">Small · 2 in or less</option>
          <option value="medium">Medium · over 2–5 in</option>
          <option value="large">Large · over 5–8 in</option>
          <option value="xl">XL · over 8 in, one area</option>
          <option value="large_scale">Large-scale work / body-area coverage</option>
        </select><small>For a single area, use the longest side as your size estimate. Size does not set a session count.</small></div>
        <div class="prototype-field"><label for="${prefix}Dimensions">Estimated dimensions (optional)</label><input id="${prefix}Dimensions" type="text" placeholder="Example: about 5 × 7 in"><small>Leave blank if you are choosing body-area coverage below.</small></div>
        <div class="prototype-field prototype-field--full" data-coverage hidden><label for="${prefix}Coverage">Which area would it cover? <span class="prototype-required">*</span></label><select id="${prefix}Coverage">
          <option value="">Choose the closest fit</option>
          <optgroup label="Arm"><option>¼ arm sleeve</option><option>½ arm sleeve</option><option>Full arm sleeve</option></optgroup>
          <optgroup label="Leg"><option>¼ leg sleeve</option><option>½ leg sleeve</option><option>Full leg sleeve</option></optgroup>
          <optgroup label="Back"><option>Half back</option><option>Full back</option><option>Spine</option></optgroup>
          <optgroup label="Front and neck"><option>Chest / front torso</option><option>Neck · front</option><option>Neck · back</option><option>Neck · side</option><option>Full neck</option></optgroup>
          <option value="other">Other area or combination</option>
        </select><small>Coverage describes where the work goes; it does not decide how many appointments it needs.</small></div>
        <div class="prototype-field prototype-field--full" data-other-coverage hidden><label for="${prefix}OtherCoverage">Describe the area</label><input id="${prefix}OtherCoverage" type="text" placeholder="Example: shoulder across upper back"></div>
      </div>`;
    travelContainer.innerHTML = `
      <fieldset class="prototype-field prototype-fieldset prototype-planning-choice"><legend>Are you traveling to Atlanta?</legend><div class="prototype-choices">
        <label class="prototype-choice"><input type="radio" name="${prefix}Travel" value="Yes">Yes</label>
        <label class="prototype-choice"><input type="radio" name="${prefix}Travel" value="No">No</label>
      </div></fieldset>`;
    scheduleContainer.innerHTML = `
      <div class="prototype-field-grid">
        <fieldset class="prototype-field prototype-field--full prototype-fieldset prototype-planning-choice" data-session-preference hidden><legend>If this needs more than one appointment, what would work best for you?</legend><div class="prototype-choices">
          <label class="prototype-choice"><input type="radio" name="${prefix}Preference" value="Back-to-back days in one trip, if feasible">Back-to-back days in one trip</label>
          <label class="prototype-choice"><input type="radio" name="${prefix}Preference" value="Separate visits with healing time in between">Separate visits with healing time in between</label>
          <label class="prototype-choice"><input type="radio" name="${prefix}Preference" value="Either plan works">Either works</label>
          <label class="prototype-choice"><input type="radio" name="${prefix}Preference" value="Need to discuss">Need to discuss</label>
        </div><small>This is your preference, not a booking choice. Even a ¼ sleeve might be completed in one appointment.</small></fieldset>
        <div class="prototype-field" data-return-ability hidden><label for="${prefix}Return">Could you return for another trip if needed?</label><select id="${prefix}Return"><option value="">Choose one</option><option>Yes</option><option>No</option><option>Not sure</option></select></div>
        <div class="prototype-field" data-trip-days hidden><label for="${prefix}TripDays">How many appointment days could you make in one trip?</label><select id="${prefix}TripDays"><option value="">Choose one</option><option>1 day</option><option>2 days</option><option>3 days</option><option>4 or more days</option><option>Not sure</option></select></div>
        <div class="prototype-field" data-travel-origin hidden><label for="${prefix}Origin">Traveling from (optional)</label><input id="${prefix}Origin" type="text" placeholder="City, state, or country"></div>
      </div>
      <p class="prototype-planning-note">${pathNote} Saiel confirms the appointment count, pacing, and budget after review; no date is reserved here.</p>
      <p class="prototype-planning-feedback" data-planning-feedback hidden aria-live="polite"></p>`;
    const size = sizeContainer.querySelector(`#${prefix}Size`);
    const coverage = sizeContainer.querySelector(`#${prefix}Coverage`);
    const feedback = scheduleContainer.querySelector("[data-planning-feedback]");
    const groups = {
      coverage: sizeContainer.querySelector("[data-coverage]"),
      other: sizeContainer.querySelector("[data-other-coverage]"),
      preference: scheduleContainer.querySelector("[data-session-preference]"),
      returnAbility: scheduleContainer.querySelector("[data-return-ability]"),
      tripDays: scheduleContainer.querySelector("[data-trip-days]"),
      origin: scheduleContainer.querySelector("[data-travel-origin]"),
    };
    const show = (element, visible) => {
      element.hidden = !visible;
      element.querySelectorAll("input, select").forEach((control) => { control.disabled = !visible; });
    };
    const sync = () => {
      const largeScale = size.value === "large_scale";
      const traveling = travelContainer.querySelector(`input[name="${prefix}Travel"]:checked`)?.value === "Yes";
      show(groups.coverage, largeScale);
      show(groups.other, largeScale && coverage.value === "other");
      show(groups.preference, largeScale || size.value === "xl");
      [groups.returnAbility, groups.tripDays, groups.origin].forEach((group) => show(group, traveling));
      const returnChoice = scheduleContainer.querySelector(`#${prefix}Return`).value;
      const preference = scheduleContainer.querySelector(`input[name="${prefix}Preference"]:checked`)?.value || "";
      if (traveling && returnChoice === "No" && preference === "Separate visits with healing time in between") {
        feedback.textContent = "You said you cannot return, so separate trips may not work for you. I would discuss a one-trip plan or a different scope before booking.";
      } else if (traveling && returnChoice === "No" && (largeScale || size.value === "xl")) {
        feedback.textContent = "You cannot make a return trip. I would review whether this project can be completed in one visit; that is not guaranteed by this request.";
      } else {
        feedback.textContent = "";
      }
      feedback.hidden = !feedback.textContent;
    };
    [sizeContainer, travelContainer, scheduleContainer].forEach((element) => element.addEventListener("change", sync));
    sync();
    const value = (id) => {
      const control = document.getElementById(`${prefix}${id}`);
      return control && !control.disabled && control.value.trim() ? (control.selectedOptions?.[0]?.textContent.trim() || control.value.trim()) : "Not provided";
    };
    planners.set(path, {
      answers: () => [
        ["Estimated size", value("Size")],
        ...(size.value === "large_scale" ? [["Body-area coverage", value("Coverage")]] : [["Estimated dimensions", value("Dimensions")]]),
        ...(coverage.value === "other" && size.value === "large_scale" ? [["Other coverage", value("OtherCoverage")]] : []),
        ...(groups.preference.hidden ? [] : [["If multiple appointments are needed", scheduleContainer.querySelector(`input[name="${prefix}Preference"]:checked`)?.value || "Not selected"]]),
        ["Traveling to Atlanta", travelContainer.querySelector(`input[name="${prefix}Travel"]:checked`)?.value || "Not selected"],
        ...(travelContainer.querySelector(`input[name="${prefix}Travel"]:checked`)?.value === "Yes" ? [["Can return", value("Return")], ["Days available in one trip", value("TripDays")], ["Traveling from", value("Origin")]] : []),
      ],
      sync,
    });
  });

  const projectType = document.getElementById("projectType");
  const reviewButton = document.getElementById("previewBriefButton");
  if (projectType && reviewButton) {
    const branchContext = document.getElementById("projectTypeContext");
    const existingPhoto = document.getElementById("existingPhotoPreview");
    const existingPhotoCopy = document.getElementById("existingPhotoCopy");
    const placementPhoto = document.getElementById("placementPhotoPreview");
    const placementPhotoCopy = document.getElementById("placementPhotoCopy");
    const budget = document.getElementById("comfortBudget");
    const specificBudget = document.getElementById("specificBudgetPreview");
    const projectGuidance = {
      new_work: {
        description: "New work: describe the idea and any style or visual direction you have in mind.",
        placement: "Body-area photos are optional on the live form. They can help show placement and scale.",
      },
      cover_up: {
        description: "Cover-up: explain what you want hidden, changed, or kept.",
        existing: "The live form requires at least 1 clear photo of the full existing tattoo. Additional angles help.",
        placement: "Additional body-area photos are optional on the live form.",
      },
      large_cover_up: {
        description: "Large cover-up: include the size of the existing tattoo. I will review whether more than one appointment is needed.",
        existing: "The live form requires at least 3 clear photos of the existing tattoo from 3 angles. These replace a separate body-area photo group.",
      },
      rework: {
        description: "Rework or recolor: explain what you want repaired, changed, or kept.",
        existing: "The live form requires at least 1 clear photo of the current tattoo. More angles can help.",
        placement: "If the tattoo may grow, photos of the surrounding area are optional on the live form.",
      },
      space_filler: {
        description: "Space filler: describe the gap and the tattoos around it.",
        placement: "The live form requires at least 2 photos: 1 wide view of the surrounding tattoos and 1 close view of the gap.",
      },
    };

    const syncProjectType = () => {
      const type = projectType.value;
      const guidance = projectGuidance[type];
      branchContext.hidden = !guidance;
      branchContext.textContent = guidance?.description || "";
      document.querySelectorAll("[data-project-types]").forEach((field) => {
        const active = field.dataset.projectTypes.split(" ").includes(type);
        field.hidden = !active;
        field.querySelectorAll("input, select, textarea").forEach((control) => { control.disabled = !active; });
      });
      existingPhoto.hidden = !guidance?.existing;
      existingPhotoCopy.textContent = guidance?.existing || "";
      placementPhoto.hidden = type === "large_cover_up";
      placementPhotoCopy.textContent = guidance?.placement || "The live form lets you add body-area photos. No image can be uploaded here.";
    };
    const syncBudget = () => { specificBudget.hidden = budget.value !== "specific"; };
    projectType.addEventListener("change", syncProjectType);
    budget.addEventListener("change", syncBudget);
    syncProjectType();
    syncBudget();

    reviewButton.addEventListener("click", () => {
      const review = document.getElementById("briefReview");
      const list = document.getElementById("briefReviewList");
      const status = document.getElementById("previewTermsStatus");
      const checks = ["previewAgeConfirmed", "previewInquiryUnderstood", "previewTermsRead"].map((id) => document.getElementById(id));
      const missing = checks.find((check) => !check.checked);
      if (missing) {
        review.hidden = true;
        status.textContent = "Check all three preview acknowledgments above to see the answer summary. Nothing will be submitted or recorded.";
        status.hidden = false;
        missing.focus();
        return;
      }
      status.hidden = true;
      const value = (id) => {
        const control = document.getElementById(id);
        if (!control?.value.trim()) return "Not provided";
        return control.tagName === "SELECT" ? control.selectedOptions[0].textContent.trim() : control.value.trim();
      };
      const selected = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((item) => item.value);
      const lines = [
        ["Project type", value("projectType")],
        ...planners.get("custom").answers(),
        ["Previously tattooed by me", selected("previousClient").join(", ") || "Not selected"],
        ["Tattoo idea", value("projectMeaning")],
        ["Examples of my work", selected("resonance").join(", ") || "Not selected"],
        ["Specific example", value("resonanceReference")],
        ["Reference links", value("referenceLinks")],
        ["Must-have details", value("projectBoundaries")],
        ["What I can decide", value("creativeFreedom")],
        ["What references show", value("referenceIntent")],
        ["Body area", value("bodyPlacement")],
        ["Color preference", value("colorDirection")],
        ["Placement concerns", value("bodyContext")],
        ["Timeline", value("timingWindow")],
        ["Requested date", value("requestedDate")],
        ["Budget", budget.value === "specific" ? value("specificBudget") : value("comfortBudget")],
      ];
      const branchAnswers = {
        new_work: [["Style direction", value("desiredStyle")]],
        cover_up: [["Cover-up goal", value("coverUpGoal")], ["Size or placement flexibility", value("sizePlacementFlexibility")]],
        large_cover_up: [["Cover-up goal", value("coverUpGoal")], ["Size or placement flexibility", value("sizePlacementFlexibility")], ["Existing tattoo size", value("existingTattooDimensions")], ["Larger tattoo", value("openToLargerFootprint")], ["Laser or scarring context", value("treatmentScarringContext")]],
        rework: [["Current tattoo age", value("existingTattooAge")], ["Work considered", selected("reworkIntervention").join(", ") || "Not selected"], ["Current condition", value("reworkCondition")], ["Making the tattoo larger", value("reworkExpansion")]],
        space_filler: [["Gap size", value("gapDimensions")], ["Surrounding tattoos", value("surroundingWork")], ["How the filler should fit", value("fillerRelationship")]],
      };
      lines.splice(2, 0, ...(branchAnswers[projectType.value] || []));
      list.replaceChildren();
      lines.forEach(([label, answer]) => {
        const item = document.createElement("li");
        const strong = document.createElement("strong");
        strong.textContent = `${label}: `;
        item.append(strong, document.createTextNode(answer));
        list.append(item);
      });
      review.hidden = false;
      review.scrollIntoView({ block: "start", behavior: "smooth" });
    });

    const clearPreview = () => {
      document.querySelectorAll("input, select, textarea").forEach((control) => {
        if (control.matches('[type="checkbox"], [type="radio"]')) control.checked = false;
        else if (control.tagName === "SELECT") control.selectedIndex = 0;
        else control.value = "";
      });
      document.getElementById("briefReview").hidden = true;
      document.getElementById("previewTermsStatus").hidden = true;
      syncProjectType();
      syncBudget();
      planners.get("custom").sync();
    };
    window.addEventListener("pagehide", clearPreview);
    window.addEventListener("pageshow", (event) => { if (event.persisted) clearPreview(); });
  }

  const animeFields = document.getElementById("animeFields");
  const syncArtistLedType = () => {
    if (!animeFields) return;
    const anime = document.querySelector('input[name="specialDesignType"]:checked')?.value === "Anime";
    animeFields.hidden = !anime;
    const source = document.getElementById("animeSource");
    source.disabled = !anime;
    if (!anime) source.value = "";
  };
  if (animeFields) {
    document.querySelectorAll('input[name="specialDesignType"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        syncArtistLedType();
        document.querySelector('[data-planning-review="special"]').hidden = true;
      });
    });
    syncArtistLedType();
  }

  document.querySelectorAll("[data-planning-preview]").forEach((button) => {
    const path = button.dataset.planningPreview;
    const review = document.querySelector(`[data-planning-review="${path}"]`);
    const status = document.querySelector(`[data-planning-status="${path}"]`);
    const acknowledgment = document.querySelector(`[data-planning-ack="${path}"]`);
    const inputValue = (id) => document.getElementById(id)?.value.trim() || "Not provided";
    button.addEventListener("click", () => {
      const missingAck = path === "special"
        ? [...document.querySelectorAll("[data-special-ack]")].find((control) => !control.checked)
        : !acknowledgment.checked ? acknowledgment : null;
      if (missingAck) {
        review.hidden = true;
        status.textContent = path === "special"
          ? "Check all preview acknowledgments first. Nothing will be submitted or recorded."
          : "Check the preview acknowledgment first. Nothing will be submitted or recorded.";
        status.hidden = false;
        missingAck.focus();
        return;
      }
      if (path === "special") {
        const type = document.querySelector('input[name="specialDesignType"]:checked');
        const missing = !type
          ? [document.querySelector('input[name="specialDesignType"]'), "Choose one of the four artist-led design types."]
          : type.value === "Anime" && !document.getElementById("animeSource").value.trim()
            ? [document.getElementById("animeSource"), "Tell me which anime, character, or arc you are choosing."]
            : !document.getElementById("specialPlacement").value.trim()
              ? [document.getElementById("specialPlacement"), "Add the body area you are offering."]
              : !document.getElementById("specialPlanningSize").value
                ? [document.getElementById("specialPlanningSize"), "Choose an estimated size."]
                : !document.getElementById("specialBudget").value
                  ? [document.getElementById("specialBudget"), "Choose a comfortable total budget range, including the flexible option."]
                  : null;
        if (missing) {
          review.hidden = true;
          status.textContent = `${missing[1]} Nothing will be submitted or recorded.`;
          status.hidden = false;
          missing[0].focus();
          return;
        }
      }
      status.hidden = true;
      const pathAnswers = path === "flash"
        ? [["Flash design", inputValue("flashDesignCode")], ["Placement", inputValue("flashPlacement")]]
        : [["Artist-led type", document.querySelector('input[name="specialDesignType"]:checked').value],
          ...(document.querySelector('input[name="specialDesignType"]:checked').value === "Anime" ? [["Anime source", inputValue("animeSource")]] : []),
          ["Body area", inputValue("specialPlacement")], ["Nearby work or limits", inputValue("specialExistingWork")],
          ["Availability", inputValue("specialTimeline")], ["Comfort budget", inputValue("specialBudget")]];
      const answers = [...pathAnswers, ...planners.get(path).answers()];
      const list = review.querySelector("ul");
      list.replaceChildren();
      answers.forEach(([label, answer]) => {
        const item = document.createElement("li");
        const strong = document.createElement("strong");
        strong.textContent = `${label}: `;
        item.append(strong, document.createTextNode(answer));
        list.append(item);
      });
      review.hidden = false;
      review.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    const clearPreview = () => {
      document.querySelectorAll("input, select, textarea").forEach((control) => {
        if (control.matches('[type="checkbox"], [type="radio"]')) control.checked = false;
        else if (control.tagName === "SELECT") control.selectedIndex = 0;
        else control.value = "";
      });
      review.hidden = true;
      status.hidden = true;
      if (path === "special") {
        syncArtistLedType();
      }
      planners.get(path).sync();
    };
    window.addEventListener("pagehide", clearPreview);
    window.addEventListener("pageshow", (event) => { if (event.persisted) clearPreview(); });
  });

})();
