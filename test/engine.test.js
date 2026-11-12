import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine } from '../src/sync/engine.js';

function fakeStore() {
  const s = {
    skus: new Map(),
    snap: new Map(),
    runs: [],
    async skuMap(skus) {
      return new Map(skus.filter((k) => s.skus.has(k)).map((k) => [k, s.skus.get(k)]));
    },
    async saveSkuMap(m) {
      for (const [k, v] of m) s.skus.set(k, v);
    },
    async locationMap() {
      return new Map([['WH1', 'loc1']]);
    },
    async snapshot() {
      return new Map(s.snap);
    },
    async saveSnapshot(changes) {
      for (const c of changes) s.snap.set(`${c.inventoryItemId}|${c.locationId}`, c.quantity);
    },
    async clearSnapshot(i, l) {
      s.snap.delete(`${i}|${l}`);
    },
    async startRun() {
      return s.runs.push({}) ;
    },
    async finishRun(id, summary) {
      s.runs[id - 1] = summary;
    },
  };
  return s;
}

const config = { sync: { safetyBuffer: 0, batchSize: 250 } };
const quiet = { info() {}, warn() {} };

test('resolves new SKUs, writes changes, then skips identical re-sync', async () => {
  const store = fakeStore();
  const writes = [];
  const inventory = {
    resolveSkus: async () => new Map([['A', 'item1']]),
    setAvailable: async (changes) => (writes.push(changes), { errors: [] }),
  };
  const engine = createSyncEngine({ store, inventory, config, logger: quiet });
  const stock = [{ sku: 'A', warehouseCode: 'WH1', onHand: 4, reserved: 1 }];

  const first = await engine.syncStock(stock, 'reconcile');
  assert.equal(first.changed, 1);
  assert.equal(writes[0][0].quantity, 3);

  const second = await engine.syncStock(stock, 'reconcile');
  assert.equal(second.changed, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(writes.length, 1);
});

test('compare-and-set conflict clears the snapshot so the next run self-heals', async () => {
  const store = fakeStore();
  store.skus.set('A', 'item1');
  store.snap.set('item1|loc1', 3);
  const inventory = {
    resolveSkus: async () => new Map(),
    setAvailable: async () => ({ errors: [{ code: 'COMPARE_QUANTITY_STALE', message: 'stale' }] }),
  };
  const engine = createSyncEngine({ store, inventory, config, logger: quiet });
  const result = await engine.syncStock([{ sku: 'A', warehouseCode: 'WH1', onHand: 9 }], 'wms_push');
  assert.equal(result.errors.length, 1);
  assert.equal(store.snap.has('item1|loc1'), false);
});
