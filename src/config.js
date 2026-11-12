// Central configuration, read once from the environment.

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

export function loadConfig() {
  return {
    port: int('PORT', 3000),
    databaseUrl: required('DATABASE_URL'),
    shopify: {
      shop: required('SHOPIFY_SHOP'), // e.g. my-store.myshopify.com
      accessToken: required('SHOPIFY_ADMIN_TOKEN'),
      apiVersion: process.env.SHOPIFY_API_VERSION || '2025-07',
      webhookSecret: required('SHOPIFY_WEBHOOK_SECRET'),
    },
    wms: {
      adapter: process.env.WMS_ADAPTER || 'http', // "http" | "mock"
      baseUrl: process.env.WMS_BASE_URL || '',
      apiKey: process.env.WMS_API_KEY || '',
      inboundToken: required('WMS_INBOUND_TOKEN'), // bearer token the WMS uses to push updates to us
    },
    sync: {
      // Units held back per SKU per location so Shopify never sells the last unit
      // the warehouse may already have allocated (picking, damaged, in transit).
      safetyBuffer: int('SYNC_SAFETY_BUFFER', 0),
      reconcileIntervalMinutes: int('RECONCILE_INTERVAL_MINUTES', 60),
      batchSize: Math.min(int('SYNC_BATCH_SIZE', 250), 250), // Shopify caps a mutation at 250 quantities
    },
  };
}
