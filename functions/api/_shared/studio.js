export function studioAddress(env = {}) {
  // STUDIO_CALENDAR_LOCATION is retained only as a transition path for older deployments.
  return String(env.STUDIO_ADDRESS || env.STUDIO_CALENDAR_LOCATION || "").trim();
}
