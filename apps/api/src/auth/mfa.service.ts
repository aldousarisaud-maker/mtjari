import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { randomBytes } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { SecretBox, sha256 } from '../common/crypto';

authenticator.options = { window: 1, step: 30, digits: 6 };

@Injectable()
export class MfaService {
  private readonly box: SecretBox;

  constructor(@Inject(ENV) env: Env) {
    this.box = new SecretBox(env.ENCRYPTION_KEYS);
  }

  createSecret(userId: string, email: string): { secret: string; encrypted: string; otpauthUrl: string } {
    const secret = authenticator.generateSecret(20);
    return {
      secret,
      encrypted: this.box.encrypt(secret, `mfa:${userId}`),
      otpauthUrl: authenticator.keyuri(email, 'Mtjari.cc', secret),
    };
  }

  verify(userId: string, encrypted: string, code: string): boolean {
    const secret = this.box.decrypt(encrypted, `mfa:${userId}`);
    return authenticator.check(code, secret);
  }

  /** 10 single-use codes like "a1b2c-3d4e5". Returns plaintext (show once) and hashes (store). */
  createRecoveryCodes(): { codes: string[]; hashes: string[] } {
    const codes = Array.from({ length: 10 }, () => {
      const h = randomBytes(5).toString('hex');
      return `${h.slice(0, 5)}-${h.slice(5)}`;
    });
    return { codes, hashes: codes.map(sha256) };
  }
}
