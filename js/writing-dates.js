// Native details supplies keyboard/touch disclosure; add familiar dismissal.
document.addEventListener("click",event=>{
  for (const details of document.querySelectorAll("[data-writing-dates][open]")) {
    if (!details.contains(event.target)) details.open = false;
  }
});
document.addEventListener("keydown",event=>{
  if (event.key !== "Escape") return;
  for (const details of document.querySelectorAll("[data-writing-dates][open]")) {
    details.open = false;
    if (details.contains(document.activeElement)) details.querySelector("summary").focus();
  }
});
