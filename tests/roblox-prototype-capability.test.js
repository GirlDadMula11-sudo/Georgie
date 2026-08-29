import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Georgie exposes a durable Roblox prototype builder instead of screenshot coaching", () => {
  const tools = fs.readFileSync(new URL("../src/tools.js", import.meta.url), "utf8");
  const agent = fs.readFileSync(new URL("../mac-agent/agent.js", import.meta.url), "utf8");
  assert.match(tools, /name:"roblox\.prototype_build"/);
  assert.match(tools, /do not fall back to screenshot coaching/i);
  assert.match(agent, /"RobloxStudio"/);
  assert.match(agent, /case "roblox\.prototype_build"/);
  assert.match(agent, /default\.project\.json/);
  assert.match(agent, /Prototype\.rbxlx/);
  assert.match(agent, /missingPrecondition: "Rojo CLI"/);
});
