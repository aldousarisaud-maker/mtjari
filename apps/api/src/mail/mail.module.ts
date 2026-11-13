import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { LogTransport, MAIL_TRANSPORT, MailService, SmtpTransport } from './mail.service';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ENV],
      useFactory: (env: Env) => (env.MAIL_TRANSPORT === 'smtp' && env.SMTP_URL ? new SmtpTransport(env.SMTP_URL) : new LogTransport()),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
