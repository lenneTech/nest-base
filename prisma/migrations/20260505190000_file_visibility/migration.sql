-- File.visibility (CF.FILES.06 — iter-113).
-- Per-file visibility marker. PRIVATE files require an authenticated
-- request through the standard CASL pipeline; PUBLIC files can be
-- handed out via the share-link surface without further auth.

CREATE TYPE "FileVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

ALTER TABLE "files"
  ADD COLUMN "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE';
