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

test("single-session booking collapses availability around the selected window", () => {
  const bookingPage = readFileSync("booking/index.html", "utf8");
  const calendarCss = readFileSync("css/booking-calendar.css", "utf8");

  assert.match(bookingPage, /id="changeWindowBtn"[^>]*>Change date\/time<\/button>/);
  assert.match(calendarCss, /\.change-window-button\{[^}]*border:5px solid var\(--ring-soft\)[^}]*color:var\(--calendar-text\)/);
  assert.match(bookingPage, /return Boolean\(selectedWindow\) && !multiSessionEnabled\(\) && !windowSelectionExpanded/);
  assert.match(bookingPage, /windowToolsEl\.classList\.toggle\("hidden", !monthKeys\.length \|\| windowSelectionCollapsed\)/);
  assert.match(bookingPage, /if \(windowSelectionCollapsed\) calendarEl\.classList\.add\("hidden"\)/);
  assert.match(bookingPage, /if \(windowSelectionCollapsed\) \{\s*windowListEl\.innerHTML = renderWindowButton\(selectedWindow\)/);
  assert.match(bookingPage, /changeWindowBtn\.classList\.toggle\("hidden", !windowSelectionCollapsed\)/);
  assert.match(bookingPage, /appEl\.classList\.toggle\("window-selection-collapsed", windowSelectionCollapsed\)/);
  assert.match(bookingPage, /\.booking-grid\.window-selection-collapsed #totalDueRow \{ order:-3; \}/);
  assert.match(bookingPage, /\.booking-grid\.window-selection-collapsed #checkoutBtn \{ order:-2; margin-top:12px; \}/);
  assert.match(bookingPage, /if \(!multiSessionEnabled\(\)\) requestAnimationFrame\(\(\) => windowListEl\.scrollIntoView\(\{ block: "start" \}\)\)/);
  assert.match(calendarCss, /\.window-list\{scroll-margin-top:120px;\}/);
  assert.match(bookingPage, /changeWindowBtn\.addEventListener\("click", \(\) => \{\s*windowSelectionExpanded = true/);
});

test("private booking offers clearly labeled responsive scheduling paths", () => {
  const bookingPage = readFileSync("booking/index.html", "utf8");
  const calendarCss = readFileSync("css/booking-calendar.css", "utf8");

  assert.match(bookingPage, /id="specificTimeHeading"[^>]*>Choose a specific day &amp; time<\/p>/);
  assert.match(bookingPage, /id="nextAvailableHeading"[^>]*>Choose next available slot<\/p>/);
  assert.match(bookingPage, /specificTimeHeadingEl\.classList\.toggle\("hidden", !monthKeys\.length \|\| windowSelectionCollapsed\)/);
  assert.match(bookingPage, /nextAvailableHeadingEl\.classList\.toggle\("hidden", windowSelectionCollapsed \|\| !visibleWindows\.length \|\| Boolean\(selectedMonthKey\)\)/);
  assert.match(calendarCss, /\.cal-month-nav\{width:100%;display:grid;grid-template-columns:var\(--calendar-control-height\) minmax\(0,1fr\) var\(--calendar-control-height\);\}/);
  assert.match(calendarCss, /\.cal-wrap \.cal-month-nav > \.custom-select\{width:100%;max-width:none;min-width:0;\}/);
  assert.match(calendarCss, /font-size:clamp\(10px,3\.4vw,14px\)/);
});
