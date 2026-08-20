const root=document.querySelector("#commandCenter");
const refresh=document.querySelector("#commandRefresh");
const list=document.querySelector("#commandPriorities");
const urgent=document.querySelector("#commandUrgent");
const tasks=document.querySelector("#commandTasks");
const approvals=document.querySelector("#commandApprovals");
const userId=localStorage.getItem("georgie:userId")||"primary";

function esc(value){return String(value||"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);}
function render(payload){const center=payload.commandCenter;urgent.textContent=center.summary.urgentPriorities;tasks.textContent=center.summary.openTasks;approvals.textContent=center.summary.pendingApprovals;const items=center.priorities.slice(0,6);list.innerHTML=items.length?items.map((item)=>`<article class="command-priority ${esc(item.priority)}"><div><span>${esc(item.domain)}</span><strong>${esc(item.title)}</strong></div><small>${esc(item.priority)}${item.dueAt?` • due ${esc(new Date(item.dueAt).toLocaleString())}`:""}</small></article>`).join(""):"<p>No open priorities were found in the connected evidence.</p>";root.dataset.ready="true";}
async function load(force=false){refresh.disabled=true;try{const response=await fetch(`/api/command-center${force?"?refresh=true":""}`,{headers:{"X-Georgie-User":userId}});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(response.status===401?"Command Center locked — open it from an enrolled Georgie device.":payload.error||"Command center unavailable");render(payload);}catch(error){list.innerHTML=`<p>${esc(error.message||"Command center unavailable")}</p>`;}finally{refresh.disabled=false;}}
refresh?.addEventListener("click",()=>load(true));
if(root)load(false);
