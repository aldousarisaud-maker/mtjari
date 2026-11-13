/* eslint-disable */
// Manual check of the Tap adapter against Tap's REAL sandbox. Not part of the test suite
// (CI must not depend on a third party). Needs network access to api.tap.company.
//
//   pnpm --filter @mtjari/api build
//   TAP_TEST_KEY=<your Tap test secret key> node apps/api/scripts/tap-sandbox-check.cjs
//
// Use a TEST key only. It creates one unpaid test charge of 9.500 KWD and reads charges back.
const { TapAdapter } = require('../dist/orders/payment-adapters.js');

const key = process.env.TAP_TEST_KEY ?? '';
if (!/^sk_test_/.test(key)) { console.error('Set TAP_TEST_KEY to a Tap TEST secret key.'); process.exit(2); }
const base = process.env.TAP_API_URL ?? 'https://api.tap.company';
const tap = new TapAdapter(base);
const credentials = { secretKey: key };
let failed = 0;
const check = async (name, fn) => {
  try { console.log(`ok    ${name}: ${await fn()}`); } catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message}`); }
};
const rejects = async (fn, message) => {
  try { await fn(); } catch (e) { if (e.message === message) return `refused with ${message}`; throw new Error(`expected ${message}, got ${e.message}`); }
  throw new Error(`expected ${message}, but it succeeded`);
};

(async () => {
  await check('a valid test key is accepted', async () => `mode=${(await tap.checkCredentials(credentials)).mode}`);
  await check('an unknown key is refused', () => rejects(() => tap.checkCredentials({ secretKey: 'sk_test_ThisKeyDoesNotExist01' }), 'invalid_payment_credentials'));

  let ref;
  await check('a charge is created and Tap returns its payment page', async () => {
    const r = await tap.initiate({
      orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001, amount: 9500, currency: 'KWD', locale: 'ar', storeName: 'Mtjari sandbox check',
      customer: { name: 'Test Shopper', phone: '+96550001234', email: null, country: 'KW' },
      returnUrl: 'https://shop.example.com/ar/orders/sandbox-check', webhookUrl: null, credentials,
    });
    ref = r.providerRef;
    if (!/^https:\/\//.test(r.redirectUrl)) throw new Error(`unexpected payment page ${r.redirectUrl}`);
    return `${r.providerRef} -> ${new URL(r.redirectUrl).host}`;
  });
  await check('reading the unpaid charge back says "not paid yet" with our amount', async () => {
    const s = await tap.fetchStatus({ providerRef: ref, credentials });
    if (s.outcome !== 'ignored' || s.amount !== 9500 || s.currency !== 'KWD') throw new Error(JSON.stringify(s));
    return `${s.type}, ${s.amount} minor units ${s.currency}`;
  });
  await check('a charge id that does not exist is an error, never a payment', () => rejects(() => tap.fetchStatus({ providerRef: 'chg_TS00000000000000000000', credentials }), 'payment_provider_error'));
  await check('a captured charge on the account reads as paid', async () => {
    const res = await fetch(`${base}/v2/charges/list`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ limit: 25 }) });
    const captured = ((await res.json()).charges ?? []).find((c) => c.status === 'CAPTURED' && ['KWD', 'SAR', 'AED', 'BHD', 'QAR', 'OMR', 'USD'].includes(c.currency));
    if (!captured) return 'skipped: no captured charge among the latest 25 on this account';
    const s = await tap.fetchStatus({ providerRef: captured.id, credentials });
    if (s.outcome !== 'paid' || s.currency !== captured.currency) throw new Error(JSON.stringify(s));
    return `${captured.id}: ${captured.amount} ${captured.currency} -> paid, ${s.amount} minor units`;
  });
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed against the real Tap sandbox.');
  process.exit(failed ? 1 : 0);
})();
