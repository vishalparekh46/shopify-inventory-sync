// WMS / ERP adapters. Each adapter returns stock records:
//   { sku, warehouseCode, onHand, reserved }
// Add your own (ERPNext, NetSuite, Cin7, a 3PL API, a CSV drop) by implementing fetchStock().

/** Generic REST adapter: GET {baseUrl}/stock returns an array of stock records. */
export function httpAdapter({ baseUrl, apiKey, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error('WMS_BASE_URL is required for the http adapter');
  return {
    name: 'http',
    async fetchStock() {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/stock`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) throw new Error(`WMS responded ${res.status}`);
      return normalizeStock(await res.json());
    },
  };
}

/** In-memory adapter for local development and demos. */
export function mockAdapter(records = []) {
  return {
    name: 'mock',
    async fetchStock() {
      return normalizeStock(records);
    },
  };
}

/** Validate and coerce incoming stock records; throws on malformed input. */
export function normalizeStock(input) {
  if (!Array.isArray(input)) throw new Error('Stock payload must be an array');
  return input.map((r, i) => {
    if (!r || typeof r.sku !== 'string' || !r.sku.trim()) throw new Error(`Record ${i}: sku is required`);
    if (typeof r.warehouseCode !== 'string' || !r.warehouseCode.trim())
      throw new Error(`Record ${i}: warehouseCode is required`);
    const onHand = Number(r.onHand);
    const reserved = Number(r.reserved ?? 0);
    if (!Number.isFinite(onHand)) throw new Error(`Record ${i}: onHand must be a number`);
    if (!Number.isFinite(reserved)) throw new Error(`Record ${i}: reserved must be a number`);
    return { sku: r.sku.trim(), warehouseCode: r.warehouseCode.trim(), onHand, reserved };
  });
}

export function createAdapter(config) {
  if (config.adapter === 'mock') return mockAdapter();
  return httpAdapter(config);
}
