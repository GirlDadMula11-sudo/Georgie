import "dotenv/config";
import "./server.js";
import { scheduleRuntimePlane, startRuntimeProfile } from "./runtime-components.js";

startRuntimeProfile("web", { plane: "core" });
scheduleRuntimePlane("web", "specialist");
