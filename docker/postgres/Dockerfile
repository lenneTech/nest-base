# Custom Postgres image for nest-base local-dev (iter-207 — TR.DB.04
# closure).
#
# Bundles two extensions that vanilla `postgres:18-*` does not ship:
#
#   pg_uuidv7  — required by every project (UUID v7 column defaults).
#   postgis    — only loaded when `features.geo.enabled` is true, but
#                must be available in the binary so `CREATE EXTENSION`
#                works without an extra container swap.
#
# Iter-207 rebases the build chain onto `imresamu/postgis:18-3.6`
# (multi-arch — amd64 + arm64) which already bundles PostGIS 3.6
# against Postgres 18. The PRD pin `imresamu/postgis:18-3.5` no
# longer exists upstream — `imresamu` rolled forward to PostGIS 3.6
# with Postgres 18; the runtime contract (PostGIS 3.x with ST_DWithin,
# ST_Contains, pg_uuidv7) is unchanged.
#
# pg_uuidv7 still ships from source — the imresamu image doesn't
# include it. The build stage compiles it once, and the runtime
# stage copies the resulting `.so` + control files in.

ARG POSTGRES_VERSION=18

FROM imresamu/postgis:${POSTGRES_VERSION}-3.6 AS build
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


FROM imresamu/postgis:${POSTGRES_VERSION}-3.6
ARG POSTGRES_VERSION

# pg_uuidv7 binaries from the build stage. PostGIS is already bundled
# in the imresamu base image so the runtime stage stays minimal.
COPY --from=build /usr/share/postgresql/${POSTGRES_VERSION}/extension/pg_uuidv7* \
                  /usr/share/postgresql/${POSTGRES_VERSION}/extension/
COPY --from=build /usr/lib/postgresql/${POSTGRES_VERSION}/lib/pg_uuidv7.so \
                  /usr/lib/postgresql/${POSTGRES_VERSION}/lib/

# Sanity-check that both extensions are findable. Fails the build if
# packaging regressed.
RUN test -f /usr/share/postgresql/${POSTGRES_VERSION}/extension/pg_uuidv7.control \
 && test -f /usr/share/postgresql/${POSTGRES_VERSION}/extension/postgis.control
