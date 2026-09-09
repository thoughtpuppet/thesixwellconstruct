import {Editor, Node, mergeAttributes} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
export {prepareWritingImage} from "./image.js";

export function createWritingEditor(element, {content, onUpdate = ()=>{}, onSelection = ()=>{}, imageUrl = async()=>""} = {}) {
  const WritingImage = Node.create({
    name:"writingImage", group:"block", atom:true, draggable:true,
    addAttributes() { return {mediaId:{default:""},alt:{default:""},caption:{default:""}}; },
    parseHTML() { return []; },
    renderHTML({HTMLAttributes}) { return ["figure",mergeAttributes(HTMLAttributes,{"data-writing-image":""}),["span",{},HTMLAttributes.alt || "Entry image"]]; },
    addNodeView() {
      return ({node}) => {
        const dom = document.createElement("figure"), image = document.createElement("img"), caption = document.createElement("figcaption");
        dom.className = "writing-image"; dom.contentEditable = "false"; image.alt = node.attrs.alt; caption.textContent = node.attrs.caption || "Image · select to edit its caption or alt text";
        dom.append(image,caption); let alive = true;
        Promise.resolve(imageUrl(node.attrs.mediaId)).then(url=>{if(alive && url) image.src=url;}).catch(()=>{if(alive)caption.textContent="Image preview unavailable. The saved image reference is retained.";});
        return {dom,selectNode(){dom.classList.add("is-selected");},deselectNode(){dom.classList.remove("is-selected");},destroy(){alive=false;}};
      };
    },
  });
  return new Editor({
    element, content, extensions:[StarterKit.configure({heading:{levels:[2,3]},code:false,codeBlock:false,strike:false,underline:false,horizontalRule:false,link:{openOnClick:false}}),WritingImage],
    editorProps:{attributes:{class:"writing-body writing-editor-body",role:"textbox","aria-label":"Entry body","aria-multiline":"true"}},
    onUpdate:({editor})=>onUpdate(editor),onSelectionUpdate:({editor})=>onSelection(editor),onTransaction:({editor})=>onSelection(editor),
  });
}
