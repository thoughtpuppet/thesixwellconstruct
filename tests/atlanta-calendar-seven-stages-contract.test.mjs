import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { extractSevenStagesPerformanceRuns } from "../functions/api/calendar/_lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOW_URL = "https://www.7stages.org/shows/a-meal/";
const SESSION = "11111111-2222-4333-8444-555555555555";
const EDIDS = ["718693", "718694", "718697", "718698"];

const showHtml = `
  <html><head>
    <meta property="og:title" content="A MEAL 9.17-19.2026 - 7 Stages Theatre">
  </head><body><main><p>A multi-sensorial live performance produced by LEIMAY.</p></main></body></html>`;

const ticketPageHtml = `
  <script>var SiteID = "B9597357-CCAD-4454-8DB1-9F5ABCCB3033"; var Page = "ListEvents";</script>`;

const loaderHtml = `
  <script>window.location.href = "https://plugin.vbotickets.com/plugin/events?s=${SESSION}";</script>`;

const eventsPageHtml = `<a href="https://plugin.vbotickets.com/Plugin/events?s=${SESSION}">Tickets</a>`;

const listingHtml = `
  <div id="EDID718698" class="EventListWrapper EID203736 EDID718698" data-event-name="A Meal">
    <img src="https://images.example/a-meal.jpg" class="PosterList" alt="A Meal production image">
    <div class="EventIntroText"><p>A multi-sensorial live performance produced by LEIMAY with the LEIMAY Ensemble and guests.</p></div>
    <span class="TextVenueName">7 Stages Mainstage</span>
    <span class="TextVenueAddress">1105 Euclid Avenue, Atlanta, GA 30307</span>
    <div class="TextEventDate">9/17/2026 - 9/19/2026</div>
    <a href="https://plugin.vbotickets.com/v5.0/event.asp?eid=203736&s=${SESSION}">Buy Tickets Now</a>
  </div>`;

const detailHtml = `
  <script>
    $.ajax({ url: "https://plugin.vbotickets.com/v5.0/controls/events.asp?a=load_eventdate_slider&eid=203736&edid=718693&tza=3&s=${SESSION}" });
  </script>`;

const sliderHtml = EDIDS.map((edid) => `<div role="tab" id="edid${edid}"></div>`).join("\n");

const schedule = {
  "718693": ["Thursday, September 17, 2026", "6:30 PM", "7:30 PM", "9:00 PM"],
  "718694": ["Friday, September 18, 2026", "6:30 PM", "7:30 PM", "9:00 PM"],
  "718697": ["Saturday, September 19, 2026", "1:00 PM", "2:00 PM", "3:30 PM"],
  "718698": ["Saturday, September 19, 2026", "6:30 PM", "7:30 PM", "9:00 PM"],
};

function ticketHtml(edid) {
  const [date, lobby, starts, ends] = schedule[edid];
  return `<main>${date} Lobby Open: ${lobby} Starts: ${starts} Ends: ${ends}
    General Admission Price Qty
    Pay it Forward 71.00 70.00 + 1.00 Fees
    Regular Price 36.00 35.00 + 1.00 Fees
    Accessible 26.00 25.00 + 1.00 Fees
    Buy Tickets Now</main>`;
}

function source() {
  return {
    id: "cal_source_seven_stages",
    name: "7 Stages Theatre",
    url: SHOW_URL,
    source_type: "official_html",
    trust_level: "official",
    adapter_key: "automatic",
    render_mode: "dynamic-fallback",
    adapter_config_json: "{}",
  };
}

function mockedFetch({ failEdid = "" } = {}) {
  return async (input) => {
    const url = String(input);
    if (url === "https://www.7stages.org/tickets/") return new Response(ticketPageHtml, { status:200 });
    if (url.includes("/plugin/loadplugin?")) return new Response(loaderHtml, { status:200 });
    if (url === `https://plugin.vbotickets.com/plugin/events?s=${SESSION}`) return new Response(eventsPageHtml, { status:200 });
    if (url.includes("/Plugin/events/showevents?")) return new Response(listingHtml, { status:200 });
    if (url.includes("/v5.0/event.asp?eid=203736")) return new Response(detailHtml, { status:200 });
    if (url.includes("load_eventdate_slider")) return new Response(sliderHtml, { status:200 });
    if (url.includes("/controls/tickets.asp?a=load_tickets")) {
      const edid = new URL(url).searchParams.get("edid");
      return new Response(`<script>url: "https://plugin.vbotickets.com/plugin/tickets?edid=${edid}&s=${SESSION}"</script>`, { status:200 });
    }
    if (url.includes("/plugin/tickets?")) {
      const edid = new URL(url).searchParams.get("edid");
      if (edid === failEdid) return new Response("unavailable", { status:503 });
      return new Response(ticketHtml(edid), { status:200 });
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
}

test("7 Stages adapter creates one A MEAL parent with all four independently ticketed performances", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockedFetch();
  try {
    const result = await extractSevenStagesPerformanceRuns(showHtml, source());
    assert.equal(result.diagnostics.completeness, "complete");
    assert.equal(result.proposals.length, 1);
    const event = result.proposals[0];
    assert.equal(event.sourceEventId, "seven-stages-vbo-203736");
    assert.equal(event.title, "A MEAL");
    assert.equal(event.organizer, "LEIMAY");
    assert.equal(event.eventStructure, "series");
    assert.equal(event.dateKind, "date_range");
    assert.equal(event.startsAt, "2026-09-17");
    assert.equal(event.endsAt, "2026-09-19");
    assert.equal(event.ticketStatus, "on_sale");
    assert.equal(event.occurrences.length, 4);
    assert.deepEqual(event.occurrences.map((occurrence) => occurrence.sourceEventId), EDIDS.map((edid) => `seven-stages-vbo-edid-${edid}`));
    assert.deepEqual(event.occurrences.map((occurrence) => occurrence.startsAt), [
      "2026-09-17T19:30:00-04:00",
      "2026-09-18T19:30:00-04:00",
      "2026-09-19T14:00:00-04:00",
      "2026-09-19T19:30:00-04:00",
    ]);
    assert.deepEqual(event.occurrences.map((occurrence) => occurrence.endsAt), [
      "2026-09-17T21:00:00-04:00",
      "2026-09-18T21:00:00-04:00",
      "2026-09-19T15:30:00-04:00",
      "2026-09-19T21:00:00-04:00",
    ]);
    assert.match(event.occurrences[2].title, /^A MEAL — Saturday 2:00 PM$/);
    assert.equal(event.occurrences[2].occurrenceType, "performance");
    assert.equal(event.occurrences[2].ticketStatus, "on_sale");
    assert.equal(event.occurrences[2].ticketUrl, "https://www.7stages.org/tickets/?eid=203736&edid=718697");
    assert.match(event.occurrences[0].ticketNotes, /regular \$35\.00 plus \$1\.00 fee/);
    assert.match(event.occurrences[0].ticketNotes, /accessible \$25\.00 plus \$1\.00 fee/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("7 Stages adapter refuses a partial performance run instead of proposing a destructive schedule", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockedFetch({ failEdid:"718697" });
  try {
    const result = await extractSevenStagesPerformanceRuns(showHtml, source());
    assert.equal(result.proposals.length, 0);
    assert.equal(result.diagnostics.completeness, "needs_verification");
    assert.match(result.diagnostics.missingChildren[0].error, /announced 4 ticketed showings, but only 3 complete schedule records were recovered/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio presents series as performance runs and defaults new performance occurrences correctly", () => {
  const studio = readFileSync(join(ROOT, "studio", "calendar", "calendar.js"), "utf8");
  assert.match(studio, /Series \/ performance run \/ separate dates/);
  assert.match(studio, /Showings \+ related schedule/);
  assert.match(studio, /Multiple showings on the same day stay separate/);
  assert.match(studio, /performance\?"performance":"other"/);
  assert.match(studio, /7 Stages \/ VBO performance runs/);
});
