import {build} from "esbuild";
import {mkdir,writeFile,readFile} from "node:fs/promises";
const output = new URL("../../studio/vendor/writing-editor/",import.meta.url);
await mkdir(output,{recursive:true});
await build({entryPoints:[new URL("editor.js",import.meta.url).pathname],outfile:new URL("editor.js",output).pathname,bundle:true,format:"esm",platform:"browser",target:["es2022"],minify:true,legalComments:"eof"});
const manifest = JSON.parse(await readFile(new URL("package.json",import.meta.url),"utf8"));
await writeFile(new URL("NOTICE.md",output),`# WRKNG* editor dependencies\n\nBuilt from tools/writing-editor with npm ci and npm run build.\n\nTiptap ${manifest.dependencies["@tiptap/core"]} and ProseMirror are MIT licensed.\nhttps://github.com/ueberdosis/tiptap\nhttps://github.com/ProseMirror\n\nThe dependency lockfile records all bundled packages.\n`);
// Retain the upstream licenses alongside the vendored bundle.
for (const [name,path] of [["TIPTAP-LICENSE.txt","node_modules/@tiptap/core/LICENSE.md"],["PROSEMIRROR-LICENSE.txt","node_modules/prosemirror-model/LICENSE"],["EXIFR-LICENSE.txt","node_modules/exifr/LICENSE"]]) {
  await writeFile(new URL(name,output),await readFile(new URL(path,import.meta.url)));
}
