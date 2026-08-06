const action = document.body.dataset.alertAction === "cancel" ? "cancel" : "confirm";
const token = new URLSearchParams(window.location.search).get("token") || "";
const button = document.getElementById("alertAction");
const status = document.getElementById("alertActionStatus");
if (!token) { button.disabled = true; status.textContent = "This alert link is incomplete."; }
button.addEventListener("click", async () => {
  button.disabled = true; status.textContent = action === "confirm" ? "Confirming…" : "Cancelling…";
  try {
    const response = await fetch(`/api/shop/launch-alerts/${action}`, { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ token }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "This alert could not be updated.");
    status.textContent = action === "confirm" ? `Confirmed. Six.Well Merch will email you once when ${payload.productTitle} launches.` : `Cancelled. You will not receive the ${payload.productTitle} launch alert.`;
  } catch (error) { status.textContent = error.message; button.disabled = false; }
});
