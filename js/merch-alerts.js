export const MERCH_ALERT_DISCLOSURE_VERSION = "merch-alert-v1-2026-08-05";

export function launchAlertMarkup(product, compact = false) {
  return `<form class="launch-alert${compact ? " launch-alert--compact" : ""}" data-launch-alert data-product-slug="${product.slug}">
    <h2>Notify me when this launches.</h2>
    <label>Email address<input name="email" type="email" autocomplete="email" required></label>
    <label class="launch-alert-check"><input name="newsletter" type="checkbox"> <span>Also send me the Six.Well newsletter. This is optional and requires its own email confirmation.</span></label>
    <input name="company" tabindex="-1" autocomplete="off" aria-hidden="true" class="form-honeypot">
    <button class="launch-alert-submit" type="submit"><span>Request launch alert</span><span aria-hidden="true">→</span></button>
    <p class="launch-alert-disclosure">One email when this product launches. Confirm through the email sent after signup. The newsletter choice is separate.</p>
    <p class="launch-alert-status" aria-live="polite"></p>
  </form>`;
}

export function setupLaunchAlertForms(scope = document) {
  scope.querySelectorAll("[data-launch-alert]").forEach((form) => {
    if (form.dataset.ready === "true") return;
    form.dataset.ready = "true";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".launch-alert-status");
      const button = form.querySelector("button[type='submit']");
      const data = new FormData(form);
      if (String(data.get("company") || "").trim()) return;
      button.disabled = true;
      status.textContent = "Submitting…";
      try {
        const response = await fetch("/api/shop/launch-alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slug: form.dataset.productSlug,
            email: data.get("email"),
            newsletterOptIn: data.get("newsletter") === "on",
            disclosureVersion: MERCH_ALERT_DISCLOSURE_VERSION,
            formPath: window.location.pathname,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Unable to request this alert.");
        status.textContent = payload.message || "Check your email to confirm this alert.";
        form.reset();
      } catch (error) {
        status.textContent = error.message || "Unable to request this alert.";
      } finally { button.disabled = false; }
    });
  });
}
