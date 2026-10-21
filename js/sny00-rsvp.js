(function () {
  'use strict';
  var fields=document.getElementById('rsvpFields');
  var form=document.getElementById('rsvpForm');
  var availability=document.getElementById('rsvpAvailability');
  var result=document.getElementById('rsvpResult');
  var button=document.getElementById('rsvpSubmit');
  var party=document.getElementById('partySize');
  var occurrenceId='';
  function message(value,error) {result.textContent=value; result.dataset.error=String(Boolean(error)); result.focus();}
  fetch('/api/events/sny-00/context',{credentials:'same-origin'})
    .then(function(response) {if(!response.ok) throw new Error(); return response.json();})
    .then(function(data) {
      var rsvp=data.event && data.event.rsvp;
      if(!rsvp || !rsvp.open) {availability.textContent='RSVP is currently closed.'; return;}
      occurrenceId=rsvp.occurrenceId;
      party.max=String(Math.min(rsvp.maxPartySize,rsvp.remaining));
      document.getElementById('partyHelp').textContent='Up to '+rsvp.maxPartySize+' people per RSVP, including you.';
      availability.textContent='RSVP is open.';
      fields.disabled=false;
    })
    .catch(function() {availability.textContent='RSVP is unavailable. Please check back or contact the organizer.';});
  form.addEventListener('submit',async function(event) {
    event.preventDefault();
    if(fields.disabled || button.disabled || !form.reportValidity()) return;
    var values=new FormData(form);
    button.disabled=true; button.textContent='Saving RSVP…';
    try {
      var response=await fetch('/api/events/sny-00/rsvp',{
        method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',
        body:JSON.stringify({name:values.get('name'),email:values.get('email'),partySize:Number(values.get('partySize')),
          foodRequirements:values.get('foodRequirements'),_gotcha:values.get('_gotcha'),occurrenceId:occurrenceId})
      });
      var data=await response.json();
      if(!response.ok) throw new Error(data.error || 'Unable to save your RSVP.');
      fields.disabled=true;
      button.textContent='RSVP received';
      message(data.message,false);
    } catch(error) {message(error.message || 'Unable to save your RSVP. Please try again.',true); button.disabled=false; button.textContent='Confirm RSVP';}
  });
})();
