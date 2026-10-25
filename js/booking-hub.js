import { ENGAGEMENT_CATEGORIES } from "/shared/engagement-requests.js";

if (document.documentElement.dataset.bookingView === "public") {
  const form = document.getElementById("engagementForm");
  const category = form.elements.category;
  const feedback = document.getElementById("engagementFeedback");
  const submit = form.querySelector('[type="submit"]');
  const preview = new URLSearchParams(location.search).get("preview") === "1";
  let idempotencyKey = "";
  let requestSnapshot = "";
  let sending = false;

  document.querySelectorAll("[data-engagement-category]").forEach((link) => {
    link.addEventListener("click", () => {
      category.value = link.dataset.engagementCategory;
      category.dispatchEvent(new Event("change", { bubbles:true }));
      requestAnimationFrame(() => (category.parentElement.querySelector('[role="combobox"]') || category).focus({ preventScroll:true }));
    });
  });
  const preset = new URLSearchParams(location.search).get("category");
  if (Object.hasOwn(ENGAGEMENT_CATEGORIES, preset || "")) {
    category.value = preset;
    category.dispatchEvent(new Event("change", { bubbles:true }));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    feedback.hidden = false;
    if (preview) {
      feedback.textContent = "Preview only. This inquiry has not been sent and no time has been reserved.";
      return;
    }
    const payload = Object.fromEntries(new FormData(form));
    payload.type = "engagement_request";
    const snapshot = JSON.stringify(payload);
    // Retry an uncertain response with the same key; changed details start a new request.
    if (snapshot !== requestSnapshot) {
      idempotencyKey = crypto.randomUUID();
      requestSnapshot = snapshot;
    }
    sending = true;
    submit.disabled = true;
    feedback.textContent = "Sending your inquiry…";
    try {
      const response = await fetch("/api/submissions", {
        method:"POST", headers:{ "content-type":"application/json", "idempotency-key":idempotencyKey },
        body:JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.submissionId) throw new Error(result.error || "Your inquiry could not be sent. Please try again.");
      form.querySelector(".hub-form-fields").hidden = true;
      submit.hidden = true;
      feedback.textContent = `Inquiry received. Reference: ${result.submissionId}. No appointment or studio time has been reserved.`;
    } catch (error) {
      feedback.textContent = error.message || "Unable to confirm receipt. Please retry with the same details.";
    } finally {
      sending = false;
      submit.disabled = false;
    }
  });
}
