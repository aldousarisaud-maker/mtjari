-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,
    "free_above" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_settings" (
    "store_id" UUID NOT NULL,
    "pickup_enabled" BOOLEAN NOT NULL DEFAULT false,
    "pickup_instructions_ar" TEXT,
    "pickup_instructions_en" TEXT,
    "min_order_amount" INTEGER NOT NULL DEFAULT 0,
    "next_order_number" INTEGER NOT NULL DEFAULT 1001,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_settings_pkey" PRIMARY KEY ("store_id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "credentials_enc" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "payment_provider" TEXT NOT NULL,
    "fulfillment" "FulfillmentType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "delivery_fee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "customer_email" TEXT,
    "address" JSONB,
    "delivery_zone_id" UUID,
    "customer_note" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "access_token_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "name_ar" TEXT,
    "name_en" TEXT,
    "sku" TEXT,
    "option_values" JSONB NOT NULL DEFAULT '{}',
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" INTEGER NOT NULL,
    "stock_taken" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus",
    "note" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "provider_ref" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload_hash" TEXT NOT NULL,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_zones_store_id_sort_order_idx" ON "delivery_zones"("store_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_store_id_id_key" ON "delivery_zones"("store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_store_id_provider_key" ON "payment_methods"("store_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "orders_access_token_hash_key" ON "orders"("access_token_hash");

-- CreateIndex
CREATE INDEX "orders_store_id_placed_at_idx" ON "orders"("store_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "orders_store_id_status_idx" ON "orders"("store_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_store_id_number_key" ON "orders"("store_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_store_id_id_key" ON "orders"("store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_store_id_idempotency_key_key" ON "orders"("store_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_store_id_id_key" ON "payments"("store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_store_id_provider_provider_ref_key" ON "payments"("store_id", "provider", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_store_id_provider_event_id_key" ON "webhook_events"("store_id", "provider", "event_id");

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_settings" ADD CONSTRAINT "checkout_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_store_id_order_id_fkey" FOREIGN KEY ("store_id", "order_id") REFERENCES "orders"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_store_id_order_id_fkey" FOREIGN KEY ("store_id", "order_id") REFERENCES "orders"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_store_id_order_id_fkey" FOREIGN KEY ("store_id", "order_id") REFERENCES "orders"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written: integrity checks, grants and tenant isolation.
-- =====================================================================
ALTER TABLE delivery_zones ADD CONSTRAINT delivery_zones_amounts CHECK (fee >= 0 AND (free_above IS NULL OR free_above >= 0));
ALTER TABLE checkout_settings ADD CONSTRAINT checkout_settings_amounts CHECK (min_order_amount >= 0 AND next_order_number >= 1);
ALTER TABLE orders ADD CONSTRAINT orders_amounts CHECK (subtotal >= 0 AND delivery_fee >= 0 AND total = subtotal + delivery_fee);
ALTER TABLE orders ADD CONSTRAINT orders_paid_at CHECK (payment_status = 'UNPAID' OR paid_at IS NOT NULL);
ALTER TABLE orders ADD CONSTRAINT orders_delivery_address CHECK (fulfillment = 'PICKUP' OR address IS NOT NULL);
ALTER TABLE order_items ADD CONSTRAINT order_items_amounts CHECK (quantity BETWEEN 1 AND 99 AND unit_price >= 0 AND line_total = unit_price * quantity);
ALTER TABLE payments ADD CONSTRAINT payments_amount CHECK (amount >= 0);
ALTER TABLE payments ADD CONSTRAINT payments_paid_at CHECK (status NOT IN ('PAID', 'REFUNDED') OR paid_at IS NOT NULL);

-- An order can only be marked paid when a payment row for its full amount is
-- PAID. This holds even if application code has a bug.
CREATE FUNCTION orders_require_paid_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_status = 'PAID' AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.store_id = NEW.store_id AND p.order_id = NEW.id AND p.status = 'PAID'
      AND p.amount = NEW.total AND p.currency = NEW.currency
  ) THEN
    RAISE EXCEPTION 'order % cannot be marked paid without a matching paid payment', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_paid_guard BEFORE INSERT OR UPDATE OF payment_status, total ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_require_paid_payment();

GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_zones, checkout_settings, payment_methods TO mtjari_app;
-- Orders are never deleted by the application; the timeline is append-only.
GRANT SELECT, INSERT, UPDATE ON orders, order_items, payments, webhook_events TO mtjari_app;
GRANT SELECT, INSERT ON order_events TO mtjari_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_zones', 'checkout_settings', 'payment_methods', 'orders', 'order_items', 'order_events', 'payments', 'webhook_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO mtjari_app USING (store_id = app_tenant_id()) WITH CHECK (store_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $$;
