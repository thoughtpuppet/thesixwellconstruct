(function(){
  'use strict';
  var slug=new URLSearchParams(location.search).get('event') || 'sny-00';
  var base='/api/admin/events/'+encodeURIComponent(slug);
  var token=localStorage.getItem('swc_submissions_admin_token') || '';
  var status=document.getElementById('adminStatus'),records=document.getElementById('privateRecords');
  var select=document.getElementById('matchingRsvp'),form=document.getElementById('attendanceForm');
  function escape(value){return String(value ?? '').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function message(value){status.textContent=value;status.focus();}
  async function api(path,method,body){
    var response=await fetch(base+path,{method:method || 'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    var data=await response.json();
    if(!response.ok) throw new Error(response.status===401?'Sign in through Studio to view private records.':data.error || 'Unable to load records.');
    return data;
  }
  function matching(){var linked=Boolean(select.value);document.getElementById('walkInNameField').hidden=linked;document.getElementById('walkInName').required=!linked;}
  async function load(){
    if(!token){message('Sign in through Studio to view private records.');return;}
    try{
      var data=await api('/rsvps'); records.hidden=false;
      var summary=data.summary;
      document.getElementById('recordSummary').textContent=slug+' · RSVP headcount: '+summary.rsvpHeadcount+' · Reconciled attendance: '+summary.attendedHeadcount+' · Walk-ins: '+summary.walkInHeadcount+' · Capacity: '+(summary.capacity || 'needs review');
      select.innerHTML='<option value="">Walk-in — no matching RSVP</option>'+data.registrations.map(function(row){return '<option value="'+escape(row.id)+'">'+escape(row.contact_name)+' · '+row.party_size+' planned · '+escape(row.status)+'</option>';}).join(''); matching();
      document.getElementById('registrationList').innerHTML=data.registrations.map(function(row){return '<details><summary>'+escape(row.contact_name)+' · '+row.party_size+' planned · '+escape(row.status)+'</summary><p>'+escape(row.contact_email)+'</p><form class="public-form" data-rsvp="'+escape(row.id)+'"><div class="field"><label>Status<select name="status"><option '+(row.status==='confirmed'?'selected':'')+'>confirmed</option><option '+(row.status==='cancelled'?'selected':'')+'>cancelled</option></select></label></div><div class="field"><label>Planned party size<input name="partySize" type="number" min="1" max="99" step="1" value="'+row.party_size+'" required></label></div><div class="field"><label>Private food note<textarea name="foodRequirements" maxlength="500">'+escape(row.food_requirements)+'</textarea></label></div><button class="sny-button" type="submit">Save RSVP changes</button></form></details>';}).join('') || '<p>No RSVPs yet.</p>';
      document.getElementById('attendanceList').innerHTML=data.attendance.map(function(row){return '<article class="sny-panel"><h3>'+escape(row.attendee_name)+'</h3><p>'+row.attended_count+' attended · '+escape(row.paper_reference)+' · '+(row.rsvp_id?'linked RSVP':'walk-in')+'</p><button class="sny-button sny-button--secondary" type="button" data-remove="'+escape(row.id)+'">Remove incorrect transcription</button></article>';}).join('') || '<p>No paper attendance reconciled yet.</p>';
    }catch(error){records.hidden=true;message(error.message);}
  }
  select.addEventListener('change',matching);
  form.addEventListener('submit',async function(event){
    event.preventDefault();if(!form.reportValidity())return;
    var values=new FormData(form),button=form.querySelector('button');button.disabled=true;
    try{await api('/attendance','POST',{paperReference:values.get('paperReference'),rsvpId:values.get('rsvpId'),name:values.get('name'),attendedCount:Number(values.get('attendedCount'))});form.reset();await load();message('Paper attendance saved. RSVP headcount is unchanged.');}catch(error){message(error.message);}finally{button.disabled=false;}
  });
  document.getElementById('registrationList').addEventListener('submit',async function(event){
    var edit=event.target.closest('form[data-rsvp]');if(!edit)return;event.preventDefault();
    if(!edit.reportValidity())return;var values=new FormData(edit),button=edit.querySelector('button');button.disabled=true;
    try{await api('/rsvps/'+encodeURIComponent(edit.dataset.rsvp),'PATCH',{status:values.get('status'),partySize:Number(values.get('partySize')),foodRequirements:values.get('foodRequirements')});await load();message('Private RSVP updated. Attendance is unchanged.');}catch(error){message(error.message);button.disabled=false;}
  });
  document.getElementById('attendanceList').addEventListener('click',async function(event){
    var button=event.target.closest('[data-remove]');if(!button)return;
    if(!confirm('Remove this incorrect transcription? Keep the original paper sheet for reconciliation.'))return;
    button.disabled=true;
    try{await api('/attendance/'+encodeURIComponent(button.dataset.remove),'DELETE');await load();message('Incorrect transcription removed.');}catch(error){message(error.message);button.disabled=false;}
  });
  load();
})();
