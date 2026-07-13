(function(){
  async function resolve(){
    const explicit=document.documentElement.dataset.constructEntity||document.body?.dataset.constructEntity;if(explicit)return explicit;
    const flash=location.pathname.match(/^\/tattoos\/flash\/([^/]+)\/?$/);if(flash){const response=await fetch(`/api/flash/${encodeURIComponent(flash[1])}`,{headers:{accept:"application/json"}});if(response.ok)return(await response.json()).record?.id}
    const event=location.pathname.match(/^\/events\/([^/]+)\/?$/);if(event&&!['calendar','confirmed'].includes(event[1])){const response=await fetch('/api/events',{headers:{accept:'application/json'}});if(response.ok)return((await response.json()).events||[]).find(item=>item.slug===event[1])?.id}
    return "";
  }
  async function start(){try{const entityId=await resolve();if(!entityId)return;const footer=document.querySelector("footer"),host=document.createElement("section");if(footer?.parentNode)footer.parentNode.insertBefore(host,footer);else document.body.appendChild(host);const script=document.createElement("script");script.src="/js/construct-connections.js?v=1";script.onload=()=>window.ConstructConnections?.mount({entityId,host});document.head.appendChild(script)}catch{/* Static page remains usable if the managed API is unavailable. */}}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();
