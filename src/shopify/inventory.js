// Shopify inventory operations: resolve SKUs, read levels, write "available" quantities.

const VARIANTS_BY_SKU = /* GraphQL */ `
  query VariantsBySku($query: String!, $after: String) {
    productVariants(first: 100, query: $query, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        sku
        inventoryItem { id tracked }
      }
    }
  }
`;

const LOCATIONS = /* GraphQL */ `
  query Locations($after: String) {
    locations(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id name isActive }
    }
  }
`;

const SET_QUANTITIES = /* GraphQL */ `
  mutation SetAvailable($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { id }
      userErrors { field message code }
    }
  }
`;

/** Build a Shopify search query matching any of the given SKUs. */
export function skuSearchQuery(skus) {
  return skus.map((s) => `sku:"${String(s).replace(/"/g, '\\"')}"`).join(' OR ');
}

/** Split an array into chunks of at most `size`. */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createInventoryApi(client) {
  /** Map SKU -> inventoryItem GID for tracked variants. Untracked items are skipped. */
  async function resolveSkus(skus) {
    const result = new Map();
    for (const group of chunk([...new Set(skus)], 50)) {
      let after = null;
      do {
        const data = await client.graphql(VARIANTS_BY_SKU, { query: skuSearchQuery(group), after });
        for (const v of data.productVariants.nodes) {
          if (v.sku && v.inventoryItem?.tracked) result.set(v.sku, v.inventoryItem.id);
        }
        after = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
      } while (after);
    }
    return result;
  }

  async function listLocations() {
    const locations = [];
    let after = null;
    do {
      const data = await client.graphql(LOCATIONS, { after });
      locations.push(...data.locations.nodes.filter((l) => l.isActive));
      after = data.locations.pageInfo.hasNextPage ? data.locations.pageInfo.endCursor : null;
    } while (after);
    return locations;
  }

  /**
   * Set "available" quantities. Each change is
   * { inventoryItemId, locationId, quantity, previous }.
   * When `previous` is known we send it as compareQuantity, so Shopify rejects
   * the write if stock moved since our last sync (e.g. a sale landed in between)
   * instead of silently overwriting it.
   */
  async function setAvailable(changes, { batchSize = 250, reason = 'correction', referenceUri } = {}) {
    const errors = [];
    for (const batch of chunk(changes, batchSize)) {
      const useCompare = batch.every((c) => Number.isInteger(c.previous));
      const input = {
        name: 'available',
        reason,
        ignoreCompareQuantity: !useCompare,
        quantities: batch.map((c) => ({
          inventoryItemId: c.inventoryItemId,
          locationId: c.locationId,
          quantity: c.quantity,
          ...(useCompare ? { compareQuantity: c.previous } : {}),
        })),
      };
      if (referenceUri) input.referenceDocumentUri = referenceUri;
      const data = await client.graphql(SET_QUANTITIES, { input });
      errors.push(...data.inventorySetQuantities.userErrors);
    }
    return { errors };
  }

  return { resolveSkus, listLocations, setAvailable };
}
