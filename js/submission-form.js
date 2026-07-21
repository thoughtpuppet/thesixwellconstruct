(function () {
  function ensureConsentStyles() {
    if (document.getElementById("sixwellMarketingConsentStyles")) return;
    var styles = document.createElement("style");
    styles.id = "sixwellMarketingConsentStyles";
    styles.textContent = ".marketing-consent-options{display:grid;gap:12px;padding:20px 0}.marketing-consent-heading{margin:0;font:900 10px/1.4 var(--sans,sans-serif);letter-spacing:.16em;text-transform:uppercase;color:var(--text-dim,currentColor)}.marketing-consent-choice{display:grid;grid-template-columns:22px minmax(0,1fr);gap:12px;align-items:start;margin:0;font:400 13px/1.65 var(--serif,serif);letter-spacing:normal;text-transform:none;color:var(--text-mute,currentColor);cursor:pointer}.marketing-consent-choice input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--accent,currentColor)}.marketing-consent-manage{font:700 10px/1.5 var(--sans,sans-serif);letter-spacing:.1em;text-transform:uppercase;color:var(--accent,currentColor)}";
    document.head.appendChild(styles);
  }

  function ensureMarketingConsent(form) {
    if (!form || form.querySelector("[data-marketing-consent]")) return;
    if (!form.querySelector('[name="email"],[name="from_email"]')) return;
    ensureConsentStyles();
    var wrap = document.createElement("div");
    wrap.className = "marketing-consent-options";
    wrap.dataset.marketingConsent = "1";
    wrap.innerHTML = [
      '<p class="marketing-consent-heading">Optional updates</p>',
      '<label class="marketing-consent-choice"><input type="checkbox" name="newsletter_consent" value="yes"><span>Yes, send me The Six.Well newsletter by email. This is optional and I can unsubscribe at any time.</span></label>',
      form.querySelector('[name="phone"]')
        ? '<label class="marketing-consent-choice"><input type="checkbox" name="sms_marketing_consent" value="yes"><span>Yes, send me occasional Six.Well marketing texts. Message frequency varies; message and data rates may apply. Reply STOP to opt out or HELP for help.</span></label>'
        : "",
      '<a class="marketing-consent-manage" href="/preferences/">Manage communication preferences</a>',
    ].join("");
    var submit = form.querySelector('[type="submit"]');
    var anchor = submit && submit.closest(".form-actions,.submit-row,.actions");
    form.insertBefore(wrap, anchor || submit || null);
  }

  function setStatus(statusEl, message, state) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.remove("error", "success");
    if (state) statusEl.classList.add(state);
  }

  function initSubmissionForm(options) {
    var form = document.querySelector(options.form);
    if (!form) return;
    ensureMarketingConsent(form);

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
        var additionalHeaders = typeof options.headers === "function"
          ? options.headers({ form: form }) || {}
          : options.headers || {};
        var response = await fetch(form.action, {
          method: form.method || "POST",
          headers: { "idempotency-key": idempotencyKey, ...additionalHeaders },
          body: new FormData(form),
        });
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(payload.error || options.errorText || "Submission failed.");

        if (typeof options.onSuccess === "function") {
          clearIdempotencyKey();
          window.dispatchEvent(new CustomEvent("sixwell:form-complete", { detail: { formId: form.id || form.getAttribute("name") || "submission-form" } }));
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
        window.dispatchEvent(new CustomEvent("sixwell:form-complete", { detail: { formId: form.id || form.getAttribute("name") || "submission-form" } }));
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
