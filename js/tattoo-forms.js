(function () {
  function setStatus(form, message, state) {
    var status = form.querySelector("[data-form-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state || "idle";
  }

  function serialize(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      if (key === "consent") {
        data[key] = true;
      } else {
        data[key] = String(value || "").trim();
      }
    });
    data.sourcePath = window.location.pathname;
    return data;
  }

  function fieldLabel(field) {
    var labels = {
      formType: "form type",
      firstName: "first name",
      lastName: "last name",
      email: "email",
      message: "project notes",
      consent: "review consent",
    };
    return labels[field] || field;
  }

  async function submitForm(form) {
    var button = form.querySelector("[data-submit-label]");
    var original = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Sending";
    }
    setStatus(form, "Submitting for review.", "pending");

    try {
      var response = await fetch("/api/tattoo/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serialize(form)),
      });
      var payload = await response.json().catch(function () {
        return {};
      });

      if (!response.ok) {
        var fields = Array.isArray(payload.fields)
          ? " Missing: " + payload.fields.map(fieldLabel).join(", ") + "."
          : "";
        throw new Error((payload.error || "The submission could not be sent.") + fields);
      }

      form.reset();
      setStatus(
        form,
        "Received. This is not a booking confirmation. If approved, you will receive a private booking link and next steps.",
        "success"
      );
    } catch (error) {
      setStatus(form, error.message || "The submission could not be sent.", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  document.addEventListener("submit", function (event) {
    var form = event.target.closest("[data-tattoo-form]");
    if (!form) return;
    event.preventDefault();
    submitForm(form);
  });
})();
