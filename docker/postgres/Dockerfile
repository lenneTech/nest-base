# Custom Postgres image for nest-base local-dev.
#
# Bundles two extensions that vanilla `postgres:*-alpine` does not ship:
#
#   pg_uuidv7  — required by every project (UUID v7 column defaults).
#   postgis    — only loaded when `features.geo.enabled` is true, but
#                must be available in the binary so `CREATE EXTENSION`
#                works without an extra container swap.
#
# Postgres 18 — Debian apt now ships `postgresql-18-postgis-3` since
# the 2026-04 PostGIS release, so we no longer need to hold the image
# back at 17. We use the Debian-based `postgres:18-bookworm` rather
# than alpine because:
#   1. The official `postgres` image is multi-arch (amd64 + arm64);
#      `postgis/postgis` only ships some tags for arm64.
#   2. Debian apt ships `postgresql-18-postgis-3` as a single package,
#      no compiling required for PostGIS.
#   3. pg_uuidv7 still needs to be compiled from source either way.

ARG POSTGRES_VERSION=18

FROM postgres:${POSTGRES_VERSION}-bookworm AS build
ARG POSTGRES_VERSION

# Compile pg_uuidv7 from source. Build deps are discarded in the
# runtime stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      git \
      "postgresql-server-dev-${POSTGRES_VERSION}" \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/pg_uuidv7
RUN git clone --depth 1 https://github.com/fboulnois/pg_uuidv7.git . \
 && make \
 && make install


FROM postgres:${POSTGRES_VERSION}-bookworm
ARG POSTGRES_VERSION

# PostGIS as a Debian package (multi-arch, no compiling).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      "postgresql-${POSTGRES_VERSION}-postgis-3" \
 && rm -rf /var/lib/apt/lists/*

# pg_uuidv7 binaries from the build stage.
COPY --from=build /usr/share/postgresql/${POSTGRES_VERSION}/extension/pg_uuidv7* \
                  /usr/share/postgresql/${POSTGRES_VERSION}/extension/
COPY --from=build /usr/lib/postgresql/${POSTGRES_VERSION}/lib/pg_uuidv7.so \
                  /usr/lib/postgresql/${POSTGRES_VERSION}/lib/

# Sanity-check that both extensions are findable. Fails the build if
# packaging regressed.
RUN test -f /usr/share/postgresql/${POSTGRES_VERSION}/extension/pg_uuidv7.control \
 && test -f /usr/share/postgresql/${POSTGRES_VERSION}/extension/postgis.control
