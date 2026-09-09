import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "jsdom";
import {createWritingEditor} from "./editor.js";
import {normalizeWritingSnapshot,renderWritingBody} from "../../shared/writing-content.js";
const dom=new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>',{url:"http://localhost",pretendToBeVisual:true});
for(const key of ["window","document","navigator","Node","HTMLElement","Element","DocumentFragment","MutationObserver","DOMParser","getComputedStyle"]){Object.defineProperty(globalThis,key,{value:key==="getComputedStyle"?dom.window.getComputedStyle.bind(dom.window):dom.window[key],configurable:true});}
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);globalThis.cancelAnimationFrame=clearTimeout;
globalThis.innerHeight=1000;globalThis.innerWidth=1400;
globalThis.ClipboardEvent=dom.window.Event;
dom.window.Range.prototype.getClientRects=()=>[];dom.window.Range.prototype.getBoundingClientRect=()=>({top:0,left:0,right:0,bottom:0});
function snapshot(editor){return normalizeWritingSnapshot({schemaVersion:1,title:"Editor round trip",author:"Saiel Dauhn Solehman",excerpt:"",body:editor.getJSON(),sources:[],relatedIds:[]});}
test("formatting, lists, images, captions, undo, redo, and JSON reload retain meaning",async()=>{
  const editor=createWritingEditor(document.querySelector("#editor"),{content:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"An observation"}]}]}});
  editor.commands.setTextSelection({from:1,to:3});editor.commands.toggleBold();
  assert.equal(editor.getJSON().content[0].content[0].marks[0].type,"bold");
  editor.commands.undo();assert.equal(editor.getJSON().content[0].content[0].marks,undefined);
  editor.commands.redo();assert.equal(editor.getJSON().content[0].content[0].marks[0].type,"bold");
  editor.commands.setTextSelection(editor.state.doc.content.size-1);
  editor.commands.insertContent([{type:"heading",attrs:{level:2},content:[{type:"text",text:"A question"}]},{type:"blockquote",content:[{type:"paragraph",content:[{type:"text",text:"A quoted thought"}]}]},{type:"orderedList",attrs:{start:1},content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"First step"}]}]}]},{type:"writingImage",attrs:{mediaId:"test-image",alt:"A line drawing",caption:"Image caption"}}]);
  const saved=snapshot(editor);editor.commands.setContent(saved.body);assert.deepEqual(snapshot(editor),saved);
  const html=renderWritingBody(saved,[{id:"test-image",url:"/api/construct/entity-media/test-image"}]);assert.match(html,/<strong>An<\/strong>/);assert.match(html,/<h2>A question/);assert.match(html,/<blockquote>/);assert.match(html,/<ol start="1">/);assert.match(html,/<figcaption>Image caption/);
  editor.destroy();
});
test("pasted HTML keeps supported formatting and discards scripts and arbitrary images",()=>{
  const editor=createWritingEditor(document.querySelector("#editor"),{content:"<p>Start</p>"});
  editor.commands.selectAll();editor.view.pasteHTML('<p><strong>Bold</strong> and <em>italic</em> <a href="https://example.com">source</a></p><script>alert(1)</script><img src="https://tracker.example/private.png"><p style="font-size:90px" onclick="alert(1)">Plain paragraph</p>');
  const value=snapshot(editor),html=renderWritingBody(value);assert.match(html,/<strong>Bold<\/strong>/);assert.match(html,/<em>italic<\/em>/);assert.match(html,/https:\/\/example.com/);assert.doesNotMatch(html,/script|tracker|onclick|font-size/);editor.destroy();
});

test("nested supported blocks and marked soft breaks remain valid after editing",()=>{
  const editor=createWritingEditor(document.createElement("div"),{content:'<blockquote><h2>Question</h2><blockquote><p><strong>One<br>two</strong></p></blockquote></blockquote><ul><li><p>First</p><h3>Inside a list</h3></li></ul>'});
  const value=normalizeWritingSnapshot({schemaVersion:1,title:"Nested",author:"",excerpt:"",body:editor.getJSON(),sources:[],relatedIds:[]});
  assert.equal(value.body.content[0].type,"blockquote");assert.equal(value.body.content[1].content[0].content[1].type,"heading");editor.destroy();
});

test("GIF display preparation strips private text while preserving image data",async()=>{
  const {cleanWritingGif}=await import("./image.js");
  const source=Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","base64");
  const comment=Buffer.from("PRIVATE GPS test");
  const annotated=Buffer.concat([source.subarray(0,19),Buffer.from([0x21,0xfe,comment.length]),comment,Buffer.from([0]),source.subarray(19)]);
  const output=Buffer.from(await cleanWritingGif(annotated).arrayBuffer());
  assert.deepEqual(output,source);assert.throws(()=>cleanWritingGif(source.subarray(0,20)),/Incomplete/);
});
