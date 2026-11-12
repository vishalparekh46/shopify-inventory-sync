-- Which WMS warehouse feeds which Shopify location.
CREATE TABLE IF NOT EXISTS location_map (
  warehouse_code       TEXT PRIMARY KEY,
  shopify_location_id  TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cached SKU -> Shopify inventory item, refreshed by products/update webhooks and reconciliation.
CREATE TABLE IF NOT EXISTS sku_map (
  sku                  TEXT PRIMARY KEY,
  inventory_item_id    TEXT NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Last "available" quantity we wrote per item/location. Used to skip no-op writes
-- and as compareQuantity so concurrent sales are never overwritten.
CREATE TABLE IF NOT EXISTS stock_snapshot (
  inventory_item_id    TEXT NOT NULL,
  location_id          TEXT NOT NULL,
  quantity             INTEGER NOT NULL,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (inventory_item_id, location_id)
);

-- Shopify retries webhooks; we process each delivery once.
CREATE TABLE IF NOT EXISTS webhook_event (
  webhook_id           TEXT PRIMARY KEY,
  topic                TEXT NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit trail of every sync run.
CREATE TABLE IF NOT EXISTS sync_run (
  id                   BIGSERIAL PRIMARY KEY,
  trigger              TEXT NOT NULL,          -- 'wms_push' | 'reconcile' | 'webhook'
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at          TIMESTAMPTZ,
  changed              INTEGER NOT NULL DEFAULT 0,
  unchanged            INTEGER NOT NULL DEFAULT 0,
  skipped              INTEGER NOT NULL DEFAULT 0,
  errors               JSONB NOT NULL DEFAULT '[]'::jsonb
);
