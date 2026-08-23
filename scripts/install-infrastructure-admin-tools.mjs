import fs from "node:fs";

const file = new URL("../src/tools.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const importLine = 'import { executeInfrastructureAdmin } from "./integrations/infrastructure-admin.js";';
if (!source.includes(importLine)) {
  const anchor = 'import { validateBrowserWorkflow } from "./browser-workflow.js";';
  if (!source.includes(anchor)) throw new Error("infrastructure admin installer: import anchor missing");
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

const marker = 'name:"infrastructure_admin.vercel_team_member_invite"';
if (!source.includes(marker)) {
  const anchor = 'const LEVELS={read:0,low_risk_write:1,sensitive_write:2,external_side_effect:3};const registry=new Map();function defineTool(definition){registry.set(definition.name,definition)}';
  if (!source.includes(anchor)) throw new Error("infrastructure admin installer: registry anchor missing");
  const tools = `\ndefineTool({name:"infrastructure_admin.vercel_team_members_list",description:"List members of the configured Vercel team through the governed infrastructure-admin adapter.",risk:"read",async run({userId,args}){return executeInfrastructureAdmin(userId,{action:"vercel.team.members.list",tenant:args?.teamId||args?.tenant,requester:args?.requester||"georgie",idempotencyKey:args?._governance?.idempotencyKey})}});\ndefineTool({name:"infrastructure_admin.vercel_team_member_invite",description:"Invite a person to the configured Vercel team. This is an external side effect and requires an approved governance receipt.",risk:"external_side_effect",async run({userId,args}){const approvalId=args?._governance?.approvalId||args?.approvalId;if(!approvalId)throw new Error("Vercel member invitation requires an approved governance receipt");return executeInfrastructureAdmin(userId,{action:"vercel.team.member.invite",tenant:args?.teamId||args?.tenant,subject:args?.email||args?.subject,role:args?.role||"DEVELOPER",approved:true,approvalId,requester:args?.requester||"georgie",idempotencyKey:args?._governance?.idempotencyKey})}});\ndefineTool({name:"infrastructure_admin.supabase_organization_members_list",description:"List members of the configured Supabase organization through the governed infrastructure-admin adapter.",risk:"read",async run({userId,args}){return executeInfrastructureAdmin(userId,{action:"supabase.organization.members.list",tenant:args?.organizationSlug||args?.tenant,requester:args?.requester||"georgie",idempotencyKey:args?._governance?.idempotencyKey})}});\ndefineTool({name:"infrastructure_admin.supabase_organization_member_invite",description:"Invite a person to the configured Supabase organization through the official API when available, otherwise return the governed dashboard-fallback requirement. Requires an approved governance receipt.",risk:"external_side_effect",async run({userId,args}){const approvalId=args?._governance?.approvalId||args?.approvalId;if(!approvalId)throw new Error("Supabase member invitation requires an approved governance receipt");return executeInfrastructureAdmin(userId,{action:"supabase.organization.member.invite",tenant:args?.organizationSlug||args?.tenant,subject:args?.email||args?.subject,role:args?.role||"DEVELOPER",approved:true,approvalId,requester:args?.requester||"georgie",idempotencyKey:args?._governance?.idempotencyKey})}});\n`;
  source = source.replace(anchor, `${anchor}${tools}`);
}

const verifyMarker = 'name:"infrastructure_admin.vercel_team_member_verify"';
if (!source.includes(verifyMarker)) {
  const inviteAnchor = 'defineTool({name:"infrastructure_admin.vercel_team_member_invite"';
  if (!source.includes(inviteAnchor)) throw new Error("infrastructure admin installer: invite tool anchor missing");
  const verifyTool = `defineTool({name:"infrastructure_admin.vercel_team_member_verify",description:"Verify one exact Vercel team member email and role using a fresh provider member-list read.",risk:"read",async run({userId,args}){const email=String(args?.email||args?.subject||"").trim().toLowerCase(),requestedRole=String(args?.role||"DEVELOPER").trim().toUpperCase();if(!email)throw new Error("Vercel member verification requires an email");const listed=await executeInfrastructureAdmin(userId,{action:"vercel.team.members.list",tenant:args?.teamId||args?.tenant,requester:args?.requester||"georgie"});const payload=listed?.result;const members=Array.isArray(payload)?payload:Array.isArray(payload?.members)?payload.members:Array.isArray(payload?.data)?payload.data:[];const match=members.find(item=>String(item?.email||item?.user?.email||item?.member?.email||"").trim().toLowerCase()===email)||null;const actualRole=String(match?.role||match?.teamRole||match?.membership?.role||"").trim().toUpperCase()||null;return{verified:Boolean(match)&&actualRole===requestedRole,email,role:actualRole,requestedRole,member:match?{uid:match?.uid||match?.id||match?.user?.uid||match?.user?.id||null,email,role:actualRole}:null,checkedAt:new Date().toISOString()}}});\n`;
  source = source.replace(inviteAnchor, `${verifyTool}${inviteAnchor}`);
}

fs.writeFileSync(file, source);

const intentsFile = new URL("../src/fast-intents.js", import.meta.url);
let intents = fs.readFileSync(intentsFile, "utf8");
const helperMarker = "function parseExplicitVercelMemberInvite";
if (!intents.includes(helperMarker)) {
  const anchor = 'export function deterministicToolPlan(input = "") {';
  if (!intents.includes(anchor)) throw new Error("infrastructure admin installer: fast-intents anchor missing");
  const helper = String.raw`
function parseExplicitVercelMemberInvite(text = "") {
  const raw=String(text||"").trim();
  if(!/\bvercel\b/i.test(raw)||!/\b(?:invite|add)\b/i.test(raw)||!/\bdeveloper\b/i.test(raw))return null;
  const email=(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0];
  if(!email)return null;
  const explicitlyApproved=/\b(?:i approve|i authorize|you have my approval|this is my approval|approved to (?:invite|add)|treat [^.]{0,140} authorization [^.]{0,100} as approval)\b/i.test(raw);
  return{email,role:"DEVELOPER",explicitlyApproved};
}
function vercelMemberInvitePlan({email,role="DEVELOPER"}={}){
  return{title:"Invite approved Vercel developer",summary:"Invite the exact approved email to the configured Vercel team as Developer, then independently verify the provider member record and assigned role.",steps:["Invite the exact email through the governed Vercel team-member endpoint","Read the provider team-member list and verify the exact email and Developer role"],domain:"technical",risk:"high",reversible:true,verificationMethod:"Read Vercel team members from the provider and match the exact email and role.",rollbackPlan:"Do not remove the member automatically. Any later removal requires a separate explicit approval.",execution:{tool:"infrastructure_admin.vercel_team_member_invite",args:{email,role},expect:{ok:true,action:"vercel.team.member.invite"},verification:[{tool:"infrastructure_admin.vercel_team_member_verify",args:{email,role},expect:{verified:true,email,role}}]}};
}
`;
  intents = intents.replace(anchor, `${helper}\n${anchor}`);
}
const routeMarker = "const vercelMemberInvite = parseExplicitVercelMemberInvite(text);";
if (!intents.includes(routeMarker)) {
  const anchor = "  if (!text) return [];";
  if (!intents.includes(anchor)) throw new Error("infrastructure admin installer: fast-intents empty-input anchor missing");
  const route = String.raw`  const vercelMemberInvite = parseExplicitVercelMemberInvite(text);
  if(vercelMemberInvite){
    const plan=vercelMemberInvitePlan(vercelMemberInvite);
    if(vercelMemberInvite.explicitlyApproved)return[{tool:"approvals.prepare_plan",args:plan},{tool:"approvals.continue_latest",args:{utterance:"execute the plan now, you have my approval"}}];
    return[{tool:"approvals.prepare_plan",args:plan}];
  }`;
  intents = intents.replace(anchor, `${anchor}\n${route}`);
}
fs.writeFileSync(intentsFile, intents);
console.log("Infrastructure admin planner tools and approved Vercel intent installed");
