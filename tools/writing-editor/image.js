import exifr from "exifr";

// Keep animation and raster data; discard comments and unknown application data.
export function cleanWritingGif(input) {
  const bytes=new Uint8Array(input),chunks=[];
  if(!/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0,6)))||bytes.length<13)throw new Error("Invalid GIF image.");
  let offset=13+((bytes[10]&128)?3*(2**((bytes[10]&7)+1)):0);
  const take=(start,end)=>{if(end>bytes.length)throw new Error("Incomplete GIF image.");chunks.push(bytes.slice(start,end));};
  const blocks=()=>{while(offset<bytes.length){const length=bytes[offset++];if(!length)return;offset+=length;if(offset>bytes.length)break;}throw new Error("Incomplete GIF image.");};
  take(0,offset);
  while(offset<bytes.length){const start=offset,kind=bytes[offset++];
    if(kind===0x3b){take(start,offset);return new Blob(chunks,{type:"image/gif"});}
    if(kind===0x2c){if(offset+9>bytes.length)throw new Error("Incomplete GIF image.");const flags=bytes[offset+8];offset+=9+((flags&128)?3*(2**((flags&7)+1)):0);offset++;blocks();take(start,offset);}
    else if(kind===0x21){const label=bytes[offset++],name=new TextDecoder().decode(bytes.slice(offset+1,offset+12));blocks();if(label===0xf9||(label===0xff&&["NETSCAPE2.0","ANIMEXTS1.0"].includes(name)))take(start,offset);}
    else throw new Error("Unsupported GIF image.");
  }
  throw new Error("Incomplete GIF image.");
}

export async function prepareWritingImage(file) {
  if(file.size>15*1024*1024)throw new Error("Choose an image of 15 MB or less.");
  let evidence={},metadataNote="";
  try{evidence=await exifr.parse(file,{xmp:true,icc:true,iptc:true,reviveValues:false})||{};}catch{metadataNote="Embedded metadata could not be parsed; retained in the original file.";}
  const bitmap=await createImageBitmap(file);
  const width=bitmap.width,height=bitmap.height;
  if(width*height>40000000){bitmap.close();throw new Error("Choose an image below 40 megapixels.");}
  let blob;
  try {
    if(file.type==="image/gif")blob=cleanWritingGif(await file.arrayBuffer());
    else{const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;canvas.getContext("2d").drawImage(bitmap,0,0);blob=await new Promise(resolve=>canvas.toBlob(resolve,file.type==="image/jpeg"?"image/jpeg":"image/png",.94));}
  }finally{bitmap.close();}
  if(!blob)throw new Error("This image could not be prepared for display.");
  const extension=blob.type==="image/jpeg"?"jpg":blob.type==="image/gif"?"gif":"png";
  const original={original_format:file.type,camera_make:String(evidence.Make||""),camera_model:String(evidence.Model||""),editing_software:String(evidence.Software||evidence.CreatorTool||""),orientation:String(evidence.Orientation||""),color_profile:String(evidence.ProfileDescription||evidence.ColorSpace||""),raw_metadata:{embedded:evidence,pixelDimensions:{width,height},filename:file.name,fileLastModified:file.lastModified?new Date(file.lastModified).toISOString():null,metadataNote,dateNote:"File modification and embedded capture dates are evidence, not the creation date of the work."}};
  return {original,display:new File([blob],`${file.name.replace(/\.[^.]*$/,"")}-writing-display.${extension}`,{type:blob.type}),width,height};
}
