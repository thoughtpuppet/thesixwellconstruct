function cents(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : 0;
}

export function reviewedTattooBudgetIsComplete(plan) {
  const minimum = cents(plan?.approved_budget_min_cents ?? plan?.approvedBudgetMinCents);
  const maximum = cents(plan?.approved_budget_max_cents ?? plan?.approvedBudgetMaxCents);
  const currency = plan?.approved_budget_currency || plan?.approvedBudgetCurrency || "USD";
  return minimum > 0 && maximum >= minimum && currency === "USD";
}

export function tattooPricingSummary(plan, appointment) {
  if (!reviewedTattooBudgetIsComplete(plan) || !appointment) return null;

  const laborMinimumCents = cents(plan.approved_budget_min_cents ?? plan.approvedBudgetMinCents);
  const laborMaximumCents = cents(plan.approved_budget_max_cents ?? plan.approvedBudgetMaxCents);
  const bookingTypeId = appointment.bookingTypeId || appointment.booking_type_id || "";
  const sessionFeeCents = bookingTypeId === "tattoo_extended"
    ? cents(appointment.sessionFeeCents ?? appointment.session_fee_cents)
    : 0;
  const depositCreditCents = cents(appointment.depositCents ?? appointment.deposit_cents);
  return {
    laborMinimumCents,
    laborMaximumCents,
    sessionFeeCents,
    combinedMinimumCents: laborMinimumCents + sessionFeeCents,
    combinedMaximumCents: laborMaximumCents + sessionFeeCents,
    depositCreditCents,
    remainingMinimumCents: Math.max(0, laborMinimumCents + sessionFeeCents - depositCreditCents),
    remainingMaximumCents: Math.max(0, laborMaximumCents + sessionFeeCents - depositCreditCents),
    currency: plan.approved_budget_currency || plan.approvedBudgetCurrency || appointment.currency || "USD",
  };
}
