(function(global){
  const roles=new Set(["result","before","process","detail"]);
  const healingStates=new Set(["unspecified","fresh","healed","in-progress"]);

  class PortfolioBatchOrganizer {
    constructor(options={}) {
      this.createPreview=options.createPreview||((file)=>URL.createObjectURL(file));
      this.revokePreview=options.revokePreview||((url)=>URL.revokeObjectURL(url));
      this.groups=[];
      this.nextGroupId=1;
      this.nextMediaId=1;
    }

    addFiles(files) {
      const added=[];
      for(const file of files||[]) {
        const media={
          id:`batch-media-${this.nextMediaId++}`,
          file,
          name:String(file?.name||"Portfolio image"),
          previewUrl:this.createPreview(file),
          role:"result",
          healingState:"unspecified",
          isCover:true,
          uploadStatus:"pending",
          imageRef:"",
          error:"",
        };
        const group={
          id:`batch-group-${this.nextGroupId++}`,
          selected:false,
          itemId:"",
          uploadStatus:"pending",
          error:"",
          media:[media],
        };
        this.groups.push(group);
        added.push(group);
      }
      return added;
    }

    group(groupId) {
      return this.groups.find((entry)=>entry.id===groupId)||null;
    }

    media(groupId,mediaId) {
      return this.group(groupId)?.media.find((entry)=>entry.id===mediaId)||null;
    }

    assertEditable() {
      if(this.groups.some((group)=>group.itemId||group.uploadStatus!=="pending")) {
        throw new Error("This batch has started uploading and can no longer be reorganized.");
      }
    }

    setSelected(groupId,selected) {
      const group=this.group(groupId);
      if(group) group.selected=Boolean(selected);
      return group;
    }

    combineSelected() {
      this.assertEditable();
      const selected=this.groups.filter((group)=>group.selected);
      if(selected.length<2) throw new Error("Select at least two proposed entries to combine.");
      const destination=selected[0];
      const preservedCover=destination.media.find((media)=>media.isCover)||destination.media[0];
      const selectedIds=new Set(selected.map((group)=>group.id));
      destination.media=selected.flatMap((group)=>group.media);
      destination.media.forEach((media)=>{
        media.isCover=media===preservedCover;
        if(media.isCover) media.role="result";
      });
      destination.selected=false;
      this.groups=this.groups.filter((group)=>group===destination||!selectedIds.has(group.id));
      return destination;
    }

    splitMedia(groupId,mediaId) {
      this.assertEditable();
      const groupIndex=this.groups.findIndex((entry)=>entry.id===groupId);
      const group=this.groups[groupIndex];
      if(!group||group.media.length<2) throw new Error("This image is already its own proposed entry.");
      const mediaIndex=group.media.findIndex((entry)=>entry.id===mediaId);
      if(mediaIndex<0) throw new Error("Portfolio image not found in this batch.");
      const [media]=group.media.splice(mediaIndex,1);
      media.isCover=true;
      media.role="result";
      if(!group.media.some((entry)=>entry.isCover)) {
        group.media[0].isCover=true;
        group.media[0].role="result";
      }
      const splitGroup={
        id:`batch-group-${this.nextGroupId++}`,
        selected:false,
        itemId:"",
        uploadStatus:"pending",
        error:"",
        media:[media],
      };
      this.groups.splice(groupIndex+1,0,splitGroup);
      return splitGroup;
    }

    setCover(groupId,mediaId) {
      this.assertEditable();
      const group=this.group(groupId);
      const media=this.media(groupId,mediaId);
      if(!group||!media) throw new Error("Portfolio image not found in this batch.");
      group.media.forEach((entry)=>{ entry.isCover=entry===media; });
      media.role="result";
      return media;
    }

    setRole(groupId,mediaId,role) {
      this.assertEditable();
      if(!roles.has(role)) throw new Error("Choose a valid portfolio media role.");
      const media=this.media(groupId,mediaId);
      if(!media) throw new Error("Portfolio image not found in this batch.");
      if(media.isCover&&role!=="result") throw new Error("The cover image must remain a Result.");
      media.role=role;
      return media;
    }

    setHealingState(groupId,mediaId,healingState) {
      this.assertEditable();
      if(!healingStates.has(healingState)) throw new Error("Choose a valid healing state.");
      const media=this.media(groupId,mediaId);
      if(!media) throw new Error("Portfolio image not found in this batch.");
      media.healingState=healingState;
      return media;
    }

    uploadStep(group,media) {
      if(media.uploadStatus==="complete") return "complete";
      if(media.isCover&&!group.itemId) return "create-entry";
      if(!media.isCover&&!media.imageRef) return "upload-media";
      return "document-media";
    }

    summary() {
      return {
        entries:this.groups.length,
        images:this.groups.reduce((total,group)=>total+group.media.length,0),
        selected:this.groups.filter((group)=>group.selected).length,
        completedEntries:this.groups.filter((group)=>group.uploadStatus==="complete").length,
        completedImages:this.groups.reduce((total,group)=>total+group.media.filter((media)=>media.uploadStatus==="complete").length,0),
      };
    }

    reset() {
      for(const group of this.groups) {
        for(const media of group.media) {
          if(media.previewUrl) this.revokePreview(media.previewUrl);
        }
      }
      this.groups=[];
    }
  }

  global.PortfolioBatchOrganizer=PortfolioBatchOrganizer;
})(typeof window!=="undefined"?window:globalThis);
