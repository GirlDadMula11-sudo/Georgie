import { readCloudState, writeCloudState } from "./cloud-state.js";

const NAMESPACE="sierra_investigation_artifacts_v1",MAX_ARTIFACTS=40;
const now=()=>new Date().toISOString();
const clone=value=>value==null?value:structuredClone(value);
const DEFAULT_PAGE_BYTES=12000,MAX_PAGE_BYTES=24000;
const normalize=value=>({version:1,artifacts:Array.isArray(value?.artifacts)?value.artifacts.filter(Boolean):[]});
async function state(userId){return normalize(await readCloudState(userId,NAMESPACE,{version:1,artifacts:[]}));}
async function save(userId,artifact){const current=await state(userId);const next={version:1,updatedAt:now(),artifacts:[clone(artifact),...current.artifacts.filter(item=>item.investigationId!==artifact.investigationId)].slice(0,MAX_ARTIFACTS)};if(!await writeCloudState(userId,NAMESPACE,next))throw new Error("Durable investigation artifact storage is unavailable");return clone(artifact);}

function contractRecord(step){return{contractId:step.stepId,contract:step.tool,contractVersion:Number(step.contractVersion)||1,input:clone(step.args||{}),status:step.status,startedAt:step.startedAt||null,completedAt:step.completedAt||null,output:clone(step.evidenceOutput??step.result??null),error:step.error||null,evidenceReferences:Array.isArray(step.evidenceReferences)?clone(step.evidenceReferences):[],freshness:{observedAt:step.completedAt||null,maxAgeMs:Number(step.freshnessMs)||null},persistedAt:now()};}
function reportSections(plan){const contracts=(plan.steps||[]).map(contractRecord),failed=contracts.filter(item=>item.status!=="completed"),completed=contracts.filter(item=>item.status==="completed");return[
  {id:"executive-verdict",title:"Executive verdict",content:{investigationId:plan.requestId,scope:plan.scope,status:failed.length?"blocked":"verified",completedContracts:completed.length,totalContracts:contracts.length}},
  {id:"contract-evidence",title:"Contract evidence",content:contracts.map(({output,...item})=>({...item,hasOutput:output!==null}))},
  {id:"gaps-and-contradictions",title:"Gaps and contradictions",content:{evidenceGaps:clone(plan.synthesis?.evidenceGaps||[]),contradictions:clone(plan.synthesis?.contradictions||[]),unresolved:clone(plan.synthesis?.unresolved||[])}},
  {id:"next-action",title:"Next decisive action",content:{repairPlan:clone(plan.repairPlan||null),blocked:failed.map(item=>({contract:item.contract,error:item.error||"No verified output"}))}}
].map((section,index)=>({...section,status:"generated",version:1,sequence:index+1,generatedAt:now(),deliveredAt:null}));}

export function createInvestigationArtifact(plan){return{investigationId:plan.requestId,version:Number(plan.version)||1,scope:plan.scope,reference:plan.reference||null,createdAt:plan.createdAt||now(),updatedAt:now(),contracts:(plan.steps||[]).map(contractRecord),sections:reportSections(plan),lifecycle:{executionFinishedAt:plan.completedAt||now(),evidencePersistedAt:null,evidenceReadBackAt:null,reportGeneratedAt:now(),reportDeliveredAt:null},evidenceCoverage:{verified:0,total:(plan.steps||[]).length,readBackPassed:false},status:"evidence_persisting"};}
export function certifyInvestigationReadBack(artifact,readBack){const verified=readBack?.contracts?.filter(item=>item.status==="completed"&&item.output!==null&&item.contract&&item.contractId).length||0;artifact.lifecycle.evidencePersistedAt=now();artifact.lifecycle.evidenceReadBackAt=now();artifact.evidenceCoverage={verified,total:artifact.contracts.length,readBackPassed:Boolean(readBack&&verified===artifact.contracts.length)};artifact.status=artifact.evidenceCoverage.readBackPassed?"report_ready":"blocked_incomplete_evidence";return artifact;}
export async function persistInvestigationArtifact(userId,plan){const artifact=createInvestigationArtifact(plan);await save(userId,artifact);const readBack=await openInvestigationArtifact(userId,plan.requestId);certifyInvestigationReadBack(artifact,readBack);return save(userId,artifact);}
export async function openInvestigationArtifact(userId,investigationId){const current=await state(userId);return clone(current.artifacts.find(item=>item.investigationId===investigationId)||null);}
function compactContract(item){return{contractId:item.contractId,contract:item.contract,contractVersion:item.contractVersion,status:item.status,startedAt:item.startedAt,completedAt:item.completedAt,error:item.error,evidenceReferences:clone(item.evidenceReferences||[]),freshness:clone(item.freshness||{}),persistedAt:item.persistedAt,hasOutput:item.output!==null};}
function bounded(value,maxBytes){const json=JSON.stringify(value);if(Buffer.byteLength(json)<=maxBytes)return{value:clone(value),truncated:false,bytes:Buffer.byteLength(json)};return{value:null,truncated:true,bytes:Buffer.byteLength(json)};}
export function investigationArtifactPage(artifact,{cursor=null,includeRaw=false,maxBytes=DEFAULT_PAGE_BYTES}={}){
  if(!artifact)return null;
  const safeMax=Math.max(2000,Math.min(MAX_PAGE_BYTES,Number(maxBytes)||DEFAULT_PAGE_BYTES));
  const sections=[...(artifact.sections||[])].sort((a,b)=>(a.sequence||0)-(b.sequence||0));
  const requested=String(cursor||"").trim();
  const index=requested?Math.max(0,sections.findIndex(item=>item.id===requested)):Math.max(0,sections.findIndex(item=>item.status!=="delivered"));
  const section=sections[index]||null,next=sections[index+1]||null;
  const contractSummaries=(artifact.contracts||[]).map(compactContract);
  const sectionPayload=bounded(section,safeMax);
  const rawContractId=includeRaw&&requested.startsWith("contract:")?requested.slice(9):null;
  const raw=rawContractId?(artifact.contracts||[]).find(item=>item.contractId===rawContractId):null;
  const rawPayload=raw?bounded(raw.output,safeMax):null;
  return{
    investigationId:artifact.investigationId,version:artifact.version,scope:artifact.scope,reference:artifact.reference,
    lifecycle:clone(artifact.lifecycle),evidenceCoverage:clone(artifact.evidenceCoverage),status:artifact.status,
    contracts:contractSummaries,section:sectionPayload.value,sectionTruncated:sectionPayload.truncated,
    rawContract:raw?{...compactContract(raw),output:rawPayload.value,outputTruncated:rawPayload.truncated,outputBytes:rawPayload.bytes}:null,
    cursor:section?.id||null,nextCursor:next?.id||null,firstUndeliveredCursor:sections.find(item=>item.status!=="delivered")?.id||null,
    complete:Boolean(artifact.lifecycle?.reportDeliveredAt),availableSectionIds:sections.map(item=>item.id),
    rawEvidenceAccess:{mode:"explicit_contract_cursor",cursorFormat:"contract:<contractId>",defaultIncluded:false}
  };
}
export async function listInvestigationArtifacts(userId,{limit=20}={}){const current=await state(userId);return clone(current.artifacts.slice(0,Math.max(1,Math.min(MAX_ARTIFACTS,Number(limit)||20))));}
export async function checkpointReportDelivery(userId,investigationId,{sectionId=null,delivered=false}={}){const artifact=await openInvestigationArtifact(userId,investigationId);if(!artifact)throw new Error(`Investigation artifact ${investigationId} was not found`);if(sectionId){const section=artifact.sections.find(item=>item.id===sectionId);if(!section)throw new Error(`Report section ${sectionId} was not found`);section.deliveredAt=now();section.status="delivered";}const allDelivered=artifact.sections.length>0&&artifact.sections.every(item=>item.status==="delivered");if(delivered&&!allDelivered)throw new Error("The report cannot be marked delivered while sections remain undelivered");if(allDelivered){artifact.lifecycle.reportDeliveredAt=now();artifact.status="delivered";}artifact.updatedAt=now();return save(userId,artifact);}
export function nextUndeliveredSection(artifact){return artifact?.sections?.find(item=>item.status!=="delivered")||null;}
