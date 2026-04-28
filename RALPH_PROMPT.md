# Ralph-Loop: NestJS-Server-Template-Implementation

## Mission (gilt jede Iteration)
Implementiere das in `PLAN.md` beschriebene NestJS-Server-Template phasenweise,
test-driven, atomar committet. Pro Iteration: **genau eine Slice** (= ein Checklist-
Punkt aus PLAN.md §32) im Red-Green-Refactor-Zyklus.

## Iterations-Workflow (jedes Mal in dieser Reihenfolge)

### Schritt 1 — Selbst-Orientierung
1. `git log --oneline -30` lesen — was wurde schon gemacht?
2. `PLAN.md` §32 lesen — erste unangehakte (`- [ ]`) Box der frühesten unvollständigen
   Phase finden. Phasen-Reihenfolge: 1 → 2 → 3 → 4 → 5 → 7 → 8.
   Optional-Phasen 5b/5c/6 nur, wenn `RALPH_DIRECTIVES.md` sie aktiviert; sonst skippen.
3. Falls `RALPH_LOG.md` existiert: letzten Eintrag lesen — gab es Blocker?
4. Falls Workspace leer ist: starte mit Phase 0 (Repo-Bootstrap, siehe unten),
   danach Phase 1 erste Slice (Test-Infrastruktur).

### Schritt 2 — Done-Check
Wenn ALLE Pflicht-Phasen (1, 2, 3, 4, 5, 7, 8 + die in `RALPH_DIRECTIVES.md` als
`true` markierten Optional-Phasen) vollständig abgehakt sind UND alle Quality-Gates
auf HEAD grün sind UND `OPEN_QUESTIONS.md` leer ist:
→ Gib aus: `<promise>RALPH-PROJECT-COMPLETE</promise>` und höre sofort auf.

### Schritt 3 — Eine atomare TDD-Slice
1. **Red:** Schreibe Story-/E2E-Tests (`tests/stories/<feature>.story.test.ts` oder
   `tests/<feature>.e2e-spec.ts`) für die gewählte Slice. Verifiziere Rot:
   `bun run test:e2e <pfad>` schlägt fehl. Commit:
   `test(<scope>): add red tests for <slice>`.
2. **Green:** Schreibe minimalen Code in `src/core/` oder `src/modules/`, bis genau
   diese Tests grün werden. Keine zusätzlichen Features.
3. **Refactor:** Aufräumen ohne Verhaltensänderung. Tests bleiben grün.
4. **Quality-Gates** (alle müssen grün sein vor Commit):
   - `bun run lint`
   - `bun run test:unit`
   - `bun run test:e2e`
   - `bun run test:types`
   - `bun run test:coverage` — `src/core/` ≥ 90 %, `src/modules/` ≥ 80 %
   - `bun run build`
5. **Plan abhaken:** In `PLAN.md` `- [ ]` → `- [x]` für die erledigte Box.
6. **Commit (Conventional Commits):**
   `feat(<scope>): <slice>` oder `fix(<scope>): <slice>` — eine Slice = ein Commit.

### Schritt 4 — Logging
Hänge an `RALPH_LOG.md` an:
```
## Iteration <n> · <ISO-Timestamp>
- Phase: <X>
- Slice: <Bullet-Text>
- Tests: <pfade> rot → grün
- Coverage: core <X>%, modules <Y>%
- Commit: <sha-7>
- Blocker: <none|kurz>
```

## Strikte Regeln
- Implementierung NUR mit vorher geschriebenem failing Test.
- KEIN `it.skip`, `xit`, `--no-verify`, `--force`, Test-Disable, Coverage-Senkung.
- KEINE Features/Refactorings/Helpers außerhalb von PLAN.md.
- KEINE Änderungen an `PLAN.md` außer dem Abhaken (`[ ]`→`[x]`). Vermutete Plan-
  Fehler oder offene Entscheidungen → Eintrag in `OPEN_QUESTIONS.md`, nächste
  unabhängige Slice.
- KEIN Wechsel der in PLAN.md §33 (28.1–28.10) entschiedenen Tools/Architektur:
  Bun · NestJS 11 · Prisma 6 · Postgres 17 · Better-Auth · Zod 4 · nestjs-zod ·
  kubb · Vitest · oxlint/oxfmt · sharp · @tus/server v3 · pg-boss · Socket.IO +
  Postgres-NOTIFY · RustFS · portless · MIT · GitLab CI · Self-hosted-Hetzner ·
  Single-Repo · `src/core/`+`src/modules/`+`src/shared/`.
- KEINE in §1.4 als Out-of-Scope markierten Features (GraphQL, Mongoose, MongoDB,
  Vendor-Mode, Mailjet, Legacy-Auth, @UnifiedField, process()-Pipeline,
  @Restricted/@Roles-Stack).
- KEINE Test-Übernahmen aus nest-server, die in §28b.5 als "NICHT übernehmen"
  markiert sind (GraphQL, Mongoose, Unified-Field, Legacy-Auth-Szenarien).

## Phase 0 — Repo-Bootstrap (nur wenn Workspace leer)
Lege an, bevor die erste Test-Slice startet:
- `package.json` (mit den Scripts aus PLAN.md §28b.10)
- `tsconfig.json` (strict, Bun)
- `vitest.config.ts` (mit `tests/global-setup.ts`)
- `.gitlab-ci.yml` (Stages aus §28b.8, ohne Container-Build/Deploy)
- `LICENSE` (MIT)
- `Dockerfile.example` (Multi-Stage Bun, non-root, **nicht** in CI gebaut)
- `docker-compose.yml` (nur Postgres 17 + RustFS + Mailpit + OTel-Collector)
- `portless.yml`
- `.gitignore`
- `README.md` (Quickstart-Skelett)
Dann erster Commit: `chore: bootstrap repo`.

## Fehler-Eskalation
- Quality-Gate 3× hintereinander rot trotz Reparaturversuchen → Slice in
  `OPEN_QUESTIONS.md` dokumentieren, `git restore .` für die Slice, nächste
  unabhängige Slice anfangen. Keine Endlos-Reparatur.
- 50 Iterationen ohne Phase-Fortschritt → schreibe Status in `RALPH_STATUS.md`,
  gib `<promise>RALPH-PROJECT-COMPLETE</promise>` aus (ungeplanter Stop —
  User muss reviewen).

## Test-Vorlagen
Adaptiere Tests aus `lenneTech/nest-server` (develop-Branch) gemäß PLAN.md §28b.6.
NIEMALS Tests aus §28b.5 übernehmen.

## Quellen-Referenzen (Pflicht-Lektüre bei Unklarheit)
- `PLAN.md` — Spezifikation (Single Source of Truth)
- `RALPH_DIRECTIVES.md` — User-Toggles für Optional-Phasen
- `OPEN_QUESTIONS.md` — Vermerk für unklare Entscheidungen (anlegen falls nicht da)
- `RALPH_LOG.md` — eigenes Iteration-Log (anlegen falls nicht da)
