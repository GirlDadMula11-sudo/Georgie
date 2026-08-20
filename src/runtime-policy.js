const TOOL_INTENT = /\b(open|launch|start|show|read|check|inspect|diagnose|health|status|deal|portfolio|lender|offer|pipeline|refresh|task|remind|email|mail|send|reply|search|find|clipboard|screen|screenshot|type|press|calendar|strategy|network)\b/i;
const CURRENT_INFO = /\b(today|tonight|current|currently|latest|recent|right now|news|weather|price|stock|market|score|schedule|law|rule|regulation|availability|technology climate|tech climate|technology trend|tech trend|future of|future direction|state of ai|ai landscape|competitive landscape|emerging technology|frontier model|realtime ai|agentic|agents)\b/i;
const DURABLE_MEMORY = /\b(remember|my preference|my goal|my daughter|my family|my company|we decided|previously|last time|our plan)\b/i;
const DEEP_REASONING = /\b(architect|architecture|root cause|diagnos|strategy|strategic|compare|tradeoff|optimi[sz]|design|plan|why|risk|forecast|underwrit|capitalmatch|system-wide|reconcile|regression|data integrity|evidence|contradiction|infrastructure|deployment|database|worker|queue|latency|performance|future|technology|tech|agentic|autonomous|multimodal|realtime|roadmap|competitive advantage|decision|dilemma|scenario|causal|assumption|counterargument|evaluate|investigate|research)\b/i;
const EXECUTIVE_REASONING = /\b(chief of staff|company direction|business direction|technology direction|tech direction|priorities|what next|next move|evolve|evolution|improve|enhance|maintain|monitor)\b/i;
const SIMPLE_LOCAL = /^(?:please\s+)?(?:open|launch|start|switch to|activate)\s+[^\n]{1,80}$/i;

export function runtimePolicy(input = "") {
  const text = String(input || "").trim();
  const words = text ? text.split(/\s+/).length : 0;
  const deep = DEEP_REASONING.test(text) || EXECUTIVE_REASONING.test(text);
  const simple = SIMPLE_LOCAL.test(text);
  const quick = !deep && !TOOL_INTENT.test(text) && !CURRENT_INFO.test(text) && words <= 18;
  return {
    needsToolRouter: !simple && TOOL_INTENT.test(text),
    allowWebTool: CURRENT_INFO.test(text),
    needsMemoryExtraction: words >= 8 && !/^(thanks|thank you|ok|okay|great|perfect|yes|no|done|got it)[.! ]*$/i.test(text),
    memoryLikelyUseful: DURABLE_MEMORY.test(text),
    reasoningEffort: simple || quick ? "low" : deep ? "high" : "medium",
    responseVerbosity: deep ? "medium" : words <= 12 ? "low" : "medium",
    latencyClass: simple || quick ? "instant" : deep ? "deep" : "standard"
  };
}

export function shouldRunMemoryExtraction(userText = "", assistantText = "") {
  const policy = runtimePolicy(userText);
  if (!policy.needsMemoryExtraction) return false;
  const combined = `${userText} ${assistantText}`;
  return policy.memoryLikelyUseful || /\b(prefer|always|never|need|want|goal|deadline|project|company|partner|client|lender|family|birthday|routine|constraint)\b/i.test(combined);
}
