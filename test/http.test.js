import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyShopifyHmac, verifyBearer } from '../src/http/hmac.js';
import { createServer } from '../src/http/server.js';
import { normalizeStock } from '../src/wms/adapters.js';

const secret = 'shhh';
const sign = (body) => createHmac('sha256', secret).update(body).digest('base64');

test('verifyShopifyHmac accepts valid and rejects tampered bodies', () => {
  const body = Buffer.from('{"id":1}');
  assert.equal(verifyShopifyHmac(body, sign(body), secret), true);
  assert.equal(verifyShopifyHmac(Buffer.from('{"id":2}'), sign(body), secret), false);
  assert.equal(verifyShopifyHmac(body, undefined, secret), false);
});

test('verifyBearer', () => {
  assert.equal(verifyBearer('Bearer abc', 'abc'), true);
  assert.equal(verifyBearer('Bearer abd', 'abc'), false);
  assert.equal(verifyBearer('Basic abc', 'abc'), false);
});

test('normalizeStock validates records', () => {
  assert.deepEqual(normalizeStock([{ sku: ' A ', warehouseCode: 'W', onHand: '4' }]), [
    { sku: 'A', warehouseCode: 'W', onHand: 4, reserved: 0 },
  ]);
  assert.throws(() => normalizeStock([{ warehouseCode: 'W', onHand: 1 }]), /sku is required/);
  assert.throws(() => normalizeStock({}), /must be an array/);
});

async function withServer(deps, fn) {
  const server = createServer({
    config: { wms: { inboundToken: 'tok' }, shopify: { webhookSecret: secret } },
    logger: { error() {}, info() {}, warn() {} },
    ...deps,
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('POST /wms/stock requires auth and syncs valid payloads', async () => {
  const synced = [];
  const engine = { syncStock: async (stock, trigger) => (synced.push({ stock, trigger }), { changed: 1 }) };
  await withServer({ engine, store: {} }, async (base) => {
    const body = JSON.stringify([{ sku: 'A', warehouseCode: 'W', onHand: 3 }]);
    assert.equal((await fetch(`${base}/wms/stock`, { method: 'POST', body })).status, 401);
    const bad = await fetch(`${base}/wms/stock`, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer tok' } });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/wms/stock`, { method: 'POST', body, headers: { Authorization: 'Bearer tok' } });
    assert.equal(ok.status, 200);
    assert.equal(synced[0].trigger, 'wms_push');
  });
});

test('Shopify webhooks are HMAC-checked and de-duplicated', async () => {
  const seen = new Set();
  const events = [];
  const store = { claimWebhook: async (id) => (seen.has(id) ? false : (seen.add(id), true)) };
  await withServer({ store, engine: {}, onShopifyEvent: async (topic) => events.push(topic) }, async (base) => {
    const body = JSON.stringify({ inventory_item_id: 1, location_id: 2 });
    const headers = {
      'X-Shopify-Hmac-Sha256': sign(body),
      'X-Shopify-Webhook-Id': 'w1',
      'X-Shopify-Topic': 'inventory_levels/update',
    };
    assert.equal((await fetch(`${base}/webhooks/shopify`, { method: 'POST', body, headers: { ...headers, 'X-Shopify-Hmac-Sha256': 'nope' } })).status, 401);
    assert.deepEqual(await (await fetch(`${base}/webhooks/shopify`, { method: 'POST', body, headers })).json(), { received: true });
    assert.deepEqual(await (await fetch(`${base}/webhooks/shopify`, { method: 'POST', body, headers })).json(), { duplicate: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(events, ['inventory_levels/update']);
  });
});
