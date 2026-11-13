import { randomBytes } from 'node:crypto';
import { SecretBox, randomToken, safeEqual, sha256 } from './crypto';

const k1 = randomBytes(32);
const k2 = randomBytes(32);

describe('SecretBox', () => {
  it('round-trips and produces a different ciphertext each time', () => {
    const box = new SecretBox({ current: 'v1', keys: new Map([['v1', k1]]) });
    const a = box.encrypt('sk_live_secret', 'store-1');
    const b = box.encrypt('sk_live_secret', 'store-1');
    expect(a).not.toEqual(b);
    expect(a).not.toContain('sk_live_secret');
    expect(box.decrypt(a, 'store-1')).toBe('sk_live_secret');
  });

  it('fails when the AAD (owner binding) does not match', () => {
    const box = new SecretBox({ current: 'v1', keys: new Map([['v1', k1]]) });
    const ct = box.encrypt('secret', 'store-1');
    expect(() => box.decrypt(ct, 'store-2')).toThrow();
  });

  it('fails on tampering', () => {
    const box = new SecretBox({ current: 'v1', keys: new Map([['v1', k1]]) });
    const parts = box.encrypt('secret').split(':');
    const ct = Buffer.from(parts[3]!, 'base64url');
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString('base64url');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
  });

  it('supports key rotation', () => {
    const old = new SecretBox({ current: 'v1', keys: new Map([['v1', k1]]) });
    const ct = old.encrypt('secret');
    const rotated = new SecretBox({ current: 'v2', keys: new Map([['v2', k2], ['v1', k1]]) });
    expect(rotated.decrypt(ct)).toBe('secret');
    expect(rotated.needsRotation(ct)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('x'))).toBe(false);
  });
});

describe('helpers', () => {
  it('randomToken is url-safe and unique', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toEqual(t);
  });
  it('sha256 and safeEqual', () => {
    expect(sha256('abc')).toHaveLength(64);
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'b')).toBe(false);
    expect(safeEqual('a', 'ab')).toBe(false);
  });
});
