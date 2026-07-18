// Shared calendar / time-picker / checkout logic for the consultation and
// build-in-person booking forms. All displayed times are in studio local
// time (America/New_York).
(function (global) {
  const TIME_ZONE = "America/New_York";
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const days = ["Su","Mo","Tu","We","Th","Fr","Sa"];

  function dateKey(date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }

  function formatDate(date) {
    if (dateKey(date) === dateKey(new Date())) return "Today";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric" }).format(date);
    return parts;
  }

  function formatTime(windowItem) {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
    return `${fmt.format(new Date(windowItem.startAt))} - ${fmt.format(new Date(windowItem.endAt))} ET`;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function showRebookBanner(form) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("rebook") !== "1") return;
    const banner = document.createElement("div");
    banner.className = "rebook-banner";
    banner.innerHTML = `
      <span>Your previous time was released — pick a new one below.</span>
      <button type="button" class="rebook-banner-dismiss" aria-label="Dismiss">&times;</button>
    `;
    banner.querySelector(".rebook-banner-dismiss").addEventListener("click", () => banner.remove());
    form.parentElement.insertBefore(banner, form);
  }

  function addTimezoneNote(slotPicker) {
    const label = slotPicker.querySelector(".slot-picker-label");
    if (!label) return;
    const note = document.createElement("p");
    note.className = "tz-note";
    note.textContent = "All times shown in Atlanta (Eastern Time).";
    label.insertAdjacentElement("afterend", note);
  }

  function ensureMarketingConsent(form) {
    if (!form || form.querySelector("[data-marketing-consent]")) return;
    if (!form.querySelector('[name="email"]')) return;
    const wrap = document.createElement("div");
    wrap.className = "marketing-consent-options";
    wrap.dataset.marketingConsent = "1";
    wrap.innerHTML = `
      <p class="marketing-consent-heading">Optional updates</p>
      <label class="marketing-consent-choice"><input type="checkbox" name="newsletter_consent" value="yes"><span>Yes, send me The Six.Well newsletter by email. This is optional and I can unsubscribe at any time.</span></label>
      ${form.querySelector('[name="phone"]') ? '<label class="marketing-consent-choice"><input type="checkbox" name="sms_marketing_consent" value="yes"><span>Yes, send me occasional Six.Well marketing texts. Message frequency varies; message and data rates may apply. Reply STOP to opt out or HELP for help.</span></label>' : ""}
      <a class="marketing-consent-manage" href="/preferences/">Manage communication preferences</a>
    `;
    const submit = form.querySelector('[type="submit"]');
    form.insertBefore(wrap, submit?.closest(".submit-row,.form-actions,.actions") || submit || null);
  }

  function initBookingCalendar(options) {
    const {
      filterBookingTypes,
      apiBookingTypeIds = [],
      walkInEmptyMessage = "No walk-in windows are currently set. Book a consultation or check back soon.",
      onBookingTypeChange,
      previewBookingTypes,
      contextUrl = "/api/booking/public-consultation/context",
      checkoutUrl = "/api/booking/public-consultation/checkout",
    } = options;

    const previewParams = new URLSearchParams(window.location.search);
    const previewMode = previewParams.get("preview") === "1";
    const previewState = previewParams.get("state") || "";
    const requestedBookingTypeId = previewParams.get("type") || "";

    async function fetchManagedContext() {
      if (contextUrl === "/api/booking/public-consultation/context" && global.getPublicConsultationContext) {
        return global.getPublicConsultationContext();
      }
      const params = apiBookingTypeIds.length
        ? `?type=${apiBookingTypeIds.map(encodeURIComponent).join("&type=")}`
        : "";
      const response = await fetch(`${contextUrl}${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to load session times.");
      return payload;
    }

    async function previewContext() {
      if (previewState === "error") {
        return { error: "Unable to load session times. (Preview of the load-error state.)" };
      }
      let managedPayload = {};
      try {
        managedPayload = await fetchManagedContext();
      } catch (error) {
        if (!Array.isArray(previewBookingTypes) || !previewBookingTypes.length) throw error;
      }
      const managedTypes = managedPayload.bookingTypes || (managedPayload.bookingType ? [managedPayload.bookingType] : []);
      const previewTypes = managedTypes.length ? managedTypes : (previewBookingTypes || []);
      if (!previewTypes.length) throw new Error("No active session types are available for this preview.");
      const previewWindows = [];
      if (previewState !== "no-availability") {
        const dayOffsets = [2, 4, 7, 9, 11, 16];
        const startHours = [11, 14, 12, 15, 10, 13];
        previewTypes.forEach((type) => {
          dayOffsets.forEach((offset, index) => {
            const start = new Date();
            start.setDate(start.getDate() + offset);
            start.setHours(startHours[index], 0, 0, 0);
            const durationMinutes = Number(type.durationMinutes) || 60;
            previewWindows.push({
              id: `preview-${type.id}-${index + 1}`,
              bookingTypeId: type.id,
              startAt: start.toISOString(),
              endAt: new Date(start.getTime() + durationMinutes * 60 * 1000).toISOString(),
            });
          });
        });
      }
      return {
        ...managedPayload,
        bookingTypes: previewTypes,
        availabilityWindows: previewWindows,
        walkInWindows: managedPayload.walkInWindows || [],
      };
    }

    const form = document.getElementById("consultForm");
    ensureMarketingConsent(form);
    const submitBtn = document.getElementById("submitBtn");
    const formError = document.getElementById("formError");
    const calGrid = document.getElementById("calGrid");
    const calMonthLabel = document.getElementById("calMonthLabel");
    let prevBtn = document.getElementById("calPrev");
    let nextBtn = document.getElementById("calNext");
    const timeRow = document.getElementById("timeRow");
    const timePanel = document.getElementById("timePanel");
    let timeTrigger = document.getElementById("timeTrigger");
    let timeTriggerLabel = document.getElementById("timeTriggerLabel");
    const timeAddBtn = document.getElementById("timeAddBtn");
    const selectedEl = document.getElementById("slotSelected");
    const preferredSlots = document.getElementById("preferredSlots");
    const availabilityWindowId = document.getElementById("availabilityWindowId");
    const bookingTypeSelect = document.getElementById("bookingTypeId");
    const fullNote = document.getElementById("calFullNote");
    const slotPicker = document.querySelector(".slot-picker");
    const calWrap = document.getElementById("calWrap");
    const announcement = document.createElement("p");
    const idempotencyStorageKey = `sixwell:booking-idempotency:${window.location.pathname}:${checkoutUrl}`;
    let idempotencyKey = "";
    try {
      idempotencyKey = window.sessionStorage.getItem(idempotencyStorageKey) || "";
      if (!idempotencyKey) {
        idempotencyKey = global.crypto?.randomUUID?.() || `booking-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        window.sessionStorage.setItem(idempotencyStorageKey, idempotencyKey);
      }
    } catch (_error) {
      idempotencyKey = global.crypto?.randomUUID?.() || `booking-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    announcement.className = "cal-announcement";
    announcement.setAttribute("role", "status");
    announcement.setAttribute("aria-live", "polite");
    announcement.setAttribute("aria-atomic", "true");
    (calWrap || slotPicker || form).appendChild(announcement);
    calGrid.setAttribute("role", "grid");
    calGrid.setAttribute("aria-label", "Available appointment dates");
    calMonthLabel.setAttribute("aria-live", "polite");
    selectedEl.setAttribute("role", "status");
    selectedEl.setAttribute("aria-live", "polite");
    timePanel.setAttribute("role", "listbox");
    timePanel.setAttribute("aria-label", "Available appointment times");
    formError.setAttribute("role", "alert");
    formError.setAttribute("aria-live", "assertive");

    let calendarDate = new Date();
    let windows = [];
    let bookingTypes = [];
    let bookingType = null;
    let pickedDate = null;
    let pendingWindow = null;
    let selectedWindow = null;
    let windowIndex = new Map();
    let nextWindowByType = new Map();
    let calendarFocusIndex = 0;

    function announce(message) {
      announcement.textContent = "";
      window.requestAnimationFrame(() => {
        announcement.textContent = message;
      });
    }

    function reducedMotion() {
      return global.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    }

    const freshPrevBtn = prevBtn.cloneNode(true);
    const freshNextBtn = nextBtn.cloneNode(true);
    const freshTimeTrigger = timeTrigger.cloneNode(true);
    prevBtn.replaceWith(freshPrevBtn);
    nextBtn.replaceWith(freshNextBtn);
    timeTrigger.replaceWith(freshTimeTrigger);
    prevBtn = freshPrevBtn;
    nextBtn = freshNextBtn;
    timeTrigger = freshTimeTrigger;
    timeTriggerLabel = timeTrigger.querySelector("#timeTriggerLabel");
    const freshAddBtn = timeAddBtn.cloneNode(true);
    timeAddBtn.replaceWith(freshAddBtn);

    function indexKey(typeId, key) {
      return `${typeId || ""}|${key}`;
    }

    function rebuildWindowIndex() {
      const nextIndex = new Map();
      const nextByType = new Map();
      const now = Date.now();
      const sorted = [...windows].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      sorted.forEach((item) => {
        const start = new Date(item.startAt);
        const key = dateKey(start);
        const ids = item.bookingTypeId ? [item.bookingTypeId] : bookingTypes.map((type) => type.id);
        ids.forEach((typeId) => {
          const bucketKey = indexKey(typeId, key);
          if (!nextIndex.has(bucketKey)) nextIndex.set(bucketKey, []);
          nextIndex.get(bucketKey).push(item);
          if (start.getTime() >= now && !nextByType.has(typeId)) nextByType.set(typeId, item);
        });
      });
      windowIndex = nextIndex;
      nextWindowByType = nextByType;
    }

    function windowsFor(date) {
      return windowIndex.get(indexKey(bookingTypeSelect.value, dateKey(date))) || [];
    }

    function resetSelectedTime() {
      selectedWindow = null;
      pendingWindow = null;
      pickedDate = null;
      selectedEl.innerHTML = "";
      preferredSlots.value = "";
      availabilityWindowId.value = "";
      timeRow.style.display = "none";
      timePanel.style.display = "none";
      renderCalendar();
      announce("Selected time cleared.");
    }

    function selectedBookingType() {
      return bookingTypes.find((type) => type.id === bookingTypeSelect.value) || null;
    }

    function setSelectedWindow(windowItem) {
      selectedWindow = windowItem;
      pendingWindow = null;
      timeRow.style.display = "none";
      timePanel.style.display = "none";
      const date = new Date(windowItem.startAt);
      selectedEl.innerHTML = `
        <div class="slot-item">
          <span class="slot-item-text"><span class="slot-item-num">Selected ·</span> ${formatDate(date)} at ${formatTime(windowItem)}</span>
          <button type="button" class="slot-item-remove" aria-label="Clear selected time">×</button>
        </div>
      `;
      selectedEl.querySelector(".slot-item-remove").addEventListener("click", () => {
        selectedWindow = null;
        selectedEl.innerHTML = "";
        preferredSlots.value = "";
        availabilityWindowId.value = "";
        renderCalendar();
      });
      preferredSlots.value = `${formatDate(date)} at ${formatTime(windowItem)}`;
      availabilityWindowId.value = windowItem.id;
      renderCalendar();
      announce(`Selected ${formatDate(date)} at ${formatTime(windowItem)}.`);
    }

    function renderTimeOptions(date) {
      const dayWindows = windowsFor(date);
      timePanel.innerHTML = "";
      pendingWindow = null;
      timeTriggerLabel.textContent = dayWindows.length ? "Pick a time" : "No times available";
      timeTrigger.classList.remove("has-value");
      freshAddBtn.disabled = true;
      freshAddBtn.textContent = "Select Time";
      dayWindows.forEach((windowItem) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "time-option";
        button.textContent = formatTime(windowItem);
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(selectedWindow?.id === windowItem.id));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          setSelectedWindow(windowItem);
        });
        timePanel.appendChild(button);
      });
      const timeButtons = [...timePanel.querySelectorAll(".time-option")];
      timeButtons.forEach((button, index) => {
        button.addEventListener("keydown", (event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
              ? timeButtons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + timeButtons.length) % timeButtons.length;
          timeButtons[nextIndex]?.focus();
        });
      });
      timeRow.style.display = "";
      timePanel.style.display = dayWindows.length ? "grid" : "none";
      fullNote.style.display = dayWindows.length ? "none" : "";
    }

    function nextAvailableWindow() {
      return nextWindowByType.get(bookingTypeSelect.value) || null;
    }

    function renderNextAvailable() {
      const container = document.getElementById("calNextAvailable");
      if (!container) return;
      if (selectedWindow) {
        container.innerHTML = "";
        return;
      }
      const next = nextAvailableWindow();
      if (!next) {
        container.innerHTML = "";
        return;
      }
      container.innerHTML = `
        <button type="button" class="cal-next-btn">
          <span>
            <span class="cal-next-title">${escapeHtml(formatDate(new Date(next.startAt)))}</span>
            <span class="cal-next-meta">${escapeHtml(formatTime(next))}</span>
          </span>
          <span class="cal-next-tag">Next Available</span>
        </button>
      `;
      container.querySelector(".cal-next-btn").addEventListener("click", () => {
        const date = new Date(next.startAt);
        calendarDate = new Date(date.getFullYear(), date.getMonth(), 1);
        pickedDate = date;
        setSelectedWindow(next);
      });
    }

    function renderCalendar() {
      renderNextAvailable();
      const todayKey = dateKey(new Date());
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const firstOfMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
      const firstOfToday = new Date(today.getFullYear(), today.getMonth(), 1);
      calMonthLabel.textContent = `${months[calendarDate.getMonth()]} ${calendarDate.getFullYear()}`;
      prevBtn.disabled = firstOfMonth <= firstOfToday;
      calGrid.innerHTML = "";

      const firstDay = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1).getDay();
      const daysInMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0).getDate();
      for (let index = 0; index < firstDay; index += 1) {
        const blank = document.createElement("span");
        blank.className = "cal-day empty";
        blank.setAttribute("aria-hidden", "true");
        calGrid.appendChild(blank);
      }

      for (let day = 1; day <= daysInMonth; day += 1) {
        const button = document.createElement("button");
        button.type = "button";
        const date = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day, 12);
        const key = dateKey(date);
        button.textContent = key === todayKey ? "Today" : day;
        const hasTimes = windowsFor(date).length > 0;
        const available = key >= todayKey && hasTimes;
        const isSelected = selectedWindow && dateKey(new Date(selectedWindow.startAt)) === key;
        const isPicked = pickedDate && dateKey(pickedDate) === key;
        button.className = "cal-day" +
          (key < todayKey || !hasTimes ? " past" : "") +
          (available ? " open" : "") +
          (key === todayKey ? " today" : "") +
          (isSelected ? " booked" : "") +
          (isPicked ? " active" : "");
        button.dataset.date = key;
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-label", `${new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date)}${available ? `, ${windowsFor(date).length} available ${windowsFor(date).length === 1 ? "time" : "times"}` : ", unavailable"}`);
        button.setAttribute("aria-pressed", String(Boolean(isSelected || isPicked)));
        if (available) {
          button.addEventListener("click", () => {
            pickedDate = date;
            renderTimeOptions(date);
            renderCalendar();
            calGrid.querySelector(`[data-date="${key}"]`)?.focus({ preventScroll: true });
            announce(`${formatDate(date)} selected. Choose an available time.`);
          });
        } else {
          button.disabled = true;
        }
        calGrid.appendChild(button);
      }

      const availableButtons = [...calGrid.querySelectorAll(".cal-day.open:not(:disabled)")];
      if (availableButtons.length) {
        calendarFocusIndex = Math.min(calendarFocusIndex, availableButtons.length - 1);
        const preferredIndex = availableButtons.findIndex((button) => button.dataset.date === dateKey(pickedDate || new Date()));
        if (preferredIndex >= 0) calendarFocusIndex = preferredIndex;
        availableButtons.forEach((button, index) => {
          button.tabIndex = index === calendarFocusIndex ? 0 : -1;
          button.addEventListener("focus", () => { calendarFocusIndex = index; });
          button.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
            event.preventDefault();
            if (event.key === "PageUp" || event.key === "PageDown") {
              const direction = event.key === "PageDown" ? 1 : -1;
              const requestedMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + direction, 1);
              if (requestedMonth < firstOfToday) {
                announce(`${calMonthLabel.textContent} is the earliest booking month.`);
                return;
              }
              calendarDate = requestedMonth;
              pickedDate = null;
              calendarFocusIndex = 0;
              renderCalendar();
              calGrid.querySelector(".cal-day.open:not(:disabled)")?.focus();
              announce(`${calMonthLabel.textContent}.`);
              return;
            }
            const requestedIndex = event.key === "Home"
              ? 0
              : event.key === "End"
                ? availableButtons.length - 1
                : index + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key] || 0);
            calendarFocusIndex = Math.max(0, Math.min(availableButtons.length - 1, requestedIndex));
            availableButtons.forEach((entry, entryIndex) => { entry.tabIndex = entryIndex === calendarFocusIndex ? 0 : -1; });
            availableButtons[calendarFocusIndex]?.focus();
          });
        });
      }
    }

    function renderWalkInWindows(items) {
      const list = document.getElementById("windowList");
      const note = document.getElementById("windowsNote");
      const address = document.getElementById("addressLines");
      if (address) address.textContent = "Studio address is shared with confirmed clients.";
      if (!list || !note) return;
      note.textContent = "Walk-in windows are updated from the studio availability console.";
      global.renderWalkInCards(list, items, { emptyMessage: walkInEmptyMessage });
    }

    async function loadContext() {
      try {
        let payload;
        if (previewMode) {
          payload = await previewContext();
          if (payload.error) throw new Error(payload.error);
        } else {
          payload = await fetchManagedContext();
        }
        const allTypes = payload.bookingTypes || (payload.bookingType ? [payload.bookingType] : []);
        bookingTypes = allTypes.filter(filterBookingTypes);
        windows = payload.availabilityWindows || [];
        rebuildWindowIndex();
        const walkInWindows = payload.walkInWindows || [];
        bookingTypeSelect.innerHTML = bookingTypes.map((type) => (
          `<option value="${type.id}">${type.label} - ${type.depositLabel} / ${type.durationMinutes} min</option>`
        )).join("");
        if (requestedBookingTypeId && bookingTypes.some((type) => type.id === requestedBookingTypeId)) {
          bookingTypeSelect.value = requestedBookingTypeId;
        }
        bookingType = selectedBookingType();
        if (onBookingTypeChange) {
          onBookingTypeChange(bookingType, walkInWindows, renderWalkInWindows);
        } else {
          renderWalkInWindows(walkInWindows);
        }
        if (previewMode) submitBtn.textContent = "Preview Checkout";
        else if (bookingType) submitBtn.textContent = `Continue to Square - ${bookingType.depositLabel}`;
        renderCalendar();
        announce(`${calMonthLabel.textContent}. Use arrow keys to move through available dates.`);
      } catch (error) {
        renderWalkInWindows([]);
        formError.textContent = error.message || "Unable to load session times.";
        formError.style.display = "block";
        renderCalendar();
      }
    }

    prevBtn.addEventListener("click", () => {
      calendarDate.setMonth(calendarDate.getMonth() - 1);
      pickedDate = null;
      timeRow.style.display = "none";
      timePanel.style.display = "none";
      renderCalendar();
      announce(`${calMonthLabel.textContent}.`);
    });
    nextBtn.addEventListener("click", () => {
      calendarDate.setMonth(calendarDate.getMonth() + 1);
      pickedDate = null;
      timeRow.style.display = "none";
      timePanel.style.display = "none";
      renderCalendar();
      announce(`${calMonthLabel.textContent}.`);
    });
    timeTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      timePanel.style.display = timePanel.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", () => {
      if (timeRow.style.display === "none") timePanel.style.display = "none";
    });
    freshAddBtn.addEventListener("click", () => {
      if (pendingWindow) setSelectedWindow(pendingWindow);
    });
    bookingTypeSelect.addEventListener("change", () => {
      bookingType = selectedBookingType();
      submitBtn.textContent = previewMode
        ? "Preview Checkout"
        : (bookingType ? `Continue to Square - ${bookingType.depositLabel}` : "Continue to Square");
      if (onBookingTypeChange) onBookingTypeChange(bookingType, null, renderWalkInWindows);
      resetSelectedTime();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (previewMode) {
        formError.textContent = selectedWindow
          ? `Preview mode only - real clients continue to Square. Selected: ${formatDate(new Date(selectedWindow.startAt))} at ${formatTime(selectedWindow)}.`
          : "Preview mode only - select an available time to see the checkout step.";
        formError.style.display = "block";
        return;
      }
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (!selectedWindow) {
        formError.textContent = "Please select an available session time before continuing.";
        formError.style.display = "block";
        document.getElementById("calWrap").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
        calGrid.querySelector(".cal-day.open:not(:disabled)")?.focus();
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Preparing checkout...";
      formError.style.display = "none";
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        const response = await fetch(checkoutUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify(data)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Unable to start checkout.");
        document.getElementById("formStep").style.display = "none";
        document.getElementById("paymentStep").style.display = "block";
        try { window.sessionStorage.removeItem(idempotencyStorageKey); } catch (_error) {}
        window.location.href = payload.checkoutUrl || `/booking/confirmed/?appointment=${encodeURIComponent(payload.appointmentId || "")}`;
      } catch (error) {
        submitBtn.disabled = false;
        bookingType = selectedBookingType();
        submitBtn.textContent = bookingType ? `Continue to Square - ${bookingType.depositLabel}` : "Continue to Square";
        formError.textContent = error.message || "Something went wrong. Please try again or email us directly.";
        formError.style.display = "block";
      }
    }, true);

    if (slotPicker) addTimezoneNote(slotPicker);
    showRebookBanner(form);
    renderCalendar();
    loadContext();
  }

  global.initBookingCalendar = initBookingCalendar;
})(window);
