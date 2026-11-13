// Local stand-in for Hesabe, for automated tests only. It copies the parts of Hesabe's API the
// adapter uses (AES-256-CBC hex bodies, `accesscode` header, POST /checkout, GET
// /api/transaction/{token}) as documented at developer.hesabe.com, plus a tiny payment page.
// The API talks to it only when HESABE_API_URL points here, which only the test suites do.
import { createServer } from 'node:http';
import { createCipheriv, createDecipheriv } from 'node:crypto';

const PORT = Number(process.env.FAKE_HESABE_PORT ?? 2529);
// Made-up test accounts. Each has its own access code, secret and IV.
const ACCOUNTS = new Map([
  ['aaaaaaaa-0000-4000-8000-000000000001', { merchant: '1000001', secret: 'FakeHesabeSecretKeyForTestsAAA01', iv: 'FakeHesabeIvA001' }],
  ['bbbbbbbb-0000-4000-8000-000000000002', { merchant: '1000002', secret: 'FakeHesabeSecretKeyForTestsBBB02', iv: 'FakeHesabeIvB002' }],
]);
const tx = new Map();
let seq = 0;
let down = false;

const enc = (a, text) => { const c = createCipheriv('aes-256-cbc', Buffer.from(a.secret), Buffer.from(a.iv)); return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('hex'); };
const dec = (a, hex) => {
  try { const d = createDecipheriv('aes-256-cbc', Buffer.from(a.secret), Buffer.from(a.iv)); return Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8'); } catch { return null; }
};
const read = (req) => new Promise((done) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => done(b)); });
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const encrypted = (res, a, body) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(enc(a, JSON.stringify(body))); };
const view = (t) => ({ token: t.token, status: t.status, amount: t.amount.toFixed(3), orderReferenceNumber: t.request.orderReferenceNumber, paymentType: 'KNET', variable1: t.request.variable1 ?? null });

async function attempt(t, outcome) {
  t.status = outcome === 'pay' ? 'SUCCESSFUL' : 'FAILED';
  t.touched = true;
  if (t.request.webhookUrl) {
    await fetch(t.request.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t.token, status: t.status }) }).catch(() => {});
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (path === '/health') return res.end('ok');

  // ---- test controls ----
  if (path === '/__control/transactions') return json(res, 200, [...tx.values()].map((t) => ({ ...view(t), request: t.request })));
  if (path === '/__control/down') { down = JSON.parse(await read(req)).down; return json(res, 200, { down }); }
  let m = /^\/__control\/transactions\/(\d+)$/.exec(path);
  if (m && req.method === 'POST') {
    const t = tx.get(m[1]);
    if (!t) return json(res, 404, {});
    const body = JSON.parse(await read(req));
    if (body.amount !== undefined) t.amount = body.amount;
    if (body.attempt) await attempt(t, body.attempt);
    if (body.status) { t.status = body.status; t.touched = true; }
    return json(res, 200, view(t));
  }

  // ---- the hosted payment page (opened with ?data=<encrypted>) ----
  if (path === '/payment') {
    const data = url.searchParams.get('data');
    const t = [...tx.values()].find((x) => x.data === data);
    if (!t) { res.writeHead(404); return res.end('unknown payment'); }
    if (req.method === 'POST') {
      const outcome = new URLSearchParams(await read(req)).get('outcome');
      await attempt(t, outcome);
      const back = outcome === 'pay' ? t.request.responseUrl : t.request.failureUrl;
      res.writeHead(303, { location: `${back}${back.includes('?') ? '&' : '?'}data=${enc(t.account, JSON.stringify({ resultCode: outcome === 'pay' ? 'CAPTURED' : 'FAILED', token: t.token }))}` });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>Fake Hesabe</title><h1>Fake Hesabe payment page (tests only)</h1>
      <p data-testid="amount">${t.amount.toFixed(3)} KWD</p>
      <form method="post" action="/payment?data=${encodeURIComponent(data)}"><button name="outcome" value="pay">Pay</button><button name="outcome" value="decline">Decline</button></form>`);
  }

  // ---- Hesabe API ----
  if (down) return json(res, 503, { message: 'Service unavailable' });
  const account = ACCOUNTS.get(String(req.headers.accesscode ?? ''));
  if (!account) return json(res, 401, { status: false, message: 'Invalid access code' });

  if (path === '/checkout' && req.method === 'POST') {
    const hex = new URLSearchParams(await read(req)).get('data') ?? '';
    const plain = dec(account, hex);
    // Wrong secret/IV: Hesabe cannot read the request.
    if (plain === null) return json(res, 422, { status: false, message: 'Unable to decrypt the request' });
    let b; try { b = JSON.parse(plain); } catch { return json(res, 422, { status: false, message: 'Bad payload' }); }
    if (String(b.merchantCode) !== account.merchant || !(Number(b.amount) > 0) || b.currency !== 'KWD' || !b.responseUrl || !b.failureUrl || !b.orderReferenceNumber) {
      return encrypted(res, account, { status: false, code: 422, message: 'Validation failed', response: {} });
    }
    const token = String(2026000000000 + ++seq) + '0000';
    const data = enc(account, JSON.stringify({ token, merchant: b.merchantCode }));
    tx.set(token, { token, account, status: 'PENDING', amount: Number(b.amount), request: b, data, touched: false });
    return encrypted(res, account, { status: true, code: 200, message: 'Success', token, response: { data } });
  }

  m = /^\/api\/transaction\/(\d+)$/.exec(path);
  if (m && req.method === 'GET') {
    const t = tx.get(m[1]);
    // Only the account that created a transaction can see it; an unpaid one is "not found".
    if (!t || t.account !== account || !t.touched) return json(res, 404, { status: false, message: 'Transaction not found' });
    return json(res, 200, { status: true, message: 'Success', data: view(t) });
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1');
