import { WebSocket } from "ws";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const NEO_ORIGIN = "https://app.neo.space";

function endpoint(value = process.env.GEORGIE_CHROME_CDP_URL || "http://127.0.0.1:9222") {
  const url = new URL(value);
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || url.username || url.password) throw new Error("NEO_CDP_ENDPOINT_NOT_LOOPBACK");
  return url;
}

async function targets(base) {
  const url = new URL("/json/list", base);
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(3000), redirect: "error" });
  if (!response.ok) throw new Error(`NEO_CDP_DISCOVERY_FAILED:${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("NEO_CDP_DISCOVERY_MALFORMED");
  return rows.filter(row => row?.type === "page" && String(row.url || "").startsWith(`${NEO_ORIGIN}/`));
}

async function evaluate(target, expression) {
  const socketUrl = new URL(String(target.webSocketDebuggerUrl || ""));
  if (!['ws:','wss:'].includes(socketUrl.protocol) || !LOOPBACK.has(socketUrl.hostname)) throw new Error("NEO_CDP_SOCKET_NOT_LOOPBACK");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl.toString(), { handshakeTimeout: 3000 });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("NEO_CDP_EVALUATION_TIMEOUT")); }, 5000);
    ws.once("error", error => { clearTimeout(timer); reject(new Error(`NEO_CDP_SOCKET_FAILED:${error.message}`)); });
    ws.once("open", () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: false, userGesture: false } })));
    ws.on("message", bytes => {
      let message; try { message = JSON.parse(String(bytes)); } catch { return; }
      if (message.id !== 1) return;
      clearTimeout(timer); ws.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error("NEO_CDP_EVALUATION_REJECTED"));
      else resolve(message.result?.result?.value);
    });
  });
}

export async function verifyNeoCdpSession({ mailboxes = [] } = {}) {
  const requested = [...new Set(mailboxes.map(value => String(value).trim().toLowerCase()))];
  if (!requested.length || requested.some(value => !/^[^@\s]+@sierramarketinginc\.com$/.test(value))) throw new Error("NEO_CDP_MAILBOX_SCOPE_REJECTED");
  let rows;
  try { rows = await targets(endpoint()); } catch (error) { throw new Error(`NEO_CDP_NOT_AVAILABLE:${error.message}`); }
  if (rows.length !== 1) throw new Error(`NEO_CDP_TARGET_AMBIGUOUS:${rows.length}`);
  const expression = `JSON.stringify((()=>{const wanted=${JSON.stringify(requested)};const text=(document.body?.innerText||'').toLowerCase();return{origin:location.origin,bindings:wanted.map(email=>({email,present:text.includes(email)})),messageContentAccessed:false,credentialsTransferred:false,mutationPerformed:false}})())`;
  const raw = await evaluate(rows[0], expression);
  let proof; try { proof = JSON.parse(String(raw || "")); } catch { throw new Error("NEO_CDP_SESSION_PROOF_MALFORMED"); }
  if (proof.origin !== NEO_ORIGIN) throw new Error("NEO_CDP_ORIGIN_NOT_PROVEN");
  for (const item of proof.bindings || []) if (!item.present) throw new Error(`NEO_CDP_MAILBOX_NOT_BOUND:${item.email}`);
  return { provider: "neo_cdp", targetCount: 1, origin: proof.origin, bindings: proof.bindings, transport: "loopback_cdp", authority: "read_only", messageContentAccessed: false, credentialsTransferred: false, mutationPerformed: false };
}
