// Entry point: HTTP server + scheduled full reconciliation.
import { loadConfig } from './config.js';
import { createShopifyClient } from './shopify/client.js';
import { createInventoryApi } from './shopify/inventory.js';
import { createStore } from './db/store.js';
import { createAdapter } from './wms/adapters.js';
import { createSyncEngine } from './sync/engine.js';
import { createServer } from './http/server.js';

const config = loadConfig();
const store = createStore(config.databaseUrl);
const inventory = createInventoryApi(createShopifyClient(config.shopify));
const adapter = createAdapter(config.wms);
const engine = createSyncEngine({ store, inventory, config });

async function reconcile() {
  try {
    await engine.syncStock(await adapter.fetchStock(), 'reconcile');
  } catch (err) {
    console.error(`reconcile failed: ${err.message}`);
  }
}

// Shopify-side changes we care about.
async function onShopifyEvent(topic, payload) {
  if (topic === 'inventory_levels/update') {
    // Someone changed stock directly in Shopify admin. Forget our snapshot so the
    // next WMS push or reconciliation restores the warehouse truth.
    await store.clearSnapshot(
      `gid://shopify/InventoryItem/${payload.inventory_item_id}`,
      `gid://shopify/Location/${payload.location_id}`,
    );
  }
}

const server = createServer({ config, store, engine, onShopifyEvent });
server.listen(config.port, () => console.info(`shopify-inventory-sync listening on :${config.port}`));

const timer = setInterval(reconcile, config.sync.reconcileIntervalMinutes * 60_000);
reconcile();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    clearInterval(timer);
    server.close();
    await store.close();
    process.exit(0);
  });
}
