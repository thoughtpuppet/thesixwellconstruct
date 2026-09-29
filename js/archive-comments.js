import {commentGroupKey} from '../shared/archive-comment-targets.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Date(value).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
let serial=0;
export function commentStyles(){
  if(document.querySelector('link[data-retro-styles]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='/css/archive-comments.css';link.dataset.retroStyles='';document.head.append(link);
}

// Canonical visible text plus DOM endpoints. Images, captions and controls are separate targets.
export function textProjection(root){
  const units=[];
  const block=/^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|SECTION)$/;
  function visit(node){
    if(node.nodeType===3){for(let i=0;i<node.data.length;i++)units.push({char:node.data[i],node,offset:i});return;}
    if(node.nodeType!==1||node.matches('figure,button,audio,video,[data-retro-ignore],.retro-marker,.retro-times'))return;
    if(node.tagName==='BR'){units.push({char:' '});return;}
    if(block.test(node.tagName))units.push({char:' '});
    for(const child of node.childNodes)visit(child);
    if(block.test(node.tagName))units.push({char:' '});
  }
  visit(root);
  const normalized=[];
  for(const unit of units){if(/\s/.test(unit.char)){if(normalized.length&&normalized.at(-1).char!==' ')normalized.push({...unit,char:' '});}else normalized.push(unit);}
  if(normalized.at(-1)?.char===' ')normalized.pop();
  return {text:normalized.map(v=>v.char).join(''),positions:normalized};
}

export function selectionAnchor(root){
  if(!root)return null;
  if(root.matches('textarea')){const start=root.selectionStart,end=root.selectionEnd;return end>start?{start,end,quote:root.value.slice(start,end)}:null;}
  const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed)return null;
  const range=selection.getRangeAt(0);if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return null;
  const projection=textProjection(root),selected=[];
  projection.positions.forEach((p,i)=>{if(p.node&&range.comparePoint(p.node,p.offset)>=0&&range.comparePoint(p.node,p.offset+1)<=0)selected.push(i);});
  if(!selected.length)return null;
  let start=selected[0],end=selected.at(-1)+1;
  while(projection.text[start]===' ')start++;while(projection.text[end-1]===' ')end--;
  return {start,end,quote:projection.text.slice(start,end)};
}

function bodyMarkup(value){return escape(value).replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/\n/g,'<br>');}
export function openCommentPopup(trigger,comments){
  commentStyles();
  const popup=document.createElement('dialog');popup.className='retro-popup';const titleId=`retro-title-${++serial}`;
  popup.setAttribute('aria-labelledby',titleId);
  popup.innerHTML=`<header class="retro-header"><h2 id="${titleId}">RETROSPECTIVE COMMENT</h2><button type="button" class="retro-close">CLOSE</button></header><div class="retro-list">${comments.map(c=>`<article><p class="retro-meta">${escape(c.author_name)}<br>Added ${escape(date(c.created_at))}${c.edited_at?`<br>Edited ${escape(date(c.edited_at))}`:''}</p><p class="retro-body">${bodyMarkup(c.body)}</p></article>`).join('')}</div>`;
  document.body.append(popup);
  let closed=false;
  const dismiss=()=>{if(closed)return;closed=true;popup.close();popup.remove();if(trigger.isConnected)trigger.focus({preventScroll:true});};
  popup.querySelector('.retro-close').addEventListener('click',dismiss);
  popup.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  popup.addEventListener('click',event=>{if(event.target===popup){const r=popup.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dismiss();}});
  popup.showModal();popup.querySelector('.retro-close').focus({preventScroll:true});
  return popup;
}
function marker(comments){
  const button=document.createElement('button');button.type='button';button.className='retro-marker';button.setAttribute('aria-label',`Read retrospective comment${comments.length>1?'s':''}`);button.setAttribute('aria-haspopup','dialog');button.innerHTML='<span aria-hidden="true">i</span>';
  button.addEventListener('click',event=>{event.stopPropagation();event.preventDefault();openCommentPopup(button,comments);});return button;
}
const timeLabel=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
export function renderComments(root,comments=[]){
  commentStyles();
  const groups=new Map();for(const comment of comments){const key=commentGroupKey(comment);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(comment);}
  const scopes=[...(root.matches?.('[data-retro-kind],[data-retro-media]')?[root]:[]),...root.querySelectorAll('[data-retro-kind],[data-retro-media]')];
  for(const scope of scopes){
    const media=scope.dataset.retroMedia;
    const applicable=[...groups.entries()].filter(([,rows])=>{const c=rows[0];return media?c.target_kind==='media'&&c.target_id===media:c.target_kind===scope.dataset.retroKind&&c.target_id===scope.dataset.retroId&&c.field_key===scope.dataset.retroField;});
    const projection=media?null:textProjection(scope);
    // Descending offsets preserve the original text-node endpoints while inserting markers.
    applicable.sort((a,b)=>(b[1][0].anchor.end||0)-(a[1][0].anchor.end||0));
    for(const [key,rows] of applicable){
      if([...scope.querySelectorAll('.retro-marker')].some(b=>b.dataset.retroGroup===key))continue;
      const c=rows[0],button=marker(rows);button.dataset.retroGroup=key;
      if(media){
        let label=scope.querySelector('[data-retro-label],figcaption');
        if(!label){label=document.createElement('p');label.dataset.retroLabel='';label.textContent=scope.dataset.retroTitle||'Recording';scope.append(label);}
        if(c.anchor.start_seconds!=null){
          let times=scope.querySelector('.retro-times');if(!times){times=document.createElement('div');times.className='retro-times';scope.append(times);}
          const entry=document.createElement('span'),seek=document.createElement('button');seek.type='button';seek.className='retro-seek';seek.textContent=timeLabel(c.anchor.start_seconds)+(c.anchor.end_seconds!=null?`–${timeLabel(c.anchor.end_seconds)}`:'');
          seek.addEventListener('click',()=>{const player=scope.querySelector('audio,video');if(player)player.currentTime=c.anchor.start_seconds;});entry.append(seek,button);times.append(entry);
        }else label.append(button);
      }else{
        const a=c.anchor;if(projection.text.slice(a.start,a.end)!==a.quote)continue;
        const point=projection.positions[a.end-1];if(!point?.node)continue;
        const range=document.createRange();range.setStart(point.node,point.offset+1);range.collapse(true);range.insertNode(button);
      }
    }
  }
}
const observers=new WeakMap();
export function mountComments(root,comments=[]){
  observers.get(root)?.disconnect();renderComments(root,comments);
  const observer=new MutationObserver(()=>{observer.disconnect();renderComments(root,comments);observer.observe(root,{childList:true,subtree:true});});
  observer.observe(root,{childList:true,subtree:true});observers.set(root,observer);return ()=>observer.disconnect();
}
