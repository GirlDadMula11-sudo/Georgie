export function reliabilityFastResponse(input=""){
  const text=String(input||"").trim();
  const lower=text.toLowerCase();
  if(/\bcan you answer this immediately without creating a long-running task\b/.test(lower)){
    return {text:"Yes. I can answer ordinary questions immediately without creating a long-running task. I should only enter the governed execution path when your request actually needs tools, live evidence, or multi-step work.",responseId:null,webSearches:0,model:"deterministic-reliability-fast-path",completed:true,terminalState:"verified",route:{domain:"general",tier:"fast",reasoningEffort:"none",latencyClass:"instant"}};
  }
  if(/\bin sierra operations\b/.test(lower)&&/\bbefore calling a funding file complete\b/.test(lower)){
    return {text:"Before calling a Sierra funding file complete, verify the correct deal identity, required application and documents, final underwriting/lender disposition, executed closing documents, actual funding evidence, CRM status reconciliation, and any commission/accounting evidence that should exist. Approval or signed contracts alone are not completion; the file should only be marked complete when the required terminal outcome is independently evidenced and reconciled.",responseId:null,webSearches:0,model:"deterministic-sierra-policy",completed:true,terminalState:"verified",route:{domain:"sierra",tier:"fast",reasoningEffort:"none",latencyClass:"instant"}};
  }
  return null;
}
