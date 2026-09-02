import "dotenv/config";
import "./server.js";
import { runtimeOwnsBackgroundWorkers, scheduleRuntimePlane, startRuntimeProfile, RUNTIME_COMPONENTS } from "./runtime-components.js";

if (runtimeOwnsBackgroundWorkers()) {
  startRuntimeProfile("web", { plane: "core" });

  // The Smartlead reply closer owns a durable, generation-fenced production
  // authority and must remain alive even when the rest of Georgie's specialist
  // plane is intentionally disabled in kernel mode. Keep this exception narrow:
  // only the reply closer is selected here; no other specialist wakes up.
  const smartleadReplyCloser = RUNTIME_COMPONENTS.filter(component => component.id === "smartlead-reply-closer");
  if (smartleadReplyCloser.length !== 1) {
    throw new Error(`Smartlead reply closer registry invariant failed: ${smartleadReplyCloser.length}`);
  }
  startRuntimeProfile("web", { components: smartleadReplyCloser, plane: "specialist", mode: "full" });

  scheduleRuntimePlane("web", "specialist");
} else {
  console.log("Georgie request-serving runtime online; durable workers remain owned by the long-lived worker plane.");
}
