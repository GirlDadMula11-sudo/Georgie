import test from "node:test";
import assert from "node:assert/strict";
import { componentsForProfile, RUNTIME_COMPONENTS, validateRuntimeRegistry } from "../src/runtime-components.js";

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
  const worker = componentsForProfile("worker");
  assert.equal(worker.some(component => component.role === "kernel"), false);
  assert.equal(worker.some(component => component.id === "objective-worker"), false);
});
