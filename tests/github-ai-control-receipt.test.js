import test from "node:test";
import assert from "node:assert/strict";

process.env.GEORGIE_GITHUB_TOKEN="test-token";
const { postAIControlReceipt }=await import(`../src/integrations/github-ai-control.js?test=${Date.now()}`);
const jsonResponse=(data,status=200)=>({status,async text(){return JSON.stringify(data);}});

test("lost GitHub create response is recovered by marker read-back without a duplicate receipt",async()=>{
  const originalFetch=global.fetch,comments=[];let postCalls=0,getCalls=0;
  global.fetch=async(url,options={})=>{
    const method=String(options.method||"GET").toUpperCase();
    if(method==="GET"&&String(url).includes("/issues/68/comments")){getCalls+=1;return jsonResponse(comments,200);}
    if(method==="POST"&&String(url).includes("/issues/68/comments")){postCalls+=1;const payload=JSON.parse(options.body);comments.push({id:101,html_url:"https://example.test/comment/101",body:payload.body});throw new Error("simulated lost response after provider commit");}
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  try{
    const payload={commandId:"cmd-receipt-lost-001",correlationId:"corr-receipt-lost-001",status:"completed",summary:"Provider state verified.",evidenceRefs:["ev_test"],terminal:true};
    const first=await postAIControlReceipt("GirlDadMula11-sudo/Georgie",68,payload);
    assert.equal(first.ok,true);assert.equal(first.readBackConfirmed,true);assert.equal(first.writeAttempts,1);assert.equal(postCalls,1);assert.equal(comments.length,1);assert.ok(getCalls>=2);
    const replay=await postAIControlReceipt("GirlDadMula11-sudo/Georgie",68,payload);
    assert.equal(replay.ok,true);assert.equal(replay.readBackConfirmed,true);assert.equal(replay.deduplicated,true);assert.equal(replay.writeAttempts,0);assert.equal(postCalls,1);assert.equal(comments.length,1);
  }finally{global.fetch=originalFetch;}
});

test("an existing command receipt is updated in place for a later status revision",async()=>{
  const originalFetch=global.fetch,comments=[];let postCalls=0,patchCalls=0;
  global.fetch=async(url,options={})=>{
    const method=String(options.method||"GET").toUpperCase();
    if(method==="GET"&&String(url).includes("/issues/68/comments"))return jsonResponse(comments,200);
    if(method==="POST"&&String(url).includes("/issues/68/comments")){postCalls+=1;const payload=JSON.parse(options.body);const comment={id:202,html_url:"https://example.test/comment/202",body:payload.body};comments.push(comment);return jsonResponse(comment,201);}
    if(method==="PATCH"&&String(url).includes("/issues/comments/202")){patchCalls+=1;const payload=JSON.parse(options.body);comments[0]={...comments[0],body:payload.body};return jsonResponse(comments[0],200);}
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  try{
    const base={commandId:"cmd-receipt-revision-001",correlationId:"corr-receipt-revision-001",summary:"Mutation accepted; verification pending.",terminal:false};
    const pending=await postAIControlReceipt("GirlDadMula11-sudo/Georgie",68,{...base,status:"executed_pending_verification"});
    assert.equal(pending.ok,true);assert.equal(postCalls,1);assert.equal(comments.length,1);
    const completed=await postAIControlReceipt("GirlDadMula11-sudo/Georgie",68,{...base,status:"completed",summary:"Mutation verified.",terminal:true});
    assert.equal(completed.ok,true);assert.equal(completed.readBackConfirmed,true);assert.equal(postCalls,1);assert.equal(patchCalls,1);assert.equal(comments.length,1);assert.match(comments[0].body,/Status: \*\*completed\*\*/);
  }finally{global.fetch=originalFetch;}
});
