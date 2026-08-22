import fs from "node:fs";

const serverPath = new URL("../src/server.js", import.meta.url);
let server = fs.readFileSync(serverPath, "utf8");

if (!server.includes('from "./owner-recovery.js"')) {
  const anchor = 'import { authenticateNativeRequest } from "./mobile-auth.js";\n';
  if (!server.includes(anchor)) throw new Error("owner recovery installer could not find mobile-auth import anchor");
  server = server.replace(anchor, anchor + 'import { requestOwnerRecovery } from "./owner-recovery.js";\n');
}

if (!server.includes('/api/mobile/recovery/request')) {
  const anchor = 'app.use("/api",rateLimit({windowMs:60000,limit:Number(process.env.GEORGIE_RATE_LIMIT||90),standardHeaders:"draft-7",legacyHeaders:false}));app.use("/api/mobile",createMobileRouter());';
  if (!server.includes(anchor)) throw new Error("owner recovery installer could not find mobile router anchor");
  const replacement = 'app.use("/api",rateLimit({windowMs:60000,limit:Number(process.env.GEORGIE_RATE_LIMIT||90),standardHeaders:"draft-7",legacyHeaders:false}));app.post("/api/mobile/recovery/request",async(req,res)=>{try{const result=await requestOwnerRecovery({clientKey:req.ip||"unknown"});res.set("Cache-Control","no-store").status(202).json({ok:true,...result});}catch(error){const status=error?.code==="rate_limited"?429:503;res.set("Cache-Control","no-store").status(status).json({ok:false,error:error instanceof Error?error.message:"Recovery request failed"});}});app.use("/api/mobile",createMobileRouter());';
  server = server.replace(anchor, replacement);
}

fs.writeFileSync(serverPath, server);
console.log("[Georgie] Non-circular owner recovery endpoint installed.");
