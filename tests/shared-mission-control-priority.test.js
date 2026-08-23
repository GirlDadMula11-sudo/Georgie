import test from "node:test";
import assert from "node:assert/strict";
import { compareHandoffPriority } from "../src/shared-mission.js";

test("trusted typed AI control traffic outranks older generic mission work",()=>{
  const generic={source:"shared_mission",priority:100,createdAt:"2026-08-23T00:00:00Z"};
  const control={source:"authorized_assistant_control_command",priority:75,createdAt:"2026-08-23T01:00:00Z"};
  const ordered=[generic,control].sort(compareHandoffPriority);
  assert.equal(ordered[0],control);
});

test("normal priority ordering remains unchanged within the same lane",()=>{
  const low={source:"shared_mission",priority:50,createdAt:"2026-08-23T00:00:00Z"};
  const high={source:"shared_mission",priority:90,createdAt:"2026-08-23T01:00:00Z"};
  assert.equal([low,high].sort(compareHandoffPriority)[0],high);
});

test("older typed command wins equal-priority control traffic",()=>{
  const older={source:"authorized_assistant_control_command",priority:90,createdAt:"2026-08-23T00:00:00Z"};
  const newer={source:"authorized_assistant_control_command",priority:90,createdAt:"2026-08-23T01:00:00Z"};
  assert.equal([newer,older].sort(compareHandoffPriority)[0],older);
});
