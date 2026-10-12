import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCommittedUploadUpdates,
  buildUploadPatch,
} from './uploadEvidenceContract.js';

const upload = { objectPath: '/objects/latest.jpg', contentType: 'image/jpeg' };

test('a newer status is never replayed by a long-running upload', () => {
  const source = { id: 'status-1', status: 'Yet to start' };
  const latest = { ...source, status: 'Done' };
  const { patch, automaticStatusApplied } = buildUploadPatch(source, latest, upload);

  assert.deepEqual(patch, {
    photoUrl: '/objects/latest.jpg',
    photoContentType: 'image/jpeg',
  });
  assert.equal(automaticStatusApplied, false);
  const committed = buildCommittedUploadUpdates(
    source,
    latest,
    upload,
    automaticStatusApplied,
    null,
  );
  assert.equal(committed.photoLink, '/objects/latest.jpg');
  assert.equal(committed.photoContentType, 'image/jpeg');
  assert.equal(Object.hasOwn(committed, 'status'), false);
});

test('an untouched Yet to start source is promoted once, with photo metadata', () => {
  const source = { id: 'status-1', status: 'Yet to start' };
  const { patch, automaticStatusApplied } = buildUploadPatch(source, source, upload);
  assert.deepEqual(patch, {
    photoUrl: '/objects/latest.jpg',
    photoContentType: 'image/jpeg',
    currentStatus: 'In-Progress',
    isBlocker: false,
  });
  assert.equal(automaticStatusApplied, true);
  assert.equal(
    buildCommittedUploadUpdates(source, source, upload, true, null).status,
    'In-Progress',
  );
});

test('a local status draft suppresses automatic promotion and local overwrite', () => {
  const source = { id: 'status-1', status: 'Yet to start' };
  const { patch, automaticStatusApplied } = buildUploadPatch(
    source,
    source,
    upload,
    { value: 'Yet to start', generation: 7 },
  );
  assert.equal(Object.hasOwn(patch, 'currentStatus'), false);
  assert.equal(automaticStatusApplied, false);
  assert.equal(
    Object.hasOwn(buildCommittedUploadUpdates(source, source, upload, true, { value: 'Yet to start' }), 'status'),
    false,
  );
});