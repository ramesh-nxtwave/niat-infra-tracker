ALTER TABLE "university_classrooms"
  ADD COLUMN "space_id" TEXT;

ALTER TABLE "university_classrooms"
  ADD CONSTRAINT "university_classrooms_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "university_classrooms_space_id_key"
  ON "university_classrooms"("space_id");
CREATE INDEX "university_classrooms_university_id_is_deleted_idx"
  ON "university_classrooms"("university_id", "is_deleted");