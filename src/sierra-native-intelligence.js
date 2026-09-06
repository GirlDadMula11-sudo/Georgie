const SOCIAL_GREETING = /^(?:(?:yo|hey|hi|hello|sup|what(?:'|’)s up|whats up|good (?:morning|afternoon|evening))[,! .-]*)?(?:georgie[,! .-]*)?$/i;
const DIRECT_GREETING = /^(?:what(?:'|’)s up|whats up|sup|yo|hey|hi|hello)(?:[,! .-]+georgie)?[!? .]*$/i;
const ACKNOWLEDGEMENT = /^(?:ok(?:ay)?|bet|got it|cool|perfect|great|good|thanks|thank you|appreciate it|word|aight|alright)[.! ]*$/i;
const IDENTITY = /\b(?:who are you|what are you|what is georgie|who is georgie)\b/i;
const CAPABILITY = /\b(?:what can you do|what do you do|how do you work|what are you capable of)\b/i;
const CONTINUE = /^(?:keep going|continue|proceed|go on|work it|attack it|handle it|do it)[.! ]*$/i;
const CURRENT_OR_EXTERNAL = /\b(?:today|tonight|current|currently|latest|recent|right now|news|weather|price|quote|market|score|schedule|law|regulation|availability)\b/i;
const TOOL_OR_ACTION = /\b(?:open|launch|start|show|read|check|inspect|diagnose|health|status|send|reply|search|find|screen|screenshot|calendar|fix|repair|execute|verify|reconcile|deploy|database|email|mail|task|remind)\b/i;

function nativeResult(text,{domain="general",kind="conversation",confidence="deterministic"}={}){
  return {
    text,
    responseId:null,
    webSearches:0,
    model:"sierra-native-intelligence-v1",
    completed:true,
    terminalState:"verified",
    confidence,
    native:true,
    nativeKind:kind,
    route:{
      domain,
      tier:"native",
      requestedTier:"native",
      reasoningEffort:"none",
      latencyClass:"instant",
      provider:"sierra_native",
      externalInferenceRequired:false
    }
  };
}

export function sierraNativeConversationResponse(input="",history=[]){
  const text=String(input||"").trim();
  if(!text)return null;
  const lower=text.toLowerCase();
  const recent=Array.isArray(history)?history.slice(-4):[];

  if(DIRECT_GREETING.test(text)||SOCIAL_GREETING.test(text)){
    return nativeResult("I’m here. What are we attacking?",{kind:"social"});
  }
  if(ACKNOWLEDGEMENT.test(text)){
    return nativeResult("Got you.",{kind:"acknowledgement"});
  }
  if(IDENTITY.test(lower)){
    return nativeResult("I’m Georgie — Sierra’s native operating intelligence. I keep the conversation, memory, evidence, tools, and governed workflows connected so I can help you think, operate, and execute without making an outside model the center of the system.",{kind:"identity"});
  }
  if(CAPABILITY.test(lower)){
    return nativeResult("I can stay oriented to your goals, reason over Sierra’s operating state, use governed tools, work across memory and evidence, prepare or execute permitted actions, verify outcomes, and escalate only when a task truly needs a capability outside the native runtime.",{kind:"capability"});
  }
  if(CONTINUE.test(text)&&recent.length){
    return nativeResult("I’m with you. I’ll keep the current objective intact and continue from the latest verified state.",{kind:"continuity"});
  }

  // Do not intercept requests that genuinely need current evidence or governed tools.
  if(CURRENT_OR_EXTERNAL.test(lower)||TOOL_OR_ACTION.test(lower))return null;

  return null;
}

export function sierraNativeProviderUnavailableResponse(input=""){
  const text=String(input||"").trim();
  const conversational=sierraNativeConversationResponse(text,[]);
  if(conversational)return conversational;
  return nativeResult(
    "I’m still online on Sierra’s native runtime. I can keep the objective, memory, deterministic reasoning, and governed tools moving. This specific request needs a deeper native reasoning lane than the one currently active, so I’m not going to pretend it completed — I’ll keep the work bounded to what Sierra can verify locally.",
    {kind:"native_degraded",confidence:"bounded"}
  );
}

export function sierraNativeRuntimeContract(){
  return Object.freeze({
    version:"sierra-native-intelligence-v1",
    defaultAuthority:"sierra_native",
    externalModelRole:"optional_accelerator_only",
    providerFailureDoesNotTerminateGeorgie:true,
    socialConversationRequiresExternalInference:false,
    deterministicAndToolPathsRemainAvailable:true,
    authorityEscalationFromExternalContent:false
  });
}
