import { renderClientEmail } from "./_email-renderer.js";

function list(values) {
  return (Array.isArray(values) ? values : []).filter((entry) => String(entry || "").trim());
}

function tattooSignature(personal = false) {
  return personal
    ? { closing: "Thank you,", name: "Saiel Solehman", mark: "[art.pill TATTOO HOUSE]" }
    : { closing: "Thank you,", name: "", mark: "art.pill TATTOO HOUSE" };
}

function constructSignature(closing = "") {
  return { closing, name: "", mark: "the six.well construct" };
}

export function buildTattooDraftResumeEmail(data) {
  const expiration = data.expiration ? `Current expiration: ${data.expiration}.` : "";
  return renderClientEmail({
    theme: "tattoo",
    subject: data.subject,
    preheader: "Your private draft link and what to know before continuing.",
    classification: "SAVED WORKING FILE",
    headline: `Your ${data.label} is saved.`,
    intro: [
      "Use the private link below to continue editing.",
    ],
    primaryAction: { label: "Continue editing", href: data.resumeUrl },
    notice: [
      "The link remains active for 30 days after your last online save.",
      expiration,
      "Reference uploads are not stored with drafts and must be attached again before final submission.",
      "This is only a saved draft. Nothing has been submitted to the Studio for review.",
      "If you did not request this email, you can ignore it.",
    ],
    signature: tattooSignature(),
  });
}

export function buildSubmissionReceivedEmail(data) {
  const requested = list(data.requestedSheetDesigns);
  return renderClientEmail({
    theme: "tattoo",
    subject: data.subject,
    preheader: "Your submission reference, review expectations, and next steps.",
    classification: "PROJECT RECEIPT",
    headline: `Your ${data.label} has been received.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: "Submission reference", value: data.submissionId },
    ],
    sections: [
      requested.length ? {
        title: "Requested sheet designs:",
        paragraphs: requested,
      } : null,
      {
        title: "What happens next",
        paragraphs: [data.expectation, data.next],
      },
    ],
    notice: [
      data.reviewLine,
      `Questions or corrections? Email ${data.supportEmail} and include your submission reference.`,
    ],
    signature: tattooSignature(),
  });
}

export function buildBookingLinkEmail(data) {
  const consultation = Boolean(data.consultation);
  const approvedDesigns = list(data.approvedSheetDesigns);
  return renderClientEmail({
    theme: "tattoo",
    subject: data.subject,
    preheader: consultation
      ? "Review your consultation option and reserve a planning time."
      : "Review your approved session plan and choose an appointment.",
    classification: consultation ? "PLANNING CONSULTATION" : "PRIVATE BOOKING INVITATION",
    headline: consultation
      ? "Your project review is ready for consultation."
      : "Your project is ready to book.",
    greeting: `Hi ${data.clientName || "there"},`,
    intro: [
      consultation
        ? "Your project review is ready for the required in-person planning consultation. This consultation happens before tattoo scheduling."
        : "Your tattoo project and final session plan are ready for tattoo booking.",
    ],
    sections: [
      approvedDesigns.length ? {
        title: "Approved sheet designs:",
        paragraphs: approvedDesigns,
      } : null,
      {
        title: consultation ? "Available consultation option" : "Approved tattoo session options",
        paragraphs: [data.sessionOptions],
      },
    ],
    details: [
      data.approvedBudget ? { label: "Approved project budget", value: data.approvedBudget } : null,
      {
        label: consultation ? "Consultation reservation fee" : "Tattoo deposit due to book",
        value: data.depositText,
      },
      data.expiresAt ? { label: "Private link expires", value: data.expiresAt } : null,
    ],
    primaryAction: {
      label: consultation ? "Choose consultation time" : "Review session and book",
      href: data.bookingUrl,
    },
    secondaryActions: [
      { label: "Terms & Conditions", href: data.bookingTermsUrl },
      {
        label: consultation ? "Location & parking" : "Tattoo preparation & location details",
        href: consultation ? data.locationParkingUrl : data.dayOfInstructionsUrl,
      },
    ],
    notice: [
      data.approvedBudget
        ? "Review and agree to this project-total range in the private booking link before choosing an appointment. The tattoo deposit is applied to the final tattoo cost."
        : "",
      consultation
        ? "The consultation fee is non-refundable and is not a tattoo deposit. Paying schedules only the prerequisite consultation; the tattoo remains unbooked until consultation completion, a final session plan, and a separate tattoo booking link."
        : "This link is private to your project. Tattoo deposits are non-refundable and go toward the final cost of the scheduled tattoo. Personalized aftercare instructions are provided at the appointment.",
      "If the available times do not work, reply to this email and the studio can help.",
    ],
    signature: tattooSignature(),
  });
}

const APPOINTMENT_CONFIRMATION_PROFILES = Object.freeze({
  tattoo: {
    theme: "tattoo",
    classification: "APPOINTMENT FILE",
    headline: "Your art.pill TATTOO HOUSE appointment is confirmed.",
    feeLabel: "Deposit",
    resourceTitle: "Before your appointment",
    body: "Personalized aftercare instructions will be provided at your appointment.\n\nI may follow up directly with prep notes or adjustments before your appointment, if needed.",
    signature: tattooSignature(true),
  },
  consultation_in_person: {
    theme: "tattoo",
    classification: "CONSULTATION FILE",
    headline: "Your in-person consultation at art.pill TATTOO HOUSE is confirmed.",
    feeLabel: "Reservation fee",
    body: "We'll talk through your project, placement, scale, and timeline in person. No prep is required ahead of time - just bring any reference images or ideas you'd like to share.",
    signature: tattooSignature(true),
  },
  consultation_virtual: {
    theme: "tattoo",
    classification: "VIRTUAL CONSULTATION FILE",
    headline: "Your virtual consultation with art.pill TATTOO HOUSE is confirmed.",
    feeLabel: "Reservation fee",
    body: "We'll talk through your project, placement, scale, and timeline over video. No prep is required ahead of time - just bring any reference images or ideas you'd like to share, and a quiet spot with a stable connection.",
    signature: tattooSignature(true),
  },
  build_session: {
    theme: "tattoo",
    classification: "BUILD SESSION FILE",
    headline: "Your in-person build session at art.pill TATTOO HOUSE is confirmed.",
    feeLabel: "Reservation fee",
    body: "This session is dedicated to building out your design together - placement, scale, and final artwork. Bring any reference images, sizing notes, or ideas you'd like to work from.",
    signature: tattooSignature(true),
  },
  studio: {
    theme: "construct_studio",
    classification: "STUDIO RESERVATION",
    headline: "Your studio booking at the six.well construct is confirmed.",
    feeLabel: "Deposit",
    body: "We'll reach out with anything you need ahead of your time in the space. Reply to this email with questions.",
    signature: constructSignature("Thank you,"),
  },
});

export function buildAppointmentConfirmedEmail(data) {
  const profile = APPOINTMENT_CONFIRMATION_PROFILES[data.kind] || APPOINTMENT_CONFIRMATION_PROFILES.tattoo;
  const resourceActions = list(data.resources).map((resource) => ({
    label: resource.label,
    href: resource.href,
  }));
  return renderClientEmail({
    theme: profile.theme,
    subject: data.subject,
    preheader: "Date, time, payment details, and everything you need before arriving.",
    classification: profile.classification,
    headline: profile.headline,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: "When", value: data.when },
      { label: data.kind === "studio" ? "Booking" : "Session", value: data.session },
      { label: profile.feeLabel, value: data.feeText },
      data.tipText ? { label: "Optional tip", value: data.tipText } : null,
      data.totalPaidText ? { label: "Total paid today", value: data.totalPaidText } : null,
      data.zoomUrl ? { label: "Zoom link", value: data.zoomUrl } : null,
    ],
    primaryAction: { label: "View confirmation", href: data.confirmationUrl },
    secondaryActions: [
      { label: "Add to calendar", href: data.calendarUrl },
      ...resourceActions,
    ],
    outro: [profile.body],
    signature: profile.signature,
  });
}

export function buildAppointmentRescheduledEmail(data) {
  const studio = data.kind === "studio";
  const theme = studio ? "construct_studio" : "tattoo";
  return renderClientEmail({
    theme,
    subject: data.subject,
    preheader: `Your updated ${data.label} time and confirmation details.`,
    classification: studio ? "UPDATED STUDIO RESERVATION" : "UPDATED APPOINTMENT FILE",
    headline: `Your ${data.label} has been rescheduled.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      data.previousTime ? { label: "Previous time", value: data.previousTime } : null,
      { label: "New time", value: data.newTime },
      { label: "Session", value: data.session },
      { label: "Payment", value: "Your existing payment remains attached to this booking. No new payment was charged for this move." },
      data.zoomUrl ? { label: "Updated Zoom link", value: data.zoomUrl } : null,
      data.zoomStatus ? { label: "Zoom details", value: data.zoomStatus } : null,
    ],
    primaryAction: { label: "View updated confirmation", href: data.confirmationUrl },
    secondaryActions: [
      { label: "Updated calendar event", href: data.calendarUrl },
      data.locationUrl ? { label: "Location & parking", href: data.locationUrl } : null,
    ],
    notice: [
      "This booking has now used its one online reschedule. Contact the Studio if anything else changes.",
    ],
    signature: studio ? constructSignature() : tattooSignature(),
  });
}

export function buildAppointmentCancelledEmail(data) {
  const studio = data.kind === "studio";
  return renderClientEmail({
    theme: studio ? "construct_studio" : "tattoo",
    subject: data.subject,
    preheader: `Cancellation details for your ${data.occasion}.`,
    classification: studio ? "STUDIO RESERVATION CANCELLED" : "APPOINTMENT FILE CLOSED",
    headline: `Your ${studio ? "six.well construct " : "art.pill TATTOO HOUSE "}${data.occasion} has been cancelled.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: "Was scheduled", value: data.scheduled },
      { label: studio ? "Booking" : "Session", value: data.session },
    ],
    notice: [data.policyText],
    primaryAction: data.rebookUrl
      ? { label: "Start a new reservation", href: data.rebookUrl }
      : null,
    outro: [
      data.nextText,
      `Questions? Email ${data.supportEmail}.`,
    ],
    signature: studio ? constructSignature("Thank you,") : tattooSignature(),
  });
}

export function buildAppointmentReminderEmail(data) {
  const studio = data.kind === "studio";
  const virtual = data.kind === "consultation_virtual";
  return renderClientEmail({
    theme: studio ? "construct_studio" : "tattoo",
    subject: data.subject,
    preheader: `Your ${data.occasion} is tomorrow. Review the time and arrival details.`,
    classification: studio ? "STUDIO REMINDER" : "SESSION REMINDER",
    headline: `Your ${data.occasion} with ${data.brand} is tomorrow.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: "When", value: data.when },
      { label: "Session", value: data.session },
      virtual && data.zoomUrl ? { label: "Zoom link", value: data.zoomUrl } : null,
      virtual && data.zoomStatus ? { label: "Zoom details", value: data.zoomStatus } : null,
    ],
    secondaryActions: [
      { label: "Add to calendar", href: data.calendarUrl },
      ...list(data.resources),
    ],
    outro: [
      data.notice,
      "Reply to this thread if you have any questions or concerns before your session.",
    ],
    signature: studio
      ? constructSignature()
      : { closing: "", name: "-Saiel Solehman", mark: "[art.pill TATTOO HOUSE]" },
  });
}

export function buildEventTicketPaidEmail(data) {
  return renderClientEmail({
    theme: "construct_event",
    subject: data.subject,
    preheader: `Your admission details for ${data.title}.`,
    classification: "EVENT ADMISSION",
    headline: `You're booked for ${data.title}.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: "Seats reserved", value: data.seats },
      data.when ? { label: "When", value: data.when } : null,
      data.where ? { label: "Where", value: data.where } : null,
    ],
    primaryAction: { label: "View ticket", href: data.ticketUrl },
    secondaryActions: [
      data.calendarUrl ? { label: "Add to calendar", href: data.calendarUrl } : null,
    ],
    outro: [
      "Your spot is confirmed and paid. Reply to this email if anything changes or you have questions before the night.",
    ],
    signature: constructSignature("See you there,"),
  });
}

export function buildEventTicketCancelledEmail(data) {
  return renderClientEmail({
    theme: "construct_event",
    subject: data.subject,
    preheader: `Cancellation and refund details for ${data.title}.`,
    classification: "EVENT ADMISSION CANCELLED",
    headline: `Your ticket for ${data.title} has been cancelled.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      data.when ? { label: "Was scheduled", value: data.when } : null,
    ],
    notice: [data.refundText],
    outro: [
      "Sorry to miss you this time - reply to this email if you'd like help getting into a future gathering.",
    ],
    signature: constructSignature(),
  });
}

export function buildEventOpenMicSlotEmail(data) {
  return renderClientEmail({
    theme: "construct_event",
    subject: data.subject,
    preheader: `Your assigned performance time for ${data.title}.`,
    classification: "PERFORMER CALL",
    headline: `Your open-mic slot for ${data.title} is scheduled.`,
    greeting: `Hi ${data.performerName || "there"},`,
    details: [
      data.eventWhen ? { label: "Event", value: data.eventWhen } : null,
      { label: "Your slot", value: data.slot || "Assigned by the host" },
      data.duration ? { label: "Planned slot length", value: `${data.duration} minutes` } : null,
      data.where ? { label: "Where", value: data.where } : null,
    ],
    notice: [
      "Please arrive early enough to check in before your slot. Bring anything you need for your piece, and reply to this email if your setup changes.",
    ],
    primaryAction: { label: "View event", href: data.eventUrl },
    signature: constructSignature("See you there,"),
  });
}

export function buildEventReminderEmail(data) {
  return renderClientEmail({
    theme: "construct_event",
    subject: data.subject,
    preheader: `${data.title} is tomorrow. Review the time and admission details.`,
    classification: "EVENT REMINDER",
    headline: `${data.title} is tomorrow.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: "When", value: data.when },
      data.where ? { label: "Where", value: data.where } : null,
      { label: "Seats reserved", value: data.seats },
    ],
    secondaryActions: [
      { label: "Add to calendar", href: data.calendarUrl },
    ],
    outro: [
      "Looking forward to seeing you. Reply to this email if anything has changed.",
    ],
    signature: constructSignature(),
  });
}

const PREVIEW_CATALOG = Object.freeze([
  { templateKey: "tattoo_build_draft_resume", variant: "build", label: "Saved Build draft", brand: "tattoo", stage: "inquiry" },
  { templateKey: "submission_received", variant: "custom", label: "Custom project receipt", brand: "tattoo", stage: "inquiry" },
  { templateKey: "submission_received", variant: "flash", label: "Flash claim receipt", brand: "tattoo", stage: "inquiry" },
  { templateKey: "booking_link_created", variant: "tattoo", label: "Private tattoo booking link", brand: "tattoo", stage: "booking" },
  { templateKey: "booking_link_created", variant: "consultation", label: "Prerequisite consultation link", brand: "tattoo", stage: "booking" },
  { templateKey: "appointment_confirmed", variant: "tattoo", label: "Tattoo appointment confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_confirmed", variant: "tip", label: "Tattoo confirmed with tip", brand: "tattoo", stage: "appointment" },
  { templateKey: "consultation_confirmed_in_person", variant: "default", label: "In-person consultation confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "consultation_confirmed_virtual", variant: "default", label: "Virtual consultation confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "build_session_confirmed", variant: "default", label: "Build session confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_rescheduled", variant: "tattoo", label: "Tattoo appointment rescheduled", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_cancelled", variant: "tattoo", label: "Tattoo appointment cancelled", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_cancelled", variant: "consultation", label: "Consultation cancelled", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_cancelled", variant: "build", label: "Build session cancelled", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_reminder_24h", variant: "tattoo", label: "Tattoo appointment reminder", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_reminder_24h", variant: "virtual", label: "Virtual consultation reminder", brand: "tattoo", stage: "appointment" },
  { templateKey: "studio_booking_confirmed", variant: "default", label: "Studio booking confirmed", brand: "studio", stage: "studio" },
  { templateKey: "appointment_rescheduled", variant: "studio", label: "Studio booking rescheduled", brand: "studio", stage: "studio" },
  { templateKey: "appointment_cancelled", variant: "studio", label: "Studio booking cancelled", brand: "studio", stage: "studio" },
  { templateKey: "appointment_reminder_24h", variant: "studio", label: "Studio booking reminder", brand: "studio", stage: "studio" },
  { templateKey: "event_ticket_paid", variant: "default", label: "Event ticket confirmed", brand: "events", stage: "events" },
  { templateKey: "event_ticket_cancelled", variant: "refunded", label: "Event ticket cancelled and refunded", brand: "events", stage: "events" },
  { templateKey: "event_ticket_cancelled", variant: "no_refund", label: "Event ticket cancelled without refund", brand: "events", stage: "events" },
  { templateKey: "event_ticket_reminder_24h", variant: "default", label: "Event reminder", brand: "events", stage: "events" },
  { templateKey: "event_open_mic_slot", variant: "default", label: "Open-mic slot assigned", brand: "events", stage: "events" },
]);

export function clientEmailPreviewCatalog() {
  return PREVIEW_CATALOG.map((entry) => ({ ...entry }));
}

const SAMPLE = Object.freeze({
  clientName: "Jordan Rivera",
  when: "Friday, June 12, 2026 at 2:00 PM EDT - Friday, June 12, 2026 at 5:00 PM EDT",
  shortWhen: "Friday, June 12, 2026 at 2:00 PM EDT",
  session: "Half Day Session",
  confirmationUrl: "https://thesixwellconstruct.com/booking/confirmed/?appointment=demo-appointment",
  calendarUrl: "https://thesixwellconstruct.com/api/booking/calendar?appointment=demo-appointment",
  bookingUrl: "https://thesixwellconstruct.com/booking/?token=demo-private-token",
  bookingTermsUrl: "https://thesixwellconstruct.com/tattoos/policies/",
  dayOfInstructionsUrl: "https://thesixwellconstruct.com/tattoos/day-of/",
  locationParkingUrl: "https://thesixwellconstruct.com/tattoos/location-parking/",
  supportEmail: "saisolehman@artpilltattoohouse.com",
  zoomUrl: "https://zoom.us/j/00000000000",
  eventTitle: "Signal & Symbol",
  eventWhen: "Saturday, July 25, 2026 at 7:00 PM EDT",
  eventWhere: "the six.well construct - location shared after booking",
  eventUrl: "https://thesixwellconstruct.com/events/signal-symbol/",
  ticketUrl: "https://thesixwellconstruct.com/events/confirmed/?ticket=demo-ticket",
  eventCalendarUrl: "https://thesixwellconstruct.com/api/events/tickets/demo-ticket/calendar",
});

function previewConfirmation(kind, subject, overrides = {}) {
  return buildAppointmentConfirmedEmail({
    kind,
    subject,
    clientName: SAMPLE.clientName,
    when: overrides.when || SAMPLE.when,
    session: overrides.session || SAMPLE.session,
    feeText: overrides.feeText || "$100 received",
    tipText: overrides.tipText || "",
    totalPaidText: overrides.totalPaidText || "",
    zoomUrl: overrides.zoomUrl || "",
    confirmationUrl: overrides.confirmationUrl || SAMPLE.confirmationUrl,
    calendarUrl: SAMPLE.calendarUrl,
    resources: overrides.resources || [
      { label: "Day-of instructions", href: SAMPLE.dayOfInstructionsUrl },
      { label: "Location & parking", href: SAMPLE.locationParkingUrl },
    ],
  });
}

export function renderClientEmailPreview(templateKey, variant = "") {
  const key = String(templateKey || "").trim();
  const mode = String(variant || "").trim();
  let rendered = null;

  if (key === "tattoo_build_draft_resume") {
    rendered = buildTattooDraftResumeEmail({
      subject: "Continue your art.pill Build Your Own draft",
      label: "Build Your Own draft",
      resumeUrl: "https://thesixwellconstruct.com/tattoos/build/#resume=demo-private-token",
      expiration: "August 18, 2026",
    });
  } else if (key === "submission_received") {
    const flash = mode === "flash";
    rendered = buildSubmissionReceivedEmail({
      subject: flash
        ? "art.pill TATTOO HOUSE - Flash claim received"
        : "art.pill TATTOO HOUSE - Custom tattoo project received",
      clientName: SAMPLE.clientName,
      label: flash ? "flash claim" : "custom tattoo project",
      submissionId: "demo-submission-014",
      requestedSheetDesigns: flash ? ["A is Moth - placement: Forearm - scale: 4 in"] : [],
      expectation: flash
        ? "The studio will review placement, scale, budget, and the selected flash record. Multiple claims may be reviewed; the design is reserved only when the first compatible claim is approved."
        : "The studio will review the concept, placement, scale, references, budget, and timing before deciding the next step.",
      next: flash
        ? "If your claim is approved while the design is still available, you will receive a private tattoo-booking link."
        : "If the project is a fit, you will receive the appropriate next step or a private tattoo-booking link.",
      reviewLine: "Most project submissions are reviewed within 5-7 business days.",
      supportEmail: SAMPLE.supportEmail,
    });
  } else if (key === "booking_link_created") {
    const consultation = mode === "consultation";
    rendered = buildBookingLinkEmail({
      subject: consultation
        ? "Your private prerequisite consultation link"
        : "Your private art.pill TATTOO HOUSE tattoo booking link",
      consultation,
      clientName: SAMPLE.clientName,
      approvedSheetDesigns: [],
      sessionOptions: consultation
        ? "In-Person Consultation: 30 minutes. Reservation fee: $50."
        : "Half Day Session: 3 hours - Approx. 3 hours for medium approved projects or developed symbolic work. Deposit: $100.",
      approvedBudget: consultation ? "" : "$800-$1,200",
      depositText: consultation ? "$50" : "$100",
      bookingUrl: SAMPLE.bookingUrl,
      expiresAt: "Friday, July 31, 2026 at 11:59 PM EDT",
      bookingTermsUrl: SAMPLE.bookingTermsUrl,
      dayOfInstructionsUrl: SAMPLE.dayOfInstructionsUrl,
      locationParkingUrl: SAMPLE.locationParkingUrl,
    });
  } else if (key === "appointment_confirmed") {
    rendered = previewConfirmation(
      "tattoo",
      "Your tattoo appointment at art.pill TATTOO HOUSE has been confirmed",
      mode === "tip" ? { tipText: "$25", totalPaidText: "$125" } : {},
    );
  } else if (key === "consultation_confirmed_in_person") {
    rendered = previewConfirmation(
      "consultation_in_person",
      "Your consultation at art.pill TATTOO HOUSE has been confirmed",
      {
        session: "In-Person Consultation",
        feeText: "$50 received - this is the full price for your consultation, not a deposit toward future work.",
        resources: [{ label: "Location & parking", href: SAMPLE.locationParkingUrl }],
      },
    );
  } else if (key === "consultation_confirmed_virtual") {
    rendered = previewConfirmation(
      "consultation_virtual",
      "Your virtual consultation with art.pill TATTOO HOUSE has been confirmed",
      {
        session: "Virtual Consultation",
        feeText: "$50 received - this is the full price for your consultation, not a deposit toward future work.",
        zoomUrl: SAMPLE.zoomUrl,
        resources: [],
      },
    );
  } else if (key === "build_session_confirmed") {
    rendered = previewConfirmation(
      "build_session",
      "Your build session at art.pill TATTOO HOUSE has been confirmed",
      {
        session: "In-Person Build Session",
        feeText: "$75 received - this is the full price for the build session, not a deposit toward a future tattoo.",
        resources: [{ label: "Location & parking", href: SAMPLE.locationParkingUrl }],
      },
    );
  } else if (key === "studio_booking_confirmed") {
    rendered = previewConfirmation(
      "studio",
      "Your studio booking at the six.well construct is confirmed",
      {
        session: "Studio Gathering",
        feeText: "$150 received - this holds your date; any balance is settled with the studio.",
        resources: [],
      },
    );
  } else if (key === "appointment_rescheduled") {
    const studio = mode === "studio";
    rendered = buildAppointmentRescheduledEmail({
      kind: studio ? "studio" : "tattoo",
      subject: studio ? "Your studio booking has been rescheduled" : "Your tattoo appointment has been rescheduled",
      label: studio ? "studio booking" : "tattoo appointment",
      clientName: SAMPLE.clientName,
      previousTime: "Thursday, June 11, 2026 at 2:00 PM EDT - Thursday, June 11, 2026 at 5:00 PM EDT",
      newTime: SAMPLE.when,
      session: studio ? "Studio Gathering" : SAMPLE.session,
      confirmationUrl: SAMPLE.confirmationUrl,
      calendarUrl: SAMPLE.calendarUrl,
      locationUrl: studio ? "" : SAMPLE.locationParkingUrl,
    });
  } else if (key === "appointment_cancelled") {
    const studio = mode === "studio";
    const consultation = mode === "consultation";
    const build = mode === "build";
    const occasion = studio ? "studio booking" : build ? "Build session" : consultation ? "consultation" : "appointment";
    rendered = buildAppointmentCancelledEmail({
      kind: studio ? "studio" : "tattoo",
      subject: `Your ${occasion.toLowerCase()} has been cancelled`,
      clientName: SAMPLE.clientName,
      occasion,
      scheduled: SAMPLE.when,
      session: studio ? "Studio Gathering" : build ? "In-Person Build Session" : consultation ? "In-Person Consultation" : SAMPLE.session,
      policyText: studio
        ? "Per studio policy, deposits and payments are non-refundable. Cancellation is separate from the one-time reschedule option."
        : consultation || build
          ? "Per studio policy, reservation fees are non-refundable. One reschedule is allowed with at least 48 hours notice; a new reservation fee is required for reschedules made within 48 hours."
          : "Per studio policy, deposits and payments are non-refundable. Cancellation is separate from the one-time reschedule option.",
      rebookUrl: build
        ? "https://thesixwellconstruct.com/tattoos/build/in-person/?rebook=1"
        : consultation
          ? "https://thesixwellconstruct.com/tattoos/inquire/consultation/?rebook=1"
          : "",
      nextText: studio
        ? "Reply to this email if you would like help planning another date."
        : "Contact the studio if you want to discuss a future project or appointment.",
      supportEmail: SAMPLE.supportEmail,
    });
  } else if (key === "appointment_reminder_24h") {
    const studio = mode === "studio";
    const virtual = mode === "virtual";
    rendered = buildAppointmentReminderEmail({
      kind: studio ? "studio" : virtual ? "consultation_virtual" : "tattoo",
      subject: studio
        ? "Reminder: Your studio booking with the six.well construct is tomorrow"
        : virtual
          ? "Reminder: Your consultation with art.pill TATTOO HOUSE is tomorrow"
          : "Reminder: Your tattoo appointment with art.pill TATTOO HOUSE is tomorrow",
      occasion: studio ? "studio booking" : virtual ? "consultation" : "tattoo appointment",
      brand: studio ? "the six.well construct" : "art.pill TATTOO HOUSE",
      clientName: SAMPLE.clientName,
      when: SAMPLE.when,
      session: studio ? "Studio Gathering" : virtual ? "Virtual Consultation" : SAMPLE.session,
      zoomUrl: virtual ? SAMPLE.zoomUrl : "",
      calendarUrl: SAMPLE.calendarUrl,
      resources: studio || virtual ? [] : [
        { label: "Day-of instructions", href: SAMPLE.dayOfInstructionsUrl },
        { label: "Location & parking", href: SAMPLE.locationParkingUrl },
      ],
    });
  } else if (key === "event_ticket_paid") {
    rendered = buildEventTicketPaidEmail({
      subject: `You're booked - ${SAMPLE.eventTitle}`,
      title: SAMPLE.eventTitle,
      clientName: SAMPLE.clientName,
      seats: "2",
      when: SAMPLE.eventWhen,
      where: SAMPLE.eventWhere,
      ticketUrl: SAMPLE.ticketUrl,
      calendarUrl: SAMPLE.eventCalendarUrl,
    });
  } else if (key === "event_ticket_cancelled") {
    rendered = buildEventTicketCancelledEmail({
      subject: `Your ticket for ${SAMPLE.eventTitle} was cancelled`,
      title: SAMPLE.eventTitle,
      clientName: SAMPLE.clientName,
      when: SAMPLE.eventWhen,
      refundText: mode === "no_refund"
        ? "If you were charged, a refund will be handled separately - reply to this email if you have any questions."
        : "A full refund has been issued to your original payment method. It may take a few business days to appear.",
    });
  } else if (key === "event_ticket_reminder_24h") {
    rendered = buildEventReminderEmail({
      subject: `Reminder: ${SAMPLE.eventTitle} is tomorrow`,
      title: SAMPLE.eventTitle,
      clientName: SAMPLE.clientName,
      when: SAMPLE.eventWhen,
      where: SAMPLE.eventWhere,
      seats: "2",
      calendarUrl: SAMPLE.eventCalendarUrl,
    });
  } else if (key === "event_open_mic_slot") {
    rendered = buildEventOpenMicSlotEmail({
      subject: "Cult & Shift open mic slot",
      title: "Cult & Shift",
      performerName: SAMPLE.clientName,
      eventWhen: "Saturday, August 8, 2026 at 8:00 PM EDT",
      slot: "Saturday, August 8, 2026 at 8:45 PM EDT",
      duration: 5,
      where: SAMPLE.eventWhere,
      eventUrl: "https://thesixwellconstruct.com/events/cultandshift/",
    });
  }

  if (!rendered) return null;
  return {
    templateKey: key,
    variant: mode,
    ...rendered,
  };
}
