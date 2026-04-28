# Ralph-Direktiven

User-Toggles für die Ralph-Loop. Werden bei jeder Iteration neu gelesen — Änderungen
hier wirken auf die nächste Iteration ohne Neustart.

## Optional-Phasen aus PLAN.md §32

```yaml
optional_phases:
  5b_powersync: false   # Mobile-Offline-Sync (PowerSync)
  5c_geo: false         # PostGIS / Standortdaten
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

## Stop-Bedingungen (zusätzlich zur Default-Done-Logik)

```yaml
hard_stop:
  on_repeated_failures: 3        # Wiederholte Quality-Gate-Fails pro Slice
  on_no_progress_iterations: 50  # Iterationen ohne Phase-Fortschritt
```
