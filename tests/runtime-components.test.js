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

test("server delegates every background lifecycle to the runtime registry", async () => {
  const server = await import("node:fs/promises").then(fs => fs.readFile(new URL("../src/server.js", import.meta.url), "utf8"));
  const directStarts = server.match(/^start[A-Z][A-Za-z0-9]*\(\);$/gm) || [];
  assert.deepEqual(directStarts, []);
  assert.ok(RUNTIME_COMPONENTS.some(component => component.id === "email-intelligence"));
});
