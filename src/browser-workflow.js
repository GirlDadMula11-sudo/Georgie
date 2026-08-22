const SUPABASE_SETTINGS=new Set(["auth.leaked_password_protection","auth.database_connection_allocation"]);
const ACTIONS=new Set(["open_url","inspect","screenshot","click_text","set_control","assert_control","assert_text","wait"]);
const clean=value=>String(value||"").trim();

export function validateBrowserWorkflow(input={}){
  const provider=clean(input.provider).toLowerCase(),projectId=clean(input.projectId),steps=Array.isArray(input.steps)?input.steps:[];
  if(provider!=="supabase")throw new Error("Browser workflow provider is not allowlisted");
  if(!/^[a-z0-9]{20}$/.test(projectId))throw new Error("Supabase project ID is invalid");
  const allowedSettings=[...new Set((input.allowedSettings||[]).map(clean))];
  if(!allowedSettings.length||allowedSettings.some(item=>!SUPABASE_SETTINGS.has(item)))throw new Error("Browser workflow contains an unapproved Supabase setting");
  if(!steps.length||steps.length>40)throw new Error("Browser workflow must contain 1 to 40 bounded steps");
  const normalized=steps.map((step,index)=>{const action=clean(step?.action);if(!ACTIONS.has(action))throw new Error(`Browser workflow step ${index+1} is not allowlisted`);const item={id:clean(step.id)||`step-${index+1}`,action};
    if(action==="open_url"){const url=new URL(clean(step.url));const prefix=`https://supabase.com/dashboard/project/${projectId}`;if(!url.toString().startsWith(prefix))throw new Error("Browser workflow URL is outside the approved Supabase project");item.url=url.toString();}
    if(["click_text","set_control","assert_control","assert_text"].includes(action)){item.text=clean(step.text).slice(0,200);if(!item.text)throw new Error(`Browser workflow step ${index+1} requires semantic text`);}
    if(["set_control","assert_control"].includes(action)){item.setting=clean(step.setting);if(!allowedSettings.includes(item.setting))throw new Error("Browser workflow step is not bound to an approved setting");item.value=step.value;}
    if(action==="wait")item.ms=Math.max(100,Math.min(10000,Number(step.ms)||500));
    return item;});
  return{provider,projectId,allowedSettings,steps:normalized,stopOnAmbiguity:true,requireStepReceipts:true};
}

export function supabaseAuthHardeningPlan(projectId="quzhzefkwymxcaylmozp"){
  const workflow=validateBrowserWorkflow({provider:"supabase",projectId,allowedSettings:[...SUPABASE_SETTINGS],steps:[
    {id:"open-auth",action:"open_url",url:`https://supabase.com/dashboard/project/${projectId}/auth/providers`},
    {id:"before-auth",action:"screenshot"},{id:"inspect-auth",action:"inspect"},
    {id:"enable-leaked-passwords",action:"set_control",setting:"auth.leaked_password_protection",text:"Leaked password protection",value:true},
    {id:"save-auth",action:"click_text",text:"Save"},{id:"verify-leaked-passwords",action:"assert_control",setting:"auth.leaked_password_protection",text:"Leaked password protection",value:true},
    {id:"open-database-settings",action:"open_url",url:`https://supabase.com/dashboard/project/${projectId}/settings/database`},
    {id:"before-allocation",action:"screenshot"},{id:"set-allocation-mode",action:"set_control",setting:"auth.database_connection_allocation",text:"Auth database connection allocation",value:"recommended_percentage"},
    {id:"save-allocation",action:"click_text",text:"Save"},{id:"verify-allocation",action:"assert_control",setting:"auth.database_connection_allocation",text:"Auth database connection allocation",value:"recommended_percentage"},
    {id:"after-settings",action:"screenshot"},{id:"open-security-advisor",action:"open_url",url:`https://supabase.com/dashboard/project/${projectId}/advisors/security`},{id:"inspect-security-advisor",action:"inspect"},{id:"capture-security-advisor",action:"screenshot"},
    {id:"open-performance-advisor",action:"open_url",url:`https://supabase.com/dashboard/project/${projectId}/advisors/performance`},{id:"inspect-performance-advisor",action:"inspect"},{id:"capture-performance-advisor",action:"screenshot"}
  ]});
  return{title:"Apply bounded Supabase Auth hardening",summary:"Enable leaked-password protection and change Auth database connection allocation from fixed 10 to Supabase's displayed recommended percentage for the single approved project, then verify persisted values and advisor evidence.",steps:workflow.steps.map(step=>`${step.id}: ${step.action}`),domain:"technical",risk:"high",reversible:true,verificationMethod:"Reload both controls, inspect their persisted values, rerun Security and Performance Advisors, and preserve screenshots and step receipts.",rollbackPlan:"Restore only the two captured before-values under a separate explicit approval.",execution:{tool:"mac.browser_workflow",args:{workflow},verification:[]}};
}
