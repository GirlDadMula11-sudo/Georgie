import test from "node:test";
import assert from "node:assert/strict";

process.env.GEORGIE_SUPABASE_URL="";
process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY="";

test("a disconnected caller cannot lose a delayed durable task result",async()=>{
  const {beginDurableTurn,getDurableTurn,runDurableTurn}=await import(`../src/durable-turn-runtime.js?test=${Date.now()}`);
  const job=await beginDurableTurn({requestId:"request-36-second-provider",userId:"u1",sessionId:"s1",input:"continue this investigation",recoverable:true});
  const operation=runDurableTurn({job,execute:async({onProgress})=>{
    onProgress({type:"status",stage:"tool_running",message:"Running the delayed provider check."});
    await new Promise(resolve=>setTimeout(resolve,80));
    return{text:"Verified delayed result",completed:true,actions:[],evidence:[{source:"test-provider"}]};
  }});
  // Simulate the browser disappearing without awaiting the operation.
  const whileDisconnected=await getDurableTurn("u1",job.requestId);
  assert.ok(["accepted","running"].includes(whileDisconnected.status));
  await operation;
  await new Promise(resolve=>setTimeout(resolve,10));
  const recovered=await getDurableTurn("u1",job.requestId);
  assert.equal(recovered.status,"completed");
  assert.equal(recovered.result.text,"Verified delayed result");
});
