import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../js/archive-note-markdown.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../css/archive-notes.css',import.meta.url),'utf8');
const sandbox={window:{},URL,location:{origin:'https://example.test'}};
vm.runInNewContext(script,sandbox);
const render=sandbox.window.ArchiveNoteMarkdown.render;
test('Note reading surface preserves source case and target identity without displayed captions',()=>{
 const source='{{asset:sketch}}\n\nOriginal Mixed Case source.\nSecond line.';
 const html=render(source,[{token:'sketch',media_id:'image-one',mime_type:'image/png',url:'/image.png',alt_text:'Accessible description',caption:'Retrospective caption'}],'note-one');
 assert.match(html,/Original Mixed Case source\.<br>Second line\./);
 assert.match(html,/data-retro-kind="note" data-retro-id="note-one" data-retro-field="body_markdown"/);
 assert.match(html,/data-retro-media="image-one"/);
 assert.match(html,/data-retro-label/);
 assert.match(html,/alt="Accessible description"/);
 assert.doesNotMatch(html,/figcaption|Retrospective caption|View full image/);
 assert.equal(source,'{{asset:sketch}}\n\nOriginal Mixed Case source.\nSecond line.');
});
test('Only the verified drawing opts into reversible dark appearance; photographs retain their pixels',()=>{
 const asset={token:'image',mime_type:'image/png',url:'/original.png'};
 assert.match(render('{{asset:image}}',[{...asset,media_id:'media-72ee85ed-4c78-4571-b742-5e0c3533cdd2'}]),/data-note-drawing="true"/);
 assert.match(render('{{asset:image}}',[{...asset,media_id:'a-photo'}]),/data-note-drawing="false"/);
 assert.match(css,/\[data-note-theme="dark"\].*\[data-note-drawing="true"\]/);
 assert.match(css,/filter:url\(#archive-note-drawing-dark\)/);
 assert.match(script,/color-interpolation-filters="sRGB"/);
 assert.match(script,/-0\.687 0 0\.687 0 0/);
 assert.match(script,/flood-color="#0056ff"/);
 assert.match(css,/\.archive-note-asset\s*\{[^}]*border:\s*0/s);
});
test('Dark drawing tint matches the reference blue without tinting neutral or red ink',()=>{
 const tint=([r,g,b])=>{const alpha=Math.max(0,Math.min(1,.687*(b-r)/255));return [r*(1-alpha),g*(1-alpha)+86*alpha,b*(1-alpha)+255*alpha].map(Math.round);};
 assert.deepEqual(tint([78.244,164.244,255]),[41,127,255]);
 assert.deepEqual(tint([0,0,0]),[0,0,0]);
 assert.deepEqual(tint([128,128,128]),[128,128,128]);
 assert.deepEqual(tint([120,20,10]),[120,20,10]);
});
test('Theme toolbar and zoom preserve comment access and source isolation',()=>{
 assert.match(script,/toolbar\.dataset\.retroIgnore/);
 assert.match(script,/reader\.querySelector\(':scope > \.archive-note-reader-toolbar'\)/);
 assert.match(script,/localStorage\.setItem\(themeKey,theme\)/);
 assert.match(script,/mountComments\(dialog,trigger\.retrospectiveComments/);
 assert.match(script,/size!==viewportSize/);
 assert.match(script,/pointercancel/);
 assert.match(script,/ArrowLeft/);
 assert.match(script,/lastTrigger\?\.focus\(\)/);
});
test('Source escaping and safe attachment URLs remain enforced',()=>{
 assert.match(render('<script>alert(1)</script>'),/&lt;script&gt;/);
 assert.doesNotMatch(render('{{asset:x}}',[{token:'x',mime_type:'image/png',url:'javascript:alert(1)'}]),/<img/);
});
test('Note body typography uses native Apple fonts, a deliberate web fallback and reference spacing',()=>{
 assert.match(css,/--note-body-font:-apple-system,BlinkMacSystemFont,"Archive Note Inter",Inter,"Helvetica Neue",Arial,sans-serif/);
 assert.match(css,/--note-body-leading:1\.529411765/);
 assert.match(css,/--note-body-tracking:-\.02em/);
 assert.match(css,/font:400 17px\/var\(--note-body-leading\) var\(--note-body-font\)/);
 assert.match(css,/padding:0 16px 24px;scrollbar-gutter:auto;scrollbar-width:thin/);
 assert.match(css,/\.archive-note-asset>\.archive-note-image-comments\{right:-16px\}/);
 // The typography contract is confined to source content, not popup copy.
 assert.doesNotMatch(css,/\.retro-popup[^}]*--note-body-font/);
});
test('Single-storey a uses font-specific features without rewriting source letters',()=>{
 assert.match(css,/@font-face\{font-family:"Archive Note Inter";[^}]*font-feature-settings:"cv11" 1/);
 assert.match(css,/@supports \(-webkit-touch-callout:none\)\{\.archive-note-content\{font-feature-settings:"ss07" 1\}\}/);
 const font=readFileSync(new URL('../assets/fonts/inter/InterVariable.woff2',import.meta.url));
 assert.equal(font.subarray(0,4).toString(),'wOF2');
 assert.match(readFileSync(new URL('../assets/fonts/inter/LICENSE.txt',import.meta.url),'utf8'),/SIL OPEN FONT LICENSE Version 1.1/);
 const source='Wanting marbles, a pit and water.';
 assert.match(render(source),/Wanting marbles, a pit and water\./);
 assert.equal(source,'Wanting marbles, a pit and water.');
});
test('Note controls use square Archive styling and scoped amber scrollbars',()=>{
 for(const selector of ['.archive-note-appearance button{','.archive-note-image-dialog header button:not(.retro-marker){']){
  const rule=css.slice(css.indexOf(selector)).split('}')[0];
  assert.match(rule,/border-radius:0/);
  assert.match(rule,/color:var\(--color-archive-bright,#B87A32\)/);
  assert.match(rule,/font:700 12px\/1\.2 var\(--font-display,Inter,Arial,sans-serif\)/);
  assert.match(rule,/min-height:44px/);
 }
 assert.match(css,/html:has\(body\.archive-public\[data-archive-view="notes"\]\),\.archive-note-reader,\.archive-note-image-dialog-media\{scrollbar-color:var\(--color-archive-bright,#B87A32\)/);
 assert.match(css,/::-webkit-scrollbar-thumb/);
 assert.doesNotMatch(css,/\.retro-marker\{[^}]*border-radius:0/);
});
