import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify a Shopify webhook signature against the raw request body. */
export function verifyShopifyHmac(rawBody, headerValue, secret) {
  if (!headerValue || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let received;
  try {
    received = Buffer.from(headerValue, 'base64');
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Constant-time bearer token check for the WMS push endpoint. */
export function verifyBearer(authHeader, token) {
  if (!authHeader || !token) return false;
  const [scheme, value] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
