import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, sellableQuantity } from '../src/sync/plan.js';

const skuMap = new Map([
  ['TSHIRT-RED-M', 'gid://shopify/InventoryItem/1'],
  ['MUG-01', 'gid://shopify/InventoryItem/2'],
]);
const locationMap = new Map([
  ['AHM-WH1', 'gid://shopify/Location/10'],
  ['AHM-WH2', 'gid://shopify/Location/10'], // two bins -> one Shopify location
  ['DXB', 'gid://shopify/Location/20'],
]);

test('sellableQuantity subtracts reserved and buffer, never negative', () => {
  assert.equal(sellableQuantity({ onHand: 10, reserved: 3 }), 7);
  assert.equal(sellableQuantity({ onHand: 10, reserved: 3 }, 2), 5);
  assert.equal(sellableQuantity({ onHand: 2, reserved: 5 }, 1), 0);
  assert.equal(sellableQuantity({ onHand: 4.9 }), 4);
});

test('sums multiple warehouses mapped to the same Shopify location', () => {
  const { changes } = planSync(
    [
      { sku: 'MUG-01', warehouseCode: 'AHM-WH1', onHand: 5, reserved: 0 },
      { sku: 'MUG-01', warehouseCode: 'AHM-WH2', onHand: 7, reserved: 2 },
    ],
    { skuMap, locationMap },
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].quantity, 10);
  assert.equal(changes[0].locationId, 'gid://shopify/Location/10');
});

test('skips no-op writes and passes previous quantity for compare-and-set', () => {
  const snapshot = new Map([
    ['gid://shopify/InventoryItem/1|gid://shopify/Location/20', 8],
    ['gid://shopify/InventoryItem/2|gid://shopify/Location/20', 3],
  ]);
  const { changes, unchanged } = planSync(
    [
      { sku: 'TSHIRT-RED-M', warehouseCode: 'DXB', onHand: 8, reserved: 0 },
      { sku: 'MUG-01', warehouseCode: 'DXB', onHand: 6, reserved: 1 },
    ],
    { skuMap, locationMap, snapshot },
  );
  assert.equal(unchanged, 1);
  assert.deepEqual(changes.map((c) => [c.sku, c.quantity, c.previous]), [['MUG-01', 5, 3]]);
});

test('reports unmapped SKUs and warehouses instead of dropping them silently', () => {
  const { changes, skipped } = planSync(
    [
      { sku: 'UNKNOWN', warehouseCode: 'DXB', onHand: 1 },
      { sku: 'MUG-01', warehouseCode: 'NOWHERE', onHand: 1 },
    ],
    { skuMap, locationMap },
  );
  assert.equal(changes.length, 0);
  assert.deepEqual(skipped.map((s) => s.reason), ['sku_not_in_shopify', 'warehouse_not_mapped']);
});

test('applies safety buffer per record', () => {
  const { changes } = planSync([{ sku: 'MUG-01', warehouseCode: 'DXB', onHand: 3 }], {
    skuMap,
    locationMap,
    safetyBuffer: 2,
  });
  assert.equal(changes[0].quantity, 1);
});
