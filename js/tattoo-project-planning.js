(function () {
  function setGroup(group, visible) {
    if (!group) return;
    group.hidden = !visible;
    group.querySelectorAll("input, select, textarea").forEach(function (control) {
      control.disabled = !visible;
      if (control.dataset.requiredWhenVisible === "true") control.required = visible;
    });
  }

  function init(form) {
    var size = form.querySelector("[data-planning-size]");
    var coverage = form.querySelector("[data-planning-coverage]");
    var travelChoices = form.querySelectorAll('[name="traveling_to_atlanta"]');
    if (!size || !coverage || !travelChoices.length) return;
    var coverageGroup = form.querySelector("[data-planning-coverage-group]");
    var otherCoverageGroup = form.querySelector("[data-planning-other-coverage-group]");
    var preferenceGroup = form.querySelector("[data-planning-preference-group]");
    var firstPreference = form.querySelector('[name="multi_session_preference"]');
    var backToBackLabel = form.querySelector('[name="multi_session_preference"][value="back_to_back"]')?.closest("label")?.querySelector("span");
    var travelDetailGroups = form.querySelectorAll("[data-planning-travel-detail]");
    var feedback = form.querySelector("[data-planning-feedback]");

    function sync() {
      var largeScale = size.value === "large_scale";
      var largeCoverUp = form.querySelector('[name="project_type"]')?.value === "large_cover_up";
      var traveling = form.querySelector('[name="traveling_to_atlanta"]:checked')?.value === "yes";
      if (backToBackLabel) backToBackLabel.textContent = traveling ? "Back-to-back days in one trip" : "Back-to-back days";
      setGroup(coverageGroup, largeScale);
      setGroup(otherCoverageGroup, largeScale && coverage.value === "other");
      setGroup(preferenceGroup, largeScale || size.value === "xl" || largeCoverUp);
      if (firstPreference) firstPreference.required = largeCoverUp;
      travelDetailGroups.forEach(function (group) { setGroup(group, traveling); });

      if (!feedback) return;
      var canReturn = form.querySelector('[name="can_return_for_healed_visit"]')?.value || "";
      var preference = form.querySelector('[name="multi_session_preference"]:checked')?.value || "";
      if (traveling && canReturn === "no" && preference === "separate_healed_visits") {
        feedback.textContent = "You said you cannot return. I would review a one-trip plan or a different scope with you before booking.";
      } else if (traveling && canReturn === "no" && (largeScale || size.value === "xl" || largeCoverUp)) {
        feedback.textContent = "A return trip may not be possible for you. I will review whether the work can be planned for one visit; that is not guaranteed.";
      } else {
        feedback.textContent = "";
      }
      feedback.hidden = !feedback.textContent;
    }

    form.addEventListener("change", sync);
    sync();
  }

  document.querySelectorAll("form[data-tattoo-project-planning]").forEach(init);
})();
