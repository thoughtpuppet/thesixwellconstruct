import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarScoutHandoffEndpoint,
  normalizeCalendarScoutHandoff,
  sendCalendarScoutHandoff,
} from "../tools/calendar-scout-handoff.mjs";

const event = {
  title: "Experimental Memory Show",
  sourceUrl: "https://artist-led.example/events/experimental-memory-show",
  startsAt: "2026-09-18T19:00:00-04:00",
  endsAt: "2026-09-18T22:00:00-04:00",
  timezone: "America/New_York",
  verificationState: "verified",
  privateRationale: "A strong interdisciplinary match.",
};

test("scheduled Scout handoff validates evidence without changing public event facts", () => {
  const normalized = normalizeCalendarScoutHandoff({ detectedAt:"2026-08-25T12:00:00-04:00", events:[event] });
  assert.equal(normalized.events[0], event);
  assert.equal(normalized.model, "scheduled-atlanta-creative-scout");
  assert.throws(() => normalizeCalendarScoutHandoff({ events:[{ title:"No evidence" }] }), /verificationState must be/);
  assert.throws(
    () => normalizeCalendarScoutHandoff({ events:[{ title:"No verification state", sourceUrl:"https://artist-led.example/event" }] }),
    /verificationState must be/,
  );
  assert.throws(() => normalizeCalendarScoutHandoff({ events:[] }), /at least one strong event/);
  assert.throws(
    () => normalizeCalendarScoutHandoff({ events:[{ title:"Incomplete", sourceUrl:"https://artist-led.example/incomplete", verificationState:"needs_verification" }] }),
    /requires private verificationNotes/,
  );
  const incomplete = normalizeCalendarScoutHandoff({ events:[{
    title:"Announced Atlanta Exhibition",
    sourceUrl:"https://artist-led.example/announcements/atlanta-exhibition",
    startsAt:null,
    verificationState:"needs_verification",
    verificationNotes:"Confirm the opening date and venue address.",
  }] });
  assert.equal(incomplete.events[0].startsAt, null);
});

test("scheduled Scout handoff sends its scoped token only to the fixed Studio route", async () => {
  let request;
  const result = await sendCalendarScoutHandoff({ events:[event] }, {
    token:"scoped-test-token",
    fetchImpl:async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        runId:"cal_run_test", status:"completed", candidates:1, updates:0, unchanged:0,
        duplicates:0, suppressed:0, failures:0,
        strongPicks:[{
          candidateId:"cal_candidate_test", title:event.title, kind:"new", candidateStatus:"needs_verification",
          verificationState:"needs_verification", privateRationale:"must not echo",
        }],
      }), { status:200, headers:{ "content-type":"application/json" } });
    },
  });
  assert.equal(request.url, "https://thesixwellconstruct.com/api/admin/calendar/strong-picks");
  assert.equal(request.options.headers.authorization, "Bearer scoped-test-token");
  assert.deepEqual(JSON.parse(request.options.body).events, [event]);
  assert.deepEqual(result.strongPicks, [{
    candidateId:"cal_candidate_test", title:event.title, kind:"new", detectedAt:"",
    candidateStatus:"needs_verification", verificationState:"needs_verification",
  }]);
  assert.equal(JSON.stringify(result).includes("must not echo"), false);
});

test("scheduled Scout handoff refuses credential forwarding to another host or route", () => {
  assert.throws(() => calendarScoutHandoffEndpoint("https://example.com/api/admin/calendar/strong-picks"), /only to thesixwellconstruct/);
  assert.throws(() => calendarScoutHandoffEndpoint("http://thesixwellconstruct.com/api/admin/calendar/strong-picks"), /must use HTTPS/);
  assert.throws(() => calendarScoutHandoffEndpoint("https://thesixwellconstruct.com/api/admin/calendar/strong-picks?next=elsewhere"), /without query parameters/);
  assert.equal(calendarScoutHandoffEndpoint("http://127.0.0.1:8787/api/admin/calendar/strong-picks"), "http://127.0.0.1:8787/api/admin/calendar/strong-picks");
});

test("scheduled Scout handoff reports Studio errors without exposing its token", async () => {
  await assert.rejects(
    sendCalendarScoutHandoff({ events:[event] }, {
      token:"never-print-this-token",
      fetchImpl:async () => new Response(JSON.stringify({ error:"Candidate validation failed." }), { status:422 }),
    }),
    (error) => {
      assert.match(error.message, /Candidate validation failed/);
      assert.doesNotMatch(error.message, /never-print-this-token/);
      return true;
    },
  );
});
