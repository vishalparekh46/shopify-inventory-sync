import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShopifyClient, throttleDelay } from '../src/shopify/client.js';
import { createInventoryApi, skuSearchQuery, chunk } from '../src/shopify/inventory.js';

const json = (status, body) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });

test('throttleDelay waits for the bucket to refill', () => {
  const ms = throttleDelay({ requestedQueryCost: 200, throttleStatus: { currentlyAvailable: 100, restoreRate: 50 } }, 0);
  assert.equal(ms, 2100);
  assert.equal(throttleDelay(undefined, 2), 4000);
});

test('client retries THROTTLED responses then succeeds', async () => {
  const calls = [];
  const responses = [
    json(200, {
      errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      extensions: { cost: { requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 10, restoreRate: 100 } } },
    }),
    json(200, { data: { ok: true } }),
  ];
  const client = createShopifyClient({
    shop: 'demo.myshopify.com',
    accessToken: 't',
    apiVersion: '2025-07',
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers });
      return responses.shift();
    },
  });
  assert.deepEqual(await client.graphql('{ shop { id } }'), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://demo.myshopify.com/admin/api/2025-07/graphql.json');
  assert.equal(calls[0].headers['X-Shopify-Access-Token'], 't');
});

test('client surfaces GraphQL errors', async () => {
  const client = createShopifyClient({
    shop: 's',
    accessToken: 't',
    apiVersion: 'v',
    fetchImpl: async () => json(200, { errors: [{ message: 'bad field' }] }),
  });
  await assert.rejects(client.graphql('{ x }'), /Shopify GraphQL error/);
});

test('skuSearchQuery escapes quotes; chunk splits arrays', () => {
  assert.equal(skuSearchQuery(['A', 'B"1']), 'sku:"A" OR sku:"B\\"1"');
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('setAvailable batches and uses compareQuantity only when every previous is known', async () => {
  const inputs = [];
  const api = createInventoryApi({
    graphql: async (_q, vars) => {
      inputs.push(vars.input);
      return { inventorySetQuantities: { userErrors: [] } };
    },
  });
  const changes = [
    { inventoryItemId: 'i1', locationId: 'l1', quantity: 5, previous: 3 },
    { inventoryItemId: 'i2', locationId: 'l1', quantity: 2, previous: 1 },
    { inventoryItemId: 'i3', locationId: 'l1', quantity: 9 },
  ];
  await api.setAvailable(changes, { batchSize: 2 });
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].ignoreCompareQuantity, false);
  assert.equal(inputs[0].quantities[0].compareQuantity, 3);
  assert.equal(inputs[1].ignoreCompareQuantity, true);
  assert.equal('compareQuantity' in inputs[1].quantities[0], false);
  assert.equal(inputs[0].name, 'available');
});

test('resolveSkus keeps only tracked variants and follows pagination', async () => {
  const pages = [
    {
      productVariants: {
        pageInfo: { hasNextPage: true, endCursor: 'c1' },
        nodes: [{ sku: 'A', inventoryItem: { id: 'gid://1', tracked: true } }],
      },
    },
    {
      productVariants: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          { sku: 'B', inventoryItem: { id: 'gid://2', tracked: false } },
          { sku: 'C', inventoryItem: { id: 'gid://3', tracked: true } },
        ],
      },
    },
  ];
  const api = createInventoryApi({ graphql: async () => pages.shift() });
  const map = await api.resolveSkus(['A', 'B', 'C']);
  assert.deepEqual([...map], [['A', 'gid://1'], ['C', 'gid://3']]);
});
