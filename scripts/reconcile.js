// Run one full reconciliation from the command line (e.g. from cron).
import { loadConfig } from '../src/config.js';
import { createShopifyClient } from '../src/shopify/client.js';
import { createInventoryApi } from '../src/shopify/inventory.js';
import { createStore } from '../src/db/store.js';
import { createAdapter } from '../src/wms/adapters.js';
import { createSyncEngine } from '../src/sync/engine.js';

const config = loadConfig();
const store = createStore(config.databaseUrl);
const engine = createSyncEngine({
  store,
  inventory: createInventoryApi(createShopifyClient(config.shopify)),
  config,
});
try {
  const result = await engine.syncStock(await createAdapter(config.wms).fetchStock(), 'reconcile');
  console.info(JSON.stringify(result, null, 2));
} finally {
  await store.close();
}
