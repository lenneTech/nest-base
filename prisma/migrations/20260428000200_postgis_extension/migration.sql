-- PostGIS extension.
--
-- Enables the spatial-types and GIST-index support that prisma/features/geo.prisma
-- relies on (Address.location, Geofence.area). The migration is idempotent so a
-- consumer flipping `features.geo.enabled = true` can run it without conflict
-- against an existing PostGIS install.
--
-- Note: the corresponding `prepare:schema`-generated geo.prisma is loaded only
-- when the feature flag is on; without the flag the extension still becomes
-- available but no models reference it (zero overhead).

CREATE EXTENSION IF NOT EXISTS postgis;
