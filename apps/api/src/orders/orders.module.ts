import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DeliveryService } from './delivery.service';
import { OrderTokens } from './order-tokens';
import { OrdersController, PaymentWebhooksController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentRegistry } from './payment-adapters';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentSettlement } from './payment-settlement';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [AuditModule, CatalogModule],
  controllers: [OrdersController, PaymentWebhooksController],
  providers: [PaymentRegistry, PaymentMethodsService, DeliveryService, OrdersService, WebhooksService, PaymentSettlement, OrderTokens],
  exports: [PaymentRegistry, PaymentMethodsService, PaymentSettlement, OrderTokens, CatalogModule],
})
export class OrdersModule {}
