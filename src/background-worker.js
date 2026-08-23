import "dotenv/config";
import { startCloudStateRecovery } from "./cloud-state.js";
import { startApprovalDispatchWorker } from "./tools.js";
import { startEngineeringCoordinator } from "./engineering-coordinator.js";
import { startMaintenanceSentinel } from "./maintenance-sentinel.js";
import { startReconciliationWorkers } from "./reconciliation-workers.js";
import { startBackgroundOperatingLayer } from "./background-operating-layer.js";
import { startSelfEvolution } from "./self-evolution.js";

startCloudStateRecovery();
startApprovalDispatchWorker();
startMaintenanceSentinel();
startReconciliationWorkers();
startSelfEvolution();
startBackgroundOperatingLayer();
startEngineeringCoordinator();
console.log("Georgie background engineering worker online");
setInterval(()=>{},60_000);
let shuttingDown=false;
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>{
  if(shuttingDown)return;shuttingDown=true;
  console.log(`Georgie background worker received ${signal}; stopping new work and allowing the active lease to checkpoint.`);
  setTimeout(()=>process.exit(0),5_000).unref?.();
});
