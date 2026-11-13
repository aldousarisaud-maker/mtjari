import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface Keyring {
  current: string;
  keys: Map<string, Buffer>;
}

/**
 * AES-256-GCM envelope: "<keyId>:<iv>:<tag>:<ciphertext>" (base64url parts).
 * The key id allows rotation: new data uses `current`, old data still decrypts.
 * Optional AAD binds a ciphertext to its owner (e.g. user id or store id) so a
 * value copied into another row fails to decrypt.
 */
export class SecretBox {
  constructor(private readonly ring: Keyring) {}

  encrypt(plaintext: string, aad?: string): string {
    const key = this.ring.keys.get(this.ring.current)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [this.ring.current, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
  }

  decrypt(envelope: string, aad?: string): string {
    const [keyId, iv, tag, ct] = envelope.split(':');
    const key = keyId ? this.ring.keys.get(keyId) : undefined;
    if (!key || !iv || !tag || ct === undefined) throw new Error('Unreadable secret envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }

  needsRotation(envelope: string): boolean {
    return !envelope.startsWith(`${this.ring.current}:`);
  }
}
