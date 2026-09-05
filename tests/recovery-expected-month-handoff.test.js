import test from 'node:test';
import assert from 'node:assert/strict';
import { completeStatementUpload } from '../src/financing-recovery-engagement.js';

test('passes selected expected month into validator only when token-scoped', async () => {
  const seen = [];
  const token = 'x'.repeat(40);
  const store = {
    resolveUploadToken: async () => ({ applicantId:'a', episodeId:'e', requestedMonths:['2026-07','2026-08'], expiresAt:'2099-01-01T00:00:00.000Z', revoked:false }),
    transactUploadCompletion: async input => input
  };
  const storage = { contract:'georgie.statement-storage.v1', putImmutable: async ({contentHash}) => ({ receiptId:'store-1', contentHash, immutable:true }) };
  const file = { buffer: Buffer.from('%PDF-1.4\n'.padEnd(64,'x')), name:'statement.pdf', mimeType:'application/pdf' };
  await completeStatementUpload(store, {
    token, file, expectedMonth:'2026-07', storage,
    scan: async ({contentHash}) => ({ clean:true, receiptId:`scan:${contentHash}` }),
    validateDocument: async args => { seen.push(args.expectedMonth); return { verified:true, statementMonth:'2026-07', businessMatch:true, evidenceIds:[] }; }
  });
  assert.deepEqual(seen, ['2026-07']);
});