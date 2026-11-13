import { redact } from './audit.service';

describe('redact', () => {
  it('masks credential-looking keys at any depth', () => {
    expect(
      redact({ email: 'a@b.c', password: 'x', nested: { apiKey: 'k', secretKey: 's', list: [{ token: 't', ok: 1 }] } }),
    ).toEqual({ email: 'a@b.c', password: '[REDACTED]', nested: { apiKey: '[REDACTED]', secretKey: '[REDACTED]', list: [{ token: '[REDACTED]', ok: 1 }] } });
  });
});
