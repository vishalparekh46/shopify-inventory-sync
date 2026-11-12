// PostgreSQL persistence for maps, snapshots, webhook de-duplication and run history.
import pg from 'pg';

export function createStore(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

  return {
    pool,

    async locationMap() {
      const { rows } = await pool.query('SELECT warehouse_code, shopify_location_id FROM location_map');
      return new Map(rows.map((r) => [r.warehouse_code, r.shopify_location_id]));
    },

    async skuMap(skus) {
      const { rows } = await pool.query(
        'SELECT sku, inventory_item_id FROM sku_map WHERE sku = ANY($1::text[])',
        [skus],
      );
      return new Map(rows.map((r) => [r.sku, r.inventory_item_id]));
    },

    async saveSkuMap(entries) {
      if (!entries.size) return;
      const skus = [...entries.keys()];
      const ids = [...entries.values()];
      await pool.query(
        `INSERT INTO sku_map (sku, inventory_item_id)
         SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT (sku) DO UPDATE SET inventory_item_id = EXCLUDED.inventory_item_id, updated_at = now()`,
        [skus, ids],
      );
    },

    async snapshot(itemIds) {
      const { rows } = await pool.query(
        'SELECT inventory_item_id, location_id, quantity FROM stock_snapshot WHERE inventory_item_id = ANY($1::text[])',
        [itemIds],
      );
      return new Map(rows.map((r) => [`${r.inventory_item_id}|${r.location_id}`, r.quantity]));
    },

    async saveSnapshot(changes) {
      if (!changes.length) return;
      await pool.query(
        `INSERT INTO stock_snapshot (inventory_item_id, location_id, quantity)
         SELECT * FROM unnest($1::text[], $2::text[], $3::int[])
         ON CONFLICT (inventory_item_id, location_id)
         DO UPDATE SET quantity = EXCLUDED.quantity, synced_at = now()`,
        [changes.map((c) => c.inventoryItemId), changes.map((c) => c.locationId), changes.map((c) => c.quantity)],
      );
    },

    async clearSnapshot(inventoryItemId, locationId) {
      await pool.query('DELETE FROM stock_snapshot WHERE inventory_item_id = $1 AND location_id = $2', [
        inventoryItemId,
        locationId,
      ]);
    },

    /** Returns true the first time a webhook id is seen, false on Shopify retries. */
    async claimWebhook(webhookId, topic) {
      const { rowCount } = await pool.query(
        'INSERT INTO webhook_event (webhook_id, topic) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [webhookId, topic],
      );
      return rowCount === 1;
    },

    async startRun(trigger) {
      const { rows } = await pool.query('INSERT INTO sync_run (trigger) VALUES ($1) RETURNING id', [trigger]);
      return rows[0].id;
    },

    async finishRun(id, { changed, unchanged, skipped, errors }) {
      await pool.query(
        `UPDATE sync_run SET finished_at = now(), changed = $2, unchanged = $3, skipped = $4, errors = $5 WHERE id = $1`,
        [id, changed, unchanged, skipped, JSON.stringify(errors)],
      );
    },

    async lastRuns(limit = 20) {
      const { rows } = await pool.query('SELECT * FROM sync_run ORDER BY id DESC LIMIT $1', [limit]);
      return rows;
    },

    close: () => pool.end(),
  };
}
