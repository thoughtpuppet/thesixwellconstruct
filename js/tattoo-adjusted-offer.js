(() => {
  const token = location.pathname.match(/^\/o\/([A-Za-z0-9_-]{12})\/?$/)?.[1] || "";
  const title = document.getElementById("offerTitle");
  const copy = document.getElementById("offerCopy");
  const details = document.getElementById("offerDetails");
  const price = document.getElementById("offerPrice");
  const note = document.getElementById("offerNote");
  const deadline = document.getElementById("offerDeadline");
  const status = document.getElementById("offerStatus");
  const accept = document.getElementById("acceptOffer");
  const decline = document.getElementById("declineOffer");

  function closedState(state) {
    details.hidden = true;
    if (state === "accepted") {
      title.textContent = "This adjusted offer was accepted.";
      copy.textContent = "Use the private booking link sent to your email to choose your appointment.";
    } else if (state === "declined") {
      title.textContent = "This adjusted offer was declined.";
      copy.textContent = "Thank you for your time. I wish you luck getting your project completed elsewhere.";
    } else {
      title.textContent = "This adjusted offer is no longer active.";
      copy.textContent = "Contact the Studio directly if you need help.";
    }
  }

  async function load() {
    const localPreview = ["localhost", "127.0.0.1"].includes(location.hostname)
      && new URLSearchParams(location.search).get("preview") === "1";
    if (localPreview) {
      title.textContent = "Review your adjusted rate.";
      copy.textContent = "Your tattoo request has been approved, but this project does not qualify for the current special because it is a cover-up.";
      price.textContent = "Adjusted flat rate: $450.00";
      note.textContent = "The new rate accounts for the existing tattoo while keeping the project discounted.";
      note.hidden = false;
      deadline.textContent = "Respond by August 23, 2026 at 5:00 PM";
      details.hidden = false;
      return;
    }
    if (!token) return closedState("invalid");
    try {
      const response = await fetch(`/api/tattoo/adjusted-offers/context?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "This adjusted offer is unavailable.");
      if (!data.offer) return closedState(data.status);
      title.textContent = "Review your adjusted rate.";
      copy.textContent = data.offer.copy;
      price.textContent = data.offer.priceLabel;
      note.textContent = data.offer.clientNote || "";
      note.hidden = !data.offer.clientNote;
      deadline.textContent = `Respond by ${new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(new Date(data.offer.expiresAt))}`;
      details.hidden = false;
    } catch (error) {
      title.textContent = "This adjusted offer is unavailable.";
      copy.textContent = error.message;
      details.hidden = true;
    }
  }

  async function respond(action) {
    accept.disabled = true;
    decline.disabled = true;
    status.textContent = action === "accept" ? "Accepting your adjusted rate…" : "Closing your adjusted offer…";
    try {
      const response = await fetch("/api/tattoo/adjusted-offers/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        referrerPolicy: "no-referrer",
        body: JSON.stringify({ token, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your response could not be saved.");
      if (data.status === "accepted" && data.bookingUrl) {
        location.assign(data.bookingUrl);
        return;
      }
      closedState(data.status);
      status.textContent = data.message || "Your response has been saved.";
    } catch (error) {
      status.textContent = error.message;
      accept.disabled = false;
      decline.disabled = false;
    }
  }

  accept.addEventListener("click", () => respond("accept"));
  decline.addEventListener("click", () => respond("decline"));
  load();
})();
