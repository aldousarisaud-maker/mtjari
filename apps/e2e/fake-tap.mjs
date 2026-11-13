// Local stand-in for Tap Payments, for automated tests only. It copies the parts
// of Tap's API the adapter uses (paths, Bearer auth, error and charge shapes as
// documented at developers.tap.company and observed on Tap's sandbox) and adds a
// tiny "payment page". It is never used outside tests: the API talks to it only
// when TAP_API_URL points here.
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';

const PORT = Number(process.env.FAKE_TAP_PORT ?? 2527);
const KEYS = new Set((process.env.FAKE_TAP_KEYS ?? 'sk_test_FakeTapKey00000001,sk_test_FakeTapKey00000002').split(','));
const DECIMALS = { KWD: 3, BHD: 3, OMR: 3 };
const charges = new Map();
let down = false;

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
const view = ({ _key, _request, _headers, ...c }) => c;
const hashstring = (c, key) => createHmac('sha256', key).update(
  `x_id${c.id}x_amount${c.amount.toFixed(DECIMALS[c.currency] ?? 2)}x_currency${c.currency}x_gateway_reference${c.reference.gateway ?? ''}x_payment_reference${c.reference.payment ?? ''}x_status${c.status}x_created${c.transaction.created}`).digest('hex');

async function settle(c, status) {
  c.status = status;
  if (status === 'CAPTURED') Object.assign(c.reference, { gateway: 'fake_gw_1', payment: String(Date.now()) });
  if (c.post?.url) {
    const body = JSON.stringify(view(c));
    await fetch(c.post.url, { method: 'POST', headers: { 'content-type': 'application/json', hashstring: hashstring(c, c._key) }, body }).catch(() => {});
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (path === '/health') return res.end('ok');

  // ---- test controls ----
  if (path === '/__control/charges' && req.method === 'GET') return json(res, 200, [...charges.values()].map((c) => ({ ...view(c), request: c._request, headers: c._headers })));
  if (path === '/__control/down') { down = JSON.parse(await read(req)).down; return json(res, 200, { down }); }
  let m = /^\/__control\/charges\/(chg_\w+)$/.exec(path);
  if (m && req.method === 'POST') {
    const c = charges.get(m[1]);
    if (!c) return json(res, 404, {});
    const body = JSON.parse(await read(req));
    if (body.amount !== undefined) c.amount = body.amount;
    if (body.currency !== undefined) c.currency = body.currency;
    if (body.status) await settle(c, body.status);
    return json(res, 200, view(c));
  }

  // ---- the hosted payment page ----
  m = /^\/pay\/(chg_\w+)$/.exec(path);
  if (m) {
    const c = charges.get(m[1]);
    if (!c) { res.writeHead(404); return res.end('unknown charge'); }
    if (req.method === 'POST') {
      const outcome = new URLSearchParams(await read(req)).get('outcome');
      await settle(c, outcome === 'pay' ? 'CAPTURED' : outcome === 'decline' ? 'DECLINED' : 'CANCELLED');
      res.writeHead(303, { location: `${c.redirect.url}${c.redirect.url.includes('?') ? '&' : '?'}tap_id=${c.id}` });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>Fake Tap</title><h1>Fake Tap payment page (tests only)</h1>
      <p data-testid="amount">${c.amount.toFixed(DECIMALS[c.currency] ?? 2)} ${c.currency}</p><p data-testid="description">${String(c.description).replace(/[<&]/g, '')}</p>
      <form method="post"><button name="outcome" value="pay">Pay</button><button name="outcome" value="decline">Decline</button><button name="outcome" value="cancel">Cancel</button></form>`);
  }

  // ---- Tap API ----
  if (!path.startsWith('/v2/')) { res.writeHead(404); return res.end(); }
  if (down) return json(res, 503, { errors: [{ code: '5000', description: 'Service unavailable' }] });
  const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!key || !KEYS.has(key)) return json(res, 401, { errors: [{ code: '2104', description: 'Invalid API Key' }] });

  if (path === '/v2/charges/list' && req.method === 'POST') return json(res, 200, { object: 'list', live_mode: false, count: 0, charges: [] });
  if (path === '/v2/charges' && req.method === 'POST') {
    const b = JSON.parse(await read(req));
    if (typeof b.amount !== 'number' || !(b.amount > 0) || !b.currency || !b.customer?.first_name || !b.source?.id || !b.redirect?.url) {
      return json(res, 400, { errors: [{ code: '1108', description: 'Invalid request' }] });
    }
    const id = `chg_TS${randomBytes(12).toString('hex')}`;
    const created = String(Date.now());
    const c = {
      id, object: 'charge', live_mode: false, api_version: 'V2', method: 'CREATE', status: 'INITIATED', amount: b.amount, currency: b.currency,
      threeDSecure: true, description: b.description ?? '', metadata: b.metadata ?? {},
      transaction: { timezone: 'UTC+03:00', created, url: `http://127.0.0.1:${PORT}/pay/${id}`, expiry: { period: 30, type: 'MINUTE' }, asynchronous: false, amount: b.amount, currency: b.currency },
      reference: { ...(b.reference ?? {}) }, response: { code: '100', message: 'Initiated' }, customer: b.customer, source: { object: 'source', id: b.source.id },
      redirect: { status: 'PENDING', url: b.redirect.url }, ...(b.post?.url ? { post: { status: 'PENDING', url: b.post.url } } : {}),
      _key: key, _request: b, _headers: { lang_code: req.headers.lang_code ?? null },
    };
    charges.set(id, c);
    return json(res, 200, view(c));
  }
  m = /^\/v2\/charges\/(\w+)$/.exec(path);
  if (m && req.method === 'GET') {
    const c = charges.get(m[1]);
    // A charge is visible only with the key of the account that created it.
    if (!c || c._key !== key) return json(res, 400, { errors: [{ code: '9997', description: 'Provided id is invalid' }] });
    return json(res, 200, { ...view(c), method: 'GET' });
  }
  return json(res, 404, { errors: [{ code: '1000', description: 'Not found' }] });
}).listen(PORT, '127.0.0.1');
