import { parseAIControlEnvelopes } from "../ai-control-envelope.js";

const GITHUB_BASE="https://api.github.com";
const DEFAULT_REPOSITORY="GirlDadMula11-sudo/Georgie";
const DEFAULT_TRUSTED=["GirlDadMula11-sudo"];
const token=()=>String(process.env.GEORGIE_GITHUB_TOKEN||process.env.GITHUB_TOKEN||"").trim();
const trustedAuthors=()=>new Set(String(process.env.GEORGIE_HANDOFF_TRUSTED_AUTHORS||DEFAULT_TRUSTED.join(",")).split(",").map(v=>v.trim()).filter(Boolean));
const allowedRepo=repository=>String(repository||DEFAULT_REPOSITORY)===DEFAULT_REPOSITORY;

async function request(path,{method="GET",body,expected=[200]}={}){
  const credential=token();if(!credential)return{ok:false,error:{code:"authentication_missing",message:"GitHub credential is not configured"}};
  try{
    const response=await fetch(`${GITHUB_BASE}${path}`,{method,headers:{authorization:`Bearer ${credential}`,accept:"application/vnd.github+json","content-type":"application/json","x-github-api-version":"2022-11-28"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
    const text=await response.text();let data=null;if(text){try{data=JSON.parse(text);}catch{return{ok:false,error:{code:"malformed_response",message:"GitHub returned non-JSON"}};}}
    if(!expected.includes(response.status))return{ok:false,error:{code:response.status===401?"authentication_missing":response.status===403?"permission_denied":"provider_error",status:response.status,message:String(data?.message||`GitHub request failed (${response.status})`).slice(0,500)}};
    return{ok:true,data,status:response.status};
  }catch(error){return{ok:false,error:{code:"connector_unavailable",message:error instanceof Error?error.message:String(error)}};}
}

export function githubAIControlConfigured(){return Boolean(token());}

export async function listTrustedAIControlCommands(repository=DEFAULT_REPOSITORY){
  if(!allowedRepo(repository))return{ok:false,error:{code:"permission_denied",message:"AI control transport repository is not allowlisted"}};
  const issues=await request(`/repos/${repository}/issues?state=open&labels=georgie-handoff&per_page=30&sort=updated&direction=asc`);if(!issues.ok)return issues;
  const authors=trustedAuthors(),commands=[],rejected=[];
  for(const issue of (Array.isArray(issues.data)?issues.data:[]).filter(row=>!row.pull_request)){
    const comments=await request(`/repos/${repository}/issues/${issue.number}/comments?per_page=100`);if(!comments.ok){rejected.push({issueNumber:issue.number,error:comments.error});continue;}
    for(const comment of Array.isArray(comments.data)?comments.data:[]){
      const body=String(comment.body||"");if(!body.includes("ai-control:v1")||body.includes("georgie-receipt:"))continue;
      const author=String(comment.user?.login||"");if(!authors.has(author)){rejected.push({issueNumber:issue.number,commentId:comment.id,reason:"untrusted_author",author});continue;}
      for(const parsed of parseAIControlEnvelopes(body)){
        if(!parsed.ok){rejected.push({issueNumber:issue.number,commentId:comment.id,reason:"invalid_envelope",error:parsed.error});continue;}
        commands.push({repository,issueNumber:issue.number,issueUrl:issue.html_url||null,commentId:comment.id,commentUrl:comment.html_url||null,author,createdAt:comment.created_at||null,envelope:parsed.envelope});
      }
    }
  }
  return{ok:true,commands,rejected};
}

export async function postAIControlReceipt(repository=DEFAULT_REPOSITORY,issueNumber,{commandId,correlationId,status,summary,evidenceRefs=[],terminal=true}={}){
  if(!allowedRepo(repository))return{ok:false,error:{code:"permission_denied",message:"AI control transport repository is not allowlisted"}};
  const marker=`<!-- georgie-receipt:${String(commandId||correlationId||"unknown").replace(/[^a-zA-Z0-9._:-]/g,"").slice(0,160)} -->`;
  const body=["### Georgie AI-control receipt",`Command: \`${String(commandId||"unknown").slice(0,220)}\``,`Correlation: \`${String(correlationId||commandId||"unknown").slice(0,220)}\``,`Status: **${String(status||"updated").slice(0,80)}**`,`Terminal: **${terminal?"yes":"no"}**`,"",String(summary||"").slice(0,5000),evidenceRefs.length?`\nEvidence: ${evidenceRefs.map(v=>`\`${String(v).slice(0,300)}\``).join(", ")}`:"","",marker].filter(Boolean).join("\n");
  const result=await request(`/repos/${repository}/issues/${Number(issueNumber)}/comments`,{method:"POST",body:{body},expected:[201]});
  return result.ok?{ok:true,commentId:result.data?.id||null,url:result.data?.html_url||null}:result;
}
