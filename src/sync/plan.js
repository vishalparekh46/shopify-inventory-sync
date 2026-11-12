// Pure sync planning logic — no I/O, fully unit-tested.

/**
 * Units Shopify may sell for one SKU at one location.
 * onHand - reserved - safetyBuffer, never below zero.
 */
export function sellableQuantity({ onHand, reserved = 0 }, safetyBuffer = 0) {
  const qty = Math.floor(Number(onHand) || 0) - Math.floor(Number(reserved) || 0) - safetyBuffer;
  return Math.max(0, qty);
}

/**
 * Turn WMS stock records into Shopify writes.
 *
 * @param stock        [{ sku, warehouseCode, onHand, reserved }]
 * @param skuMap       Map<sku, inventoryItemId>
 * @param locationMap  Map<warehouseCode, shopifyLocationId>
 * @param snapshot     Map<"itemId|locationId", lastQuantityWeSet>
 * @returns { changes, unchanged, skipped }
 *   changes   — writes to send, with `previous` for compare-and-set
 *   unchanged — count of levels already correct
 *   skipped   — records we could not map, with a reason (surfaced in logs, never dropped silently)
 */
export function planSync(stock, { skuMap, locationMap, snapshot = new Map(), safetyBuffer = 0 }) {
  const changes = [];
  const skipped = [];
  let unchanged = 0;

  // Several WMS bins/warehouses can map to one Shopify location — sum them first.
  const totals = new Map();
  for (const rec of stock) {
    const inventoryItemId = skuMap.get(rec.sku);
    if (!inventoryItemId) {
      skipped.push({ ...rec, reason: 'sku_not_in_shopify' });
      continue;
    }
    const locationId = locationMap.get(rec.warehouseCode);
    if (!locationId) {
      skipped.push({ ...rec, reason: 'warehouse_not_mapped' });
      continue;
    }
    const key = `${inventoryItemId}|${locationId}`;
    const prev = totals.get(key) ?? { inventoryItemId, locationId, sku: rec.sku, quantity: 0 };
    prev.quantity += sellableQuantity(rec, safetyBuffer);
    totals.set(key, prev);
  }

  for (const [key, target] of totals) {
    const previous = snapshot.get(key);
    if (previous === target.quantity) {
      unchanged++;
      continue;
    }
    changes.push({ ...target, previous: Number.isInteger(previous) ? previous : undefined });
  }

  return { changes, unchanged, skipped };
}
