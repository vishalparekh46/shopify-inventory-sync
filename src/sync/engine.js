// Orchestrates one sync: resolve SKUs -> plan -> write to Shopify -> record snapshot.
import { planSync } from './plan.js';

export function createSyncEngine({ store, inventory, config, logger = console }) {
  async function ensureSkuMap(skus) {
    const known = await store.skuMap(skus);
    const missing = skus.filter((s) => !known.has(s));
    if (missing.length) {
      const resolved = await inventory.resolveSkus(missing);
      await store.saveSkuMap(resolved);
      for (const [sku, id] of resolved) known.set(sku, id);
    }
    return known;
  }

  /** Sync a set of stock records (full feed or a partial push from the WMS). */
  async function syncStock(stock, trigger) {
    const runId = await store.startRun(trigger);
    const errors = [];
    try {
      const skus = [...new Set(stock.map((r) => r.sku))];
      const skuMap = await ensureSkuMap(skus);
      const locationMap = await store.locationMap();
      const snapshot = await store.snapshot([...new Set(skuMap.values())]);

      const plan = planSync(stock, { skuMap, locationMap, snapshot, safetyBuffer: config.sync.safetyBuffer });
      for (const s of plan.skipped) logger.warn(`skip ${s.sku}@${s.warehouseCode}: ${s.reason}`);

      if (plan.changes.length) {
        const { errors: userErrors } = await inventory.setAvailable(plan.changes, {
          batchSize: config.sync.batchSize,
          referenceUri: `gid://shopify-inventory-sync/SyncRun/${runId}`,
        });
        errors.push(...userErrors);

        if (userErrors.length) {
          // A compare-and-set conflict means stock moved in Shopify since our last write.
          // Drop the stale snapshot so the next run writes without compareQuantity.
          for (const c of plan.changes) await store.clearSnapshot(c.inventoryItemId, c.locationId);
        } else {
          await store.saveSnapshot(plan.changes);
        }
      }

      const summary = {
        changed: errors.length ? 0 : plan.changes.length,
        unchanged: plan.unchanged,
        skipped: plan.skipped.length,
        errors,
      };
      await store.finishRun(runId, summary);
      logger.info(`sync #${runId} (${trigger}): ${summary.changed} changed, ${summary.unchanged} unchanged, ${summary.skipped} skipped, ${errors.length} errors`);
      return { runId, ...summary };
    } catch (err) {
      await store.finishRun(runId, { changed: 0, unchanged: 0, skipped: 0, errors: [{ message: err.message }] });
      throw err;
    }
  }

  return { syncStock };
}
