import fs from "node:fs";

const serverFile=new URL("../src/server.js",import.meta.url);
let server=fs.readFileSync(serverFile,"utf8");
const relayImport='import { createGithubReceiptRelayRouter } from "./github-receipt-relay.js";';
if(!server.includes(relayImport)){
  const anchor='import { createGovernedConnectorRouter } from "./governed-connector.js";';
  if(!server.includes(anchor))throw new Error("github receipt relay installer: server import anchor missing");
  server=server.replace(anchor,`${anchor}\n${relayImport}`);
}
const relayMount='app.use("/api/ai-control/receipt-relay",createGithubReceiptRelayRouter());';
if(!server.includes(relayMount)){
  const anchor='app.use("/api/connector",createGovernedConnectorRouter({executeCommand:({userId,sessionId,input})=>completeTurn({userId,sessionId,input,history:[]})}));';
  if(!server.includes(anchor))throw new Error("github receipt relay installer: connector mount anchor missing");
  server=server.replace(anchor,`${relayMount}\n${anchor}`);
}
fs.writeFileSync(serverFile,server);

const coordinatorFile=new URL("../src/engineering-coordinator.js",import.meta.url);
let coordinator=fs.readFileSync(coordinatorFile,"utf8");
const oldPending='const pending=await listPendingCallbacks(userId,{deliveryMode:"github_ai_control",limit}),results=[];';
const newPending='const pending=(await listPendingCallbacks(userId,{deliveryMode:"github_ai_control",limit})).filter(callback=>!/Resource not accessible by personal access token|permission_denied|GitHub request failed \\(403\\)/i.test(String(callback?.lastDeliveryError||""))),results=[];';
if(coordinator.includes(oldPending))coordinator=coordinator.replace(oldPending,newPending);
else if(!coordinator.includes(newPending))throw new Error("github receipt relay installer: receipt outbox anchor missing");
fs.writeFileSync(coordinatorFile,coordinator);

console.log("GitHub OIDC receipt relay installed");
