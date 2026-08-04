import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker from "../_worker.js";
import {
  BOOKING_TOKEN_LENGTH,
  bookingPathForToken,
  bookingTokenFromUrl,
  createBookingRawToken,
  shortBookingTokenFromPath,
} from "../functions/api/booking-links.js";

test("new private booking tokens are 12-character Base64URL values", () => {
  for (let index = 0; index < 50; index += 1) {
    const token = createBookingRawToken();
    assert.equal(token.length, BOOKING_TOKEN_LENGTH);
    assert.match(token, /^[A-Za-z0-9_-]{12}$/);
    assert.equal(shortBookingTokenFromPath(bookingPathForToken(token)), token);
  }
});

test("booking token parsing supports short and legacy client links", () => {
  assert.equal(bookingTokenFromUrl("/b/Ab3dE7xQ9wK2"), "Ab3dE7xQ9wK2");
  assert.equal(bookingTokenFromUrl("https://example.test/b/Ab3dE7xQ9wK2/"), "Ab3dE7xQ9wK2");
  assert.equal(bookingTokenFromUrl("/booking/?token=existing-token"), "existing-token");
  assert.equal(bookingTokenFromUrl("/b/not-short"), "");
});

test("the Worker serves the established private booking page at a short link", async () => {
  let assetUrl = "";
  const env = {
    ASSETS: {
      async fetch(request) {
        assetUrl = request.url;
        return new Response("<!doctype html><title>Private Booking</title>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  };

  const response = await worker.fetch(new Request("https://example.test/b/Ab3dE7xQ9wK2"), env);
  assert.equal(response.status, 200);
  assert.equal(new URL(assetUrl).pathname, "/booking/index.html");
});

test("private booking wayfinding never renders the token as its breadcrumb", () => {
  const bookingPage = readFileSync("booking/index.html", "utf8");
  const wayfinding = readFileSync("js/construct-wayfinding.js", "utf8");
  assert.match(bookingPage, /data-construct-breadcrumb-current="Private Booking"/);
  assert.match(wayfinding, /data-construct-breadcrumb-current/);
});
