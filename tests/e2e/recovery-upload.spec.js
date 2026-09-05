import { test, expect } from "@playwright/test";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

let server;
const slots = [{ month: "2026-08", status: "open" }, { month: "2026-07", status: "open" }];
const staged = new Map();
function json(res, status, value) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); }
async function readBody(req) { const chunks=[]; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); }

test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    if (url.pathname === "/api/financing-recovery/upload-session") return json(res, 200, { ok: true, session: { status: "active", firstName: "Ava", businessName: "North Star Bakery", requestedMonths: slots.map(slot => slot.month), slots, expiresAt: "2026-09-10T00:00:00.000Z", complete: false } });
    if (url.pathname === "/api/financing-recovery/upload-authorize" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req));
      const objectPath = `incoming/test/${payload.expectedMonth}/${encodeURIComponent(payload.name)}`;
      return json(res, 200, { ok: true, upload: { signedUrl: `/signed-upload/${encodeURIComponent(payload.expectedMonth)}`, objectPath, maxBytes: 50 * 1024 * 1024, mimeType: payload.mimeType } });
    }
    if (url.pathname.startsWith("/signed-upload/") && req.method === "PUT") {
      const month = decodeURIComponent(url.pathname.split("/").pop());
      staged.set(month, await readBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ Key: `fixture/${month}` }));
    }
    if (url.pathname === "/api/financing-recovery/upload-complete" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req));
      if (!staged.get(payload.expectedMonth)?.length) return json(res, 400, { ok: false, error: "RECOVERY_STAGED_OBJECT_404" });
      slots.find(slot => slot.month === payload.expectedMonth).status = "verified";
      return json(res, 202, { ok: true, result: { created: true, complete: slots.every(slot => slot.status === "verified") }, prism: { accepted: true } });
    }
    const file = url.pathname === "/recovery/" ? "recovery-upload.html" : url.pathname.slice(1);
    try { const content = await fs.readFile(path.join(process.cwd(), "public", file)); const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".webp") ? "image/webp" : "text/html"; res.writeHead(200, { "content-type": type }); res.end(content); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(4310, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

test("mobile keyboard-accessible two-statement journey reaches polished confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/recovery/#abcdefghijklmnopqrstuvwxyz1234567890");
  await expect(page.getByText("No new application is required.").first()).toBeVisible();
  await expect(page.getByText("North Star Bakery")).toBeVisible();
  const inputs = page.locator('input[type="file"]');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).setInputFiles({ name: "August-statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-August") });
  await expect(page.getByText("1 of 2 verified")).toBeVisible();
  await inputs.nth(1).setInputFiles({ name: "July-statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-July") });
  await expect(page.getByRole("heading", { name: /statements are securely received/i })).toBeVisible();
  await expect(page.getByText("Prism review", { exact: true })).toBeVisible();
  await expect(page.getByText("Funding options", { exact: true })).toBeVisible();
  await expect(page.getByText("Georgie follow-up", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/recovery-upload-success.png", fullPage: true });
});

test("expired session has focused recovery and no internal identity", async ({ page }) => {
  await page.route("**/upload-session", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, session: { status: "expired" } }) }));
  await page.goto("/recovery/#abcdefghijklmnopqrstuvwxyz1234567890");
  await expect(page.getByRole("heading", { name: /secure link has expired/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /request a new secure link/i })).toBeFocused();
  await expect(page.locator("body")).not.toContainText(/app_|deal_|thread_|account ending/i);
});
