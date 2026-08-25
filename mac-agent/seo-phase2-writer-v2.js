import { buildSeoPhase2WordpressPageScript, validateSeoPhase2MacRequest } from "./seo-phase2-writer.js";

const SITE = "https://sierramarketinginc.com";

export { validateSeoPhase2MacRequest };

export function buildSeoPhase2WordpressPageScriptWithRollback(args = {}) {
  validateSeoPhase2MacRequest(args);
  const base = buildSeoPhase2WordpressPageScript(args);
  const needle = "changed, rollbackPerformed: false";
  if (!base.includes(needle)) throw new Error("SEO_PHASE2_ROLLBACK_BUNDLE_PATCH_ANCHOR_MISSING");
  return base.replace(needle, "changed, rollbackBundle: originals, rollbackPerformed: false");
}

export function buildSeoPhase2WordpressRollbackScript({ commandId, planHash, rollbackBundle = [] } = {}) {
  if (!commandId || !planHash || !Array.isArray(rollbackBundle) || !rollbackBundle.length) throw new Error("SEO_PHASE2_ROLLBACK_MATERIAL_REQUIRED");
  const safe = rollbackBundle.map(item => ({
    type: String(item.type || ""),
    id: Number(item.id),
    path: String(item.path || ""),
    title: String(item.title || ""),
    content: String(item.content || "")
  }));
  if (safe.some(item => !["pages", "posts"].includes(item.type) || !Number.isInteger(item.id) || item.id <= 0 || !item.path.startsWith("/"))) throw new Error("SEO_PHASE2_ROLLBACK_BUNDLE_INVALID");
  return `(() => {
    const bundle = ${JSON.stringify(safe)};
    const nonce = window.wpApiSettings && window.wpApiSettings.nonce;
    if (!nonce) throw new Error('WORDPRESS_REST_NONCE_NOT_AVAILABLE');
    function request(method, path, body) {
      const xhr = new XMLHttpRequest();
      xhr.open(method, path, false);
      xhr.setRequestHeader('X-WP-Nonce', nonce);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(body));
      if (xhr.status < 200 || xhr.status >= 300) throw new Error('WORDPRESS_REST_' + xhr.status + ':' + path);
      return JSON.parse(xhr.responseText || 'null');
    }
    const restored = [];
    for (const item of bundle) {
      request('POST', '/wp-json/wp/v2/' + item.type + '/' + item.id, { title: item.title, content: item.content });
      restored.push({ type: item.type, id: item.id, path: item.path });
    }
    return { ok: true, commandId: ${JSON.stringify(String(commandId))}, planHash: ${JSON.stringify(String(planHash))}, rollbackPerformed: true, restoredCount: restored.length, restored };
  })()`;
}

export function stripRollbackBundle(result = {}) {
  const { rollbackBundle, ...publicResult } = result || {};
  return { publicResult, rollbackBundle: Array.isArray(rollbackBundle) ? rollbackBundle : [] };
}

export const SEO_PHASE2_SITE = SITE;
