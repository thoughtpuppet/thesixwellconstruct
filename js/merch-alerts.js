export const MERCH_ALERT_DISCLOSURE_VERSION = "merch-alert-v1-2026-08-05";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character]));
}

export function launchAlertMarkup(product, compact = false) {
  const slug = escapeHtml(product.slug);
  const panelId = `launch-alert-${compact ? "card" : "detail"}-${slug}`;
  return `<div class="launch-alert${compact ? " launch-alert--compact" : ""}" data-launch-alert data-product-slug="${slug}">
    <button class="launch-alert-toggle" type="button" aria-expanded="false" aria-controls="${panelId}" data-launch-alert-toggle>
      <span class="launch-alert-toggle-label">Notify me when this launches.</span><span class="launch-alert-toggle-mark" aria-hidden="true">+</span>
    </button>
    <form class="launch-alert-form" id="${panelId}" data-launch-alert-form hidden>
      <label>Email address<input name="email" type="email" autocomplete="email" required></label>
      <label class="launch-alert-check"><input name="newsletter" type="checkbox"> <span>Also sign me up for The Solehman Letters, the newsletter of the creative ecosystem. This is optional and requires its own email confirmation.</span></label>
      <input name="company" tabindex="-1" autocomplete="off" aria-hidden="true" class="form-honeypot">
      <button class="launch-alert-submit" type="submit"><span>Request launch alert</span><span aria-hidden="true">→</span></button>
      <p class="launch-alert-disclosure">One email when this product launches. Confirm through the email sent after signup. The newsletter choice is separate.</p>
      <p class="launch-alert-status" aria-live="polite"></p>
    </form>
  </div>`;
}

export function setupLaunchAlertForms(scope = document) {
  scope.querySelectorAll("[data-launch-alert]").forEach((alert) => {
    if (alert.dataset.ready === "true") return;
    alert.dataset.ready = "true";
    const toggle = alert.querySelector("[data-launch-alert-toggle]");
    const form = alert.querySelector("[data-launch-alert-form]");
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      form.hidden = expanded;
      if (!expanded) form.querySelector('input[name="email"]')?.focus();
    });
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
            slug: alert.dataset.productSlug,
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
