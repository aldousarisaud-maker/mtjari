import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ENV, type Env } from '../config/env';
import { AuditModule } from '../audit/audit.module';
import { AuthController, MeController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    AuditModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, issuer: env.JWT_ISSUER, audience: 'mtjari-api', algorithm: 'HS256' },
        verifyOptions: { issuer: env.JWT_ISSUER, audience: 'mtjari-api', algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, PasswordService, TokensService, MfaService],
  exports: [PasswordService],
})
export class AuthModule {}
