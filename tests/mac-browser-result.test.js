import test from "node:test";
import assert from "node:assert/strict";
import { verifiedDirectResponse } from "../src/v2-turn-engine.js";

test("completed Mac browser inspection returns evidence without model synthesis", () => {
  const response = verifiedDirectResponse("inspect all open Mac browser tabs", [{
    ok: true,
    tool: "mac.browser_inspect",
    result: {
      id: "job-1",
      status: "completed",
      result: {
        tabs: [
          { browser: "Google Chrome", active: true, title: "Sierra", url: "https://app.sierramarketinginc.com", contentApproved: true, content: "healthy" },
          { browser: "Google Chrome", active: false, title: "Malformed", url: "not a valid URL %", contentApproved: false, content: null },
        ],
        browserErrors: [],
      },
    },
  }]);

  assert.equal(response.terminalState, "verified");
  assert.equal(response.completed, true);
  assert.match(response.text, /TASK COMPLETED/);
  assert.match(response.text, /2 open tabs/);
  assert.match(response.text, /Sierra/);
  assert.doesNotMatch(response.text, /expected pattern/i);
});

test("pending Mac browser inspection is never falsely marked complete", () => {
  const response = verifiedDirectResponse("inspect my Mac tabs", [{
    ok: true,
    tool: "mac.browser_inspect",
    result: { id: "job-pending", status: "pending" },
  }]);

  assert.equal(response.terminalState, "working");
  assert.equal(response.completed, false);
  assert.match(response.text, /job-pending/);
  assert.match(response.text, /Nothing was marked complete/);
});
