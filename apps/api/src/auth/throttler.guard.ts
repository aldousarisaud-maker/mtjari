import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import { AUTH_THROTTLE } from './decorators';

/**
 * "default" throttler applies everywhere; the stricter "auth" throttler only
 * applies to handlers marked @AuthThrottle().
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    if (props.throttler.name === 'auth') {
      const isAuth = this.reflector.getAllAndOverride<boolean>(AUTH_THROTTLE, [props.context.getHandler(), props.context.getClass()]);
      if (!isAuth) return true;
    }
    return super.handleRequest(props);
  }
}
