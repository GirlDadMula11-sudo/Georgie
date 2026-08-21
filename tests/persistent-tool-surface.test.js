import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const toolsSource = await readFile(new URL("../src/tools.js", import.meta.url), "utf8");
const turnSource = await readFile(new URL("../src/v2-turn-engine.js", import.meta.url), "utf8");
const promptSource = await readFile(new URL("../src/georgie.js", import.meta.url), "utf8");

test("the planner receives the complete governed registry by default", () => {
  assert.match(toolsSource, /includeUnavailable=true/);
  assert.match(toolsSource, /persistent_governed_registry/);
  assert.match(toolsSource, /attachedToEveryTurn:true/);
});

test("an attached Sierra tool reports its exact configuration precondition", () => {
  assert.match(toolsSource, /blockedBy:"secure_sierra_workforce_configuration"/);
  assert.match(toolsSource, /Tool \$\{name\} is attached/);
  assert.doesNotMatch(toolsSource, /filter\(tool=>workforce\|\|!tool\.workforceOnly\)\.map/);
});

test("attachment turns and the intelligence prompt enforce persistent tools", () => {
  assert.match(turnSource, /PERSISTENT GOVERNED TOOL SURFACE/);
  assert.match(turnSource, /persistentToolSurface\(\)/);
  assert.match(promptSource, /governed tool registry as persistent across every turn/);
  assert.match(promptSource, /not exposed in this turn/);
});
