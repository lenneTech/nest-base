# Open Questions

Ralph trägt hier Slices ein, bei denen er sich nicht sicher ist oder wo PLAN.md
unklar ist. User reviewt periodisch und beantwortet entweder durch direkte Edits
in `PLAN.md` oder durch eine Klarstellung in `RALPH_DIRECTIVES.md`.

## Offene Punkte

<!-- Format pro Eintrag:
### YYYY-MM-DD · Phase X · <Slice-Titel>
- **Kontext:** Was wurde versucht.
- **Frage:** Was ist unklar.
- **Vermutung:** Was Ralph annehmen würde.
- **Status:** open | answered (Antwort: …)
-->

### 2026-04-28 · Phase 3 · `Permission.fields = []` Semantik

- **Kontext:** PLAN.md §6.3 dokumentiert: `fields String[]` mit "Null = alle Felder, [] = keine".
  Unser Schema hat `fields String[]` (non-null Postgres-Array), CASL akzeptiert keine leere
  `fields`-Liste in einem Rule (`rawRule.fields cannot be an empty array`).
- **Frage:** Wie soll `fields = []` an der CASL-Schicht behandelt werden? Die wörtliche
  Lesart "keine Felder lesbar" entspricht "Rule grants nothing" — also könnte die Rule
  schlicht entfallen. Aber andere Rules für dasselbe Resource könnten dann das Recht
  geben.
- **Vermutung:** Aktuell behandelt `buildAbility()` `fields = []` als "keine Field-Level-
  Restriktion" (alle Felder erlaubt) und überspringt das CASL-`fields`-Argument. Dies
  ist die laxere Interpretation — nicht streng "deny all fields". Soll im
  Permission-Pipeline-Stage 2 (Field-Strip) später korrekt umgesetzt werden, sobald die
  Output-Pipeline-Stages aufgesetzt sind.
- **Status:** open

