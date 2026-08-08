(function attachStudioRequestBadgeState(global) {
  const BOOKING_WORKFLOW_TYPES = new Set([
    "tattoo_inquiry",
    "flash_claim",
    "build_brief",
    "build_your_own",
    "byo",
    "maze_design",
    "special_project",
    "tattoo_special",
  ]);

  function badge(label, tone) {
    return { label, tone };
  }

  function resolve(submission = {}) {
    const status = String(submission.status || "").toLowerCase();
    const stage = String(submission.tattooStage || submission.tattoo_stage || "").toLowerCase();
    const payment = String(submission.depositPaymentStatus || "none").toLowerCase();
    const notification = String(submission.clientNotificationStatus || "unsent").toLowerCase();
    const linkNotification = String(submission.clientLinkNotificationStatus || "unsent").toLowerCase();
    const activeAccess = submission.clientAccessStatus === "active" && Boolean(submission.bookingUrl);
    const directInviteWaiting = submission.payload?.direct_booking_invite === "yes" && !submission.contactName;
    const consultRequired = submission.payload?.consult_required === "yes";

    if (payment === "paid_attention") return badge("PAYMENT NEEDS REVIEW", "error");
    if (notification === "failed") return badge("EMAIL FAILED", "error");
    if (["declined", "cancelled", "archived"].includes(status)) return badge(status.toUpperCase(), "terminal");
    if (status === "booked" || stage === "tattoo_scheduled") return badge("BOOKED", "booked");
    if (payment === "paid") return badge("DEPOSIT PAID", "success");
    if (payment === "pending") return badge("AWAITING DEPOSIT", "waiting");
    if (stage === "consultation_scheduled") return badge("CONSULTATION SCHEDULED", "success");
    if (stage === "consultation_required" || (consultRequired && !["consultation_complete", "ready_to_book", "tattoo_scheduled", "closed"].includes(stage))) {
      return badge("SCHEDULE CONSULTATION", "action");
    }
    if (stage === "consultation_complete") return badge("COMPLETE SESSION PLAN", "action");
    if (directInviteWaiting) return badge("AWAITING CLIENT", "waiting");
    if (activeAccess && linkNotification === "sent") return badge("AWAITING CLIENT", "waiting");
    if (activeAccess) return badge("SEND BOOKING LINK", "action");
    if (status === "approved" && BOOKING_WORKFLOW_TYPES.has(submission.type)) return badge("CREATE BOOKING LINK", "action");
    if (status === "reviewing") return badge("IN REVIEW", "review");
    if (status === "new" && submission.openedAt) return badge("NEEDS REVIEW", "needs-review");
    if (status === "new") return badge("NEW", "new");
    return null;
  }

  global.StudioRequestBadgeState = Object.freeze({ resolve });
})(typeof window === "undefined" ? globalThis : window);
