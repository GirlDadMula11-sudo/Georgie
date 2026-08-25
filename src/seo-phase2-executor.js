import { compilePreservedSeoPhase2Command } from "./seo-phase2-batches.js";

const SITE = "https://sierramarketinginc.com";

export function buildSeoPhase2Objective(input = {}) {
  const plan = compilePreservedSeoPhase2Command(input);
  const stableKey = `seo-phase2:${plan.commandId}`;
  return Object.freeze({
    stableKey,
    title: `Sierra SEO Phase 2 — ${plan.batch}`,
    domain: "seo",
    priority: "high",
    maxAttempts: 6,
    resumeBlocked: true,
    steps: Object.freeze([
      Object.freeze({
        id: "capture-before-state",
        tool: "seo.phase2_before_state",
        policy: "read",
        args: Object.freeze({ siteOrigin: SITE, commandId: plan.commandId, batch: plan.batch, pages: plan.pages })
      }),
      Object.freeze({
        id: "execute-bounded-batch",
        tool: "seo.phase2_batch_execute",
        policy: "low_risk_write",
        args: Object.freeze({
          deviceId: "primary-mac",
          siteOrigin: SITE,
          authority: "reversible_write",
          commandId: plan.commandId,
          batch: plan.batch,
          pages: plan.pages,
          changeClasses: plan.changeClasses,
          protectedSurfaces: plan.protectedSurfaces
        }),
        verification: Object.freeze({
          tool: "seo.phase2_batch_verify",
          args: Object.freeze({ siteOrigin: SITE, commandId: plan.commandId, batch: plan.batch, pages: plan.pages, predicates: plan.verification }),
          expect: Object.freeze({ verified: true })
        }),
        delayMsAfter: 1000
      }),
      Object.freeze({
        id: "capture-after-state",
        tool: "seo.phase2_after_state",
        policy: "read",
        args: Object.freeze({ siteOrigin: SITE, commandId: plan.commandId, batch: plan.batch, pages: plan.pages })
      })
    ]),
    phase2: plan
  });
}

export function assertSeoPhase2ExecutionReceipt(receipt = {}) {
  if (receipt.commandId == null) throw new Error("SEO_PHASE2_RECEIPT_COMMAND_REQUIRED");
  const plan = compilePreservedSeoPhase2Command({ commandId: receipt.commandId, batch: receipt.batch });
  if (receipt.verified !== true) throw new Error("SEO_PHASE2_SEMANTIC_VERIFICATION_REQUIRED");
  if (receipt.beforeStateCaptured !== true) throw new Error("SEO_PHASE2_BEFORE_STATE_REQUIRED");
  if (receipt.rollbackMaterialCreated !== true) throw new Error("SEO_PHASE2_ROLLBACK_MATERIAL_REQUIRED");
  if (receipt.publicReadbackVerified !== true) throw new Error("SEO_PHASE2_PUBLIC_READBACK_REQUIRED");
  if (receipt.duplicateReplay === true && receipt.mutationPerformed === true) throw new Error("SEO_PHASE2_DUPLICATE_REPLAY_MUTATED");
  return Object.freeze({ accepted: true, commandId: plan.commandId, batch: plan.batch, verified: true });
}
