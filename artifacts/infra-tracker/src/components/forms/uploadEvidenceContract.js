/**
 * Uploads persist evidence independently from checklist status.  The status
 * promotion is only an automatic convenience for a source that is still
 * "Yet to start" and has not changed during the upload.
 */
export function buildUploadPatch(sourceItem, latestItem, upload, statusDraft) {
  const patch = {
    photoUrl: upload.objectPath,
    photoContentType: upload.contentType,
  };
  const automaticStatusApplied =
    sourceItem.status === 'Yet to start'
    && latestItem.status === 'Yet to start'
    && !statusDraft;
  if (automaticStatusApplied) {
    patch.currentStatus = 'In-Progress';
    patch.isBlocker = false;
  }
  return { patch, automaticStatusApplied };
}

export function buildCommittedUploadUpdates(
  sourceItem,
  latestItem,
  latestUpload,
  automaticStatusApplied,
  statusDraft,
) {
  const statusChangedByUpload =
    automaticStatusApplied
    && sourceItem.status === 'Yet to start'
    && latestItem.status === 'Yet to start'
    && !statusDraft;
  return {
    photoLink: latestUpload.objectPath,
    photoContentType: latestUpload.contentType,
    lastUpdated: new Date().toISOString(),
    ...(statusChangedByUpload ? { status: 'In-Progress' } : {}),
  };
}