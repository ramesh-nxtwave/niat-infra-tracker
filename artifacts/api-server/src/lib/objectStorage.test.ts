import assert from "node:assert/strict";
import test from "node:test";
import {
  isObjectStorageNotFoundError,
  parseObjectByteRange,
  stripObjectPathMetadata,
} from "./objectStorage";

test("strips media metadata before resolving an object for deletion", () => {
  assert.equal(
    stripObjectPathMetadata(
      "/objects/uploads/550e8400-e29b-41d4-a716-446655440000?media=video"
    ),
    "/objects/uploads/550e8400-e29b-41d4-a716-446655440000"
  );
});

test("strips fragments and preserves ordinary object paths", () => {
  assert.equal(
    stripObjectPathMetadata("/objects/uploads/video-id#preview"),
    "/objects/uploads/video-id"
  );
  assert.equal(
    stripObjectPathMetadata("/objects/uploads/photo.jpg"),
    "/objects/uploads/photo.jpg"
  );
});

test("parses browser byte ranges for video streaming", () => {
  assert.deepEqual(parseObjectByteRange("bytes=0-1023", 5000), {
    start: 0,
    end: 1023,
  });
  assert.deepEqual(parseObjectByteRange("bytes=4000-", 5000), {
    start: 4000,
    end: 4999,
  });
  assert.deepEqual(parseObjectByteRange("bytes=-500", 5000), {
    start: 4500,
    end: 4999,
  });
});

test("rejects unsatisfiable or malformed byte ranges", () => {
  assert.equal(parseObjectByteRange("bytes=5000-", 5000), "invalid");
  assert.equal(parseObjectByteRange("bytes=20-10", 5000), "invalid");
  assert.equal(parseObjectByteRange("items=0-1", 5000), "invalid");
});

test("recognizes storage not-found errors during a deletion race", () => {
  assert.equal(isObjectStorageNotFoundError({ code: 404 }), true);
  assert.equal(isObjectStorageNotFoundError({ code: 500 }), false);
  assert.equal(isObjectStorageNotFoundError(new Error("not found")), false);
});