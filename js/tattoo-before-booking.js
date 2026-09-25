(function () {
  "use strict";

  var items = [
    {
      title: "How requests are reviewed",
      body: '<p>I review the idea, placement, size, timing, budget, and whether it fits my style or if I can translate it into my style. I work best with full artistic freedom over the composition and orientation. Be as detailed as possible to make this process as smooth as possible; vagueness will delay the process or even lead to complete rejection of your project. A submission does not guarantee approval or an appointment. You will be notified by email if a project has been rejected.</p><p>Flash, Custom, Build, and Special Projects have different starting points. If your project needs more discussion, I may ask for more context or recommend a consultation before a date is offered. Or I might recommend another artist that would best fit your needs.<br><br>If you need one-on-one planning time, you can book a consultation on the <a href="/tattoos/inquire/">inquiry page</a>.</p>'
    },
    {
      title: "Your idea and my interpretation",
      body: '<p>You bring the subject, meaning, placement, idea, and any details that you want to stay. I shape the composition, scale, style, orientation, and how the design works on your body.</p><p>I do not copy another artist\'s work or repeat a previous custom piece. However, I am open to recreating a previous custom piece or interpreting a reference in my own style. Tell me what matters most and I\'ll try to accomadate while maintaining my own artistic intergrity. If you need an exact image reproduced, I may not be the right artist for you. If you want a specific style that another artist is known for, try contacting them for your project.</p>'
    },
    {
      title: "References and designs you bring",
      body: '<p>References can show a mood, story, subject, or visual detail you like. You can also point to a tattoo, tattoo design, or symbols from my work on the form you fill out. A reference is a starting point, not a promise to trace it.</p><p>If you made your own drawing or used a digital or AI image to explore the idea, send it with a note about what you like in it. I may need to change it for placement, contrast, existing work, and how it will age. Build Your Own creates a brief for review; selected marks may be adapted in the final composition.</p>'
    },
    {
      title: "When you see the design",
      body: '<p>After a project is approved and booked, I prepare the references and composition. Your design is normally shown at the tattoo appointment. An earlier design review requires a separately requested, approved, and paid consultation.</p><p>The tattoo deposit includes one developed design direction. Minor refinements and redraws I initiate are included. If I approve a substantially different alternate concept you request, the current policy requires a separate non-refundable drawing fee before that work begins. See the <a href="/tattoos/policies/">Studio &amp; Booking Policies</a> for the amount and full conditions.</p>'
    },
    {
      title: "Placement and body photographs",
      body: '<p>Send a clear, real photograph of the actual area you want tattooed so I can see its shape, available space, skin tone and nearby tattoos. For cover-ups or reworks, include clear photos of the existing tattoo. Do not use internet or AI generated photos.</p>'
    },
    {
      title: "Rates, budgets, and deposits",
      body: '<p>The <a href="/tattoos/#project-fit">Tattooing rates</a> show current starting rates by path. Your inquiry budget tells me what you are comfortable spending; it is not an approved quote. If your project is accepted, I will present a reviewed scope, session plan, and cost before private scheduling. I do try to work with everyone\'s budget as much as I can.</p><p>Booking requires a deposit. Tattoo deposits are non-refundable and credited toward the tattoo. Deposits depend on the session length and range from $50 to $300. You will review the appointment length and exact deposit in your private booking plan; payment and rescheduling rules are in the <a href="/tattoos/policies/">Studio &amp; Booking Policies</a>.</p>'
    },
    {
      title: "How I Build Structure, Layers, and Depth",
      body: '<p>For larger work, I plan the whole composition around your body before deciding how each appointment should be used. My process is similar to building a painting: I usually establish the overall structure and middle values first, then develop the darker shadows and contrast, followed by brighter highlights, details, and refinement.</p><p>That order can change when the tattoo, placement, skin, or schedule calls for it. I may build the full composition in layers or bring one section further along at a time. If appointments are on back-to-back days, each day is planned around fresh areas so I am not repeatedly working over skin that has not healed. When there is healing time between visits, later sessions can deepen, balance, and refine the work after I see how it has settled.</p>'
    },
    {
      title: "How sessions are planned",
      body: '<p>For larger work, we may complete sections across back-to-back days on one trip, or make separate visits with healing time in between for further depth and refinement. The first approach does not guarantee a whole sleeve in one trip; the second is not required for every project. Your travel limits help shape the plan, which you review before booking.</p>'
    },
    {
      title: "Estimated Session Lengths & Needs",
      body: '<p>During the planning phase, you choose how long each session will be from the session lengths available for your project. Shorter sessions usually divide the work across more appointments, while longer sessions may reduce the number of visits. That choice does not change the total amount of work the tattoo requires.</p><p>I use your chosen session length, the size and placement, level of detail, travel plans, and whether the work should be built in layers or section by section to propose the appointment count. Your skin response, comfort, breaks, and the amount we can complete safely can still affect the pace. The final session plan and cost are confirmed after review, before dates are booked.</p>'
    },
    {
      title: "If you are traveling to Atlanta",
      body: '<p>Tell me whether you are traveling, how many appointment days you can make in one trip, and whether returning after healing is possible. If more than one appointment is needed, you can state a preference for back-to-back days or separate visits with healing time in between. These are preferences for planning, not guaranteed schedules.</p><p>Please wait for project approval, an agreed session plan, and confirmed appointments before buying non-refundable travel.</p>'
    },
    {
      title: "What Happens During Each Session",
      body: '<p>At the first appointment, I\'ll show you the prepared design and talk through how I plan to execute the entire project, including what we\'ll work on that day and how later appointments or return trips may fit together if needed. We\'ll check the size and placement, then I\'ll apply the stencil.</p><p>Once you approve the design and stencil placement, we\'ll confirm that day\'s session price and take payment before tattooing begins. For a project with multiple appointment days, payment is taken at the start of each day, not for the whole project upfront.</p><p>During tattooing, I work without planned breaks. If you need a break, tell me and we\'ll pause. At the end of each day, we\'ll review what was completed, go over aftercare, and discuss the next session if one is needed.</p>'
    },
    {
      title: "Preparing for your appointment",
      body: '<p>You must be at least 18 and bring a valid ID. Eat a meal within four hours <strong>before</strong> your appointment, drink water, and arrive rested. Wear clothing that gives easy access to the area being tattooed. Before your visit, review <a href="/tattoos/day-of/">day-of preparation</a>, <a href="/tattoos/location-parking/">location and parking</a>, and <a href="/tattoos/aftercare/">aftercare</a>.</p><p>Timing, late arrival, rescheduling, and health requirements are covered in the full <a href="/tattoos/policies/">Studio &amp; Booking Policies</a>.</p>'
    },
    {
      title: "Terms & Conditions",
      body: '<p>This is a plain-language introduction to the <a href="/tattoos/policies/">full Studio &amp; Booking Policies</a>. Read that page before booking; it governs if a summary here leaves out a detail. An inquiry is a request for review, not an appointment or a deposit charge.</p><ul><li><strong>Age and ID:</strong> You must be at least 18 and bring valid ID.</li><li><strong>Design:</strong> I do not offer exact copies. The design is normally shown at your appointment unless an earlier consultation is requested, approved, and paid for.</li><li><strong>Changes:</strong> One developed direction is included with a paid tattoo deposit. Minor refinements and artist-initiated redraws are included; an approved alternate concept has a separate non-refundable drawing fee. Major last-minute changes can require a new appointment and deposit.</li><li><strong>Deposit and timing:</strong> Tattoo deposits are non-refundable and credited toward the final cost. One reschedule is allowed with at least 48 hours\' notice. Late arrival and no-shows have separate consequences in the full policy.</li><li><strong>Payment and safety:</strong> The remaining balance is paid before tattooing begins, after the final design, placement, and session price are confirmed. Digital payments carry a processing fee. Arriving under the influence or with an active illness or skin concern near the tattoo area can prevent the session.</li></ul><p>Review the full policy for exact fees, grace periods, guest guidance, payment methods, and all other conditions.</p>'
    }
  ];

  function render(host, index) {
    if (!host.hasAttribute("data-live-edit-owner")) {
      host.setAttribute("data-live-edit-owner", "preview");
      host.setAttribute("data-live-edit-label", "Shared tattoo before-booking guide");
    }
    var baseId = host.id || "tattoo-before-booking-" + (index + 1);
    var contentId = baseId + "-content";
    var headingId = baseId + "-title";
    var groupName = baseId + "-subjects";

    host.innerHTML = '<section class="tattoo-before-booking is-collapsed" aria-labelledby="' + headingId + '">' +
      '<div class="tattoo-before-booking__head">' +
        '<p class="tattoo-before-booking__index">01 / Start here</p>' +
        '<h2 class="tattoo-before-booking__title" id="' + headingId + '"><button class="tattoo-before-booking__title-button" type="button" aria-expanded="false" aria-controls="' + contentId + '">What You Should Know Before Booking</button></h2>' +
        '<button class="tattoo-before-booking__toggle" type="button" aria-label="Expand What You Should Know Before Booking" aria-expanded="false" aria-controls="' + contentId + '"><span class="tattoo-before-booking__toggle-mark" aria-hidden="true">+</span></button>' +
        '<p class="tattoo-before-booking__intro">Open a subject for the full guidance. The studio policies linked below remain the terms that govern appointments.</p>' +
      '</div>' +
      '<div class="tattoo-before-booking__content tattoo-before-booking__list" id="' + contentId + '" aria-label="Before booking guidance" hidden>' +
        items.map(function (item, itemIndex) {
          var termsId = itemIndex === items.length - 1 ? ' id="' + baseId + '-terms"' : "";
          return '<details class="tattoo-before-booking__item" name="' + groupName + '"' + termsId + '><summary>' + item.title + '</summary><div class="tattoo-before-booking__copy">' + item.body + '</div></details>';
        }).join("") +
      '</div>' +
    '</section>';

    var section = host.querySelector(".tattoo-before-booking");
    var toggle = section.querySelector(".tattoo-before-booking__toggle");
    var titleToggle = section.querySelector(".tattoo-before-booking__title-button");
    var content = section.querySelector(".tattoo-before-booking__content");
    var mark = section.querySelector(".tattoo-before-booking__toggle-mark");

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      titleToggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", (open ? "Collapse " : "Expand ") + "What You Should Know Before Booking");
      content.hidden = !open;
      section.classList.toggle("is-collapsed", !open);
      mark.textContent = open ? "−" : "+";
    }

    [toggle, titleToggle].forEach(function (control) {
      control.addEventListener("click", function () {
        setOpen(toggle.getAttribute("aria-expanded") !== "true");
      });
    });
  }

  Array.from(document.querySelectorAll("[data-tattoo-before-booking]")).forEach(render);
})();
