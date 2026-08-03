(function (root) {
  const TIMEZONE = "America/New_York";
  const DEFAULT_TEMPLATES = [
    { key:"opening_tattoo", label:"Tattoo opening", group:"Opening", allowedTokens:["greeting","first_name"], body:"{{greeting}} {{first_name}}, this is Sai Solehman of art.pill TATTOO HOUSE." },
    { key:"opening_sixwell", label:"Six.Well opening", group:"Opening", allowedTokens:["greeting","first_name"], body:"{{greeting}} {{first_name}}, this is the six.well construct." },
    { key:"event_confirmed", label:"Event confirmed", group:"Events", allowedTokens:["event_title"], body:"Your spot for {{event_title}} is confirmed and paid. See you there — reply here if anything changes." },
    { key:"event_received", label:"Event RSVP received", group:"Events", allowedTokens:["event_title"], body:"We saw your RSVP for {{event_title}}. Your seat is held once Square payment clears — reply here if you need a hand." },
    { key:"studio_confirmed", label:"Studio booking confirmed", group:"Studio", allowedTokens:["booking_label"], body:"Your {{booking_label}} is confirmed. Keep an eye on your email for arrival details, and reply here if anything changes." },
    { key:"studio_received", label:"Studio request received", group:"Studio", allowedTokens:["booking_label"], body:"We received your {{booking_label}} request and will follow up with next steps. Thank you." },
    { key:"tattoo_appointment_confirmed", label:"Tattoo appointment confirmed", group:"Tattoo", allowedTokens:[], body:"Your appointment is confirmed. Keep an eye on your email for studio follow-up before the session." },
    { key:"tattoo_special_approved", label:"Tattoo Special approved", group:"Tattoo", allowedTokens:["booking_url"], body:"Your Tattoo Special request has been approved. Review your approved request and pay the deposit to confirm your appointment here: {{booking_url}}" },
    { key:"tattoo_consultation_required", label:"Consultation required", group:"Tattoo", allowedTokens:["booking_url"], body:"Your project needs an in-person consultation before tattoo booking. You can choose a consultation time and place the deposit here: {{booking_url}}" },
    { key:"tattoo_booking_approved", label:"Tattoo approved for booking", group:"Tattoo", allowedTokens:["approved_budget_sentence","booking_url"], body:"Your project has been approved for booking. {{approved_budget_sentence}} Review and agree to the session estimate and budget, choose your appointment, and place the deposit here: {{booking_url}}" },
    { key:"tattoo_inquiry_received", label:"Tattoo inquiry received", group:"Tattoo", allowedTokens:[], body:"We received your inquiry and will review the project details before sending booking access. Thank you." },
  ];

  function greetingForDate(value, timezone = TIMEZONE) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 17) return "Good afternoon";
    if (hour >= 17 && hour < 22) return "Good evening";
    return "Hi";
  }

  function renderTemplate(body, values = {}) {
    return String(body || "")
      .replace(/{{\s*([a-z][a-z0-9_]*)\s*}}/g, (_match, token) => String(values[token] ?? ""))
      .replace(/\s+/g, " ")
      .trim();
  }

  function templateSelection(context = {}) {
    if (context.type === "event_rsvp") {
      return {
        openingKey: "opening_sixwell",
        bodyKey: context.status === "booked" ? "event_confirmed" : "event_received",
      };
    }
    if (context.isStudio) {
      return {
        openingKey: "opening_sixwell",
        bodyKey: context.appointmentConfirmed ? "studio_confirmed" : "studio_received",
      };
    }
    if (context.appointmentConfirmed || (context.bookingUrl && context.status === "booked")) {
      return { openingKey: "opening_tattoo", bodyKey: "tattoo_appointment_confirmed" };
    }
    if (context.specialClientUrl) {
      return { openingKey: "opening_tattoo", bodyKey: "tattoo_special_approved" };
    }
    if (context.bookingUrl && context.status === "approved" && context.requiresInPersonConsult) {
      return { openingKey: "opening_tattoo", bodyKey: "tattoo_consultation_required" };
    }
    if (context.bookingUrl && context.status === "approved") {
      return { openingKey: "opening_tattoo", bodyKey: "tattoo_booking_approved" };
    }
    return { openingKey: "opening_tattoo", bodyKey: "tattoo_inquiry_received" };
  }

  function compose(templates, openingKey, bodyKey, values = {}) {
    const opening = templates[openingKey]?.body || "";
    const body = templates[bodyKey]?.body || "";
    return renderTemplate(`${opening} ${body}`, values);
  }

  root.ManualTextAssist = { TIMEZONE, DEFAULT_TEMPLATES, greetingForDate, renderTemplate, templateSelection, compose };
})(typeof globalThis !== "undefined" ? globalThis : window);
