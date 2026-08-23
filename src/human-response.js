function parseJsonResponse(text=""){
  const raw=String(text||"").trim();
  const candidate=raw.startsWith("```json")?raw.replace(/^```json\s*/i,"").replace(/\s*```$/,"" ):raw;
  if(!candidate.startsWith("{")||!candidate.endsWith("}"))return null;
  try{return JSON.parse(candidate);}catch{return null;}
}

function registryFailure(payload){
  const code=String(payload?.error?.code||payload?.code||"").toUpperCase();
  const message=String(payload?.error?.message||payload?.message||"");
  return code.includes("REGISTRY")||/plan[- ]registry|registry mutation|registry invocation/i.test(message);
}

export function humanizeResponseText(text=""){
  const payload=parseJsonResponse(text);
  if(!payload||payload.ok!==false)return String(text||"");
  if(registryFailure(payload)){
    const planCreated=Boolean(payload.newPlanId),approvalCreated=Boolean(payload.newApprovalId),executed=Boolean(payload.executedRepairPlan);
    if(!planCreated&&!approvalCreated&&!executed)return [
      "I couldn’t update the repair plan because Georgie’s plan registry did not confirm the request.",
      "What this means: no replacement plan or approval was created, and no repair ran.",
      "What I’ll do next: keep the unsafe plan inactive and retry through the governed registry when it is available.",
      "You do not need to approve anything yet."
    ].join("\n\n");
  }
  const message=String(payload?.error?.message||payload?.message||"The requested action could not be completed.").trim();
  return [
    "I couldn’t complete that action.",
    `What happened: ${message}`,
    "What changed: nothing from this attempt.",
    "I’ll preserve the work and continue from the failed step when it is safe to do so."
  ].join("\n\n");
}

export function humanizeResponse(response={}){
  const text=humanizeResponseText(response?.text||"");
  return text===response?.text?response:{...response,text};
}
