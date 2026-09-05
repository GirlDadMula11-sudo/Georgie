import test from 'node:test';
import assert from 'node:assert/strict';
import { activePdfTokens } from '../src/integrations/recovery-upload-validation.js';

test('allows benign PDF Additional Actions metadata by itself', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Annot /AA << /E 2 0 R >> >>\nendobj\n');
  assert.deepEqual(activePdfTokens(pdf), []);
});

test('blocks JavaScript carried through an Additional Actions dictionary', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /AA << /E << /S /JavaScript /JS (app.alert(1)) >> >> >>\nendobj\n');
  const active = activePdfTokens(pdf);
  assert.ok(active.includes('/JavaScript'));
  assert.ok(active.includes('/JS'));
  assert.ok(active.includes('/AA:risky-action'));
});

test('continues blocking other risky active PDF features', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /OpenAction << /S /Launch /F (payload.exe) >> >>\nendobj\n');
  const active = activePdfTokens(pdf);
  assert.ok(active.includes('/OpenAction'));
  assert.ok(active.includes('/Launch'));
});
