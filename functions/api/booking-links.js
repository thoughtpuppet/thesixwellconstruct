const BOOKING_TOKEN_BYTES = 9;
export const BOOKING_TOKEN_LENGTH = 12;

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createBookingRawToken() {
  const bytes = new Uint8Array(BOOKING_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function shortBookingTokenFromPath(pathname) {
  const match = String(pathname || "").match(/^\/b\/([A-Za-z0-9_-]{12})\/?$/);
  return match?.[1] || "";
}

export function bookingTokenFromUrl(value) {
  try {
    const url = new URL(String(value || ""), "https://booking.invalid");
    return url.searchParams.get("token") || shortBookingTokenFromPath(url.pathname);
  } catch {
    return "";
  }
}

export function bookingPathForToken(rawToken) {
  if (!new RegExp(`^[A-Za-z0-9_-]{${BOOKING_TOKEN_LENGTH}}$`).test(rawToken)) {
    throw new TypeError("Booking token must be a 12-character Base64URL value.");
  }
  return `/b/${rawToken}`;
}

export function bookingUrlForToken(baseUrl, rawToken) {
  return new URL(bookingPathForToken(rawToken), baseUrl);
}
