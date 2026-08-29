import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlanWithHistory } from "../src/fast-intents.js";

test("Makayla Roblox continuation binds the real update-and-build tool", () => {
  const [action] = deterministicToolPlanWithHistory("Update and restart your Mac agent from main. Then resume the Makayla Roblox game plan and build the approved prototype.", []);
  assert.equal(action.tool, "approvals.prepare_plan");
  assert.equal(action.args.execution.tool, "roblox.update_agent_install_and_build");
  assert.equal(action.args.execution.args.projectName, "Makayla Horror Prototype");
  assert.match(action.args.execution.args.designBrief, /private prototype/i);
});
