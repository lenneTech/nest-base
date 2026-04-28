# Ralph-Direktiven

User-Toggles für die Ralph-Loop. Werden bei jeder Iteration neu gelesen — Änderungen
hier wirken auf die nächste Iteration ohne Neustart.

## Optional-Phasen aus PLAN.md §32

```yaml
optional_phases:
  5b_powersync: true    # Mobile-Offline-Sync (PowerSync)
  5c_geo: true          # PostGIS / Standortdaten
  6_email_2fa_mcp: true # Email + 2FA + Passkey + MCP
```

## Klarstellungen / Live-Anpassungen

Hier können während des Loops zusätzliche Hinweise eingetragen werden, falls Ralph
sich verläuft oder eine Slice falsch interpretiert. Die Loop liest diese Sektion
bei jeder Iteration.

<!--
Beispiel:
- Phase 2 / Better-Auth: Email-Verifikation initial deaktiviert lassen, kommt in Phase 6.
- Tests für Realtime: Postgres-NOTIFY-Trigger müssen in `tests/global-setup.ts` aktiviert werden.
-->

### Stack-Overrides gegen PLAN.md §33

- **2026-04-28 · Prisma 7 statt Prisma 6** *(User-Directive: „prisma 7 bitte")*. Prisma 7 verlangt
  die Connection-URL in `prisma.config.ts` (nicht mehr in `schema.prisma`). Der `PrismaClient`
  bekommt einen `adapter` (`@prisma/adapter-pg`) statt direkter URL.
- **2026-04-28 · Postgres 18 statt Postgres 17** *(User-Directive: „postgres 18")*. Image
  `postgres:18-alpine` in `docker-compose.yml`, `tests/global-setup.ts` (testcontainers) und
  `.gitlab-ci.yml`.

## Stop-Bedingungen (zusätzlich zur Default-Done-Logik)

```yaml
hard_stop:
  on_repeated_failures: 3        # Wiederholte Quality-Gate-Fails pro Slice
  on_no_progress_iterations: 50  # Iterationen ohne Phase-Fortschritt
```
