import "dotenv/config";
import "./server.js";
import { runtimeOwnsBackgroundWorkers, scheduleRuntimePlane, startRuntimeProfile } from "./runtime-components.js";

if (runtimeOwnsBackgroundWorkers()) {
  startRuntimeProfile("web", { plane: "core" });
  scheduleRuntimePlane("web", "specialist");
} else {
  console.log("Georgie request-serving runtime online; durable workers remain owned by the long-lived worker plane.");
}
