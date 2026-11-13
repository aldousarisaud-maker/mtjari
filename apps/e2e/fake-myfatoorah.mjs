// Local stand-in for MyFatoorah, for automated tests only. It copies the parts of
// MyFatoorah's v2 API the adapter uses (paths, Bearer auth and response envelopes as
// documented at docs.myfatoorah.com) and adds a tiny "invoice page". The API talks to
// it only when MYFATOORAH_API_URL points here, which only the test suites do.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_MF_PORT ?? 2528);
const TOKENS = new Set((process.env.FAKE_MF_TOKENS ?? 'FakeMyFatoorahToken_0000000001,FakeMyFatoorahToken_0000000002').split(','));
const invoices = new Map();
let nextId = 7000001;
let down = false;

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const ok = (res, Data, Message = '') => json(res, 200, { IsSuccess: true, Message, ValidationErrors: null, Data });
const fail = (res, status, Message, ValidationErrors = null) => json(res, status, { IsSuccess: false, Message, ValidationErrors, Data: null });
const read = (req) => new Promise((done) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => done(b)); });
const status = (i) => ({
  InvoiceId: i.id, InvoiceStatus: i.status, InvoiceReference: `2026${i.id}`, CustomerReference: i.request.CustomerReference ?? null,
  InvoiceValue: i.value, InvoiceDisplayValue: `${i.value.toFixed(3)} KD`, CustomerName: i.request.CustomerName, UserDefinedField: i.request.UserDefinedField ?? null,
  InvoiceItems: [], InvoiceTransactions: i.transactions,
});

async function attempt(i, outcome) {
  const paid = outcome === 'pay';
  i.transactions.push({ PaymentGateway: 'KNET', PaymentId: `0707${i.id}${i.transactions.length}`, TransactionStatus: paid ? 'Succss' : 'Failed', TransationValue: i.value.toFixed(3), Currency: 'KD' });
  if (paid) i.status = 'Paid';
  if (i.request.WebhookUrl) {
    const body = { Event: { Code: 1, Name: 'PAYMENT_STATUS_CHANGED', CountryIsoCode: 'KWT', Reference: `WB-${Date.now()}` }, Data: { Invoice: { Id: String(i.id), Status: paid ? 'PAID' : 'PENDING' }, Transaction: { Status: paid ? 'SUCCESS' : 'FAILED' } } };
    await fetch(i.request.WebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'myfatoorah-signature': 'not-checked' }, body: JSON.stringify(body) }).catch(() => {});
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (path === '/health') return res.end('ok');

  // ---- test controls ----
  if (path === '/__control/invoices') return json(res, 200, [...invoices.values()].map((i) => ({ ...status(i), request: i.request })));
  if (path === '/__control/down') { down = JSON.parse(await read(req)).down; return json(res, 200, { down }); }
  let m = /^\/__control\/invoices\/(\d+)$/.exec(path);
  if (m && req.method === 'POST') {
    const i = invoices.get(Number(m[1]));
    if (!i) return json(res, 404, {});
    const body = JSON.parse(await read(req));
    if (body.value !== undefined) i.value = body.value;
    if (body.attempt) await attempt(i, body.attempt);
    if (body.status) i.status = body.status;
    return json(res, 200, status(i));
  }

  // ---- the hosted invoice page ----
  m = /^\/pay\/(\d+)$/.exec(path);
  if (m) {
    const i = invoices.get(Number(m[1]));
    if (!i) { res.writeHead(404); return res.end('unknown invoice'); }
    if (req.method === 'POST') {
      const outcome = new URLSearchParams(await read(req)).get('outcome');
      await attempt(i, outcome);
      const back = outcome === 'pay' ? i.request.CallBackUrl : i.request.ErrorUrl;
      const paymentId = i.transactions[i.transactions.length - 1].PaymentId;
      res.writeHead(303, { location: `${back}${back.includes('?') ? '&' : '?'}paymentId=${paymentId}&Id=${paymentId}` });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>Fake MyFatoorah</title><h1>Fake MyFatoorah invoice page (tests only)</h1>
      <p data-testid="amount">${i.value.toFixed(3)} ${i.request.DisplayCurrencyIso ?? ''}</p>
      <form method="post"><button name="outcome" value="pay">Pay</button><button name="outcome" value="decline">Decline</button></form>`);
  }

  // ---- MyFatoorah API ----
  if (!path.startsWith('/v2/') || req.method !== 'POST') { res.writeHead(404); return res.end(); }
  if (down) return fail(res, 503, 'Service unavailable');
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!token || !TOKENS.has(token)) return fail(res, 401, 'Invalid token');
  const b = JSON.parse((await read(req)) || '{}');

  if (path === '/v2/InitiatePayment') return ok(res, { PaymentMethods: [{ PaymentMethodId: 1, PaymentMethodEn: 'KNET', CurrencyIso: 'KWD' }] }, 'Initiated Successfully!');
  if (path === '/v2/SendPayment') {
    if (!b.CustomerName || b.NotificationOption !== 'LNK' || typeof b.InvoiceValue !== 'number' || !(b.InvoiceValue > 0)) {
      return fail(res, 400, 'Invalid data', [{ Name: 'InvoiceValue', Error: 'Invoice value must be more than 0' }]);
    }
    const id = nextId++;
    invoices.set(id, { id, token, status: 'Pending', value: b.InvoiceValue, request: b, transactions: [] });
    return ok(res, { InvoiceId: id, InvoiceURL: `http://127.0.0.1:${PORT}/pay/${id}`, CustomerReference: b.CustomerReference ?? null, UserDefinedField: b.UserDefinedField ?? null }, 'Invoice Created Successfully!');
  }
  if (path === '/v2/GetPaymentStatus') {
    const i = b.KeyType === 'InvoiceId' ? invoices.get(Number(b.Key)) : undefined;
    // An invoice is visible only with the token of the account that created it.
    if (!i || i.token !== token) return fail(res, 400, 'No data match the provided key!');
    return ok(res, status(i));
  }
  return fail(res, 404, 'Not found');
}).listen(PORT, '127.0.0.1');
