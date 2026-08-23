import test from "node:test";
import assert from "node:assert/strict";
import { objectiveCoordinationBridgeContract } from "../src/objective-coordination-bridge.js";
import { specialistRegistryContract } from "../src/command-objective-router.js";

test("coordination objects reference one canonical execution lease",()=>{
  const contract=objectiveCoordinationBridgeContract();
  assert.equal(contract.singleCanonicalExecutionLease,true);
  assert.equal(contract.coordinationObjectsAreReferences,true);
  assert.equal(contract.idempotentByCoordinationObjective,true);
  assert.equal(contract.duplicateExecutionQueuesForbidden,true);
});

test("specialist routing declares one canonical execution lease",()=>{
  const contract=specialistRegistryContract();
  assert.equal(contract.incomingCommandsBecomeDurableObjectives,true);
  assert.equal(contract.typedCommandEnvelope,true);
  assert.equal(contract.durableHandoff,true);
  assert.equal(contract.singleCanonicalExecutionLease,true);
});
