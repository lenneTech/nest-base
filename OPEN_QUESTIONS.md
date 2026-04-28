# Open Questions

Ralph trägt hier Slices ein, bei denen er sich nicht sicher ist oder wo PLAN.md
unklar ist. User reviewt periodisch und beantwortet entweder durch direkte Edits
in `PLAN.md` oder durch eine Klarstellung in `RALPH_DIRECTIVES.md`.

## Offene Punkte

_Keine offenen Punkte._

<!-- Format pro Eintrag:
### YYYY-MM-DD · Phase X · <Slice-Titel>
- **Kontext:** Was wurde versucht.
- **Frage:** Was ist unklar.
- **Vermutung:** Was Ralph annehmen würde.
- **Status:** open | answered (Antwort: …)
-->

## Beantwortet

### 2026-04-28 · Phase 3 · `Permission.fields = []` Semantik

- **Kontext:** PLAN.md §6.3 dokumentierte ursprünglich: `fields String[]` mit
  „Null = alle Felder, [] = keine". Unser Schema hat `fields String[]` (non-null
  Postgres-Array), CASL akzeptiert keine leere `fields`-Liste in einer Rule
  (`rawRule.fields cannot be an empty array`).
- **Frage:** Wie soll `fields = []` an der CASL-Schicht behandelt werden?
- **Antwort (User-Direktive, 2026-04-28, Option 3):** PLAN.md §6.3 wurde
  angepasst, sodass `[]` synonym zu „keine Field-Level-Restriction" ist
  — damit ist die Spec mit der Implementierung konsistent. Rationale: CASL kann
  leere `fields`-Listen technisch nicht repräsentieren, und mehrere Tests
  (`permission-service.story.test.ts`, `permission-test-endpoint.story.test.ts`)
  pinnen die laxe Interpretation. Wer „deny all fields" semantisch braucht,
  nutzt einen `inverted: true` Rule oder lässt die Rule weg.
- **Status:** answered.
