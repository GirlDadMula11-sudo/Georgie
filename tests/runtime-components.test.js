import test from "node:test";
import assert from "node:assert/strict";
import { authoritativeWebWorkers, componentsForProfile, RUNTIME_COMPONENTS, runtimeMode, runtimeOwnsBackgroundWorkers, validateRuntimeRegistry } from "../src/runtime-components.js";

test("runtime registry declares exactly one objective lifecycle kernel", () => {
  const result = validateRuntimeRegistry();
  assert.equal(result.ok, true, result.errors.join(","));
  assert.equal(result.kernel, "objective-worker");
});

test("every runtime component has explicit ownership and profiles", () => {
  for (const component of RUNTIME_COMPONENTS) {
    assert.ok(component.id);
    assert.ok(component.role);
    assert.ok(component.profiles.length > 0);
    assert.equal(typeof component.start, "function");
    if (component.role !== "observer") assert.ok(component.authority);
  }
});

test("worker profile cannot start a second objective authority", () => {
  const worker = componentsForProfile("worker", RUNTIME_COMPONENTS, null, "full");
  assert.equal(worker.some(component => component.role === "kernel"), false);
  assert.equal(worker.some(component => component.id === "objective-worker"), false);
});

test("production defaults to the controlled kernel and fails closed on invalid mode", () => {
  assert.equal(runtimeMode({}), "kernel");
  assert.equal(runtimeMode({ GEORGIE_RUNTIME_MODE: "full" }), "full");
  assert.equal(runtimeMode({ GEORGIE_RUNTIME_MODE: "unexpected" }), "kernel");
});

test("serverless request instances never claim long-lived worker ownership", () => {
  assert.equal(runtimeOwnsBackgroundWorkers({ VERCEL: "1" }), false);
  assert.equal(runtimeOwnsBackgroundWorkers({ AWS_LAMBDA_FUNCTION_NAME: "georgie" }), false);
  assert.equal(runtimeOwnsBackgroundWorkers({ LAMBDA_TASK_ROOT: "/var/task" }), false);
  assert.equal(runtimeOwnsBackgroundWorkers({}), true);
});

test("kernel mode starts one objective authority and no autonomous specialists", () => {
  const web = componentsForProfile("web", RUNTIME_COMPONENTS, null, "kernel");
  assert.deepEqual(web.map(component => component.id), [
    "cloud-state-recovery",
    "mobile-turn-recovery",
    "approval-dispatch",
    "objective-worker"
  ]);
  assert.equal(web.filter(component => component.role === "kernel").length, 1);
  assert.equal(web.some(component => component.plane === "specialist"), false);
});

test("server delegates every background lifecycle to the runtime registry", async () => {
  const server = await import("node:fs/promises").then(fs => fs.readFile(new URL("../src/server.js", import.meta.url), "utf8"));
  const directStarts = server.match(/^start[A-Z][A-Za-z0-9]*\(\);$/gm) || [];
  assert.deepEqual(directStarts, []);
  assert.ok(RUNTIME_COMPONENTS.some(component => component.id === "email-intelligence"));
});


test("the one deployed long-lived web process owns each allowlisted financing worker exactly once", async () => {
  const owners = authoritativeWebWorkers();
  assert.deepEqual(owners.map(component => component.id), ["smartlead-reply-closer", "financing-recovery"]);
  assert.equal(owners.filter(component => component.authority === "financing-recovery").length, 1);
  assert.equal(RUNTIME_COMPONENTS.filter(component => component.authority === "financing-recovery").length, 1);
  const runtime = await import("node:fs/promises").then(fs => fs.readFile(new URL("../src/runtime.js", import.meta.url), "utf8"));
  assert.match(runtime, /for \(const component of authoritativeWebWorkers\(\)\) component\.start\(\)/);
  assert.doesNotMatch(runtime, /startFinancingRecoveryWorker\(/);
});
