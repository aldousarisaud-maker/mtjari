import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ENV, type Env } from '../config/env';
import { STORAGE, createStorage } from '../storage/storage';
import { OrdersModule } from '../orders/orders.module';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { PreviewTokens } from './preview';
import { StorefrontController, ThemeController } from './storefront.controller';
import { StorefrontGuard } from './storefront.guard';
import { StorefrontService } from './storefront.service';
import { ThemeService } from './theme.service';

@Module({
  imports: [AuditModule, OrdersModule],
  controllers: [StorefrontController, ThemeController],
  providers: [
    { provide: STORAGE, inject: [ENV], useFactory: (env: Env) => createStorage(env) },
    PreviewTokens, StorefrontGuard, StorefrontService, CartService, CheckoutService, ThemeService,
  ],
})
export class StorefrontModule {}
