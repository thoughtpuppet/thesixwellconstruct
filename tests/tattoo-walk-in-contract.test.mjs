import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => readFileSync(join(ROOT, ...relativePath.split("/")), "utf8");

const publicTattooEntryPages = [
  "tattoos/index.html",
  "tattoos/inquire/index.html",
  "tattoos/inquire/consultation/index.html",
  "tattoos/build/in-person/index.html",
  "booking/index.html",
];

test("public tattoo entry pages do not promise walk-in availability", () => {
  for (const relativePath of publicTattooEntryPages) {
    const source = read(relativePath);
    assert.doesNotMatch(
      source,
      /walk[- ]?ins?|walkIn(?:Cards|Guidance|Section|Windows)|walk-in-windows/i,
      relativePath,
    );
  }
});

test("tattoo inquiry and booking paths remain connected", () => {
  const landing = read("tattoos/index.html");
  assert.match(landing, /href="\/tattoos\/inquire\/"[^>]*>Book an appointment<\/a>/);

  const chooser = read("tattoos/inquire/index.html");
  for (const href of [
    "/tattoos/flash/",
    "/tattoos/inquire/custom/",
    "/tattoos/build/",
    "/tattoos/special-projects/",
    "/tattoos/inquire/consultation/?type=consult_in_person",
    "/tattoos/inquire/consultation/?type=consult_virtual",
  ]) {
    assert.match(chooser, new RegExp(`href="${href.replace(/[?]/g, "\\?")}"`), href);
  }

  const consultation = read("tattoos/inquire/consultation/index.html");
  assert.match(consultation, /initBookingCalendar\(\{/);
  assert.match(consultation, /apiBookingTypeIds:\s*CONSULTATION_TYPE_IDS/);

  const build = read("tattoos/build/in-person/index.html");
  assert.match(build, /contextUrl:\s*"\/api\/booking\/public-session\/context"/);
  assert.match(build, /checkoutUrl:\s*"\/api\/booking\/public-session\/checkout"/);

  const booking = read("booking/index.html");
  assert.match(booking, /id="appointmentSelection"/);
  assert.match(booking, /id="checkoutBtn"/);
});

test("inquiry guide precedes the unchanged project choices and consultation", () => {
  const chooser = read("tattoos/inquire/index.html");
  const hero = read("css/hero.css");
  const guide = chooser.indexOf('id="before-booking"');
  const project = chooser.indexOf('id="project-lane-title"');
  const consultation = chooser.indexOf('id="consult-options-title"');
  assert.ok(guide >= 0 && guide < project && project < consultation);
  assert.match(chooser, /class="intro-body hero-descriptor hero-descriptor--wide" data-copy-id="inquire-chooser-intro"/);
  assert.match(hero, /\.site-hero \.hero-descriptor\.hero-descriptor--wide \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100% !important;/);
  assert.match(chooser, /01 \/ Start here[\s\S]*What You Should Know Before Booking/);
  assert.match(chooser, /02 \/ Submit a project[\s\S]*Submit a Project/);
  assert.match(chooser, /03 \/ Paid planning[\s\S]*Book a Consultation/);
  assert.match(chooser, /<section class="lane consultation-lane" aria-labelledby="consult-options-title">/);
  assert.match(chooser, /\.consultation-lane \{ grid-template-columns:minmax\(390px,0\.38fr\) minmax\(0,1fr\); \}/);
  assert.equal((chooser.match(/<details class="guide-item"/g) || []).length, 13);
  assert.equal((chooser.match(/<details class="guide-item" name="before-booking"/g) || []).length, 13);
  assert.equal((chooser.match(/data-collapsible-lane>/g) || []).length, 1);
  assert.equal((chooser.match(/class="lane-toggle"[^>]*aria-expanded="false"/g) || []).length, 1);
  assert.equal((chooser.match(/class="lane-title-toggle"[^>]*aria-expanded="false"/g) || []).length, 1);
  assert.equal((chooser.match(/class="guide-list lane-content"[^>]*hidden/g) || []).length, 1);
  assert.doesNotMatch(chooser, /class="(?:path-grid|consult-options) lane-content"/);
  assert.match(chooser, /function setLaneOpen\(lane, open\)[\s\S]*?content\.hidden = !open[\s\S]*?setLaneOpen\(lane, false\)/);
  assert.match(chooser, /function openLaneForHash\(\)[\s\S]*?setLaneOpen\(lane, true\)[\s\S]*?target\.tagName === "DETAILS"/);
  assert.match(chooser, /\.lane-toggle \{ position:absolute; top:4px; right:4px;/);
  assert.match(chooser, /\.lane\.is-collapsed \.lane-toggle \{ top:auto; bottom:4px; \}/);
  assert.match(chooser, /\.lane\[data-collapsible-lane\]:hover,\.lane\[data-collapsible-lane\]:focus-within \{ background:var\(--cell-hover\); \}/);
  assert.match(chooser, /\[toggle, titleToggle\]\.forEach/);
  assert.match(chooser, /\.lane:not\(\.is-collapsed\) > \.lane-content \{ margin-top:58px; \}/);
  assert.match(chooser, /\.lane\.is-collapsed \.lane-intro \{ max-width:none; \}/);
  assert.match(chooser, /<summary>What Happens During Each Session<\/summary>[\s\S]*?approve the design and stencil placement[\s\S]*?payment is taken at the start of each day[\s\S]*?If you need a break, tell me and we'll pause[\s\S]*?review what was completed/);
  assert.match(chooser, /<summary>How I Build Structure, Layers, and Depth<\/summary>[\s\S]*?establish the overall structure and middle values first[\s\S]*?darker shadows and contrast[\s\S]*?brighter highlights, details, and refinement[\s\S]*?back-to-back days[\s\S]*?healing time between visits/);
  assert.match(chooser, /<summary>Estimated Session Lengths &amp; Needs<\/summary>[\s\S]*?you choose how long each session will be[\s\S]*?Shorter sessions usually divide the work across more appointments[\s\S]*?chosen session length[\s\S]*?built in layers or section by section[\s\S]*?confirmed after review/);
  assert.match(chooser, /<summary>Rates, budgets, and deposits<\/summary>[\s\S]*?Tattooing rates[\s\S]*?not an approved quote[\s\S]*?Deposits depend on the session length and range from \$50 to \$300/);
  assert.match(chooser, /<summary>If you are traveling to Atlanta<\/summary>[\s\S]*?how many appointment days you can make in one trip[\s\S]*?returning after healing[\s\S]*?before buying non-refundable travel/);
  assert.ok(chooser.indexOf("<summary>What Happens During Each Session</summary>") < chooser.indexOf("<summary>Preparing for your appointment</summary>"));
  assert.match(chooser, /<summary>Terms &amp; Conditions<\/summary>/);
  assert.match(chooser, /Choose the request that already matches your idea\. Submissions enter review before any tattoo appointment is offered\./);
  assert.match(chooser, /Browse available work, open the design you want, and send its attached claim form\./);
  assert.match(chooser, /Submit an original concept, story, placement, references, and timing for review\./);
  assert.match(chooser, /Choose symbols and marks from the Legend to create a guided brief for me to use to create your design\./);
  assert.match(chooser, /participate in an open concept-led, long-form, collaborative, or experimental call\./);
});

test("Tattoo index changes only its collaboration actions into 5px outlines", () => {
  const landing = read("tattoos/index.html");
  assert.match(landing, /\.ledger-action \{[\s\S]*?border:5px solid var\(--ring-soft\); padding:10px 14px;/);
  assert.equal((landing.match(/class="ledger-action"/g) || []).length, 4);
});

test("inquiry project and consultation actions use the outlined Tattoo treatment", () => {
  const chooser = read("tattoos/inquire/index.html");
  assert.equal((chooser.match(/class="path-action"/g) || []).length, 4);
  assert.equal((chooser.match(/class="path-action" id="specialProjectAction"/g) || []).length, 1);
  assert.equal((chooser.match(/class="consult-option-action"/g) || []).length, 2);
  assert.match(chooser, /--cell-hover:#1d1813/);
  assert.match(chooser, /\.path-card:hover,\.path-card:focus-visible \{ background:var\(--cell-hover\); outline:5px solid var\(--cell-hover\); outline-offset:-5px; \}/);
  assert.match(chooser, /\.consult-option:hover,\.consult-option:focus-visible \{ background:var\(--cell-hover\); outline:5px solid var\(--cell-hover\); outline-offset:-5px; \}/);
  assert.match(chooser, /\.path-action,\.consult-option-action \{[^}]*border:5px solid var\(--ring-soft\)/);
  assert.match(chooser, /\.path-card:hover \.path-action,\.path-card:focus-visible \.path-action,\.consult-option:hover \.consult-option-action,\.consult-option:focus-visible \.consult-option-action \{ border-color:var\(--signal\)/);
});

test("Custom, Flash, and active Special application share the new planning fields", () => {
  for (const relativePath of [
    "tattoos/inquire/custom/index.html",
    "tattoos/flash/claim/index.html",
    "tattoos/special-projects/index.html",
  ]) {
    const source = read(relativePath);
    assert.match(source, /id="specialProjectForm" data-tattoo-project-planning|id="flashClaimForm" data-tattoo-project-planning|id="inquiryForm" data-tattoo-project-planning/, relativePath);
    for (const name of ["inquiry_flow_version", "previous_client", "traveling_to_atlanta", "body_area_coverage", "multi_session_preference", "can_return_for_healed_visit", "days_per_trip", "policies_read"]) {
      assert.match(source, new RegExp(`name="${name}"`), `${relativePath}: ${name}`);
    }
    assert.match(source, /Separate visits with healing time in between/, relativePath);
    assert.match(source, /How many appointment days could you tolerate in one trip\?/, relativePath);
    assert.doesNotMatch(source, /How many appointment days could you make in one trip\?/, relativePath);
    assert.doesNotMatch(source, /¾ (?:arm|leg) sleeve/, relativePath);
  }

  const custom = read("tattoos/inquire/custom/index.html");
  assert.ok(custom.indexOf("About you</h2>") < custom.indexOf("What kind of tattoo do you want?</h2>"));
  assert.ok(custom.indexOf("What do you want tattooed?</h2>") < custom.indexOf('id="referencesField"'));
  assert.ok(custom.indexOf('id="referencesField"') < custom.indexOf("Where do you want the tattoo?</h2>"));
  assert.ok(custom.indexOf("Where do you want the tattoo?</h2>") < custom.indexOf('id="placementPhotosField"'));
  assert.ok(custom.indexOf("Where do you want the tattoo?</h2>") < custom.indexOf("What details are important to you?</h2>"));
  assert.ok(custom.indexOf("What details are important to you?</h2>") < custom.indexOf("When can you come in, and what is your budget?</h2>"));
  assert.match(custom, /<summary>Timing and review<\/summary>/);
  assert.match(custom, /<summary>Flash, Build, Special, or paid planning<\/summary>/);
  assert.match(custom, /id="previewAnswersButton"/);
  assert.match(custom, /id="answerReviewList"/);
  assert.match(custom, /id="reviewSubmitRow" hidden/);
  assert.match(custom, /href="\/css\/tattoo-custom-inquiry\.css"/);
  assert.doesNotMatch(custom, /value="one_appointment_only"/);
  assert.match(custom, /name="days_per_trip"/);
  assert.match(custom, /name="travel_origin"/);
  assert.doesNotMatch(custom, /name="(?:size_placement_flexibility|open_to_larger_footprint|open_to_multiple_sessions)"/);
  const prototype = read("tools/tattooing-prototype/custom.html");
  assert.doesNotMatch(prototype, /Can the size or placement change\?|Open to a larger tattoo\?/);
  const planning = read("js/tattoo-project-planning.js");
  assert.match(planning, /largeScale \|\| size\.value === "xl" \|\| largeCoverUp/);
  assert.match(planning, /firstPreference\.required = largeCoverUp/);
  assert.match(planning, /backToBackLabel\.textContent = traveling \? "Back-to-back days in one trip" : "Back-to-back days"/);
  const prototypePlanning = read("tools/tattooing-prototype/prototype.js");
  assert.match(prototypePlanning, /How many appointment days could you tolerate in one trip\?/);
  assert.match(prototypePlanning, /backToBackChoice\.value = traveling \? "Back-to-back days in one trip" : "Back-to-back days"/);
  assert.match(read("studio/submissions/index.html"), /planningPreference\(p\("multi_session_preference"\), p\("traveling_to_atlanta"\)\)/);
  const customStyle = read("css/tattoo-custom-inquiry.css");
  assert.match(customStyle, /border-top: 5px solid rgba\(109, 61, 21, 0\.42\)/);
  assert.match(customStyle, /--form-control-accent: var\(--color-tattooing-bright\)/);
  assert.match(customStyle, /\.radio-option:hover,[\s\S]*border-color: var\(--color-tattooing-bright\)/);
});

test("Flash and artist-led Special requests implement the prototype review flow with shared form design", () => {
  const css = read("css/tattoo-request-form.css");
  const review = read("js/tattoo-request-review.js");
  assert.match(css, /--form-control-accent: var\(--color-tattooing-bright\)/);
  assert.match(css, /\.request-review-card/);
  assert.match(review, /form\.reportValidity\(\)/);
  assert.match(review, /submit\.hidden = true/);
  for (const path of ["tattoos/inquire/custom/index.html", "tattoos/flash/claim/index.html", "tattoos/special-projects/index.html", "tattoos/build/index.html"]) {
    const source = read(path);
    assert.match(source, /href="\/css\/tattoo-request-form\.css"/);
    assert.match(source, /tattoo-form-treatment/);
  }
  const flash = read("tattoos/flash/claim/index.html");
  assert.match(flash, /id="flashClaimForm"[^>]*data-tattoo-request-review/);
  assert.ok(flash.indexOf("About you</h3>") < flash.indexOf("Which flash design?</h3>"));
  assert.ok(flash.indexOf("Which flash design?</h3>") < flash.indexOf("When can you come in?</h3>"));
  assert.match(flash, /data-request-preview/);
  assert.match(flash, /data-request-submit hidden/);
  const special = read("tattoos/special-projects/index.html");
  assert.match(special, /id="artist-led"/);
  assert.match(special, /id="artistLedForm"[^>]*data-tattoo-request-review/);
  for (const type of ["floral", "narrative", "figurative", "anime"]) {
    assert.match(special, new RegExp(`name="artist_led_type" value="${type}"`));
  }
  assert.ok(special.indexOf('id="project-calls"') < special.indexOf('id="artist-led"'));
  assert.match(special, /name="artist_led_trust_ack"/);
  assert.match(special, /name="artist_led_deposit_ack"/);
  assert.match(special, /data-request-submit hidden/);
  assert.match(read("tattoos/submission-received/index.html"), /"artist-led": \{/);
});

test("all live Preview answers buttons use the Special Projects filter treatment", () => {
  const custom = read("tattoos/inquire/custom/index.html");
  const flash = read("tattoos/flash/claim/index.html");
  const special = read("tattoos/special-projects/index.html");
  const requestStyles = read("css/tattoo-request-form.css");

  assert.match(custom, /<button class="tattoo-preview-button" type="button" id="previewAnswersButton">Preview answers/);
  assert.match(flash, /<button class="tattoo-preview-button" type="button" data-request-preview>Preview answers/);
  assert.match(special, /<button class="tattoo-preview-button" type="button" data-request-preview>Preview answers/);
  assert.match(requestStyles, /\.public-form \.tattoo-preview-button \{/);
  assert.match(requestStyles, /border: 5px solid var\(--signal\);/);
});
