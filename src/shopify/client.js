// Minimal Shopify Admin GraphQL client with throttle-aware retries.
//
// Shopify rate-limits GraphQL by query cost. When a request is throttled the
// response carries `extensions.cost.throttleStatus`, which tells us how fast
// the bucket refills — we wait exactly long enough instead of guessing.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ShopifyError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ShopifyError';
    this.details = details;
  }
}

/** How long to wait before retrying a throttled request, in ms. */
export function throttleDelay(cost, attempt) {
  const status = cost?.throttleStatus;
  const requested = cost?.requestedQueryCost;
  if (status && requested && status.restoreRate > 0) {
    const deficit = Math.max(0, requested - status.currentlyAvailable);
    return Math.ceil((deficit / status.restoreRate) * 1000) + 100;
  }
  return Math.min(1000 * 2 ** attempt, 15_000); // fallback: exponential backoff
}

export function createShopifyClient({ shop, accessToken, apiVersion, fetchImpl = fetch, maxRetries = 5 }) {
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  async function graphql(query, variables = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt >= maxRetries) throw new ShopifyError(`Shopify HTTP ${res.status} after ${attempt} retries`);
        await sleep(Math.min(1000 * 2 ** attempt, 15_000));
        continue;
      }
      if (!res.ok) throw new ShopifyError(`Shopify HTTP ${res.status}`, await res.text());

      const body = await res.json();
      const throttled = body.errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        if (attempt >= maxRetries) throw new ShopifyError('Shopify throttled after retries', body.errors);
        await sleep(throttleDelay(body.extensions?.cost, attempt));
        continue;
      }
      if (body.errors?.length) throw new ShopifyError('Shopify GraphQL error', body.errors);
      return body.data;
    }
  }

  return { graphql };
}
