// HTTP endpoints:
//   POST /wms/stock               WMS pushes stock changes (bearer token)
//   POST /webhooks/shopify        Shopify webhooks (HMAC-verified, de-duplicated)
//   GET  /health                  liveness + last sync runs
import http from 'node:http';
import { verifyShopifyHmac, verifyBearer } from './hmac.js';
import { normalizeStock } from '../wms/adapters.js';

const MAX_BODY = 5 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createServer({ config, store, engine, onShopifyEvent, logger = console }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return send(res, 200, { ok: true, lastRuns: await store.lastRuns(5) });
      }

      if (req.method === 'POST' && req.url === '/wms/stock') {
        if (!verifyBearer(req.headers.authorization, config.wms.inboundToken)) return send(res, 401, { error: 'unauthorized' });
        const raw = await readBody(req);
        let stock;
        try {
          stock = normalizeStock(JSON.parse(raw.toString('utf8')));
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
        const result = await engine.syncStock(stock, 'wms_push');
        return send(res, 200, result);
      }

      if (req.method === 'POST' && req.url === '/webhooks/shopify') {
        const raw = await readBody(req);
        if (!verifyShopifyHmac(raw, req.headers['x-shopify-hmac-sha256'], config.shopify.webhookSecret)) {
          return send(res, 401, { error: 'invalid hmac' });
        }
        const webhookId = req.headers['x-shopify-webhook-id'];
        const topic = req.headers['x-shopify-topic'];
        // Acknowledge fast; Shopify retries if we take longer than a few seconds.
        if (webhookId && !(await store.claimWebhook(webhookId, topic))) return send(res, 200, { duplicate: true });
        send(res, 200, { received: true });
        Promise.resolve(onShopifyEvent?.(topic, JSON.parse(raw.toString('utf8')))).catch((err) =>
          logger.error(`webhook ${topic} failed: ${err.message}`),
        );
        return;
      }

      send(res, 404, { error: 'not found' });
    } catch (err) {
      logger.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'internal error' });
    }
  });
}
