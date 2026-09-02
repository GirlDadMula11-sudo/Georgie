import "dotenv/config";
import "./server.js";
import { runtimeOwnsBackgroundWorkers, scheduleRuntimePlane, startRuntimeProfile, RUNTIME_COMPONENTS } from "./runtime-components.js";

if (runtimeOwnsBackgroundWorkers()) {
  startRuntimeProfile("web", { plane: "core" });

  // The Smartlead reply closer owns a durable, generation-fenced production
  // authority and must remain alive even when the rest of Georgie's specialist
  // plane is intentionally disabled in kernel mode. Keep this exception narrow:
  // start only the registered closer; do not enable the specialist plane.
  const smartleadReplyCloser = RUNTIME_COMPONENTS.find(component => component.id === "smartlead-reply-closer");
  if (!smartleadReplyCloser || smartleadReplyCloser.authority !== "smartlead-replies") {
    throw new Error("Smartlead reply closer registry invariant failed");
  }
  smartleadReplyCloser.start();
  console.log("Georgie authoritative Smartlead reply closer started alongside kernel core");

  scheduleRuntimePlane("web", "specialist");
} else {
  console.log("Georgie request-serving runtime online; durable workers remain owned by the long-lived worker plane.");
}
