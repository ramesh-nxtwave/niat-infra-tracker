export async function saveChecklistFieldAndRefresh({
  patchChecklistStatus,
  loadUniversityDetail,
  universityId,
  statusId,
  data,
}) {
  await patchChecklistStatus(universityId, statusId, data);

  try {
    await loadUniversityDetail(universityId, true);
    return true;
  } catch {
    return false;
  }
}

export async function saveChecklistStatusAndRefresh({
  patchChecklistStatus,
  loadUniversityDetail,
  universityId,
  statusId,
  status,
}) {
  return saveChecklistFieldAndRefresh({
    patchChecklistStatus,
    loadUniversityDetail,
    universityId,
    statusId,
    data: {
      currentStatus: status,
      isBlocker: status === 'Blocker',
    },
  });
}