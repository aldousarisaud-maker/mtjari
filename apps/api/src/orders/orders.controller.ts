import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  PERMISSIONS, checkoutSettingsSchema, deliveryZoneSchema, kuwaitZonesSchema, orderNoteSchema, orderTransitionSchema, ordersQuerySchema, paymentMethodUpdateSchema,
  type CheckoutSettingsInput, type DeliveryZoneInput, type OrderStatusName, type OrdersQuery, type PaymentMethodUpdateInput,
} from '@mtjari/shared';
import { Public } from '../auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { RequirePermission, StoreAccessGuard, Tenant, type TenantContext } from '../tenancy/tenancy';
import { DeliveryService } from './delivery.service';
import { OrdersService } from './orders.service';
import { PaymentMethodsService } from './payment-methods.service';
import { WebhooksService } from './webhooks.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const P = PERMISSIONS;

@Controller('v1/stores/:storeId')
@UseGuards(StoreAccessGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService, private readonly delivery: DeliveryService, private readonly methods: PaymentMethodsService) {}

  // ---- orders ----
  @RequirePermission(P.ORDERS_READ) @Get('orders')
  list(@Tenant() t: TenantContext, @Query(new ZodPipe(ordersQuerySchema)) q: OrdersQuery) { return this.orders.list(t, q); }

  @RequirePermission(P.ORDERS_READ) @Get('orders/:id')
  get(@Tenant() t: TenantContext, @Param('id', uuid) id: string) { return this.orders.get(t, id); }

  @RequirePermission(P.ORDERS_WRITE) @Post('orders/:id/transition') @HttpCode(200)
  transition(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Body(new ZodPipe(orderTransitionSchema)) body: { to: OrderStatusName; note: string }, @Meta() meta: RequestMeta) {
    return this.orders.transition(t, id, body.to, body.note, meta);
  }

  @RequirePermission(P.ORDERS_WRITE) @Post('orders/:id/record-payment') @HttpCode(200)
  recordPayment(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) { return this.orders.recordPayment(t, id, meta); }

  @RequirePermission(P.ORDERS_WRITE) @Post('orders/:id/notes') @HttpCode(200)
  note(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Body(new ZodPipe(orderNoteSchema)) body: { note: string }) { return this.orders.addNote(t, id, body.note); }

  // ---- delivery and checkout settings ----
  @RequirePermission(P.STORE_READ) @Get('delivery-zones')
  zones(@Tenant() t: TenantContext) { return this.delivery.zones(t); }

  @RequirePermission(P.SETTINGS_MANAGE) @Post('delivery-zones')
  createZone(@Tenant() t: TenantContext, @Body(new ZodPipe(deliveryZoneSchema)) body: DeliveryZoneInput, @Meta() meta: RequestMeta) { return this.delivery.createZone(t, body, meta); }

  @RequirePermission(P.SETTINGS_MANAGE) @Post('delivery-zones/kuwait') @HttpCode(200)
  kuwait(@Tenant() t: TenantContext, @Body(new ZodPipe(kuwaitZonesSchema)) body: { fee: number }, @Meta() meta: RequestMeta) { return this.delivery.addKuwaitGovernorates(t, body.fee, meta); }

  @RequirePermission(P.SETTINGS_MANAGE) @Put('delivery-zones/:id')
  updateZone(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Body(new ZodPipe(deliveryZoneSchema)) body: DeliveryZoneInput, @Meta() meta: RequestMeta) { return this.delivery.updateZone(t, id, body, meta); }

  @RequirePermission(P.SETTINGS_MANAGE) @Delete('delivery-zones/:id')
  deleteZone(@Tenant() t: TenantContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) { return this.delivery.deleteZone(t, id, meta); }

  @RequirePermission(P.STORE_READ) @Get('checkout-settings')
  settings(@Tenant() t: TenantContext) { return this.delivery.settings(t); }

  @RequirePermission(P.SETTINGS_MANAGE) @Put('checkout-settings')
  updateSettings(@Tenant() t: TenantContext, @Body(new ZodPipe(checkoutSettingsSchema)) body: CheckoutSettingsInput, @Meta() meta: RequestMeta) { return this.delivery.updateSettings(t, body, meta); }

  // ---- payment methods ----
  @RequirePermission(P.PAYMENTS_MANAGE) @Get('payment-methods')
  paymentMethods(@Tenant() t: TenantContext) { return this.methods.list(t); }

  @RequirePermission(P.PAYMENTS_MANAGE) @Put('payment-methods/:provider')
  updatePaymentMethod(@Tenant() t: TenantContext, @Param('provider') provider: string, @Body(new ZodPipe(paymentMethodUpdateSchema)) body: PaymentMethodUpdateInput, @Meta() meta: RequestMeta) {
    return this.methods.update(t, provider.slice(0, 40), body, meta);
  }
}

/** Called by payment providers, not by browsers. Authenticated by the provider's signature, checked with the store's own secret. */
@Public()
@Controller('v1/webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post(':provider/:storeId') @HttpCode(200)
  receive(@Param('provider') provider: string, @Param('storeId') storeId: string, @Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string | string[] | undefined>) {
    return this.webhooks.handle(provider.slice(0, 40), storeId, req.rawBody, headers);
  }
}
