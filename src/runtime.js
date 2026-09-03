import "dotenv/config";
import "./server.js";
import { runtimeOwnsBackgroundWorkers, scheduleRuntimePlane, startRuntimeProfile, authoritativeWebWorkers } from "./runtime-components.js";

if (runtimeOwnsBackgroundWorkers()) {
  startRuntimeProfile("web", { plane: "core" });

  // Render deploys one long-lived web process. These narrowly allowlisted,
  // generation-fenced specialists are owned here even in kernel mode; the
  // general specialist plane remains disabled and no second scheduler starts.
  for (const component of authoritativeWebWorkers()) component.start();
  console.log("Georgie authoritative web workers started alongside kernel core");

  scheduleRuntimePlane("web", "specialist");
} else {
  console.log("Georgie request-serving runtime online; durable workers remain owned by the long-lived worker plane.");
}
