-- Saved key/secret connections to source platforms (WooCommerce, Magento, …):
-- one per shop+platform, secrets AES-encrypted in the JSON.
CREATE TABLE "MigrationConnection" (
    "id"          TEXT NOT NULL,
    "shop"        TEXT NOT NULL,
    "platform"    TEXT NOT NULL,
    "creds"       TEXT NOT NULL,
    "label"       TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MigrationConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MigrationConnection_shop_platform_key" ON "MigrationConnection"("shop", "platform");
CREATE INDEX "MigrationConnection_shop_idx" ON "MigrationConnection"("shop");
