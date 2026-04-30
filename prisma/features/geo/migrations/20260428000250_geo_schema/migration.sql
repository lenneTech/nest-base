-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "street" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "state" TEXT,
    "formattedAddress" TEXT,
    "location" geometry(Point, 4326),
    "geocodingProvider" TEXT,
    "geocodedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "tenantId" UUID,
    "ownedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "area" geometry(Polygon, 4326) NOT NULL,
    "category" TEXT,
    "tenantId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geocoding_cache" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "provider" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocoding_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_country_zip_idx" ON "addresses"("country", "zip");

-- CreateIndex
CREATE INDEX "addresses_tenantId_idx" ON "addresses"("tenantId");

-- CreateIndex
CREATE INDEX "geofences_tenantId_idx" ON "geofences"("tenantId");

-- CreateIndex
CREATE INDEX "geofences_category_idx" ON "geofences"("category");

-- CreateIndex
CREATE INDEX "geocoding_cache_expiresAt_idx" ON "geocoding_cache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "geocoding_cache_provider_queryHash_key" ON "geocoding_cache"("provider", "queryHash");

