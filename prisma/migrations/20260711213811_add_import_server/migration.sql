-- CreateTable
CREATE TABLE "ImportServer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER,
    "username" TEXT,
    "password" TEXT,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportServer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportServer_shop_idx" ON "ImportServer"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ImportServer_shop_protocol_host_username_key" ON "ImportServer"("shop", "protocol", "host", "username");
