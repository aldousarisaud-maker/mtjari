// Local stand-in for Tabby, for automated tests only. It copies the parts of Tabby's API the adapter
// uses (paths, Bearer secret key, payload and response shapes as documented at docs.tabby.ai) and adds a
// tiny "hosted payment page". The API talks to it only when TABBY_API_URL points here, which only the
// test suites do. It never calls registered webhook addresses (they are public https ones); tests post
// the notification to the API themselves.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.FAKE_TABBY_PORT ?? 2530);
// Made-up test accounts: secret key -> merchant code.
const ACCOUNTS = new Map([
  ['sk_test_FakeTabbyKeyForTestsAAAA0001', 'FAKEA'],
  ['sk_test_FakeTabbyKeyForTestsBBBB0002', 'FAKEB'],
]);
const payments = new Map();
const webhooks = []; // { key, merchant, url }
let down = false;
let captureStatus = 200;

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((done) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => done(b)); });
const view = (p) => ({ id: p.id, created_at: p.created_at, status: p.status, is_test: true, amount: p.amount, currency: p.currency, order: { reference_id: p.order?.reference_id ?? null }, captures: p.captures, refunds: [] });
const fmt = (n, cur) => n.toFixed(cur === 'KWD' || cur === 'BHD' || cur === 'OMR' ? 3 : 2);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (path === '/health') return res.end('ok');

  // ---- test controls ----
  if (path === '/__control/payments') return json(res, 200, [...payments.values()].map((p) => ({ ...view(p), request: p.request })));
  if (path === '/__control/webhooks') return json(res, 200, webhooks);
  if (path === '/__control/down') { down = JSON.parse(await read(req)).down; return json(res, 200, { down }); }
  if (path === '/__control/capture-status') { captureStatus = JSON.parse(await read(req)).status; return json(res, 200, { captureStatus }); }
  let m = /^\/__control\/payments\/([0-9a-f-]+)$/.exec(path);
  if (m && req.method === 'POST') {
    const p = payments.get(m[1]);
    if (!p) return json(res, 404, {});
    const body = JSON.parse(await read(req));
    if (body.amount !== undefined) p.amount = fmt(body.amount, p.currency);
    if (body.status) p.status = body.status;
    if (body.attempt) p.status = { pay: 'AUTHORIZED', decline: 'REJECTED', cancel: 'EXPIRED' }[body.attempt];
    return json(res, 200, view(p));
  }

  // ---- the hosted payment page ----
  m = /^\/hpp\/([0-9a-f-]+)$/.exec(path);
  if (m) {
    const p = payments.get(m[1]);
    if (!p) { res.writeHead(404); return res.end('unknown payment'); }
    if (req.method === 'POST') {
      const outcome = new URLSearchParams(await read(req)).get('outcome');
      const [status, back] = { pay: ['AUTHORIZED', p.urls.success], decline: ['REJECTED', p.urls.failure], cancel: ['EXPIRED', p.urls.cancel] }[outcome];
      p.status = status;
      res.writeHead(303, { location: `${back}${back.includes('?') ? '&' : '?'}payment_id=${p.id}` });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>Fake Tabby</title><h1>Fake Tabby payment page (tests only)</h1>
      <p data-testid="amount">${p.amount} ${p.currency}</p>
      <form method="post"><button name="outcome" value="pay">Pay</button><button name="outcome" value="decline">Decline</button><button name="outcome" value="cancel">Cancel</button></form>`);
  }

  // ---- Tabby API ----
  if (!path.startsWith('/api/')) { res.writeHead(404); return res.end(); }
  if (down) return json(res, 503, { status: 'error', errorType: 'unavailable' });
  const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  const merchant = key ? ACCOUNTS.get(key) : undefined;
  if (!merchant) return json(res, 401, { status: 'error', errorType: 'not_authorized', error: 'invalid secret key' });

  if (path === '/api/v2/checkout' && req.method === 'POST') {
    const b = JSON.parse((await read(req)) || '{}');
    if (b.merchant_code !== merchant) return json(res, 401, { status: 'error', errorType: 'not_authorized', error: 'merchant is null' });
    const pay = b.payment ?? {};
    if (!pay.amount || !pay.currency || !pay.buyer?.email || !pay.buyer?.phone) return json(res, 400, { status: 'error', errorType: 'bad_data', error: 'missing required fields' });
    const full = !!pay.order;
    if (full && (!pay.buyer.name || !pay.shipping_address?.city || !pay.shipping_address?.address || !pay.shipping_address?.zip || !pay.order.reference_id || !pay.order.items?.length
      || !pay.buyer_history?.registered_since || !b.lang || !b.merchant_urls?.success)) return json(res, 400, { status: 'error', errorType: 'bad_data', error: 'missing required fields' });
    const id = randomUUID();
    const rejected = pay.buyer.email.startsWith('reject');
    const p = { id, created_at: new Date().toISOString(), status: 'CREATED', amount: pay.amount, currency: pay.currency, order: pay.order, captures: [], captureRefs: new Set(), merchant, urls: b.merchant_urls ?? {}, request: b };
    payments.set(id, p);
    return json(res, 200, {
      id: randomUUID(), status: rejected ? 'rejected' : 'created',
      payment: { id, status: 'CREATED', amount: pay.amount, currency: pay.currency },
      configuration: rejected
        ? { available_products: {}, products: { installments: { type: 'installments', is_available: false, rejection_reason: 'not_available' } } }
        : { available_products: { installments: [{ web_url: `http://127.0.0.1:${PORT}/hpp/${id}`, qr_code: '' }] }, products: { installments: { type: 'installments', is_available: true, rejection_reason: null } } },
    });
  }

  m = /^\/api\/v2\/payments\/([0-9a-f-]+)(\/captures)?$/.exec(path);
  if (m) {
    const p = payments.get(m[1]);
    // A payment is visible only with the key of the merchant that created it.
    if (!p || p.merchant !== merchant) return json(res, 404, { status: 'error', errorType: 'not_found', error: 'no such payment' });
    if (!m[2] && req.method === 'GET') return json(res, 200, view(p));
    if (m[2] && req.method === 'POST') {
      const b = JSON.parse((await read(req)) || '{}');
      if (captureStatus !== 200) return json(res, captureStatus, { status: 'error' });
      if (p.captureRefs.has(b.reference_id)) return json(res, 200, view(p));
      if (p.status !== 'AUTHORIZED' || b.amount !== p.amount || !b.reference_id) return json(res, 400, { status: 'error', errorType: 'bad_data', error: 'cannot capture' });
      p.captureRefs.add(b.reference_id);
      p.captures.push({ id: randomUUID(), amount: b.amount, created_at: new Date().toISOString(), reference_id: b.reference_id });
      p.status = 'CLOSED';
      return json(res, 200, view(p));
    }
  }

  if (path === '/api/v1/webhooks') {
    if (req.headers['x-merchant-code'] !== merchant) return json(res, 401, { status: 'error', errorType: 'not_authorized' });
    const mine = webhooks.filter((w) => w.key === key);
    if (req.method === 'GET') return json(res, 200, mine.length ? mine.map((w) => ({ id: w.id, url: w.url, is_test: true, header: null })) : null);
    if (req.method === 'POST') {
      const b = JSON.parse((await read(req)) || '{}');
      if (!/^https:\/\//.test(b.url ?? '') || mine.length >= 4) return json(res, 400, { status: 'error', errorType: 'bad_data' });
      const w = { id: randomUUID(), key, merchant, url: b.url };
      webhooks.push(w);
      return json(res, 200, { id: w.id, url: w.url, is_test: true, header: null });
    }
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1');
