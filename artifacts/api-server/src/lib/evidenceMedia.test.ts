import assert from "node:assert/strict";
import test from "node:test";
import { resolveEvidenceContentType } from "./evidenceMedia";

test("keeps structured video type when a normal save resubmits the same unmarked path", () => {
  const objectPath = "/objects/uploads/550e8400-e29b-41d4-a716-446655440000";

  assert.equal(
    resolveEvidenceContentType({
      photoUrl: objectPath,
      existingPhotoUrl: objectPath,
      existingContentType: "video/quicktime",
    }),
    "video/quicktime",
  );
});

test("uses supplied structured metadata when evidence changes", () => {
  assert.equal(
    resolveEvidenceContentType({
      photoUrl: "/objects/uploads/new-extensionless-object",
      contentType: "video/mp4",
      existingPhotoUrl: "/objects/uploads/old-extensionless-object",
      existingContentType: "image/jpeg",
    }),
    "video/mp4",
  );
});