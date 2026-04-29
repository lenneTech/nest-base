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

### 2026-04-29 · Definition-of-Done-Korrektur (kritisch)

**Eine Box in PLAN.md §32 ist ERST dann abgehakt, wenn ALLE der folgenden gilt:**

1. Die Pure-Function/Planner ist gebaut UND per Story-Test gepinnt (wie bisher).
2. **Der NestJS-DI-Layer ist verdrahtet** — Service ist `@Injectable`, Modul existiert,
   Modul ist in `AppModule` (oder einem Eltern-Modul) importiert.
3. **Wenn das Feature eine HTTP/WS-Surface hat:** Controller existiert, ist gemountet,
   und ein **e2e-Test** fährt einen echten NestJS-Server hoch (`Test.createTestingModule`),
   ruft den Endpoint via `supertest` und prüft Status + Response.
4. **Wenn das Feature einen Lifecycle braucht** (Cron, pg-boss-Worker, Socket.IO,
   Outbox-Polling): Boot-Hook (`OnModuleInit`) ist implementiert, Lifecycle-Test fährt
   den Boot durch und beobachtet die Side-Effect.
5. Quality-Gates grün (lint, test:unit, test:e2e, test:types, test:coverage, build).

**Konsequenz:** Story-Test allein reicht ab jetzt nicht mehr für eine Box-Flippung.
Boxes ohne e2e-Verifikation der HTTP-Surface bleiben offen.

Stand des Re-Audits (2026-04-29): 60 von 118 ehemals abgehakten Boxes wurden
zurückgesetzt, weil nur der Planner-Layer fertig war. Die jeweilige Lücke ist
in PLAN.md §32 in *kursiv* hinter der Box notiert.

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
