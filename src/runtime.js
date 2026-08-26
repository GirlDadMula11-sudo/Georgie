import "dotenv/config";
import "./server.js";
import { startCloudStateRecovery } from "./cloud-state.js";
import { startApprovalDispatchWorker } from "./tools.js";
import { startEngineeringCoordinator } from "./engineering-coordinator.js";
import { startMaintenanceSentinel } from "./maintenance-sentinel.js";
import { startReconciliationWorkers } from "./reconciliation-workers.js";
import { startBackgroundOperatingLayer } from "./background-operating-layer.js";
import { startSelfEvolution } from "./self-evolution.js";
import { startObjectiveWorker } from "./objective-worker.js";
import { startSeoMonitorScheduler } from "./seo-monitor.js";
import { startSmartleadReplyCloserWorker } from "./smartlead-reply-closer-worker.js";
import { startLenderDeliveryWorker } from "./lender-delivery-worker.js";
import { startSierraClosingOutreachWorker } from "./sierra-closing-outreach-worker.js";

startCloudStateRecovery();
startApprovalDispatchWorker();
startMaintenanceSentinel();
startReconciliationWorkers();
startSelfEvolution();
startBackgroundOperatingLayer();
startEngineeringCoordinator();
startObjectiveWorker();
startSeoMonitorScheduler();
startSmartleadReplyCloserWorker();
startLenderDeliveryWorker();
startSierraClosingOutreachWorker();

console.log("Georgie unified server + durable background runtime online");
