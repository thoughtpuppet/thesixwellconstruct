(function () {
  const select = document.getElementById("painting");
  if (!select) return;
  fetch("/api/art?acquisition=1", { cache: "no-store", headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error();
      const payload = await response.json();
      const requested = new URLSearchParams(location.search).get("work") || "";
      select.innerHTML = '<option value="" disabled>select a painting</option>' +
        (payload.records || []).map((record) => `<option value="${String(record.slug || record.id).replace(/"/g, "&quot;")}">${String(record.title || "Untitled work").replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[character]))}</option>`).join("") +
        '<option value="other">other — I\'ll describe below</option>';
      const match = [...select.options].find((option) => option.value === requested);
      select.value = match ? requested : "";
    })
    .catch(() => {
      // Keep the bundled option as the outage fallback.
    });
})();
