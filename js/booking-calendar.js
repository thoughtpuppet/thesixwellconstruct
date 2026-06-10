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

  function initBookingCalendar(options) {
    const {
      filterBookingTypes,
      walkInEmptyMessage = "No walk-in windows are currently set. Book a consultation or check back soon.",
      onBookingTypeChange,
    } = options;

    const form = document.getElementById("consultForm");
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

    let calendarDate = new Date();
    let windows = [];
    let bookingTypes = [];
    let bookingType = null;
    let pickedDate = null;
    let pendingWindow = null;
    let selectedWindow = null;

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

    function windowsFor(date) {
      const key = dateKey(date);
      const selectedTypeId = bookingTypeSelect.value;
      return windows.filter((item) => {
        const typeMatches = !item.bookingTypeId || item.bookingTypeId === selectedTypeId;
        return typeMatches && dateKey(new Date(item.startAt)) === key;
      });
    }

    function resetSelectedTime() {
      selectedWindow = null;
      pendingWindow = null;
      pickedDate = null;
      selectedEl.innerHTML = "";
      preferredSlots.value = "";
      availabilityWindowId.value = "";
      timeRow.style.display = "none";
      renderCalendar();
    }

    function selectedBookingType() {
      return bookingTypes.find((type) => type.id === bookingTypeSelect.value) || null;
    }

    function setSelectedWindow(windowItem) {
      selectedWindow = windowItem;
      pendingWindow = null;
      timeRow.style.display = "none";
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
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          pendingWindow = windowItem;
          timeTriggerLabel.textContent = formatTime(windowItem);
          timeTrigger.classList.add("has-value");
          freshAddBtn.disabled = false;
          timePanel.style.display = "none";
        });
        timePanel.appendChild(button);
      });
      timeRow.style.display = "";
      fullNote.style.display = dayWindows.length ? "none" : "";
    }

    function renderCalendar() {
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
        const blank = document.createElement("button");
        blank.type = "button";
        blank.className = "cal-day empty";
        calGrid.appendChild(blank);
      }

      for (let day = 1; day <= daysInMonth; day += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = day;
        const date = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day, 12);
        const key = dateKey(date);
        const hasTimes = windowsFor(date).length > 0;
        const isSelected = selectedWindow && dateKey(new Date(selectedWindow.startAt)) === key;
        const isPicked = pickedDate && dateKey(pickedDate) === key;
        button.className = "cal-day" +
          (key < todayKey || !hasTimes ? " past" : "") +
          (key === todayKey ? " today" : "") +
          (isSelected ? " booked" : "") +
          (isPicked ? " active" : "");
        if (key >= todayKey && hasTimes) {
          button.addEventListener("click", () => {
            pickedDate = date;
            renderTimeOptions(date);
            renderCalendar();
          });
        }
        calGrid.appendChild(button);
      }
    }

    function renderWalkInWindows(items) {
      const list = document.getElementById("windowList");
      const note = document.getElementById("windowsNote");
      const address = document.getElementById("addressLines");
      if (address) address.textContent = "Studio address is shared with confirmed clients.";
      if (!list || !note) return;
      note.textContent = "Walk-in windows are updated from the studio availability console.";
      if (!items.length) {
        list.innerHTML = `<p class="windows-empty">${escapeHtml(walkInEmptyMessage)}</p>`;
        return;
      }
      list.innerHTML = items.map((windowItem) => {
        const start = new Date(windowItem.startsAt);
        const end = new Date(windowItem.endsAt);
        const title = escapeHtml(windowItem.title || "Walk-in Window");
        const noteText = escapeHtml(windowItem.note || "");
        const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
        const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "long" });
        const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" });
        return `
          <div class="window-item">
            <div>
              <p class="window-day">${dayFmt.format(start)}</p>
              <p class="window-date">${dateFmt.format(start)}</p>
            </div>
            <div>
              <p class="window-time">${fmt.format(start)} - ${fmt.format(end)} ET</p>
              <p class="window-note">${title}${noteText ? ` - ${noteText}` : ""}</p>
            </div>
          </div>
        `;
      }).join("");
    }

    async function loadContext() {
      try {
        const response = await fetch("/api/booking/public-consultation/context", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Unable to load consultation times.");
        const allTypes = payload.bookingTypes || (payload.bookingType ? [payload.bookingType] : []);
        bookingTypes = allTypes.filter(filterBookingTypes);
        windows = payload.availabilityWindows || [];
        const walkInWindows = payload.walkInWindows || [];
        bookingTypeSelect.innerHTML = bookingTypes.map((type) => (
          `<option value="${type.id}">${type.label} - ${type.depositLabel} / ${type.durationMinutes} min</option>`
        )).join("");
        bookingType = selectedBookingType();
        if (onBookingTypeChange) {
          onBookingTypeChange(bookingType, walkInWindows, renderWalkInWindows);
        } else {
          renderWalkInWindows(walkInWindows);
        }
        if (bookingType) submitBtn.textContent = `Continue to Square - ${bookingType.depositLabel}`;
        renderCalendar();
      } catch (error) {
        renderWalkInWindows([]);
        formError.textContent = error.message || "Unable to load consultation times.";
        formError.style.display = "block";
        renderCalendar();
      }
    }

    prevBtn.addEventListener("click", () => {
      calendarDate.setMonth(calendarDate.getMonth() - 1);
      pickedDate = null;
      timeRow.style.display = "none";
      renderCalendar();
    });
    nextBtn.addEventListener("click", () => {
      calendarDate.setMonth(calendarDate.getMonth() + 1);
      pickedDate = null;
      timeRow.style.display = "none";
      renderCalendar();
    });
    timeTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      timePanel.style.display = timePanel.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", () => {
      timePanel.style.display = "none";
    });
    freshAddBtn.addEventListener("click", () => {
      if (pendingWindow) setSelectedWindow(pendingWindow);
    });
    bookingTypeSelect.addEventListener("change", () => {
      bookingType = selectedBookingType();
      submitBtn.textContent = bookingType ? `Continue to Square - ${bookingType.depositLabel}` : "Continue to Square";
      if (onBookingTypeChange) onBookingTypeChange(bookingType, null, renderWalkInWindows);
      resetSelectedTime();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (!selectedWindow) {
        formError.textContent = "Please select an available consultation time before continuing.";
        formError.style.display = "block";
        document.getElementById("calWrap").scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Preparing checkout...";
      formError.style.display = "none";
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        const response = await fetch("/api/booking/public-consultation/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Unable to start checkout.");
        document.getElementById("formStep").style.display = "none";
        document.getElementById("paymentStep").style.display = "block";
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
