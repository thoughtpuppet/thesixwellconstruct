import { renderClientEmail } from "./_email-renderer.js";
import {
  editableEmailContent,
  emailContentSchema,
  renderEmailContent,
  validateEmailContent,
} from "./_email-content.js";

const CLIENT_PAYMENT_DEADLINE_PATTERNS = Object.freeze([
  /\bpay by\b/i,
  /\blink expires\b/i,
  /available until the date shown above/i,
]);

const DEADLINE_FREE_TATTOO_EMAILS = new Set([
  "booking_link_created",
  "tattoo_rendering_payment_requested",
  "tattoo_special_deposit_requested",
]);

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
    templateKey: "tattoo_build_draft_resume",
    templateVariant: data.variant || "build",
    variables: { draft_label: data.label, expiration_line: expiration },
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
  const construct = ["construct_art", "construct_event", "construct_studio"].includes(data.theme);
  const supportPhone = "(770) 820-5800";
  return renderClientEmail({
    templateKey: "submission_received",
    templateVariant: data.variant || "custom",
    variables: { client_name: data.clientName || "there", submission_label: data.label, support_email: data.supportEmail },
    theme: construct ? data.theme : "tattoo",
    subject: data.subject,
    preheader: "Your submission reference, review expectations, and next steps.",
    classification: "PROJECT RECEIPT",
    headline: `Your ${data.label} has been received.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: "Submission reference", value: data.submissionId },
      data.requestedWhen ? { label: "Requested time (not reserved)", value: data.requestedWhen } : null,
    ],
    primaryAction: data.briefUrl ? {
      label: data.briefLabel || "Download submitted brief",
      href: data.briefUrl,
    } : null,
    secondaryActions: data.editUrl ? [
      { label: "Edit submitted maze", href: data.editUrl },
    ] : [],
    sections: [
      requested.length ? {
        title: "Requested sheet designs:",
        paragraphs: requested,
        editableParagraphs: false,
      } : null,
      {
        title: "What happens next",
        paragraphs: [data.expectation, data.next],
      },
    ],
    notice: [
      data.editUrl ? "Maze changes remain private until you explicitly submit an updated revision. Editing locks when Studio review ends." : "",
      `Questions or corrections? Email ${data.supportEmail}, call or text ${supportPhone}.`,
    ],
    signature: construct ? constructSignature() : tattooSignature(),
  });
}

export function buildTattooBriefReadyEmail(data) {
  const label = data.variant === "maze" ? "Maze brief" : "Build Your Own brief";
  return renderClientEmail({
    templateKey: "tattoo_brief_ready",
    templateVariant: data.variant === "maze" ? "maze" : "build",
    variables: { client_name: data.clientName || "there", brief_label: label },
    theme: "tattoo",
    subject: data.subject || `Your art.pill ${label} PDF is ready`,
    preheader: "Your submitted project brief is ready to download.",
    classification: "SUBMITTED PROJECT BRIEF",
    headline: `Your ${label} PDF is ready.`,
    greeting: `Hi ${data.clientName || "there"},`,
    intro: [
      "Your final submitted project brief has been preserved as a PDF for your records.",
    ],
    primaryAction: { label: "Download submitted brief", href: data.briefUrl },
    notice: [
      "This private link remains available unless the Studio replaces or revokes it.",
      "The PDF records the brief you submitted. It is not final tattoo artwork, a quote, or booking approval.",
    ],
    signature: tattooSignature(),
  });
}

export function buildBookingLinkEmail(data) {
  const consultation = Boolean(data.consultation);
  const tattooSpecial = data.variant === "tattoo_special";
  const approvedDesigns = list(data.approvedSheetDesigns);
  const budgetNotice = data.approvedBudget
    ? tattooSpecial
      ? "Review the fixed Tattoo Special total, deposit credit, duration, and selection in the private booking link before choosing an appointment."
      : "Review and agree to the approved tattoo-work range in the private booking link before choosing an appointment. Extended Day adds its clearly itemized $200 fee; every tattoo deposit is credited toward the final total."
    : "";
  return renderClientEmail({
    templateKey: "booking_link_created",
    templateVariant: data.variant || (consultation ? "consultation" : "tattoo"),
    variables: { client_name: data.clientName || "there", budget_notice: budgetNotice },
    theme: "tattoo",
    subject: data.subject,
    preheader: consultation
      ? "Review your consultation option and reserve a planning time."
      : tattooSpecial
        ? "Choose a time and pay the deposit to confirm your Tattoo Special appointment."
        : "Review your approved session plan and choose an appointment.",
    classification: consultation ? "PLANNING CONSULTATION" : tattooSpecial ? "TATTOO SPECIAL - DEPOSIT REQUIRED" : "PRIVATE BOOKING INVITATION",
    headline: consultation
      ? "Your project review is ready for consultation."
      : tattooSpecial
        ? "Finish booking your Tattoo Special."
        : "Your project is ready to book.",
    greeting: `Hi ${data.clientName || "there"},`,
    intro: [
      consultation
        ? "Your project review is ready for the required in-person planning consultation. This consultation happens before tattoo scheduling."
        : tattooSpecial
          ? "Your Tattoo Special was approved, but no appointment is booked yet. Choose an available time and complete the Square deposit to confirm the appointment."
          : "Your tattoo project and final session plan are ready for tattoo booking. Choose Quarter Day, Half Day, 3/4 Day, Full Day, or the optional Extended Day. You may use one longer appointment or split the project across shorter appointments.",
    ],
    sections: [
      approvedDesigns.length ? {
        title: "Approved sheet designs:",
        paragraphs: approvedDesigns,
        editableParagraphs: false,
      } : null,
      {
        title: consultation ? "Available consultation option" : tattooSpecial ? "Tattoo Special session" : "Approved tattoo session options",
        paragraphs: [data.sessionOptions],
        editableParagraphs: false,
      },
    ],
    details: [
      data.approvedBudget ? { label: tattooSpecial ? "Tattoo Special total" : "Approved tattoo-work budget", value: data.approvedBudget } : null,
      {
        label: consultation ? "Consultation reservation fee" : tattooSpecial ? "Deposit required to confirm" : "Tattoo deposit due to book",
        value: data.depositText,
      },
    ],
    primaryAction: {
      label: consultation ? "Choose consultation time" : tattooSpecial ? "Choose time and pay deposit" : "Review session and book",
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
      budgetNotice,
      consultation
        ? "The consultation fee is non-refundable and is not a tattoo deposit. Paying schedules only the prerequisite consultation; the tattoo remains unbooked until consultation completion, a final session plan, and a separate tattoo booking link."
        : tattooSpecial
          ? "This link is private to your approved Tattoo Special. Choose an available time and complete the deposit to set the appointment. The deposit is non-refundable and is credited toward the fixed approved total."
          : "This link is private to your project. Tattoo deposits are non-refundable and go toward the final cost of the scheduled tattoo. Personalized aftercare instructions are provided at the appointment.",
      "If the available times do not work, reply to this email and the studio can help.",
    ],
    signature: tattooSignature(),
  });
}

export function buildTattooRenderingPaymentRequestEmail(data) {
  return renderClientEmail({
    templateKey: "tattoo_rendering_payment_requested",
    templateVariant: "default",
    variables: {
      client_name: data.clientName || "there",
      request_number: String(data.requestNumber || ""),
    },
    theme: "tattoo",
    subject: data.subject || "Payment link for an additional tattoo concept sketch",
    preheader: "Pay the separate drawing fee before work begins on the approved alternate concept.",
    classification: "ADDITIONAL CONCEPT REQUEST",
    headline: "Your additional concept sketch is approved for payment.",
    greeting: `Hi ${data.clientName || "there"},`,
    intro: [
      "The artist approved your request for one substantially different alternate concept sketch. Drawing begins after the separate fee is paid.",
    ],
    details: [
      { label: "Drawing fee", value: data.amountText || "$50" },
      data.appointmentWhen ? { label: "Current appointment", value: data.appointmentWhen } : null,
    ],
    primaryAction: { label: "Pay drawing fee", href: data.checkoutUrl },
    notice: [
      "This $50 fee is non-refundable and is not credited toward the tattoo total.",
      "If the fee is not paid, your existing appointment and included design direction remain unchanged.",
    ],
    signature: tattooSignature(true),
  });
}

export function buildTattooRenderingPaymentConfirmedEmail(data) {
  return renderClientEmail({
    templateKey: "tattoo_rendering_payment_confirmed",
    templateVariant: "default",
    variables: {
      client_name: data.clientName || "there",
      request_number: String(data.requestNumber || ""),
    },
    theme: "tattoo",
    subject: data.subject || "Additional tattoo concept sketch payment received",
    preheader: "Your drawing fee is paid and the approved alternate concept is ready for the artist.",
    classification: "ADDITIONAL CONCEPT PAID",
    headline: "Your additional concept sketch is ready to draw.",
    greeting: `Hi ${data.clientName || "there"},`,
    intro: [
      "Your separate drawing fee has been received. The artist can now begin the approved alternate concept sketch.",
    ],
    details: [
      { label: "Drawing fee received", value: data.amountText || "$50" },
      data.appointmentWhen ? { label: "Current appointment", value: data.appointmentWhen } : null,
    ],
    notice: [
      "This fee is non-refundable and is not credited toward the tattoo total.",
      "Minor refinements to the selected direction and artist-initiated redraws remain included in the original project process.",
    ],
    signature: tattooSignature(true),
  });
}

export function buildTattooSpecialDepositRequestEmail(data) {
  return renderClientEmail({
    templateKey: "tattoo_special_deposit_requested",
    templateVariant: "default",
    variables: { client_name: data.clientName || "there" },
    theme: "tattoo",
    subject: data.subject || "Your Tattoo Special was approved — deposit required",
    preheader: "Choose an available time and complete the deposit to confirm the appointment.",
    classification: "TATTOO SPECIAL APPROVED",
    headline: "Your request is approved.",
    greeting: `Hi ${data.clientName || "there"},`,
    intro: [
      "Use the private link below to choose an available time and complete the deposit. The appointment will be set once the deposit is complete.",
    ],
    details: [
      ...(data.when ? [{ label: "Appointment", value: data.when }] : []),
      { label: "Tattoo Special", value: data.selection },
      { label: "Approved total", value: data.approvedTotal },
      { label: "Deposit due", value: data.depositText },
    ],
    primaryAction: { label: "Choose a Time", href: data.checkoutUrl },
    secondaryActions: [],
    notice: [
      "Choose a time that works for you. Availability is checked again before Square opens.",
      "The deposit is non-refundable and is credited toward the approved Tattoo Special total.",
    ],
    signature: tattooSignature(true),
  });
}

export function buildManualAppointmentDepositRequestEmail(data) {
  const studio = data.kind === "studio_visit" || data.kind === "studio_space";
  return renderClientEmail({
    templateKey: "manual_appointment_deposit_requested",
    templateVariant: data.kind || "tattoo",
    variables: { client_name: data.clientName || "there" },
    theme: data.kind === "studio_visit" ? "art" : data.kind === "studio_space" ? "events" : "tattoo",
    subject: data.subject || `Deposit requested for your ${data.label || "appointment"}`,
    preheader: `Complete the ${data.depositLabel || "deposit"} by the deadline to confirm the reserved time.`,
    classification: studio ? "APPOINTMENT DEPOSIT" : "DEPOSIT REQUESTED",
    headline: "Your appointment time is being held.",
    greeting: `Hi ${data.clientName || "there"},`,
    intro: [
      `The Studio has selected the appointment time below. Complete the ${data.depositLabel || "deposit"} by the deadline to confirm it.`,
    ],
    details: [
      { label: "Appointment", value: data.when },
      { label: "Session", value: data.session },
      { label: data.depositLabel || "Deposit due", value: data.depositText },
      { label: "Pay by", value: data.dueAt },
    ],
    primaryAction: { label: `Pay ${data.depositLabel || "Deposit"}`, href: data.checkoutUrl },
    secondaryActions: [],
    notice: [
      "The selected time remains reserved until the payment deadline.",
      "If payment is not completed by then, the hold is released automatically.",
    ],
    signature: studio ? constructSignature() : tattooSignature(true),
  });
}

export function buildTattooSpecialReviewEmail(data) {
  const declined = data.outcome === "declined";
  const specialName = [data.offerTitle, data.variantLabel].filter(Boolean).join(" — ") || "Tattoo Special";
  return renderClientEmail({
    templateKey: "tattoo_special_review",
    templateVariant: declined ? "declined" : "simplification_requested",
    variables: { client_name: data.clientName || "there" },
    theme: "tattoo",
    subject: declined ? "Your Tattoo Special review" : "Your Tattoo Special needs simplification",
    preheader: declined
      ? "An update from the Studio about your Tattoo Special request."
      : "The Studio needs an adjusted direction before approving your Tattoo Special.",
    classification: "TATTOO SPECIAL REVIEW",
    headline: declined
      ? "The Studio has completed your Tattoo Special review."
      : "Your Tattoo Special needs a simpler direction.",
    greeting: `Hi ${data.clientName || "there"},`,
    intro: [
      declined
        ? "The Studio is not able to approve this project as a Tattoo Special. You can still use the normal tattoo inquiry path if you would like to discuss another direction."
        : "The Studio needs the design simplified before it can approve the advertised Tattoo Special price. Reply to the Studio note below with an adjusted direction or reference.",
    ],
    details: [
      { label: "Tattoo Special", value: specialName },
      { label: "Advertised total", value: data.advertisedTotal },
      { label: "Deposit at booking", value: data.depositText },
      { label: "Appointment duration", value: data.durationText },
    ],
    sections: data.studioNote ? [{
      id: "studio_note",
      title: declined ? "Why this request was declined" : "Studio note",
      paragraphs: [data.studioNote],
      editableParagraphs: false,
    }] : [],
    outro: declined
      ? ["If you would like to discuss a different project direction, begin with the regular Custom Tattoo inquiry."]
      : ["Reply to this email with the adjusted direction or reference when you are ready for the Studio to continue the review."],
    signature: tattooSignature(true),
  });
}

export function buildSubmissionDecisionEmail(data) {
  const approved = data.decision === "approved";
  const art = data.variant === "art_acquisition";
  const label = data.label || (art ? "art inquiry" : "project request");
  return renderClientEmail({
    templateKey: approved ? "submission_approved" : "submission_declined",
    templateVariant: data.variant || "custom",
    variables: { client_name: data.clientName || "there", request_label: label },
    theme: art ? "construct_art" : "tattoo",
    subject: data.subject || (approved ? `Your ${label} was approved` : `An update on your ${label}`),
    preheader: approved
      ? "The Studio has approved your request and will coordinate the next step with you."
      : "The Studio has completed its review of your request.",
    classification: approved ? "REQUEST APPROVED" : "REQUEST REVIEW COMPLETE",
    headline: approved ? `Your ${label} is approved.` : `The Studio completed its review of your ${label}.`,
    greeting: `Hi ${data.clientName || "there"},`,
    intro: [approved
      ? "The Studio has approved this request. No appointment or payment is created by this message."
      : "The Studio is not able to approve this request in its current form."],
    sections: data.message ? [{
      id: "studio_message",
      title: approved ? "Studio message" : "Why this request was declined",
      paragraphs: [data.message],
      editableParagraphs: false,
    }] : [],
    notice: approved
      ? ["Reply to this email if you need to clarify the next step."]
      : ["Reply to this email if you have a question about the reviewed reason."],
    signature: art ? constructSignature() : tattooSignature(true),
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
  tattoo_special: {
    theme: "tattoo",
    classification: "TATTOO SPECIAL APPOINTMENT",
    headline: "Your Tattoo Special appointment is confirmed.",
    feeLabel: "Deposit received",
    resourceTitle: "Before your appointment",
    body: "Your selected Tattoo Special terms remain attached to this appointment. Personalized aftercare instructions will be provided at your appointment.\n\nI may follow up directly with preparation notes or adjustments before your appointment, if needed.",
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
  studio_visit: {
    theme: "construct_art",
    classification: "ART STUDIO VISIT",
    headline: "Your Open Studio Visit at the six.well construct is confirmed.",
    feeLabel: "Reservation fee",
    body: "Your visit is reserved. Reply to this email if you have questions before arriving.",
    signature: constructSignature("See you soon,"),
  },
  studio_space: {
    theme: "construct_event",
    classification: "STUDIO RESERVATION",
    headline: "Your studio booking at the six.well construct is confirmed.",
    feeLabel: "Deposit",
    body: "We'll reach out with anything you need ahead of your time in the space. Reply to this email with questions.",
    signature: constructSignature("Thank you,"),
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

export const TATTOO_APPOINTMENT_PAYMENT_AND_ARRIVAL_POLICY = "Your deposit goes toward the final tattoo cost. At the start of your appointment, after the final design, placement, and session price are confirmed, the remaining balance must be paid before tattooing begins. Cash is preferred. Cash App, Apple Pay, and credit/debit cards are also accepted. A 3% processing fee applies to all digital transactions. There is a 15-minute grace period. Arrival later than 15 minutes may require cancellation, rescheduling, and a new deposit.";

export function buildAppointmentConfirmedEmail(data) {
  const profile = APPOINTMENT_CONFIRMATION_PROFILES[data.kind] || APPOINTMENT_CONFIRMATION_PROFILES.tattoo;
  const resourceActions = list(data.resources).map((resource) => ({
    label: resource.label,
    href: resource.href,
  }));
  const sessions = list(data.sessions);
  const grouped = sessions.length > 1;
  const sessionLabel = grouped ? `${sessions.length} tattoo sessions` : "";
  const sessionSections = grouped ? sessions.map((session, index) => ({
    title: `Session ${index + 1}`,
    editableTitle: false,
    editableParagraphs: false,
    items: [
      { label: "Date and time", value: session.when },
      { label: "Session type", value: session.session },
      { label: profile.feeLabel, value: session.feeText },
      { label: "View confirmation", value: `Open Session ${index + 1}`, href: session.confirmationUrl },
      { label: "Add to calendar", value: `Add Session ${index + 1}`, href: session.calendarUrl },
      { label: "Reschedule", value: `Reschedule Session ${index + 1}`, href: session.rescheduleUrl },
    ],
  })) : [];
  return renderClientEmail({
    templateKey: data.templateKey || (["studio_visit", "studio_space"].includes(data.kind) ? "studio_booking_confirmed" : data.kind === "consultation_in_person" ? "consultation_confirmed_in_person" : data.kind === "consultation_virtual" ? "consultation_confirmed_virtual" : data.kind === "build_session" ? "build_session_confirmed" : "appointment_confirmed"),
    templateVariant: data.variant || (data.kind === "tattoo" ? (data.tipText ? "tip" : "tattoo") : "default"),
    variables: {
      client_name: data.clientName || "there",
      ...(grouped ? { session_label: sessionLabel } : {}),
    },
    theme: profile.theme,
    subject: data.subject,
    preheader: data.preheader || (grouped
      ? `${sessionLabel} are booked, with payment details and a separate reschedule link for each date.`
      : "Date, time, payment details, and everything you need before arriving."),
    classification: data.classification || profile.classification,
    headline: data.headline || (grouped ? `Your ${sessions.length} tattoo sessions are confirmed.` : profile.headline),
    greeting: `Hi ${data.clientName || "there"},`,
    details: grouped ? [
      data.studioAddress ? { id: "studio_address", label: "Studio address", value: data.studioAddress, editableLabel: false } : null,
      ...list(data.pricingDetails),
      ...list(data.balanceDetails),
      data.tipText ? { id: "optional_tip", label: "Optional tip", value: data.tipText } : null,
      data.totalPaidText ? { id: "total_paid_today", label: "Total paid today", value: data.totalPaidText } : null,
    ] : [
      { id: "when", label: "When", value: data.when },
      { id: "session", label: ["studio_visit", "studio_space"].includes(data.kind) ? "Booking" : "Session", value: data.session },
      data.studioAddress ? { id: "studio_address", label: "Studio address", value: data.studioAddress, editableLabel: false } : null,
      ...list(data.pricingDetails),
      { id: "deposit", label: profile.feeLabel, value: data.feeText },
      ...list(data.balanceDetails),
      data.tipText ? { id: "optional_tip", label: "Optional tip", value: data.tipText } : null,
      data.totalPaidText ? { id: "total_paid_today", label: "Total paid today", value: data.totalPaidText } : null,
      data.zoomUrl ? { id: "zoom_link", label: "Zoom link", value: data.zoomUrl } : null,
    ],
    sections: sessionSections,
    primaryAction: {
      label: grouped ? "View all booked sessions" : "View confirmation",
      href: data.confirmationUrl,
    },
    secondaryActions: grouped
      ? resourceActions
      : [{ label: "Add to calendar", href: data.calendarUrl }, ...resourceActions],
    outro: [data.billingPolicyText, data.renderingPolicyText, data.paymentPolicyText, profile.body],
    signature: profile.signature,
  });
}

export function buildAppointmentRescheduledEmail(data) {
  const studio = ["studio_visit", "studio_space", "studio"].includes(data.kind);
  const art = data.kind === "studio_visit";
  const legacy = data.kind === "studio";
  const tattooSpecial = data.kind === "tattoo_special";
  const theme = art ? "construct_art" : legacy ? "construct_studio" : studio ? "construct_event" : "tattoo";
  return renderClientEmail({
    templateKey: "appointment_rescheduled",
    templateVariant: data.variant || (studio ? "studio_space" : "tattoo"),
    variables: { client_name: data.clientName || "there", appointment_label: data.label },
    theme,
    subject: data.subject,
    preheader: `Your updated ${data.label} time and confirmation details.`,
    classification: art ? "UPDATED ART STUDIO VISIT" : studio ? "UPDATED STUDIO RESERVATION" : tattooSpecial ? "UPDATED TATTOO SPECIAL" : "UPDATED APPOINTMENT FILE",
    headline: tattooSpecial ? "Your Tattoo Special appointment has been rescheduled." : `Your ${data.label} has been rescheduled.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      data.previousTime ? { label: "Previous time", value: data.previousTime } : null,
      { label: "New time", value: data.newTime },
      { label: "Session", value: data.session },
      data.sessionFeeText ? { label: "Extended Day fee", value: data.sessionFeeText } : null,
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
  const studio = ["studio_visit", "studio_space", "studio"].includes(data.kind);
  const art = data.kind === "studio_visit";
  const legacy = data.kind === "studio";
  const tattooSpecial = data.kind === "tattoo_special";
  return renderClientEmail({
    templateKey: "appointment_cancelled",
    templateVariant: data.variant || (studio ? "studio_space" : "tattoo"),
    variables: { client_name: data.clientName || "there", occasion: data.occasion, support_email: data.supportEmail },
    theme: art ? "construct_art" : legacy ? "construct_studio" : studio ? "construct_event" : "tattoo",
    subject: data.subject,
    preheader: `Cancellation details for your ${data.occasion}.`,
    classification: art ? "ART STUDIO VISIT CANCELLED" : studio ? "STUDIO RESERVATION CANCELLED" : tattooSpecial ? "TATTOO SPECIAL CANCELLED" : "APPOINTMENT FILE CLOSED",
    headline: tattooSpecial ? "Your Tattoo Special appointment has been cancelled." : `Your ${studio ? "six.well construct " : "art.pill TATTOO HOUSE "}${data.occasion} has been cancelled.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: "Was scheduled", value: data.scheduled },
      { label: studio ? "Booking" : "Session", value: data.session },
    ],
    notice: [data.policyText, data.billingPolicyText],
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
  const studio = ["studio_visit", "studio_space", "studio"].includes(data.kind);
  const art = data.kind === "studio_visit";
  const legacy = data.kind === "studio";
  const virtual = data.kind === "consultation_virtual";
  const tattooSpecial = data.kind === "tattoo_special";
  return renderClientEmail({
    templateKey: "appointment_reminder_24h",
    templateVariant: data.variant || (studio ? "studio_space" : virtual ? "virtual" : "tattoo"),
    variables: { client_name: data.clientName || "there", occasion: data.occasion, brand: data.brand },
    theme: art ? "construct_art" : legacy ? "construct_studio" : studio ? "construct_event" : "tattoo",
    subject: data.subject,
    preheader: `Your ${data.occasion} is tomorrow. Review the time and arrival details.`,
    classification: art ? "ART STUDIO VISIT REMINDER" : studio ? "STUDIO REMINDER" : tattooSpecial ? "TATTOO SPECIAL REMINDER" : "SESSION REMINDER",
    headline: tattooSpecial ? "Your Tattoo Special appointment is tomorrow." : `Your ${data.occasion} with ${data.brand} is tomorrow.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: "When", value: data.when },
      { label: "Session", value: data.session },
      data.studioAddress ? { id: "studio_address", label: "Studio address", value: data.studioAddress, editableLabel: false } : null,
      data.sessionFeeText ? { label: "Extended Day fee", value: data.sessionFeeText } : null,
      virtual && data.zoomUrl ? { label: "Zoom link", value: data.zoomUrl } : null,
      virtual && data.zoomStatus ? { label: "Zoom details", value: data.zoomStatus } : null,
    ],
    secondaryActions: [
      { label: "Add to calendar", href: data.calendarUrl },
      ...list(data.resources),
    ],
    outro: [
      data.billingPolicyText,
      data.notice,
      "Reply to this thread if you have any questions or concerns before your session.",
    ],
    signature: studio
      ? constructSignature()
      : { closing: "", name: "-Saiel Solehman", mark: "[art.pill TATTOO HOUSE]" },
  });
}

export function buildEventTicketPaidEmail(data) {
  const freeRsvp = data.free === true;
  return renderClientEmail({
    templateKey: "event_ticket_paid",
    templateVariant: data.variant || (freeRsvp ? "rsvp" : "default"),
    variables: { client_name: data.clientName || "there", event_title: data.title },
    theme: "construct_event",
    subject: data.subject,
    preheader: freeRsvp ? `Your RSVP details for ${data.title}.` : `Your admission details for ${data.title}.`,
    classification: freeRsvp ? "EVENT RSVP" : "EVENT ADMISSION",
    headline: freeRsvp ? `Your RSVP is confirmed for ${data.title}.` : `You're booked for ${data.title}.`,
    greeting: `Hi ${data.clientName || "there"},`,
    details: [
      { label: freeRsvp ? "People attending" : "Seats reserved", value: data.seats },
      data.when ? { label: "When", value: data.when } : null,
      data.where ? { label: "Where", value: data.where } : null,
    ],
    notice: data.preparationNote ? [data.preparationNote] : [],
    primaryAction: { label: freeRsvp ? "View RSVP" : "View ticket", href: data.ticketUrl },
    secondaryActions: [
      data.eventUrl ? { label: "Event guide", href: data.eventUrl } : null,
      data.calendarUrl ? { label: "Add to calendar", href: data.calendarUrl } : null,
    ],
    outro: [
      freeRsvp
        ? "This RSVP is for event correspondence and planning only. Reply to this email if anything changes or you have questions before the event."
        : "Your spot is confirmed and paid. Reply to this email if anything changes or you have questions before the event.",
    ],
    signature: constructSignature("See you there,"),
  });
}

export function buildEventTicketCancelledEmail(data) {
  return renderClientEmail({
    templateKey: "event_ticket_cancelled",
    templateVariant: data.variant || "refunded",
    variables: { client_name: data.clientName || "there", event_title: data.title },
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
    templateKey: "event_open_mic_slot",
    templateVariant: data.variant || "default",
    variables: { performer_name: data.performerName || "there", event_title: data.title },
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
    templateKey: "event_ticket_reminder_24h",
    templateVariant: data.variant || "default",
    variables: { client_name: data.clientName || "there", event_title: data.title },
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
    notice: data.preparationNote ? [data.preparationNote] : [],
    secondaryActions: [
      data.eventUrl ? { label: "Event guide", href: data.eventUrl } : null,
      { label: "Add to calendar", href: data.calendarUrl },
    ],
    outro: [
      "Looking forward to seeing you. Reply to this email if anything has changed.",
    ],
    signature: constructSignature(),
  });
}

export function buildAdminNotificationEmail(data) {
  const theme = ["tattoo", "construct_art", "construct_event", "construct_studio"].includes(data.theme)
    ? data.theme
    : "construct_studio";
  const source = theme === "tattoo" ? "art.pill" : theme === "construct_art" ? "art" : theme === "construct_event" ? "event" : "studio";
  return renderClientEmail({
    templateKey: data.templateKey || "admin_test",
    templateVariant: data.variant || source,
    variables: { admin_subject: data.subject },
    theme,
    subject: data.subject,
    preheader: data.preheader || "A new Studio notification is ready for review.",
    classification: data.classification || `${source.toUpperCase()} ADMIN ALERT`,
    headline: data.headline || data.subject,
    sections: [{
      id: "notification_details",
      title: data.sectionTitle || "Notification details",
      paragraphs: list(data.lines),
      editableParagraphs: false,
    }],
    primaryAction: data.studioUrl ? { label: "Open Studio", href: data.studioUrl } : null,
    signature: constructSignature(),
    footer: ["Internal administrative correspondence."],
  });
}

export function buildCrmFollowupEmail(data) {
  const theme = data.theme === "tattoo" ? "tattoo" : "construct_studio";
  return renderClientEmail({
    templateKey: "crm_relationship_followup",
    templateVariant: theme,
    variables: {},
    theme,
    subject: data.subject,
    preheader: data.preheader || "A personal note from the studio.",
    classification: data.classification || "STUDIO CORRESPONDENCE",
    headline: data.headline || "A note from the studio.",
    intro: list(String(data.body || "").split(/\n\s*\n/)),
    signature: theme === "tattoo" ? tattooSignature(true) : constructSignature("Warmly,"),
  });
}

export function buildCommunicationPreferencesEmail(data) {
  return renderClientEmail({
    templateKey: "crm_communication_preferences",
    templateVariant: "construct_studio",
    variables: {},
    theme: "construct_studio",
    subject: "Manage your Six.Well communication preferences",
    preheader: "Review or change how the studio contacts you.",
    classification: "COMMUNICATION PREFERENCES",
    headline: "Your communication settings are ready.",
    intro: ["Use the secure link below to review or change your Six.Well email preferences."],
    primaryAction: { label: "Manage preferences", href: data.url },
    notice: ["This link expires in 30 minutes. If you did not request it, you can ignore this email."],
    signature: constructSignature(),
  });
}

const PREVIEW_CATALOG = Object.freeze([
  { templateKey: "tattoo_build_draft_resume", variant: "build", label: "Saved Build draft", brand: "tattoo", audience: "client", stage: "inquiry" },
  { templateKey: "tattoo_build_draft_resume", variant: "maze", label: "Saved Maze draft", brand: "tattoo", audience: "client", stage: "inquiry" },
  { templateKey: "tattoo_brief_ready", variant: "build", label: "Build brief PDF ready", brand: "tattoo", audience: "client", stage: "inquiry" },
  { templateKey: "tattoo_brief_ready", variant: "maze", label: "Maze brief PDF ready", brand: "tattoo", audience: "client", stage: "inquiry" },
  { templateKey: "submission_received", variant: "custom", label: "Custom project receipt", brand: "tattoo", stage: "inquiry" },
  { templateKey: "submission_received", variant: "flash", label: "Flash claim receipt", brand: "tattoo", stage: "inquiry" },
  { templateKey: "submission_received", variant: "build", label: "Build brief receipt", brand: "tattoo", stage: "inquiry" },
  { templateKey: "submission_received", variant: "maze", label: "Maze submission receipt", brand: "tattoo", stage: "inquiry" },
  { templateKey: "submission_received", variant: "special", label: "Special project receipt", brand: "tattoo", stage: "inquiry" },
  { templateKey: "submission_received", variant: "tattoo_special", label: "Tattoo Special request received", brand: "tattoo", stage: "specials" },
  { templateKey: "submission_received", variant: "consultation", label: "Consultation request receipt", brand: "tattoo", stage: "inquiry" },
  { templateKey: "submission_received", variant: "build_session", label: "Build-session request receipt", brand: "tattoo", stage: "inquiry" },
  { templateKey: "submission_received", variant: "art_acquisition", label: "Art acquisition inquiry receipt", brand: "art", stage: "inquiry" },
  { templateKey: "submission_received", variant: "studio_visit", label: "Open Studio Visit inquiry receipt", brand: "art", stage: "inquiry" },
  { templateKey: "submission_received", variant: "studio_space", label: "Studio gathering or rental inquiry receipt", brand: "events", stage: "inquiry" },
  { templateKey: "booking_link_created", variant: "tattoo", label: "Private tattoo booking link", brand: "tattoo", stage: "booking" },
  { templateKey: "booking_link_created", variant: "tattoo_special", label: "Legacy Tattoo Special calendar link", brand: "tattoo", stage: "legacy" },
  { templateKey: "tattoo_special_deposit_requested", variant: "default", label: "Tattoo Special approved / deposit payment", brand: "tattoo", stage: "specials" },
  { templateKey: "manual_appointment_deposit_requested", variant: "tattoo", label: "Studio-scheduled tattoo deposit", brand: "tattoo", stage: "appointment" },
  { templateKey: "manual_appointment_deposit_requested", variant: "consultation", label: "Studio-scheduled consultation payment", brand: "tattoo", stage: "appointment" },
  { templateKey: "manual_appointment_deposit_requested", variant: "studio_visit", label: "Studio-scheduled Open Studio Visit payment", brand: "art", stage: "appointment" },
  { templateKey: "manual_appointment_deposit_requested", variant: "studio_space", label: "Studio-scheduled room booking payment", brand: "events", stage: "appointment" },
  { templateKey: "booking_link_created", variant: "consultation", label: "Prerequisite consultation link", brand: "tattoo", stage: "booking" },
  { templateKey: "tattoo_special_review", variant: "simplification_requested", label: "Tattoo Special simplification requested", brand: "tattoo", stage: "specials" },
  { templateKey: "tattoo_special_review", variant: "declined", label: "Tattoo Special declined", brand: "tattoo", stage: "specials" },
  { templateKey: "submission_approved", variant: "art_acquisition", label: "Art inquiry approved", brand: "art", stage: "decision" },
  { templateKey: "submission_declined", variant: "custom", label: "Custom Tattoo declined", brand: "tattoo", stage: "decision" },
  { templateKey: "submission_declined", variant: "flash", label: "Flash declined", brand: "tattoo", stage: "decision" },
  { templateKey: "submission_declined", variant: "build", label: "Build declined", brand: "tattoo", stage: "decision" },
  { templateKey: "submission_declined", variant: "maze", label: "Maze declined", brand: "tattoo", stage: "decision" },
  { templateKey: "submission_declined", variant: "special", label: "Special Project declined", brand: "tattoo", stage: "decision" },
  { templateKey: "submission_declined", variant: "tattoo_special", label: "Tattoo Special declined", brand: "tattoo", stage: "decision" },
  { templateKey: "submission_declined", variant: "art_acquisition", label: "Art inquiry declined", brand: "art", stage: "decision" },
  { templateKey: "tattoo_rendering_payment_requested", variant: "default", label: "Additional concept sketch payment request", brand: "tattoo", stage: "appointment" },
  { templateKey: "tattoo_rendering_payment_confirmed", variant: "default", label: "Additional concept sketch payment confirmation", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_confirmed", variant: "tattoo", label: "Tattoo appointment confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_confirmed", variant: "tip", label: "Tattoo confirmed with tip", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_confirmed", variant: "tattoo_multi", label: "Multi-session tattoo booking confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_confirmed", variant: "tattoo_multi_tip", label: "Multi-session tattoo booking confirmed with tip", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_confirmed", variant: "tattoo_extended", label: "Extended Day appointment confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_confirmed", variant: "tattoo_extended_tip", label: "Extended Day confirmed with tip", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_confirmed", variant: "tattoo_legacy", label: "Legacy tattoo confirmation without reviewed total", brand: "tattoo", stage: "legacy" },
  { templateKey: "appointment_confirmed", variant: "tattoo_legacy_tip", label: "Legacy tattoo confirmation with tip", brand: "tattoo", stage: "legacy" },
  { templateKey: "appointment_confirmed", variant: "tattoo_extended_legacy", label: "Legacy Extended Day confirmation without reviewed total", brand: "tattoo", stage: "legacy" },
  { templateKey: "appointment_confirmed", variant: "tattoo_extended_legacy_tip", label: "Legacy Extended Day confirmation with tip", brand: "tattoo", stage: "legacy" },
  { templateKey: "appointment_confirmed", variant: "tattoo_special", label: "Tattoo Special appointment confirmed", brand: "tattoo", stage: "specials" },
  { templateKey: "appointment_confirmed", variant: "tattoo_special_tip", label: "Tattoo Special confirmed with tip", brand: "tattoo", stage: "specials" },
  { templateKey: "consultation_confirmed_in_person", variant: "default", label: "In-person consultation confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "consultation_confirmed_virtual", variant: "default", label: "Virtual consultation confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "build_session_confirmed", variant: "default", label: "Build session confirmed", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_rescheduled", variant: "tattoo", label: "Tattoo appointment rescheduled", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_rescheduled", variant: "tattoo_special", label: "Tattoo Special appointment rescheduled", brand: "tattoo", stage: "specials" },
  { templateKey: "appointment_cancelled", variant: "tattoo", label: "Tattoo appointment cancelled", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_cancelled", variant: "tattoo_special", label: "Tattoo Special appointment cancelled", brand: "tattoo", stage: "specials" },
  { templateKey: "appointment_cancelled", variant: "consultation", label: "Consultation cancelled", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_cancelled", variant: "prerequisite", label: "Prerequisite consultation cancelled", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_cancelled", variant: "build", label: "Build session cancelled", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_reminder_24h", variant: "tattoo", label: "Tattoo appointment reminder", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_reminder_24h", variant: "tattoo_special", label: "Tattoo Special appointment reminder", brand: "tattoo", stage: "specials" },
  { templateKey: "appointment_reminder_24h", variant: "virtual", label: "Virtual consultation reminder", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_reminder_24h", variant: "consultation", label: "In-person consultation reminder", brand: "tattoo", stage: "appointment" },
  { templateKey: "appointment_reminder_24h", variant: "build", label: "Build session reminder", brand: "tattoo", stage: "appointment" },
  { templateKey: "studio_booking_confirmed", variant: "studio_visit", label: "Open Studio Visit confirmed", brand: "art", stage: "appointment" },
  { templateKey: "appointment_rescheduled", variant: "studio_visit", label: "Open Studio Visit rescheduled", brand: "art", stage: "appointment" },
  { templateKey: "appointment_cancelled", variant: "studio_visit", label: "Open Studio Visit cancelled", brand: "art", stage: "appointment" },
  { templateKey: "appointment_reminder_24h", variant: "studio_visit", label: "Open Studio Visit reminder", brand: "art", stage: "appointment" },
  { templateKey: "studio_booking_confirmed", variant: "studio_space", label: "Studio gathering or rental confirmed", brand: "events", stage: "appointment" },
  { templateKey: "appointment_rescheduled", variant: "studio_space", label: "Studio gathering or rental rescheduled", brand: "events", stage: "appointment" },
  { templateKey: "appointment_cancelled", variant: "studio_space", label: "Studio gathering or rental cancelled", brand: "events", stage: "appointment" },
  { templateKey: "appointment_reminder_24h", variant: "studio_space", label: "Studio gathering or rental reminder", brand: "events", stage: "appointment" },
  { templateKey: "studio_booking_confirmed", variant: "default", label: "Legacy generic studio confirmation", brand: "studio", stage: "legacy" },
  { templateKey: "appointment_rescheduled", variant: "studio", label: "Legacy generic studio reschedule", brand: "studio", stage: "legacy" },
  { templateKey: "appointment_cancelled", variant: "studio", label: "Legacy generic studio cancellation", brand: "studio", stage: "legacy" },
  { templateKey: "appointment_reminder_24h", variant: "studio", label: "Legacy generic studio reminder", brand: "studio", stage: "legacy" },
  { templateKey: "event_ticket_paid", variant: "default", label: "Event ticket confirmed", brand: "events", stage: "events" },
  { templateKey: "event_ticket_paid", variant: "rsvp", label: "Free event RSVP confirmed", brand: "events", stage: "events" },
  { templateKey: "event_ticket_cancelled", variant: "refunded", label: "Event ticket cancelled and refunded", brand: "events", stage: "events" },
  { templateKey: "event_ticket_cancelled", variant: "no_refund", label: "Event ticket cancelled without refund", brand: "events", stage: "events" },
  { templateKey: "event_ticket_reminder_24h", variant: "default", label: "Event reminder", brand: "events", stage: "events" },
  { templateKey: "event_open_mic_slot", variant: "default", label: "Open-mic slot assigned", brand: "events", stage: "events" },
  { templateKey: "admin_submission_received", variant: "tattoo", label: "New tattoo submission alert", brand: "tattoo", audience: "admin", stage: "admin" },
  { templateKey: "admin_submission_received", variant: "tattoo_special", label: "New Tattoo Special approval request alert", brand: "tattoo", audience: "admin", stage: "specials" },
  { templateKey: "admin_submission_received", variant: "construct_art", label: "New Art inquiry alert", brand: "art", audience: "admin", stage: "admin" },
  { templateKey: "admin_submission_received", variant: "construct_event", label: "New Studio/event inquiry alert", brand: "events", audience: "admin", stage: "admin" },
  { templateKey: "admin_appointment_confirmed", variant: "tattoo", label: "Tattoo appointment admin alert", brand: "tattoo", audience: "admin", stage: "admin" },
  { templateKey: "admin_appointment_confirmed", variant: "tattoo_special", label: "Tattoo Special appointment admin alert", brand: "tattoo", audience: "admin", stage: "specials" },
  { templateKey: "admin_appointment_confirmed", variant: "construct_art", label: "Open Studio Visit admin alert", brand: "art", audience: "admin", stage: "admin" },
  { templateKey: "admin_appointment_confirmed", variant: "construct_event", label: "Studio gathering or rental admin alert", brand: "events", audience: "admin", stage: "admin" },
  { templateKey: "admin_appointment_rescheduled", variant: "tattoo", label: "Tattoo reschedule admin alert", brand: "tattoo", audience: "admin", stage: "admin" },
  { templateKey: "admin_appointment_rescheduled", variant: "tattoo_special", label: "Tattoo Special reschedule admin alert", brand: "tattoo", audience: "admin", stage: "specials" },
  { templateKey: "admin_appointment_rescheduled", variant: "construct_art", label: "Open Studio Visit reschedule admin alert", brand: "art", audience: "admin", stage: "admin" },
  { templateKey: "admin_appointment_rescheduled", variant: "construct_event", label: "Studio gathering or rental reschedule admin alert", brand: "events", audience: "admin", stage: "admin" },
  { templateKey: "admin_appointment_confirmed", variant: "construct_studio", label: "Legacy generic studio booking alert", brand: "studio", audience: "admin", stage: "legacy" },
  { templateKey: "admin_appointment_rescheduled", variant: "construct_studio", label: "Legacy generic studio reschedule alert", brand: "studio", audience: "admin", stage: "legacy" },
  { templateKey: "admin_event_waitlist_received", variant: "construct_event", label: "Event waitlist admin alert", brand: "events", audience: "admin", stage: "admin" },
  { templateKey: "admin_event_open_mic_received", variant: "construct_event", label: "Open mic admin alert", brand: "events", audience: "admin", stage: "admin" },
  { templateKey: "admin_event_ticket_paid", variant: "construct_event", label: "Event ticket admin alert", brand: "events", audience: "admin", stage: "admin" },
  { templateKey: "admin_test", variant: "construct_studio", label: "Administrative test notification", brand: "studio", audience: "admin", stage: "admin" },
  { templateKey: "crm_relationship_followup", variant: "construct_studio", label: "CRM relationship email - Six.Well", brand: "studio", audience: "crm", stage: "relationship", omitEditable: ["subject", "preheader", "intro"] },
  { templateKey: "crm_relationship_followup", variant: "tattoo", label: "CRM relationship email - art.pill", brand: "tattoo", audience: "crm", stage: "relationship", omitEditable: ["subject", "preheader", "intro"] },
  { templateKey: "crm_communication_preferences", variant: "construct_studio", label: "Communication preferences link", brand: "studio", audience: "client", stage: "relationship" },
]);

export function clientEmailPreviewCatalog() {
  return PREVIEW_CATALOG.map((entry) => ({ audience: "client", ...entry }));
}

const SAMPLE = Object.freeze({
  clientName: "Jordan Rivera",
  when: "Friday, June 12, 2026 at 2:00 PM EDT - Friday, June 12, 2026 at 5:00 PM EDT",
  shortWhen: "Friday, June 12, 2026 at 2:00 PM EDT",
  session: "Half Day Session",
  studioAddress: "Studio address supplied by the Worker configuration",
  confirmationUrl: "https://thesixwellconstruct.com/booking/confirmed/?appointment=demo-appointment",
  calendarUrl: "https://thesixwellconstruct.com/api/booking/calendar?appointment=demo-appointment",
  bookingUrl: "https://thesixwellconstruct.com/booking/?token=demo-private-token",
  bookingTermsUrl: "https://thesixwellconstruct.com/tattoos/policies/",
  dayOfInstructionsUrl: "https://thesixwellconstruct.com/tattoos/day-of/",
  locationParkingUrl: "https://thesixwellconstruct.com/tattoos/location-parking/",
  supportEmail: "saisolehman@artpilltattoohouse.com",
  supportPhone: "(770) 820-5800",
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
    variant: overrides.variant,
    subject,
    headline: overrides.headline || "",
    preheader: overrides.preheader || "",
    clientName: SAMPLE.clientName,
    when: overrides.when || SAMPLE.when,
    session: overrides.session || SAMPLE.session,
    studioAddress: overrides.studioAddress === undefined ? SAMPLE.studioAddress : overrides.studioAddress,
    pricingDetails: overrides.pricingDetails || [],
    feeText: overrides.feeText || "$100 received",
    balanceDetails: overrides.balanceDetails || [],
    tipText: overrides.tipText || "",
    totalPaidText: overrides.totalPaidText || "",
    zoomUrl: overrides.zoomUrl || "",
    billingPolicyText: overrides.billingPolicyText || "",
    renderingPolicyText: overrides.renderingPolicyText || "",
    paymentPolicyText: overrides.paymentPolicyText || (["tattoo", "tattoo_special"].includes(kind)
      ? TATTOO_APPOINTMENT_PAYMENT_AND_ARRIVAL_POLICY
      : ""),
    confirmationUrl: overrides.confirmationUrl || SAMPLE.confirmationUrl,
    calendarUrl: SAMPLE.calendarUrl,
    sessions: overrides.sessions || [],
    resources: overrides.resources || [
      { label: "Tattoo policies", href: SAMPLE.bookingTermsUrl },
      { label: "Day-of instructions", href: SAMPLE.dayOfInstructionsUrl },
      { label: "Location & parking", href: SAMPLE.locationParkingUrl },
    ],
  });
}

export function renderClientEmailPreview(templateKey, variant = "", designProfile = null) {
  const key = String(templateKey || "").trim();
  const mode = String(variant || "").trim();
  let rendered = null;

  if (key === "tattoo_build_draft_resume") {
    rendered = buildTattooDraftResumeEmail({
      variant: mode || "build",
      subject: mode === "maze" ? "Continue your art.pill Maze Studio draft" : "Continue your art.pill Build Your Own draft",
      label: mode === "maze" ? "Maze Studio draft" : "Build Your Own draft",
      resumeUrl: mode === "maze" ? "https://thesixwellconstruct.com/tattoos/build/maze/#resume=demo-private-token" : "https://thesixwellconstruct.com/tattoos/build/#resume=demo-private-token",
      expiration: "August 18, 2026",
    });
  } else if (key === "tattoo_brief_ready") {
    rendered = buildTattooBriefReadyEmail({
      variant: mode === "maze" ? "maze" : "build",
      clientName: SAMPLE.clientName,
      briefUrl: "https://thesixwellconstruct.com/api/tattoo/briefs/demo-document?v=1&sig=sample",
    });
  } else if (key === "submission_received") {
    const flash = mode === "flash";
    const profiles = {
      custom: ["custom tattoo project", "The studio will review the concept, placement, scale, references, budget, and timing before deciding the next step.", "If the project is a fit, you will receive the appropriate next step or a private tattoo-booking link."],
      flash: ["flash claim", "The studio will review placement, scale, budget, and the selected flash record.", "If your claim is approved while the design is still available, you will receive a private tattoo-booking link."],
      build: ["Build Your Own submission", "The studio will review your symbols, composition, placement, scale, and budget.", "If the project is a fit, the Studio will send the appropriate next step."],
      maze: ["Maze Studio submission", "The studio will review the generated maze, placement, scale, and project notes.", "If the project is a fit, the Studio will send the appropriate next step."],
      special: ["special project application", "The studio will review the application, scope, placement, references, budget, and timing.", "If the project is a fit, the Studio will contact you with the next step."],
      tattoo_special: ["request", "Thanks for sending this in. The selected Tattoo Special and project details are ready for review.", "If approved, a private link will make it easy to choose an available time and complete the deposit."],
      consultation: ["consultation request", "Your selected consultation time remains pending until checkout is completed.", "Complete checkout from the Square link you opened to keep the selected time."],
      build_session: ["Build session request", "Your selected Build session time remains pending until checkout is completed.", "Complete checkout from the Square link you opened to keep the selected time."],
      art_acquisition: ["art acquisition inquiry", "The Art studio will review the work, availability, budget, and questions you shared.", "The studio will reply with availability, acquisition details, or the next step."],
      studio_visit: ["Open Studio Visit request", "The Art studio will review the requested visit details and availability.", "The studio will reply with the next step or booking details."],
      studio_space: ["studio gathering or rental request", "The studio will review the requested date, group size, and use of the space.", "The studio will reply with availability and the next step."],
    };
    const profile = profiles[mode] || profiles.custom;
    const constructTheme = ["art_acquisition", "studio_visit"].includes(mode)
      ? "construct_art"
      : mode === "studio_space"
        ? "construct_event"
        : "tattoo";
    rendered = buildSubmissionReceivedEmail({
      variant: mode || "custom",
      theme: constructTheme,
      subject: constructTheme === "tattoo"
        ? `art.pill TATTOO HOUSE - ${mode === "tattoo_special" ? "Tattoo Special request" : profile[0]} received`
        : `the six.well construct - ${profile[0]} received`,
      clientName: SAMPLE.clientName,
      label: profile[0],
      submissionId: "demo-submission-014",
      requestedWhen: mode === "tattoo_special" ? "Saturday, September 19, 2026 at 1:00 PM EDT - Saturday, September 19, 2026 at 3:00 PM EDT" : "",
      requestedSheetDesigns: flash ? ["A is Moth - placement: Forearm - scale: 4 in"] : [],
      expectation: profile[1],
      next: profile[2],
      supportEmail: SAMPLE.supportEmail,
      supportPhone: SAMPLE.supportPhone,
      briefUrl: ["build", "maze"].includes(mode) ? "https://thesixwellconstruct.com/api/tattoo/briefs/demo-document?v=1&sig=sample" : "",
      editUrl: mode === "maze" ? "https://thesixwellconstruct.com/tattoos/build/maze/#edit=demo-private-token" : "",
    });
  } else if (key === "booking_link_created") {
    const consultation = mode === "consultation";
    const tattooSpecial = mode === "tattoo_special";
    rendered = buildBookingLinkEmail({
      variant: mode,
      subject: consultation
        ? "Your private prerequisite consultation link"
        : tattooSpecial
          ? "Your private art.pill TATTOO HOUSE Tattoo Special booking link"
          : "Your private art.pill TATTOO HOUSE tattoo booking link",
      consultation,
      clientName: SAMPLE.clientName,
      approvedSheetDesigns: [],
      sessionOptions: consultation
        ? "In-Person Consultation: 30 minutes. Reservation fee: $50."
        : tattooSpecial
          ? "Hand Sized Tattoo — Standard: 120 minutes. Deposit: $50."
          : "Half Day Session: 4 hours - 4 hours for medium approved projects or developed symbolic work. Deposit: $100.",
      approvedBudget: consultation ? "" : tattooSpecial ? "$200" : "$800-$1,200",
      depositText: consultation ? "$50" : tattooSpecial ? "$50" : "$100",
      bookingUrl: SAMPLE.bookingUrl,
      expiresAt: "Friday, July 31, 2026 at 11:59 PM EDT",
      bookingTermsUrl: SAMPLE.bookingTermsUrl,
      dayOfInstructionsUrl: SAMPLE.dayOfInstructionsUrl,
      locationParkingUrl: SAMPLE.locationParkingUrl,
    });
  } else if (key === "tattoo_special_deposit_requested") {
    rendered = buildTattooSpecialDepositRequestEmail({
      clientName: SAMPLE.clientName,
      when: "Saturday, September 19, 2026 at 1:00 PM EDT - Saturday, September 19, 2026 at 3:00 PM EDT",
      selection: "Hand Sized Tattoo — Standard",
      approvedTotal: "$200",
      depositText: "$50",
      checkoutUrl: "https://square.link/u/demo-tattoo-special-deposit",
      changeTimeUrl: "https://example.com/booking/reschedule/?appointment=demo-special&flow=special-request",
    });
  } else if (key === "manual_appointment_deposit_requested") {
    rendered = buildManualAppointmentDepositRequestEmail({
      kind: mode || "tattoo",
      label: mode === "studio_visit" ? "Open Studio Visit" : mode === "studio_space" ? "studio booking" : mode === "consultation" ? "consultation" : "tattoo appointment",
      clientName: SAMPLE.clientName,
      when: "Saturday, September 19, 2026 at 1:00 PM EDT - Saturday, September 19, 2026 at 5:00 PM EDT",
      session: mode === "studio_visit" ? "Open Studio Visit" : mode === "studio_space" ? "Private Studio Gathering" : mode === "consultation" ? "In-Person Consultation" : "Half Day Session",
      depositLabel: mode === "consultation" ? "Reservation fee" : "Deposit due",
      depositText: "$100",
      dueAt: "Tuesday, September 15, 2026 at 1:00 PM EDT",
      checkoutUrl: "https://square.link/u/demo-manual-appointment",
    });
  } else if (key === "tattoo_special_review") {
    rendered = buildTattooSpecialReviewEmail({
      outcome: mode,
      clientName: SAMPLE.clientName,
      offerTitle: "Anime / Cartoon — 6×6",
      variantLabel: "Color",
      advertisedTotal: "$200",
      depositText: "$50",
      durationText: "120 minutes",
      studioNote: mode === "simplification_requested" ? "Please remove the background and keep the portrait as the central direction." : "",
    });
  } else if (key === "submission_approved" || key === "submission_declined") {
    rendered = buildSubmissionDecisionEmail({
      decision: key === "submission_approved" ? "approved" : "declined",
      variant: mode || "custom",
      clientName: SAMPLE.clientName,
      label: mode === "art_acquisition" ? "art inquiry" : mode === "tattoo_special" ? "Tattoo Special request" : "project request",
      message: key === "submission_declined"
        ? "The requested scope is not a fit for the current Studio offering."
        : "The Studio will follow up with the next coordination step.",
    });
  } else if (key === "appointment_confirmed") {
    const multi = mode === "tattoo_multi" || mode === "tattoo_multi_tip";
    const tattooSpecial = mode === "tattoo_special" || mode === "tattoo_special_tip";
    const extended = mode === "tattoo_extended"
      || mode === "tattoo_extended_tip"
      || mode === "tattoo_extended_legacy"
      || mode === "tattoo_extended_legacy_tip";
    const legacy = mode === "tattoo_legacy"
      || mode === "tattoo_legacy_tip"
      || mode === "tattoo_extended_legacy"
      || mode === "tattoo_extended_legacy_tip";
    const tipped = mode === "tip"
      || mode === "tattoo_multi_tip"
      || mode === "tattoo_special_tip"
      || mode === "tattoo_extended_tip"
      || mode === "tattoo_legacy_tip"
      || mode === "tattoo_extended_legacy_tip";
    rendered = previewConfirmation(
      tattooSpecial ? "tattoo_special" : "tattoo",
      tattooSpecial
        ? "Your Tattoo Special appointment at art.pill TATTOO HOUSE has been confirmed"
        : multi
          ? "Your 3 tattoo sessions at art.pill TATTOO HOUSE have been confirmed"
        : "Your tattoo appointment at art.pill TATTOO HOUSE has been confirmed",
      {
        variant: mode,
        ...(tipped ? { tipText: "$25", totalPaidText: tattooSpecial ? "$75" : extended ? "$375" : "$125" } : {}),
        ...(!tattooSpecial && !extended && !legacy ? {
          pricingDetails: [
            { id: "approved_tattoo_work", label: "Approved tattoo work", value: "$600" },
            { id: "appointment_total", label: "Appointment total", value: "$600" },
          ],
          balanceDetails: [
            { id: "remaining_balance", label: "Remaining balance", value: "$500" },
          ],
        } : {}),
        ...(multi ? {
          headline: "Your 3 tattoo sessions are confirmed.",
          totalPaidText: tipped ? "$325" : "$300",
          sessions: [
            ["demo-appointment-1", "Friday, June 12, 2026 at 2:00 PM EDT - Friday, June 12, 2026 at 6:00 PM EDT"],
            ["demo-appointment-2", "Friday, June 26, 2026 at 2:00 PM EDT - Friday, June 26, 2026 at 6:00 PM EDT"],
            ["demo-appointment-3", "Friday, July 10, 2026 at 2:00 PM EDT - Friday, July 10, 2026 at 6:00 PM EDT"],
          ].map(([id, when]) => ({
            when,
            session: "Half Day Session",
            feeText: "$100 received",
            confirmationUrl: `https://thesixwellconstruct.com/booking/confirmed/?appointment=${id}`,
            calendarUrl: `https://thesixwellconstruct.com/api/booking/calendar?appointment=${id}`,
            rescheduleUrl: `https://thesixwellconstruct.com/booking/reschedule/?appointment=${id}`,
          })),
        } : {}),
        ...(extended ? {
          session: "Extended Day Session",
          feeText: "$350 received",
          pricingDetails: legacy
            ? [{ id: "extended_day_fee", label: "Extended Day fee", value: "+$200" }]
            : [
                { id: "approved_tattoo_work", label: "Approved tattoo work", value: "$2,000" },
                { id: "extended_day_fee", label: "Extended Day fee", value: "+$200" },
                { id: "appointment_total", label: "Appointment total", value: "$2,200" },
              ],
          balanceDetails: legacy
            ? []
            : [{ id: "remaining_balance", label: "Remaining balance", value: "$1,850" }],
          billingPolicyText: "Extended day sessions are always optional and are presented as an option for clients who want longer sessions.",
        } : {}),
        ...(tattooSpecial ? {
          session: "Tattoo Special · Hand Sized Tattoo — Standard",
          feeText: "$50 received",
          pricingDetails: [
            { id: "tattoo_special_total", label: "Tattoo Special total", value: "$200" },
          ],
          balanceDetails: [
            { id: "remaining_balance", label: "Remaining balance", value: "$150" },
            { id: "tattoo_special_duration", label: "Duration", value: "120 minutes" },
          ],
        } : {}),
      },
    );
  } else if (key === "tattoo_rendering_payment_requested") {
    rendered = buildTattooRenderingPaymentRequestEmail({
      clientName: SAMPLE.clientName,
      requestNumber: 1,
      amountText: "$50",
      appointmentWhen: SAMPLE.when,
      checkoutUrl: "https://square.link/u/demo-rendering-fee",
    });
  } else if (key === "tattoo_rendering_payment_confirmed") {
    rendered = buildTattooRenderingPaymentConfirmedEmail({
      clientName: SAMPLE.clientName,
      requestNumber: 1,
      amountText: "$50",
      appointmentWhen: SAMPLE.when,
    });
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
        studioAddress: "",
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
    const studioVisit = mode === "studio_visit";
    const legacy = mode === "default";
    rendered = previewConfirmation(
      studioVisit ? "studio_visit" : legacy ? "studio" : "studio_space",
      studioVisit
        ? "Your Open Studio Visit at the six.well construct is confirmed"
        : "Your studio booking at the six.well construct is confirmed",
      {
        variant: mode,
        session: studioVisit ? "Open Studio Visit" : "Studio Gathering",
        feeText: studioVisit
          ? "$50 received - this reserves your Open Studio Visit."
          : "$150 received - this holds your date; any balance is settled with the studio.",
        resources: [],
      },
    );
  } else if (key === "appointment_rescheduled") {
    const studioVisit = mode === "studio_visit";
    const legacy = mode === "studio";
    const studio = studioVisit || legacy || mode === "studio_space";
    const tattooSpecial = mode === "tattoo_special";
    rendered = buildAppointmentRescheduledEmail({
      kind: studioVisit ? "studio_visit" : legacy ? "studio" : studio ? "studio_space" : tattooSpecial ? "tattoo_special" : "tattoo",
      variant: mode,
      subject: studioVisit ? "Your Open Studio Visit has been rescheduled" : studio ? "Your studio booking has been rescheduled" : tattooSpecial ? "Your Tattoo Special appointment has been rescheduled" : "Your tattoo appointment has been rescheduled",
      label: studioVisit ? "Open Studio Visit" : studio ? "studio booking" : tattooSpecial ? "Tattoo Special appointment" : "tattoo appointment",
      clientName: SAMPLE.clientName,
      previousTime: "Thursday, June 11, 2026 at 2:00 PM EDT - Thursday, June 11, 2026 at 5:00 PM EDT",
      newTime: SAMPLE.when,
      session: studioVisit ? "Open Studio Visit" : studio ? "Studio Gathering" : tattooSpecial ? "Tattoo Special · Hand Sized Tattoo — Standard" : SAMPLE.session,
      confirmationUrl: SAMPLE.confirmationUrl,
      calendarUrl: SAMPLE.calendarUrl,
      locationUrl: studio ? "" : SAMPLE.locationParkingUrl,
    });
  } else if (key === "appointment_cancelled") {
    const studioVisit = mode === "studio_visit";
    const legacy = mode === "studio";
    const studio = studioVisit || legacy || mode === "studio_space";
    const consultation = mode === "consultation";
    const prerequisite = mode === "prerequisite";
    const build = mode === "build";
    const tattooSpecial = mode === "tattoo_special";
    const occasion = studioVisit ? "Open Studio Visit" : studio ? "studio booking" : build ? "Build session" : prerequisite ? "project consultation" : consultation ? "consultation" : tattooSpecial ? "Tattoo Special appointment" : "appointment";
    rendered = buildAppointmentCancelledEmail({
      variant: mode || "tattoo",
      kind: studioVisit ? "studio_visit" : legacy ? "studio" : studio ? "studio_space" : tattooSpecial ? "tattoo_special" : "tattoo",
      subject: `Your ${studioVisit ? occasion : occasion.toLowerCase()} has been cancelled`,
      clientName: SAMPLE.clientName,
      occasion,
      scheduled: SAMPLE.when,
      session: studioVisit ? "Open Studio Visit" : studio ? "Studio Gathering" : build ? "In-Person Build Session" : consultation || prerequisite ? "In-Person Consultation" : tattooSpecial ? "Tattoo Special · Hand Sized Tattoo — Standard" : SAMPLE.session,
      policyText: studio
        ? "Per studio policy, deposits and payments are non-refundable. Cancellation is separate from the one-time reschedule option."
        : consultation || prerequisite || build
          ? "Per studio policy, reservation fees are non-refundable. One reschedule is allowed with at least 48 hours notice; a new reservation fee is required for reschedules made within 48 hours."
          : "Per studio policy, deposits and payments are non-refundable. Cancellation is separate from the one-time reschedule option.",
      rebookUrl: build
        ? "https://thesixwellconstruct.com/tattoos/build/in-person/?rebook=1"
        : consultation
          ? "https://thesixwellconstruct.com/tattoos/inquire/consultation/?rebook=1"
          : "",
      nextText: studio
        ? "Reply to this email if you would like help planning another date."
        : prerequisite
          ? "This consultation belongs to your reviewed tattoo project. Contact the studio to continue that project; do not start a separate public consultation."
        : "Contact the studio if you want to discuss a future project or appointment.",
      supportEmail: SAMPLE.supportEmail,
    });
  } else if (key === "appointment_reminder_24h") {
    const studioVisit = mode === "studio_visit";
    const legacy = mode === "studio";
    const studio = studioVisit || legacy || mode === "studio_space";
    const virtual = mode === "virtual";
    const build = mode === "build";
    const consultation = mode === "consultation";
    const tattooSpecial = mode === "tattoo_special";
    rendered = buildAppointmentReminderEmail({
      kind: studioVisit ? "studio_visit" : legacy ? "studio" : studio ? "studio_space" : virtual ? "consultation_virtual" : tattooSpecial ? "tattoo_special" : "tattoo",
      variant: mode || "tattoo",
      subject: studioVisit
        ? "Reminder: Your Open Studio Visit at the six.well construct is tomorrow"
        : studio
          ? "Reminder: Your studio booking with the six.well construct is tomorrow"
        : virtual
          ? "Reminder: Your consultation with art.pill TATTOO HOUSE is tomorrow"
          : build
            ? "Reminder: Your Build session with art.pill TATTOO HOUSE is tomorrow"
            : consultation
              ? "Reminder: Your consultation with art.pill TATTOO HOUSE is tomorrow"
          : tattooSpecial
            ? "Reminder: Your Tattoo Special appointment with art.pill TATTOO HOUSE is tomorrow"
            : "Reminder: Your tattoo appointment with art.pill TATTOO HOUSE is tomorrow",
      occasion: studioVisit ? "Open Studio Visit" : studio ? "studio booking" : build ? "Build session" : virtual || consultation ? "consultation" : tattooSpecial ? "Tattoo Special appointment" : "tattoo appointment",
      brand: studio ? "the six.well construct" : "art.pill TATTOO HOUSE",
      clientName: SAMPLE.clientName,
      when: SAMPLE.when,
      session: studioVisit ? "Open Studio Visit" : studio ? "Studio Gathering" : build ? "In-Person Build Session" : virtual ? "Virtual Consultation" : consultation ? "In-Person Consultation" : tattooSpecial ? "Tattoo Special · Hand Sized Tattoo — Standard" : SAMPLE.session,
      studioAddress: virtual ? "" : SAMPLE.studioAddress,
      zoomUrl: virtual ? SAMPLE.zoomUrl : "",
      calendarUrl: SAMPLE.calendarUrl,
      resources: studio || virtual ? [] : [
        { label: "Day-of instructions", href: SAMPLE.dayOfInstructionsUrl },
        { label: "Location & parking", href: SAMPLE.locationParkingUrl },
      ],
      notice: build || virtual || consultation || studio
        ? ""
        : "Your deposit goes toward the final tattoo cost. At the start of your appointment, after the final design, placement, and session price are confirmed, the remaining balance must be paid before tattooing begins. Personalized aftercare instructions will be provided at your appointment.",
    });
  } else if (key === "event_ticket_paid") {
    const freeRsvp = mode === "rsvp";
    rendered = buildEventTicketPaidEmail({
      variant: mode || "default",
      free: freeRsvp,
      subject: freeRsvp ? `RSVP confirmed - ${SAMPLE.eventTitle}` : `You're booked - ${SAMPLE.eventTitle}`,
      title: SAMPLE.eventTitle,
      clientName: SAMPLE.clientName,
      seats: "2",
      when: SAMPLE.eventWhen,
      where: SAMPLE.eventWhere,
      ticketUrl: SAMPLE.ticketUrl,
      calendarUrl: SAMPLE.eventCalendarUrl,
      eventUrl: "https://thesixwellconstruct.com/events/example/",
      preparationNote: freeRsvp ? "Review the event guide before attending. An RSVP does not reserve tattoo time." : "",
    });
  } else if (key === "event_ticket_cancelled") {
    rendered = buildEventTicketCancelledEmail({
      variant: mode || "refunded",
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
  } else if (key === "crm_relationship_followup") {
    rendered = buildCrmFollowupEmail({
      theme: mode === "tattoo" ? "tattoo" : "construct_studio",
      subject: "A note from the studio",
      preheader: "Following up after your recent visit.",
      body: "Hi Jordan,\n\nIt was good to see you at the studio. I wanted to follow up and see how everything is settling in.\n\nReply whenever you have a moment.",
    });
  } else if (key === "crm_communication_preferences") {
    rendered = buildCommunicationPreferencesEmail({
      url: "https://thesixwellconstruct.com/communication-preferences/?token=demo-secure-token",
    });
  } else if (key.startsWith("admin_") || key === "admin_test") {
    const event = mode === "construct_event" || key.includes("event");
    const art = mode === "construct_art";
    const tattoo = mode === "tattoo" || key.includes("submission") || key.includes("appointment");
    rendered = buildAdminNotificationEmail({
      templateKey: key,
      variant: mode || (art ? "construct_art" : event ? "construct_event" : tattoo ? "tattoo" : "construct_studio"),
      theme: art ? "construct_art" : event ? "construct_event" : tattoo ? "tattoo" : "construct_studio",
      subject: "Studio notification: sample record",
      headline: "A new record needs review.",
      lines: ["Reference: demo-record-014", "Name: Jordan Rivera", "Status: ready for review"],
      studioUrl: "https://thesixwellconstruct.com/studio/",
    });
  }

  if (!rendered) return null;
  const designed = designProfile ? renderClientEmail(rendered.semantic, designProfile) : rendered;
  return {
    templateKey: key,
    variant: mode,
    ...designed,
  };
}

export function emailTemplateDefinition(templateKey, variant = "") {
  const catalog = clientEmailPreviewCatalog();
  const entry = catalog.find((item) => item.templateKey === templateKey && item.variant === variant)
    || catalog.find((item) => item.templateKey === templateKey);
  if (!entry) return null;
  const rendered = renderClientEmailPreview(entry.templateKey, entry.variant);
  if (!rendered?.semantic) return null;
  const options = {
    omit: entry.omitEditable || [],
    removedTokens: entry.templateKey === "submission_received" ? ["review_line"] : [],
    blockedCopyPatterns: DEADLINE_FREE_TATTOO_EMAILS.has(entry.templateKey)
      ? CLIENT_PAYMENT_DEADLINE_PATTERNS
      : [],
  };
  return {
    ...entry,
    defaultContent: editableEmailContent(rendered.semantic, options),
    schema: emailContentSchema(rendered.semantic, options),
    rendered,
    options,
  };
}

export function renderEmailTemplateContent(templateKey, variant, content, designProfile = null) {
  const definition = emailTemplateDefinition(templateKey, variant);
  if (!definition) return null;
  const validation = validateEmailContent(definition.rendered.semantic, content, definition.options);
  if (!validation.ok) return { definition, validation, rendered: null };
  return {
    definition,
    validation,
    rendered: renderEmailContent(definition.rendered.semantic, validation.content, definition.options, designProfile),
  };
}
