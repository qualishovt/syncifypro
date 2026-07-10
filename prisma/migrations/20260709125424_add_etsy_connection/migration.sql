-- CreateTable
CREATE TABLE "EtsyConnection" (
    "shop" TEXT NOT NULL,
    "keystring" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "etsyShopId" TEXT,
    "etsyShopName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtsyConnection_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "MigrationOAuthState" (
    "state" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "keystring" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationOAuthState_pkey" PRIMARY KEY ("state")
);
