import fs from "node:fs";

const connectorFile = new URL("../src/governed-connector.js", import.meta.url);
let connector = fs.readFileSync(connectorFile, "utf8");

const capabilityName = '"primary_mac.browser.wordpress_security_repair"';
if (!connector.includes(capabilityName)) {
  const anchor = '  "sierra.seo.workflow": Object.freeze({';
  if (!connector.includes(anchor)) throw new Error("wordpress security capability: connector capability anchor missing");
  const block = `  "primary_mac.browser.wordpress_security_repair": Object.freeze({\n    targetDevice: "primary-mac",\n    authority: "reversible_write",\n    operations: new Set(["enable_application_passwords"]),\n    prohibitedRoutes: new Set(["arbitrary_domain", "credentials.read", "credentials.write", "content.write", "wordpress.publish", "dns.write", "email.send", "user.role_change", "plugin.install", "plugin.delete", "firewall.change"])\n  }),\n`;
  connector = connector.replace(anchor, block + anchor);
}

const routeMarker = '  if (route.capability === "sierra.seo.workflow") {';
if (!connector.includes('route.capability === "primary_mac.browser.wordpress_security_repair"')) {
  if (!connector.includes(routeMarker)) throw new Error("wordpress security capability: connector route anchor missing");
  const routeBlock = `  if (route.capability === "primary_mac.browser.wordpress_security_repair") {\n    const siteOrigin = clean(command.metadata?.site_origin || "https://sierramarketinginc.com", 300).replace(/\\/$/, "");\n    if (siteOrigin !== "https://sierramarketinginc.com") throw new Error("WORDPRESS_SECURITY_SITE_NOT_ALLOWLISTED");\n    const job = await enqueueMacJob({\n      userId,\n      deviceId: route.target_device,\n      action: "browser.wordpress_enable_application_passwords",\n      args: { objectiveId: route.objective_id, authority: route.authority, operation: route.operation, siteOrigin },\n      risk: "low_risk_write",\n      reason: "Enable only the exact Sierra WordPress Application Passwords setting with before/after verification and rollback",\n      idempotencyKey: \`connector:\${command.id}:\${route.operation}\`,\n      maxAttempts: 1\n    });\n    return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, deviceId: route.target_device, action: job.action, authority: route.authority, dispatchReceipt: job.dispatchReceipt } };\n  }\n`;
  connector = connector.replace(routeMarker, routeBlock + routeMarker);
}

// Repair only the exact tracked Mac source drift already proven by hash-only inspection.
const canonicalInstallerDriftInstalled = connector.includes('"normalize_installer_generated_drift"');
if (!canonicalInstallerDriftInstalled) {
  const maintenanceOpsOld = 'operations: new Set(["update_restart_from_main", "install_neo_preload", "inspect_neo_preload", "normalize_generated_lock", "apply_neo_manifest_fix", "apply_governed_browser_agent", "apply_seo_autopilot_agent", "apply_seo_autopilot_agent_v2", "apply_seo_json_boundary"])';
  const maintenanceOpsNew = 'operations: new Set(["update_restart_from_main", "install_neo_preload", "inspect_neo_preload", "normalize_generated_lock", "normalize_generated_agent_source", "apply_neo_manifest_fix", "apply_governed_browser_agent", "apply_seo_autopilot_agent", "apply_seo_autopilot_agent_v2", "apply_seo_json_boundary"])';
  if (!connector.includes('"normalize_generated_agent_source"')) {
    if (!connector.includes(maintenanceOpsOld)) throw new Error("Mac generated-source normalizer: maintenance capability anchor missing");
    connector = connector.replace(maintenanceOpsOld, maintenanceOpsNew);
  }
  
  if (!connector.includes('const generatedAgentSourcePatch = "diff --git a/mac-agent/agent.js')) {
    const lockAnchor = '    const lockPatch = `diff --git a/package-lock.json b/package-lock.json';
    if (!connector.includes(lockAnchor)) throw new Error("Mac generated-source normalizer: lock patch anchor missing");
    const generatedAgentSourcePatch = [
      'diff --git a/mac-agent/agent.js b/mac-agent/agent.js',
      '--- a/mac-agent/agent.js',
      '+++ b/mac-agent/agent.js',
      '@@ -11,7 +11,7 @@ const execFileAsync = promisify(execFile);',
      ' const BASE = String(process.env.GEORGIE_SERVER_URL || "").replace(/\\/$/, "");',
      ' const DEVICE_ID = process.env.GEORGIE_MAC_DEVICE_ID || "primary-mac";',
      '-const AGENT_VERSION = "2.2.33";',
      '+const AGENT_VERSION = "2.2.32";',
      ' const TOKEN = process.env.GEORGIE_MAC_AGENT_TOKEN;',
      ' const INTERVAL = Math.max(750, Number(process.env.GEORGIE_MAC_POLL_MS || 1000));',
      ' const MAX_BACKOFF = Math.max(INTERVAL, Number(process.env.GEORGIE_MAC_MAX_BACKOFF_MS || 30000));',
      '@@ -649,7 +649,7 @@ async function cycle() {',
      '   try {',
      '     await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/heartbeat`, { method: "POST", body: JSON.stringify({ hostname: os.hostname(), platform: os.platform(), arch: os.arch(), agentVersion: AGENT_VERSION }) });',
      '-    const payload = await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs?limit=5`);',
      '+    const payload = await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs?limit=5&agentVersion=${encodeURIComponent(AGENT_VERSION)}`);',
      '     for (const job of payload.jobs || []) {',
      '       try {',
      '         const result = await execute(job);',
      ''
    ].join('\n');
    const patchBlock = `    const generatedAgentSourcePatch = ${JSON.stringify(generatedAgentSourcePatch)};\n`;
    connector = connector.replace(lockAnchor, patchBlock + lockAnchor);
  }
  
  const lockSpec = ': route.operation === "normalize_generated_lock"\n        ? [["developer.apply_patch", { repo, patch: lockPatch, patchHash: digest(lockPatch) }, "Normalize the exact installer-generated package-lock version drift"]]';
  if (!connector.includes('route.operation === "normalize_generated_agent_source"')) {
    if (!connector.includes(lockSpec)) throw new Error("Mac generated-source normalizer: maintenance dispatch anchor missing");
    const sourceSpec = ': route.operation === "normalize_generated_agent_source"\n        ? [["developer.apply_patch", { repo, patch: generatedAgentSourcePatch, patchHash: digest(generatedAgentSourcePatch) }, "Normalize only the hash-inspected generated Mac agent source drift"]]\n        ';
    connector = connector.replace(lockSpec, sourceSpec + lockSpec);
  }
  
}
fs.writeFileSync(connectorFile, connector);

const agentFile = new URL("../mac-agent/agent.js", import.meta.url);
let agent = fs.readFileSync(agentFile, "utf8");
if (!agent.includes("async function enableWordpressApplicationPasswords")) {
  const anchor = "async function waitForAppProcess(app, timeoutMs = 8000) {";
  if (!agent.includes(anchor)) throw new Error("wordpress security capability: agent function anchor missing");
  const handler = fs.readFileSync(new URL("./templates/wordpress-app-password-handler.txt", import.meta.url), "utf8");
  if (!handler.includes("async function enableWordpressApplicationPasswords")) throw new Error("wordpress security capability: handler template invalid");
  agent = agent.replace(anchor, handler + anchor);
}

const switchAnchor = '    case "browser.wordpress_link_integrity_repair":\n      return repairWordpressLinkIntegrity(a);';
if (!agent.includes('case "browser.wordpress_enable_application_passwords"')) {
  if (!agent.includes(switchAnchor)) throw new Error("wordpress security capability: agent switch anchor missing");
  agent = agent.replace(switchAnchor, switchAnchor + '\n    case "browser.wordpress_enable_application_passwords":\n      return enableWordpressApplicationPasswords(a);');
}
fs.writeFileSync(agentFile, agent);

console.log("Governed WordPress Application Password capability + exact Mac source normalizer installed");
