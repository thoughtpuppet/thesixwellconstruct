(function () {
  function setStatus(statusEl, message, state) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.remove("error", "success");
    if (state) statusEl.classList.add(state);
  }

  function initSubmissionForm(options) {
    var form = document.querySelector(options.form);
    if (!form) return;

    var submitBtn = options.submitButton
      ? document.querySelector(options.submitButton)
      : form.querySelector('[type="submit"]');
    var status = options.status ? document.querySelector(options.status) : null;
    if (!submitBtn || submitBtn.dataset.submissionBound === "1") return;
    submitBtn.dataset.submissionBound = "1";
    var idleHtml = submitBtn.innerHTML;
    var idleOpacity = submitBtn.style.opacity || "";
    var submitting = false;

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (submitting) return;
      if (!form.reportValidity()) return;

      if (typeof options.beforeSubmit === "function") {
        var result = options.beforeSubmit({
          form: form,
          submitButton: submitBtn,
          status: status,
          setStatus: setStatus,
        });
        if (result === false) return;
      }

      submitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = options.submittingText || "Submitting...";
      if (options.disabledOpacity) submitBtn.style.opacity = options.disabledOpacity;
      setStatus(status, options.pendingText || "Submitting.", "");

      try {
        var response = await fetch(form.action, {
          method: form.method || "POST",
          body: new FormData(form),
        });
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(payload.error || options.errorText || "Submission failed.");

        if (typeof options.onSuccess === "function") {
          options.onSuccess(payload);
          return;
        }
        window.location.href = options.redirectTo || "/tattoos/submission-received/";
      } catch (error) {
        submitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = idleHtml;
        submitBtn.style.opacity = idleOpacity;
        setStatus(status, error.message || options.errorText || "Submission failed. Please try again.", "error");
      }
    });
  }

  window.SixWellSubmissionForms = {
    init: initSubmissionForm,
    setStatus: setStatus,
  };
})();
