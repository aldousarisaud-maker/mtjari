-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "launched_at" TIMESTAMP(3),
ADD COLUMN     "theme_id" TEXT;

-- CreateTable
CREATE TABLE "store_themes" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "theme_id" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_themes_store_id_theme_id_key" ON "store_themes"("store_id", "theme_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_token_hash_key" ON "carts"("token_hash");

-- CreateIndex
CREATE INDEX "carts_store_id_expires_at_idx" ON "carts"("store_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "carts_store_id_id_key" ON "carts"("store_id", "id");

-- CreateIndex
CREATE INDEX "cart_items_store_id_variant_id_idx" ON "cart_items"("store_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");

-- AddForeignKey
ALTER TABLE "store_themes" ADD CONSTRAINT "store_themes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_store_id_cart_id_fkey" FOREIGN KEY ("store_id", "cart_id") REFERENCES "carts"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_store_id_variant_id_fkey" FOREIGN KEY ("store_id", "variant_id") REFERENCES "product_variants"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written: integrity checks, grants and tenant isolation.
-- =====================================================================
ALTER TABLE cart_items ADD CONSTRAINT cart_items_quantity_range CHECK (quantity BETWEEN 1 AND 99);

GRANT SELECT, INSERT, UPDATE, DELETE ON store_themes, carts, cart_items TO mtjari_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_themes', 'carts', 'cart_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO mtjari_app USING (store_id = app_tenant_id()) WITH CHECK (store_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $$;
