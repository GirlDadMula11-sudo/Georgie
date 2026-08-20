const TOOL_INTENT = /\b(open|launch|start|show|read|check|inspect|diagnose|health|status|deal|portfolio|lender|offer|pipeline|refresh|task|remind|email|mail|send|reply|search|find|clipboard|screen|screenshot|type|press|calendar|strategy|network)\b/i;
const CURRENT_INFO = /\b(today|tonight|current|currently|latest|recent|right now|news|weather|price|stock|market|score|schedule|law|rule|regulation|availability)\b/i;
const DURABLE_MEMORY = /\b(remember|my preference|my goal|my daughter|my family|my company|we decided|previously|last time|our plan)\b/i;
const DEEP_REASONING = /\b(architect|architecture|root cause|diagnos|strategy|strategic|compare|tradeoff|optimi[sz]|design|plan|why|risk|forecast|underwrit|capitalmatch|system-wide)\b/i;

export function runtimePolicy(input = "") {
  const text = String(input || "").trim();
  const words = text ? text.split(/\s+/).length : 0;
  return {
    needsToolRouter: TOOL_INTENT.test(text),
    allowWebTool: CURRENT_INFO.test(text),
    needsMemoryExtraction: words >= 8 && !/^(thanks|thank you|ok|okay|great|perfect|yes|no|done|got it)[.! ]*$/i.test(text),
    memoryLikelyUseful: DURABLE_MEMORY.test(text),
    reasoningEffort: DEEP_REASONING.test(text) ? "medium" : "low",
    responseVerbosity: words <= 12 ? "low" : "medium"
  };
}

export function shouldRunMemoryExtraction(userText = "", assistantText = "") {
  const policy = runtimePolicy(userText);
  if (!policy.needsMemoryExtraction) return false;
  const combined = `${userText} ${assistantText}`;
  return policy.memoryLikelyUseful || /\b(prefer|always|never|need|want|goal|deadline|project|company|partner|client|lender|family|birthday|routine|constraint)\b/i.test(combined);
}
