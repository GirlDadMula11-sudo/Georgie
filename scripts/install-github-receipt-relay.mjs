import fs from "node:fs";

const serverFile=new URL("../src/server.js",import.meta.url);
let server=fs.readFileSync(serverFile,"utf8");
const relayImport='import { createGithubReceiptRelayRouter } from "./github-receipt-relay.js";';
if(!server.includes(relayImport)){
  const anchor='import { createGovernedConnectorRouter } from "./governed-connector.js";';
  if(!server.includes(anchor))throw new Error("github receipt relay installer: server import anchor missing");
  server=server.replace(anchor,`${anchor}\n${relayImport}`);
}
const inboundImport='import { createGithubControlInboundRouter } from "./github-control-inbound.js";';
if(!server.includes(inboundImport))server=server.replace(relayImport,`${relayImport}\n${inboundImport}`);
const relayMount='app.use("/api/ai-control/receipt-relay",createGithubReceiptRelayRouter());';
if(!server.includes(relayMount)){
  const anchor='app.use("/api/connector",createGovernedConnectorRouter({executeCommand:({userId,sessionId,input})=>completeTurn({userId,sessionId,input,history:[]})}));';
  if(!server.includes(anchor))throw new Error("github receipt relay installer: connector mount anchor missing");
  server=server.replace(anchor,`${relayMount}\n${anchor}`);
}
const inboundMount='app.use("/api/ai-control/inbound",createGithubControlInboundRouter());';
if(!server.includes(inboundMount))server=server.replace(relayMount,`${relayMount}\n${inboundMount}`);
fs.writeFileSync(serverFile,server);

const coordinatorFile=new URL("../src/engineering-coordinator.js",import.meta.url);
let coordinator=fs.readFileSync(coordinatorFile,"utf8");
const oldPending='const pending=await listPendingCallbacks(userId,{deliveryMode:"github_ai_control",limit}),results=[];';
const newPending='const pending=(await listPendingCallbacks(userId,{deliveryMode:"github_ai_control",limit})).filter(callback=>!/Resource not accessible by personal access token|permission_denied|GitHub request failed \\(403\\)/i.test(String(callback?.lastDeliveryError||""))),results=[];';
if(coordinator.includes(oldPending))coordinator=coordinator.replace(oldPending,newPending);
else if(!coordinator.includes(newPending))throw new Error("github receipt relay installer: receipt outbox anchor missing");
fs.writeFileSync(coordinatorFile,coordinator);

const connectorFile=new URL("../src/governed-connector.js",import.meta.url);
let connector=fs.readFileSync(connectorFile,"utf8");
const unsafeActiveOwnerReturn='return{acquired:lease.owner===workerId,lease:leasePublic(lease)};';
const fencedActiveOwnerReturn='return{acquired:false,duplicateExecutionPrevented:true,lease:leasePublic(lease)};';
const activeLeaseReturn='return{acquired:false,active:true,lease:leasePublic(lease)};';
if(connector.includes(unsafeActiveOwnerReturn))connector=connector.replace(unsafeActiveOwnerReturn,fencedActiveOwnerReturn);
else if(!connector.includes(fencedActiveOwnerReturn)&&!connector.includes(activeLeaseReturn))throw new Error("github receipt relay installer: governed connector lease anchor missing");
fs.writeFileSync(connectorFile,connector);

console.log("GitHub OIDC receipt relay and control inbound installed");
