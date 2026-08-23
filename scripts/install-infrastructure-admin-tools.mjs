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
  const anchor = 'const LEVELS={read:0,low_risk_write:1,sensitive_write:2,external_side_effect:3};';
  if (!source.includes(anchor)) throw new Error("infrastructure admin installer: registry anchor missing");
  const tools = `\ndefineTool({name:"infrastructure_admin.vercel_team_members_list",description:"List members of the configured Vercel team through the governed infrastructure-admin adapter.",risk:"read",async run({userId,args}){return executeInfrastructureAdmin(userId,{action:"vercel.team.members.list",tenant:args?.teamId||args?.tenant,requester:args?.requester||"georgie",idempotencyKey:args?._governance?.idempotencyKey})}});\ndefineTool({name:"infrastructure_admin.vercel_team_member_invite",description:"Invite a person to the configured Vercel team. This is an external side effect and requires an approved governance receipt.",risk:"external_side_effect",async run({userId,args}){const approvalId=args?._governance?.approvalId||args?.approvalId;if(!approvalId)throw new Error("Vercel member invitation requires an approved governance receipt");return executeInfrastructureAdmin(userId,{action:"vercel.team.member.invite",tenant:args?.teamId||args?.tenant,subject:args?.email||args?.subject,role:args?.role||"DEVELOPER",approved:true,approvalId,requester:args?.requester||"georgie",idempotencyKey:args?._governance?.idempotencyKey})}});\ndefineTool({name:"infrastructure_admin.supabase_organization_members_list",description:"List members of the configured Supabase organization through the governed infrastructure-admin adapter.",risk:"read",async run({userId,args}){return executeInfrastructureAdmin(userId,{action:"supabase.organization.members.list",tenant:args?.organizationSlug||args?.tenant,requester:args?.requester||"georgie",idempotencyKey:args?._governance?.idempotencyKey})}});\ndefineTool({name:"infrastructure_admin.supabase_organization_member_invite",description:"Invite a person to the configured Supabase organization through the official API when available, otherwise return the governed dashboard-fallback requirement. Requires an approved governance receipt.",risk:"external_side_effect",async run({userId,args}){const approvalId=args?._governance?.approvalId||args?.approvalId;if(!approvalId)throw new Error("Supabase member invitation requires an approved governance receipt");return executeInfrastructureAdmin(userId,{action:"supabase.organization.member.invite",tenant:args?.organizationSlug||args?.tenant,subject:args?.email||args?.subject,role:args?.role||"DEVELOPER",approved:true,approvalId,requester:args?.requester||"georgie",idempotencyKey:args?._governance?.idempotencyKey})}});\n`;
  source = source.replace(anchor, `${anchor}${tools}`);
}

fs.writeFileSync(file, source);
console.log("Infrastructure admin planner tools installed");
