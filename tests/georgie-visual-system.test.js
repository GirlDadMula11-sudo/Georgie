import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Georgie visual system preserves every interactive runtime anchor", () => {
  const html = read("public/index.html");
  for (const id of ["enrollmentGate", "installButton", "notificationButton", "voiceOutputToggle", "companionButton", "presenceState", "continuityState", "status", "conversation", "attachmentTray", "textForm", "attachmentInput", "attachmentButton", "textInput", "voiceButton", "voiceLabel", "handsFreeToggle", "voiceOutputState", "workspaceDetails"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
});

test("desktop installation is offered only when the browser supplies an install prompt", () => {
  const pwa = read("public/pwa.js");
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /installButton\.hidden = !deferredInstallPrompt/);
  assert.match(pwa, /installButton\?\.addEventListener\("click", installGeorgie\)/);
});

test("mobile and desktop layouts use the canonical Georgie brand assets", () => {
  const html = read("public/index.html");
  const css = read("public/georgie-v2.css");
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.match(html, /georgie-logo-v2\.svg/);
  assert.match(html, /georgie-companion\.png/);
  assert.match(css, /data-voice-state="speaking"/);
  assert.match(css, /data-voice-state="approval_needed"/);
  assert.equal(fs.existsSync(new URL("../public/georgie-companion.png", import.meta.url)), true);
  assert.match(css, /grid-template-columns:minmax\(280px,340px\) minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:899px\)/);
  assert.deepEqual(manifest.icons.map(icon => icon.src), ["/georgie-logo-v2.svg"]);
  for (const icon of manifest.icons) assert.equal(fs.existsSync(new URL(`../public${icon.src}`, import.meta.url)), true);
});
