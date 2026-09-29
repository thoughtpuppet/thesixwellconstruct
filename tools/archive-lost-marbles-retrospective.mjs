import {pathToFileURL} from 'node:url';
import {textAnchor} from '../shared/archive-comment-targets.js';
export const ORIGINAL='based off the book the body keeps score with trauma';
export const INTERVENING='thinking about the body keeps score with trauma';
export const COMMENT='The painting wasn’t necessarily based on *The Body Keeps the Score*. I used the book to help explain the idea.';
export const IMAGE_COMMENTS=[
  {token:'original-sketch',label:'Original handwritten sketch',body:'Original handwritten sketch from the Lost Marbles inception note.'},
  {token:'process-experiment',label:'Process experiment',body:'Process experiment added to this note later. I drew over a photograph of the painting to test an idea. I did not use it for this painting, but kept it as a possible reference for another work.'}
];
function captionPlan(payload){
  return IMAGE_COMMENTS.map(spec=>{
    const matches=(payload.assets||[]).filter(a=>(a.token||a.asset_token)===spec.token);
    if(matches.length!==1)throw Error(`Expected exactly one ${spec.token} image. Stop and review.`);
    const asset=matches[0];
    if(!String(asset.mime_type||asset.mimeType).startsWith('image/')||!asset.public_visible)throw Error(`The ${spec.token} image is not publicly eligible.`);
    if(![spec.body,spec.label].includes(asset.caption))throw Error(`The ${spec.token} caption differs from the approved text. Stop and review.`);
    return {...spec,asset};
  });
}
export async function prepareLostMarbles(api,{apply=false,moveImageCaptions=false}={}){
  const payload=await api('/api/admin/archive-notes/lost-marbles-inception-note'),note=payload.note;
  if(!note||note.slug!=='lost-marbles-inception-note'||note.note_type==='journal-entry')throw Error('The expected Lost Marbles source Note was not found.');
  const count=phrase=>note.body_markdown.split(phrase).length-1;
  const needsCorrection=count(INTERVENING)===1&&count(ORIGINAL)===0;
  if(!needsCorrection&&!(count(ORIGINAL)===1&&count(INTERVENING)===0))throw Error('Source wording differs from the reviewed phrases. Stop and review it manually.');
  const beforeDates=[note.source_created_at,note.source_modified_at],preservation=payload.source_preservation;
  if(!preservation)throw Error('Deploy the retrospective-comment schema and API before this release step.');
  const captions=moveImageCaptions?captionPlan(payload):[];
  const preflight=await api(`/api/admin/archive-comments?owner_entity_id=${encodeURIComponent(note.id)}`);
  for(const entry of captions){
    const target=preflight.targets.find(t=>t.target_kind==='media'&&t.target_id===entry.asset.media_id);
    if(!target?.public_eligible)throw Error(`The ${entry.token} comment target is not publicly eligible.`);
    const existing=preflight.records.find(c=>c.target_kind==='media'&&c.target_id===entry.asset.media_id&&c.body===entry.body);
    if(existing&&(existing.is_stale||existing.state!=='published'))throw Error(`The ${entry.token} comment requires Studio review.`);
  }
  if(!apply)return {dry_run:true,note_id:note.id,correction_required:needsCorrection,original_phrase:ORIGINAL,comment:COMMENT,image_comments:captions.map(({token,label,body,asset})=>({token,label,body,media_id:asset.media_id})),source_dates:beforeDates};
  if(needsCorrection)await api(`/api/admin/archive-notes/${encodeURIComponent(note.id)}/source-corrections`,'POST',{body_markdown:note.body_markdown.replace(INTERVENING,ORIGINAL),reason:'Restore the original wording of the Lost Marbles source Note; retain the later clarification separately as a retrospective comment.',expected_revision:preservation.source_revision,expected_fingerprint:preservation.source_fingerprint});
  const collection=await api(`/api/admin/archive-comments?owner_entity_id=${encodeURIComponent(note.id)}`),target=collection.targets.find(t=>t.target_kind==='note'&&t.field_key==='body_markdown');
  const start=target.text.indexOf(ORIGINAL);if(start<0)throw Error('Restored phrase is missing from the current target.');
  const existing=collection.records.find(c=>c.body===COMMENT&&c.target_kind==='note'&&c.target_id===note.id);
  if(existing&&(existing.is_stale||existing.state!=='published'))throw Error('The approved comment already exists but needs Studio review. It was not overwritten.');
  if(!existing)await api('/api/admin/archive-comments','POST',{owner_entity_id:note.id,target_kind:'note',target_id:note.id,field_key:'body_markdown',anchor:textAnchor(target.text,start,start+ORIGINAL.length),source_fingerprint:target.source_fingerprint,body:COMMENT,author_name:'Saiel Dauhn Solehman',state:'published'});
  let imageCommentsCreated=0,captionsMoved=0;
  for(const entry of captions){
    const current=await api(`/api/admin/archive-comments?owner_entity_id=${encodeURIComponent(note.id)}`);
    const mediaTarget=current.targets.find(t=>t.target_kind==='media'&&t.target_id===entry.asset.media_id);
    const prior=current.records.find(c=>c.target_kind==='media'&&c.target_id===entry.asset.media_id&&c.body===entry.body);
    if(prior&&(prior.is_stale||prior.state!=='published'))throw Error(`The ${entry.token} comment requires Studio review.`);
    if(!prior){
      await api('/api/admin/archive-comments','POST',{owner_entity_id:note.id,target_kind:'media',target_id:entry.asset.media_id,field_key:'',anchor:{},source_fingerprint:mediaTarget.source_fingerprint,body:entry.body,author_name:'Saiel Dauhn Solehman',state:'published'});
      imageCommentsCreated++;
    }
    // Preserve the full explanation in an audited comment before shortening its label.
    if(entry.asset.caption!==entry.label){
      await api(`/api/admin/archive-notes/${encodeURIComponent(note.id)}/assets/${encodeURIComponent(entry.asset.id)}`,'PATCH',{caption:entry.label,expected_caption:entry.body});
      captionsMoved++;
    }
  }
  const after=await api(`/api/admin/archive-notes/${encodeURIComponent(note.id)}`);
  if(JSON.stringify(beforeDates)!==JSON.stringify([after.note.source_created_at,after.note.source_modified_at]))throw Error('Historical-date verification failed.');
  for(const entry of captions){
    if(after.assets.find(a=>a.id===entry.asset.id)?.caption!==entry.label||!after.retrospective_comments.some(c=>c.target_kind==='media'&&c.target_id===entry.asset.media_id&&c.body===entry.body&&!c.is_stale))throw Error(`The ${entry.token} migration failed verification.`);
  }
  return {applied:true,note_id:note.id,correction_recorded:needsCorrection,comment_created:!existing,image_comments_created:imageCommentsCreated,captions_moved:captionsMoved,source_dates_preserved:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),origin=args.find(a=>a.startsWith('--origin='))?.slice(9),token=process.env.SWC_RETROSPECTIVE_ADMIN_TOKEN;
  if(!origin||!token)throw Error('Supply --origin=https://approved-host and SWC_RETROSPECTIVE_ADMIN_TOKEN. Default is read-only; --apply requires release authorization.');
  const url=new URL(origin);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid API origin.');
  const api=async(path,method='GET',body)=>{const response=await fetch(new URL(path,url.origin),{method,redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(value.error||`HTTP ${response.status}`);return value;};
  console.log(JSON.stringify(await prepareLostMarbles(api,{apply:args.includes('--apply'),moveImageCaptions:args.includes('--move-image-captions')}),null,2));
}
