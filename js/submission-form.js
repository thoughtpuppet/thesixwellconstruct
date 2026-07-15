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
    var idempotencyStorageKey = "sixwell:submission-idempotency:" + window.location.pathname + ":" + (form.id || options.form || "form");
    var idempotencyKey = "";
    try {
      idempotencyKey = window.sessionStorage.getItem(idempotencyStorageKey) || "";
      if (!idempotencyKey) {
        idempotencyKey = window.crypto && typeof window.crypto.randomUUID === "function"
          ? window.crypto.randomUUID()
          : "submission-" + Date.now() + "-" + Math.random().toString(16).slice(2);
        window.sessionStorage.setItem(idempotencyStorageKey, idempotencyKey);
      }
    } catch (_error) {
      idempotencyKey = window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : "submission-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }

    function clearIdempotencyKey() {
      try { window.sessionStorage.removeItem(idempotencyStorageKey); } catch (_error) {}
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (submitting) return;
      if (!form.reportValidity()) return;

      if (new URLSearchParams(window.location.search).get("preview") === "1") {
        setStatus(status, "Preview is read-only. Nothing was submitted.", "");
        return;
      }

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
          headers: { "idempotency-key": idempotencyKey },
          body: new FormData(form),
        });
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(payload.error || options.errorText || "Submission failed.");

        if (typeof options.onSuccess === "function") {
          clearIdempotencyKey();
          options.onSuccess(payload);
          return;
        }
        var redirectTarget = options.redirectTo || "/tattoos/submission-received/";
        if (payload.submissionId) {
          var receiptUrl = new URL(redirectTarget, window.location.origin);
          if (!receiptUrl.searchParams.has("ref")) receiptUrl.searchParams.set("ref", payload.submissionId);
          redirectTarget = receiptUrl.pathname + receiptUrl.search + receiptUrl.hash;
        }
        clearIdempotencyKey();
        window.location.href = redirectTarget;
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
