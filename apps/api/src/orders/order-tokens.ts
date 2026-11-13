import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { sha256 } from '../common/crypto';
import { ENV, type Env } from '../config/env';

/**
 * The secret link a shopper uses to see their order without an account.
 * Derived from the order id with a server key, so it can be re-issued for a
 * repeated checkout submit; only its hash is stored.
 */
@Injectable()
export class OrderTokens {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = createHmac('sha256', env.JWT_ACCESS_SECRET).update('mtjari:order-access:v1').digest();
  }

  for(orderId: string): { token: string; hash: string } {
    const token = createHmac('sha256', this.key).update(orderId).digest('base64url');
    return { token, hash: sha256(token) };
  }

  static readonly FORMAT = /^[A-Za-z0-9_-]{43}$/;
}
