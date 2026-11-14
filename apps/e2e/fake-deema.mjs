// Local stand-in for Deema, for automated tests only. It copies the parts of Deema's merchant API the
// adapter uses (paths, "Authorization: Basic {API Key}", request and response shapes as documented at
// docs.deema.me) and adds a tiny hosted payment page. The API talks to it only when DEEMA_API_URL points
// here, which only the test suites do. It never calls the merchant's webhook address; tests post
// the notification to the API themselves.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.FAKE_DEEMA_PORT ?? 2531);
const KEYS = new Set(['FakeDeemaApiKeyForTestsAAAA0001', 'FakeDeemaApiKeyForTestsBBBB0002']);
const orders = new Map();
let down = false;
let refuse = false;
let nextId = 100;

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((done) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => done(b)); });
const view = (o) => ({ order_reference: o.ref, merchant_order_id: o.request.merchant_order_id, status: o.status, amount: o.amount, currency_code: o.request.currency_code });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (path === '/health') return res.end('ok');

  // ---- test controls ----
  if (path === '/__control/orders') return json(res, 200, [...orders.values()].map((o) => ({ ...view(o), request: o.request })));
  if (path === '/__control/down') { down = JSON.parse(await read(req)).down; return json(res, 200, { down }); }
  if (path === '/__control/refuse') { refuse = JSON.parse(await read(req)).refuse; return json(res, 200, { refuse }); }
  let m = /^\/__control\/orders\/([0-9a-f-]+)$/.exec(path);
  if (m && req.method === 'POST') {
    const o = orders.get(m[1]);
    if (!o) return json(res, 404, {});
    const body = JSON.parse(await read(req));
    if (body.amount !== undefined) o.amount = body.amount;
    if (body.attempt) o.status = { pay: 'captured', decline: 'declined', cancel: 'payment_cancelled', authorize: 'authorized' }[body.attempt];
    if (body.status) o.status = body.status;
    return json(res, 200, view(o));
  }

  // ---- the hosted payment page ----
  if (path === '/pay') {
    const o = orders.get(url.searchParams.get('order_reference') ?? '');
    if (!o) { res.writeHead(404); return res.end('unknown order'); }
    if (req.method === 'POST') {
      const outcome = new URLSearchParams(await read(req)).get('outcome');
      o.status = outcome === 'pay' ? 'captured' : 'declined';
      const back = outcome === 'pay' ? o.request.merchant_urls.success : o.request.merchant_urls.failure;
      res.writeHead(303, { location: back });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>Fake Deema</title><h1>Fake Deema payment page (tests only)</h1>
      <p data-testid="amount">${Number(o.amount).toFixed(3)} ${o.request.currency_code}</p>
      <form method="post"><button name="outcome" value="pay">Pay</button><button name="outcome" value="decline">Decline</button></form>`);
  }

  // ---- Deema API ----
  if (!path.startsWith('/api/merchant/v1/')) { res.writeHead(404); return res.end(); }
  if (down) return json(res, 503, { message: 'Service unavailable' });
  const key = /^Basic (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!key || !KEYS.has(key)) return json(res, 401, { error: 'Unauthenticated' });

  if (path === '/api/merchant/v1/purchase' && req.method === 'POST') {
    const b = JSON.parse((await read(req)) || '{}');
    if (typeof b.amount !== 'number' || !(b.amount >= 1) || !b.currency_code || !b.merchant_order_id || !b.merchant_urls?.success || !b.merchant_urls?.failure) {
      return json(res, 422, { message: 'The given data was invalid.', errors: {} });
    }
    // A customer-side refusal, switched on by the tests.
    if (refuse) return json(res, 400, { message: 'Customer is not able to procced order', data: {} });
    const ref = randomUUID();
    orders.set(ref, { ref, key, status: 'pending', amount: b.amount, request: b });
    return json(res, 200, { message: 'Purchase created successfully', data: { order_reference: ref, purchase_id: nextId++, order_status: 'pending', redirect_link: `http://127.0.0.1:${PORT}/pay?order_reference=${ref}` } });
  }

  m = /^\/api\/merchant\/v1\/purchase\/([^/]+)\/retrieve_by_reference$/.exec(path);
  if (m && req.method === 'GET') {
    const o = orders.get(m[1]);
    // An order is visible only with the key of the merchant that created it.
    if (!o || o.key !== key) return json(res, 404, { message: 'Purchase not found', data: null });
    return json(res, 200, { message: 'Fetch order by reference', data: view(o) });
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1');
