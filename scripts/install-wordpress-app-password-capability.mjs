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

console.log("Governed WordPress Application Password capability installed");
