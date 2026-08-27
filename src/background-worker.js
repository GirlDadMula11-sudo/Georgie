import "dotenv/config";
import { startRuntimeProfile } from "./runtime-components.js";

startRuntimeProfile("worker");
setInterval(()=>{},60_000);
let shuttingDown=false;
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>{
  if(shuttingDown)return;shuttingDown=true;
  console.log(`Georgie background worker received ${signal}; stopping new work and allowing the active lease to checkpoint.`);
  setTimeout(()=>process.exit(0),5_000).unref?.();
});
