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
  const fn = String.raw`async function enableWordpressApplicationPasswords(args = {}) {
  if (args.authority !== "reversible_write" || args.operation !== "enable_application_passwords") throw new Error("WORDPRESS_APP_PASSWORD_AUTHORIZATION_REJECTED");
  if (String(args.siteOrigin || "").replace(/\/$/, "") !== "https://sierramarketinginc.com") throw new Error("WORDPRESS_APP_PASSWORD_SITE_REJECTED");
  const adminUrl = "https://sierramarketinginc.com/wp-admin/admin.php?page=WordfenceOptions";
  await execFileAsync("open", ["-a", "Google Chrome", adminUrl], { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 4000));

  const inspectJavascript = String.raw`JSON.stringify((()=>{
    const wanted='disable wordpress application passwords';
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
    const labels=[...document.querySelectorAll('label,span,td,div')].filter(el=>norm(el.textContent)===wanted);
    const candidates=[];
    for(const label of labels){
      let checkbox=null;
      if(label.htmlFor) checkbox=document.getElementById(label.htmlFor);
      if(!checkbox) checkbox=label.querySelector('input[type="checkbox"]');
      if(!checkbox){ const scope=label.closest('tr,.wfConfigOption,.wfConfigSection,form,div'); checkbox=scope&&scope.querySelector('input[type="checkbox"]'); }
      if(checkbox&&checkbox.type==='checkbox'&&!candidates.includes(checkbox)) candidates.push(checkbox);
    }
    return {url:location.href,matchCount:candidates.length,checked:candidates.length===1?Boolean(candidates[0].checked):null,label:wanted};
  })())`;
  const runOnApprovedTab = async javascript => {
    const apple = `tell application "Google Chrome"\nrepeat with browserWindow in windows\nrepeat with browserTab in tabs of browserWindow\nset tabUrl to URL of browserTab\nif tabUrl starts with "https://sierramarketinginc.com/wp-admin/" then\nreturn execute browserTab javascript ${JSON.stringify(javascript)}\nend if\nend repeat\nend repeat\nreturn "WORDPRESS_ADMIN_TAB_NOT_FOUND"\nend tell`;
    return runAppleScript(apple);
  };
  const inspect = async () => {
    const raw = await runOnApprovedTab(inspectJavascript);
    if (raw === "WORDPRESS_ADMIN_TAB_NOT_FOUND") throw new Error("WORDPRESS_ADMIN_TAB_NOT_FOUND");
    return JSON.parse(raw || "{}");
  };

  const before = await inspect();
  if (before.matchCount !== 1) throw new Error(`WORDPRESS_APP_PASSWORD_CONTROL_AMBIGUOUS:${before.matchCount}`);
  if (before.checked === false) return { wordpressApplicationPasswords: { changed:false, alreadyEnabled:true, beforeChecked:false, afterChecked:false, verified:true, rollbackPerformed:false }, siteOrigin:args.siteOrigin, authority:args.authority, credentialsTransferred:false, formValuesCaptured:false };

  const mutateJavascript = String.raw`JSON.stringify((()=>{
    const wanted='disable wordpress application passwords';
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
    const labels=[...document.querySelectorAll('label,span,td,div')].filter(el=>norm(el.textContent)===wanted);
    const candidates=[];
    for(const label of labels){
      let checkbox=null;
      if(label.htmlFor) checkbox=document.getElementById(label.htmlFor);
      if(!checkbox) checkbox=label.querySelector('input[type="checkbox"]');
      if(!checkbox){ const scope=label.closest('tr,.wfConfigOption,.wfConfigSection,form,div'); checkbox=scope&&scope.querySelector('input[type="checkbox"]'); }
      if(checkbox&&checkbox.type==='checkbox'&&!candidates.includes(checkbox)) candidates.push(checkbox);
    }
    if(candidates.length!==1) return {ok:false,code:'CONTROL_AMBIGUOUS',count:candidates.length};
    const checkbox=candidates[0];
    const form=checkbox.closest('form');
    if(!form) return {ok:false,code:'FORM_NOT_FOUND'};
    const buttons=[...form.querySelectorAll('button[type="submit"],input[type="submit"],button')].filter(el=>norm(el.textContent||el.value)==='save changes');
    if(buttons.length!==1) return {ok:false,code:'SAVE_CONTROL_AMBIGUOUS',count:buttons.length};
    if(checkbox.checked) checkbox.click();
    if(checkbox.checked) return {ok:false,code:'CHECKBOX_DID_NOT_CLEAR'};
    buttons[0].click();
    return {ok:true,submitted:true};
  })())`;
  const mutation = JSON.parse(await runOnApprovedTab(mutateJavascript) || "{}");
  if (mutation.ok !== true) throw new Error(`WORDPRESS_APP_PASSWORD_MUTATION_REJECTED:${mutation.code||"UNKNOWN"}:${mutation.count??""}`);
  await new Promise(resolve => setTimeout(resolve, 4000));
  await execFileAsync("open", ["-a", "Google Chrome", adminUrl], { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 3000));
  const after = await inspect();
  if (after.matchCount === 1 && after.checked === false) {
    return { wordpressApplicationPasswords: { changed:true, alreadyEnabled:false, beforeChecked:true, afterChecked:false, verified:true, rollbackPerformed:false }, siteOrigin:args.siteOrigin, authority:args.authority, credentialsTransferred:false, formValuesCaptured:false };
  }

  const rollbackJavascript = String.raw`JSON.stringify((()=>{
    const wanted='disable wordpress application passwords';
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
    const labels=[...document.querySelectorAll('label,span,td,div')].filter(el=>norm(el.textContent)===wanted);
    const candidates=[];
    for(const label of labels){
      let checkbox=null;
      if(label.htmlFor) checkbox=document.getElementById(label.htmlFor);
      if(!checkbox) checkbox=label.querySelector('input[type="checkbox"]');
      if(!checkbox){ const scope=label.closest('tr,.wfConfigOption,.wfConfigSection,form,div'); checkbox=scope&&scope.querySelector('input[type="checkbox"]'); }
      if(checkbox&&checkbox.type==='checkbox'&&!candidates.includes(checkbox)) candidates.push(checkbox);
    }
    if(candidates.length!==1) return {ok:false,code:'ROLLBACK_CONTROL_AMBIGUOUS'};
    const checkbox=candidates[0],form=checkbox.closest('form');
    if(!form) return {ok:false,code:'ROLLBACK_FORM_NOT_FOUND'};
    const buttons=[...form.querySelectorAll('button[type="submit"],input[type="submit"],button')].filter(el=>norm(el.textContent||el.value)==='save changes');
    if(buttons.length!==1) return {ok:false,code:'ROLLBACK_SAVE_AMBIGUOUS'};
    if(!checkbox.checked) checkbox.click();
    if(!checkbox.checked) return {ok:false,code:'ROLLBACK_CHECKBOX_DID_NOT_SET'};
    buttons[0].click(); return {ok:true};
  })())`;
  const rollback = JSON.parse(await runOnApprovedTab(rollbackJavascript) || "{}");
  await new Promise(resolve => setTimeout(resolve, 3000));
  throw new Error(`WORDPRESS_APP_PASSWORD_VERIFY_FAILED_ROLLBACK_${rollback.ok===true?"SUBMITTED":"FAILED"}:${after.matchCount}:${after.checked}`);
}

`;
  agent = agent.replace(anchor, fn + anchor);
}

const switchAnchor = '    case "browser.wordpress_link_integrity_repair":\n      return repairWordpressLinkIntegrity(a);';
if (!agent.includes('case "browser.wordpress_enable_application_passwords"')) {
  if (!agent.includes(switchAnchor)) throw new Error("wordpress security capability: agent switch anchor missing");
  agent = agent.replace(switchAnchor, switchAnchor + '\n    case "browser.wordpress_enable_application_passwords":\n      return enableWordpressApplicationPasswords(a);');
}
fs.writeFileSync(agentFile, agent);

console.log("Governed WordPress Application Password capability installed");
