import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { completeTurnV2 } from "../src/v2-turn-engine.js";

const agent = await fs.readFile(new URL("../mac-agent/agent.js", import.meta.url), "utf8");
const tools = await fs.readFile(new URL("../src/tools.js", import.meta.url), "utf8");
const queue = await fs.readFile(new URL("../src/mac/queue.js", import.meta.url), "utf8");
const projectRoot = "/Users/mac/Documents/Georgie Roblox Projects/makayla-horror-prototype";
const playTestJobId = "idem-cb7e9b3ba3d078186977ba33a5a18acc371cb90f";

test("Mac agent performs a bounded Studio play test with six gameplay checks", () => {
  assert.match(agent, /case "roblox\.play_test_validate"/);
  for (const check of ["spawning","threeRelics","watcherChase","exitDoorUnlock","lighting","controls"]) assert.match(agent, new RegExp(`${check}:`));
  assert.match(agent, /Georgie prototype loaded:/);
  assert.match(agent, /key code 96/);
  assert.match(agent, /shift down/);
  assert.match(agent, /screenshotSha256/);
  assert.match(agent, /screenshotCaptured: Boolean\(screenshotSha256\)/);
  assert.match(agent, /screenshotError/);
  assert.match(agent, /for \(const candidate of candidates\)/);
  assert.match(agent, /runtimeSearchedLogCount/);
  assert.match(agent, /waitForRobloxStudioArtifactWindow/);
  assert.match(agent, /openRobloxStudioArtifactThroughFileDialog/);
  assert.match(agent, /keystroke "o" using \{command down\}/);
  assert.match(agent, /menu bar item "File" of menu bar 1/);
  assert.match(agent, /Open from File…/);
  assert.match(agent, /perform action "AXPress" of openMenuItem/);
  assert.match(agent, /open_panel_wait_after_file_menu/);
  assert.match(agent, /count of sheets of resolvedWindow/);
  assert.match(agent, /file_menu_item/);
  assert.match(agent, /keystroke "g" using \{command down, shift down\}/);
  assert.match(agent, /ROBLOX_STUDIO_OPEN_PANEL_NOT_FOUND/);
  assert.match(agent, /ROBLOX_STUDIO_GO_TO_FOLDER_FIELD_NOT_FOUND/);
  assert.match(agent, /set value of attribute "AXValue" of pathField to expectedArtifact/);
  assert.match(agent, /perform action "AXPress" of openButton/);
  assert.match(agent, /value of attribute "AXDefaultButton" of openPanel/);
  assert.match(agent, /repeat with candidateElement in \(entire contents of openPanel\)/);
  assert.match(agent, /candidateRole is "AXButton"/);
  assert.match(agent, /studioFileOpenControlStrategy/);
  assert.match(agent, /execFileAsync\("osacompile"/);
  assert.match(agent, /applescript_compile/);
  assert.match(agent, /studioFileOpenCompiled/);
  assert.match(agent, /compiled_scpt/);
  assert.match(agent, /execFileAsync\("osascript", \[compileTarget\]/);
  assert.match(agent, /open_button_default_wait/);
  assert.match(agent, /open_button_nested_scan/);
  assert.match(agent, /repeat 3 times/);
  assert.match(agent, /studioFileOpenExecutionMode/);
  assert.match(agent, /set resolvedElement to contents of candidateElement/);
  assert.match(agent, /set resolvedDiagnosticElement to contents of diagnosticElement/);
  assert.match(agent, /AXRole" of resolvedElement/);
  assert.match(agent, /candidateTitle is "Open" or candidateDescription is "Open"/);
  const fileDialog = agent.slice(agent.indexOf("async function openRobloxStudioArtifactThroughFileDialog"), agent.indexOf("async function activateRobloxStudioPlayMode"));
  assert.doesNotMatch(fileDialog, /ignoring case/);
  assert.match(agent, /ROBLOX_STUDIO_OPEN_PANEL_STUCK/);
  assert.match(agent, /if \(!studioWindow\.ready\) return/);
  assert.match(agent, /AXDocument/);
  assert.match(agent, /perform action "AXRaise"/);
  assert.match(agent, /studioWindowMatched/);
  assert.match(agent, /studioDocumentPath/);
  assert.match(agent, /artifactOpenRequested/);
  assert.match(agent, /studioFileOpenAttempted/);
  assert.match(agent, /studioFileOpenError/);
  assert.match(agent, /studioFileOpenStage/);
  assert.match(agent, /studioFileOpenErrorCode/);
  assert.match(agent, /studioFileOpenTopology/);
  assert.match(agent, /entire contents of diagnosticPanel/);
  assert.match(agent, /error\?\.stderr/);
  assert.match(agent, /open_panel_wait/);
  assert.match(agent, /path_field_wait/);
  assert.match(agent, /studioWindowReady/);
  assert.match(agent, /activationAttempts/);
  assert.match(agent, /playStarted: runtime\.observed/);
  assert.match(agent, /\["roblox\.install_rojo_and_build","roblox\.play_test_validate"\]\.includes\(job\.action\)/);
  assert.match(queue, /LONG_RUNNING_MAC_ACTIONS=new Set\(\["roblox\.install_rojo_and_build","roblox\.play_test_validate"\]\)/);
  assert.match(queue, /play_test_exact_artifact_window_repaired/);
  assert.match(queue, /play_test_open_element_dereference_repaired/);
  assert.match(queue, /play_test_screenshot_evidence_repaired/);
  assert.match(tools, /name:"roblox\.play_test_validate"/);
  assert.match(tools, /requiredAgentVersion:"2\.2\.54"/);
  assert.match(tools, /runtimeMarkerObserved/);
  assert.match(tools, /safeResult\.checks/);
  const activation = agent.slice(agent.indexOf("async function activateRobloxStudioPlayMode"), agent.indexOf("async function playTestRobloxPrototype"));
  assert.ok(activation.indexOf("if (!studioWindow.ready) return") < activation.indexOf("key code 96"), "F5 must remain unreachable until the exact artifact window is verified");
});

test("exact play-test recovery marker preserves the completed job identity", () => {
  const request = {jobId:playTestJobId,deviceId:"primary-mac",expectedAction:"roblox.play_test_validate",projectRoot,requiredAgentVersion:"2.2.54"};
  const [action] = deterministicToolPlan(`ROBLOX_PLAY_TEST_RECOVERY_JSON: ${JSON.stringify(request)}`);
  assert.equal(action.tool, "approvals.prepare_plan");
  assert.equal(action.args.execution.tool, "mac.long_running_job_recover");
  assert.equal(action.args.execution.args.jobId, playTestJobId);
  assert.match(action.args.summary, /do not enqueue another play-test or Roblox build job/i);
});

test("exact play-test recovery prepares through the bounded Roblox fast path", async () => {
  const request = {jobId:playTestJobId,deviceId:"primary-mac",expectedAction:"roblox.play_test_validate",projectRoot,requiredAgentVersion:"2.2.54"};
  const started = Date.now();
  const result = await completeTurnV2({
    userId:`roblox-play-test-fast-path-${Date.now()}`,
    sessionId:"connector:openai:objective:roblox-makayla-playtest-gate",
    input:`ROBLOX_PLAY_TEST_RECOVERY_JSON: ${JSON.stringify(request)}`,
    history:[],
    shouldFinalize:()=>false
  });
  assert.equal(result.engine,"unified-georgie-runtime-v1-roblox-fast-path");
  assert.equal(result.actions.length,1);
  assert.equal(result.actions[0].tool,"approvals.prepare_plan");
  if(result.actions[0].ok)assert.equal(result.actions[0].result.plan.execution.tool,"mac.long_running_job_recover");
  else assert.equal(result.actions[0].blockedBy,"runtime_execution_failure");
  assert.ok(Date.now()-started<1000,"deterministic recovery plan registration must remain sub-second");
});

test("play-test recovery marker rejects identity, path, action, or version expansion", () => {
  const valid = {jobId:playTestJobId,deviceId:"primary-mac",expectedAction:"roblox.play_test_validate",projectRoot,requiredAgentVersion:"2.2.54"};
  for (const request of [
    {...valid,deviceId:"secondary-mac"},
    {...valid,expectedAction:"roblox.prototype_build"},
    {...valid,projectRoot:"/Users/mac/Documents/Other"},
    {...valid,requiredAgentVersion:"2.2.41"}
  ]) assert.deepEqual(deterministicToolPlan(`ROBLOX_PLAY_TEST_RECOVERY_JSON: ${JSON.stringify(request)}`), []);
});

test("exact play-test marker prepares one non-publishing plan", () => {
  const marker = `ROBLOX_PLAY_TEST_JSON: ${JSON.stringify({projectRoot,requiredAgentVersion:"2.2.54"})}`;
  const [action] = deterministicToolPlan(marker);
  assert.equal(action.tool, "approvals.prepare_plan");
  assert.equal(action.args.execution.tool, "roblox.play_test_validate");
  assert.equal(action.args.execution.args.projectRoot, projectRoot);
  assert.match(action.args.summary, /Do not publish or create another project/i);
});

test("play-test marker rejects path or agent expansion", () => {
  for (const request of [
    {projectRoot:"/Users/mac/Documents/Other",requiredAgentVersion:"2.2.54"},
    {projectRoot,requiredAgentVersion:"2.2.43"}
  ]) assert.deepEqual(deterministicToolPlan(`ROBLOX_PLAY_TEST_JSON: ${JSON.stringify(request)}`), []);
});
