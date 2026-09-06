import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/202609061300_rehash_multi_contact_routing_v1.sql', import.meta.url), 'utf8');

test('multi-contact routing preserves one canonical deal and fans out by route', () => {
  assert.match(migration, /georgie_recovery_contact_routes/);
  assert.match(migration, /unique\(deal_id,email\)/);
  assert.match(migration, /limit 3/);
  assert.match(migration, /statement-request:'\|\|p_deal_id\|\|':'\|\|substr\(md5\(lower\(r\.email\)\)/);
});

test('route eligibility uses merchant linkage plus flexible evidence, not a single perfect-address gate', () => {
  assert.match(migration, /p_merchant_linked/);
  assert.match(migration, /p_confidence,0\) >= 0\.50/);
  assert.match(migration, /p_direct_sierra_history/);
  assert.match(migration, /p_independent_signals,0\) >= 2/);
  assert.doesNotMatch(migration, /p_confidence,0\) >= 0\.85/);
});

test('hard safety remains per address and engagement collapses duplicate routes', () => {
  assert.match(migration, /lower\(s\.email\)=lower\(r\.email\)/);
  assert.match(migration, /merchant_engaged_elsewhere/);
  assert.match(migration, /reply_received/);
  assert.match(migration, /statement_uploaded/);
  assert.match(migration, /thread_id<>coalesce\(p_engaged_thread_id,''\)/);
});

test('Prism precontact remains once per merchant before safe contact fanout', () => {
  assert.match(migration, /georgie_complete_prism_precontact_v1/);
  assert.match(migration, /georgie_sync_contact_routes_v1\(500\)/);
  assert.match(migration, /georgie_enqueue_contact_routes_v1\(source\.deal_id,p_packet,p_secure_link\)/);
});
