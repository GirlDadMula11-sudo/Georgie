import { listNeoMailboxes, verifyNeoMailbox } from "./integrations/neo-mail.js";
import { getProviderObservability } from "./integrations/provider-observability.js";

export async function runConnectionCertification() {
  const mailboxes = listNeoMailboxes();
  const mailboxResults = await Promise.all(mailboxes.map(async (mailbox) => {
    try {
      const result = await verifyNeoMailbox(mailbox.id);
      return { id: mailbox.id, email: mailbox.email, ok: Boolean(result?.ok), imap: true, smtp: true };
    } catch (error) {
      return { id: mailbox.id, email: mailbox.email, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  let providers;
  try {
    providers = await getProviderObservability();
  } catch (error) {
    providers = { vercel: { ok: false, error: String(error) }, render: { ok: false, error: String(error) } };
  }

  const report = {
    ok: mailboxResults.length >= 2 && mailboxResults.every((x) => x.ok) && Boolean(providers?.vercel?.ok) && Boolean(providers?.render?.ok),
    neo: mailboxResults,
    vercel: { ok: Boolean(providers?.vercel?.ok), latestDeployment: providers?.vercel?.latestDeployment || null, errorCount: providers?.vercel?.errorCount ?? null, error: providers?.vercel?.error || null },
    render: { ok: Boolean(providers?.render?.ok), latestDeployment: providers?.render?.latestDeployment || null, errorCount: providers?.render?.errorCount ?? null, error: providers?.render?.error || null },
    checkedAt: new Date().toISOString()
  };

  const logReport = report.ok ? {
    ok: true,
    neo: report.neo.map(({ id, email, ok, imap, smtp }) => ({ id, email, ok, imap, smtp })),
    vercel: { ok: report.vercel.ok, latestDeployment: report.vercel.latestDeployment, issueCount: report.vercel.errorCount },
    render: { ok: report.render.ok, latestDeployment: report.render.latestDeployment, issueCount: report.render.errorCount },
    checkedAt: report.checkedAt
  } : report;
  console.log(`[Georgie] Connection certification: ${JSON.stringify(logReport)}`);
  return report;
}
