import "dotenv/config";
import { runSyntheticRehashCanary } from "../src/financing-recovery-canary.js";
import { adapterInventory } from "../src/integrations/financing-recovery-adapters.js";

const first = value => String(value || "").split(",").map(item => item.trim()).find(Boolean) || "";
const email = first(process.env.CANARY_EMAIL_ALLOWLIST), phone = first(process.env.CANARY_PHONE_ALLOWLIST);
const inventory = adapterInventory();
const report = await runSyntheticRehashCanary({ email, phone, adapters: {
  database: { configured: false }, storage: { configured: false }, validators: { configured: false }, prism: { configured: false }, crm: { configured: false }, email: { configured: false }, sms: { configured: false }
} });
process.stdout.write(`${JSON.stringify({ ...report, configuredBoundaries: inventory }, null, 2)}\n`);
