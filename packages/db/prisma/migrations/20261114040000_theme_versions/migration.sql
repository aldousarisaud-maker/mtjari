-- CreateTable
CREATE TABLE "store_theme_versions" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "theme_id" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_theme_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_theme_versions_store_id_theme_id_created_at_idx" ON "store_theme_versions"("store_id", "theme_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "store_theme_versions" ADD CONSTRAINT "store_theme_versions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written: grants and tenant isolation. History is append-only for the app role.
-- =====================================================================
GRANT SELECT, INSERT ON store_theme_versions TO mtjari_app;

ALTER TABLE store_theme_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY store_theme_versions_tenant ON store_theme_versions FOR ALL TO mtjari_app
  USING (store_id = app_tenant_id()) WITH CHECK (store_id = app_tenant_id());
