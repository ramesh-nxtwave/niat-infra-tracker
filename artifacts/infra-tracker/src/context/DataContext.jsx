import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  cancelChecklistRemarkSaveTimer,
  checklistRemarkSaveKey,
  enqueueChecklistBatchSave,
  enqueueChecklistRemarkSave,
  getChecklistRemarkSaveState,
} from '../utils/checklistRemarkSaveQueue';
import {
  checklistSaveFailureError,
  runBoundedChecklistSaveTask,
  runRegisteredBoundedChecklistSaves,
} from '../utils/boundedChecklistSave';
import {
  acknowledgeChecklistDraft,
  applyChecklistDraftsToUniversity,
  checklistApiDataToDraftSnapshot,
  getChecklistDraftFieldsForApiData,
  getChecklistDraftSubmissions,
  getPendingChecklistDrafts,
  markChecklistDraftFailed,
  recordChecklistDraft,
  setChecklistDraftOwner,
  mergeChecklistItemDraft,
} from '../utils/checklistDraftStore';

const DataContext = createContext();
export const useData = () => useContext(DataContext);

export const ITEM_STATUSES = ['Done', 'Partially Done', 'In-Progress', 'Yet to start', 'Need to revamp', 'No info as of now', 'Blocker', 'N/A'];

function canonicalChecklistSemanticPart(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function canonicalChecklistSemanticKey(category, name) {
  const canonicalCategory = canonicalChecklistSemanticPart(category);
  const canonicalName = canonicalChecklistSemanticPart(name);
  return canonicalCategory && canonicalName
    ? `${canonicalCategory}\u0000${canonicalName}`
    : null;
}

function cloneBulkChecklistUpdate(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    const error = new Error('Each bulk update must be an object');
    error.code = 'CHECKLIST_BULK_UPDATE_INVALID';
    throw error;
  }
  const hasSourceSpaceType = Object.prototype.hasOwnProperty.call(update || {}, 'sourceSpaceType');
  const hasSkipBlankValues = Object.prototype.hasOwnProperty.call(update || {}, 'skipBlankValues');
  if (hasSourceSpaceType && update.sourceSpaceType !== 'model_classroom') {
    const error = new Error('sourceSpaceType must be model_classroom for a model classroom copy');
    error.code = 'CHECKLIST_SOURCE_SPACE_TYPE_INVALID';
    throw error;
  }
  if (hasSkipBlankValues && typeof update.skipBlankValues !== 'boolean') {
    const error = new Error('skipBlankValues must be boolean');
    error.code = 'CHECKLIST_BULK_UPDATE_INVALID';
    throw error;
  }
  return {
    ...update,
    ...(hasSourceSpaceType ? { sourceSpaceType: update.sourceSpaceType } : {}),
    ...(hasSkipBlankValues ? { skipBlankValues: update.skipBlankValues } : {}),
    ...(Array.isArray(update.classroomIds) && { classroomIds: [...update.classroomIds] }),
    ...(Array.isArray(update.spaceIds) && { spaceIds: [...update.spaceIds] }),
    ...(Array.isArray(update.targetStatusIds) && { targetStatusIds: [...update.targetStatusIds] }),
  };
}

function normalizeUniversity(uni) {
  if (!uni) return null;

  const spaces = uni.spaces || [];
  const canonicalName = canonicalChecklistSemanticPart;
  const spacesMap = new Map();
  spaces.forEach(s => {
    if (s.spaceType) spacesMap.set(canonicalName(s.spaceType), s);
    if (s.name) spacesMap.set(canonicalName(s.name), s);
    if (s.id) spacesMap.set(String(s.id), s);
  });

  const mapItems = (spaceType) => {
    const space = spacesMap.get(String(spaceType)) || spacesMap.get(canonicalName(spaceType));
    if (!space || !Array.isArray(space.checklistStatuses)) return [];
    return space.checklistStatuses
     .map(st => ({
        checklistItemCategory: st.checklistItem?.category || '',
        checklistItemName: st.checklistItem?.name || '',
        checklistSemanticKey: canonicalChecklistSemanticKey(
          st.checklistItem?.category,
          st.checklistItem?.name,
        ),
        id: st.id,
        checklistItemId: st.checklistItemId,
        name: st.checklistItem?.name || 'Unknown',
        category: st.checklistItem?.category || 'General',
        sortOrder: st.checklistItem?.sortOrder ?? 999,
        spec: st.checklistItem?.specification || '',
        requiresCapacity: !!(st.checklistItem?.name?.toLowerCase().includes('generator') || st.checklistItem?.name?.toLowerCase().includes('transformer')),
        status: st.isBlocker ? 'Blocker' : (st.currentStatus || 'Yet to start'),
        remarks: st.remarks || '',
        capacity: st.capacity || '',
        // The current status row is authoritative for the media shown in a
        // checklist. PhotoHistory is an audit gallery, not a fallback current
        // value: after an explicit removal the row is null while old uploads
        // remain intentionally retained for history/shared references.
        photoLink: st.photoUrl || '',
        photoContentType: st.photoUrl
          ? (st.photoContentType || st.photoHistory?.find(photo => photo.photoUrl === st.photoUrl)?.contentType || null)
          : null,
        photoUrl: st.photoUrl || '',
        universityTimeline: st.universityTimeline || '',
        targetDate: st.targetTimeline || '',
        itemStartDate: st.itemStartDate || '',
        itemEndDate: st.itemEndDate || '',
        actualDate: st.actualCompletionDate || '',
        lastUpdated: st.updatedAt || new Date().toISOString(),
        spaceId: st.spaceId,
        isBlocker: st.isBlocker || false,
        photoHistory: st.photoHistory || [],
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  };

  const modelItems = mapItems('model_classroom');
  const labItems = mapItems('lab');
  const staffItems = mapItems('staff_room');

  const modelSpace = spacesMap.get('model_classroom');
  const labSpace = spacesMap.get('lab');
  const staffSpace = spacesMap.get('staff_room');

  const classroomsWithItems = (uni.classrooms || []).map(room => {
    const name = canonicalName(room.roomId || room.room_id);
    const matchingRooms = (uni.classrooms || []).filter(candidate =>
      !candidate.isDeleted && canonicalName(candidate.roomId || candidate.room_id) === name);
    const matchingSpaces = spaces.filter(candidate =>
      !candidate.isDeleted && candidate.spaceType === 'overall_classroom'
      && canonicalName(candidate.name) === name);
    const explicitSpaceId = room.spaceId ?? room.space_id ?? null;
    const explicitSpace = explicitSpaceId == null
      ? null
      : spaces.find(candidate => !candidate.isDeleted
        && candidate.spaceType === 'overall_classroom'
        && String(candidate.id) === String(explicitSpaceId));
    const legacySpace = name && matchingRooms.length === 1 && matchingSpaces.length === 1
      ? matchingSpaces[0] : null;
    // Existing rows receive a nullable spaceId after the schema rollout. Keep
    // the exact-one legacy match for null links so valid rooms do not disappear;
    // a non-null link is always authoritative and must itself be valid.
    const space = explicitSpaceId != null ? explicitSpace : legacySpace;
    const associationState = explicitSpaceId != null
      ? (explicitSpace ? 'resolved' : 'invalid')
      : (legacySpace ? 'resolved' : (matchingSpaces.length > 1 || matchingRooms.length > 1 ? 'ambiguous' : 'missing'));
    const associationError = associationState === 'resolved' ? null
      : associationState === 'invalid'
        ? 'This classroom has an invalid checklist association. Ask an administrator to choose an active classroom checklist space.'
        : associationState === 'ambiguous'
          ? 'This classroom matches more than one checklist space. Ask an administrator to resolve the association.'
          : 'This classroom has no checklist association. Ask an administrator to resolve the association.';
    const associationCandidates = spaces
      .filter(candidate => !candidate.isDeleted && candidate.spaceType === 'overall_classroom')
      .map(candidate => ({
        id: candidate.id,
        name: candidate.name || 'Unnamed space',
        checklistCount: Array.isArray(candidate.checklistStatuses) ? candidate.checklistStatuses.length : 0,
        statusCount: Array.isArray(candidate.checklistStatuses)
          ? candidate.checklistStatuses.filter(status => status.currentStatus || status.isBlocker).length : 0,
      }));
    return {
      ...room,
      id: room.id,
      room_id: room.room_id || room.roomId || '',
      spaceId: space?.id || null,
      associationState,
      associationError,
      associationCandidates,
      items: space ? mapItems(space.id) : [],
    };
  });

  const getReadiness = (items) => {
    if (!items?.length) return 0;
    return Math.round((items.filter(i => i.status === 'Done' || i.status === 'N/A').length / items.length) * 100);
  };

  // Use pre-computed per-module readiness from API when available (list view)
  // and fall back to computed when full item data is loaded (detail view)
  const mr = uni.moduleReadiness || {};
  const modelReadiness = modelItems.length > 0 ? getReadiness(modelItems) : (mr['model_classroom'] ?? null);
  const labReadiness = labItems.length > 0 ? getReadiness(labItems) : (mr['lab'] ?? null);
  const staffReadiness = staffItems.length > 0 ? getReadiness(staffItems) : (mr['staff_room'] ?? null);
  const classroomReadiness = classroomsWithItems.length > 0
    ? getReadiness(classroomsWithItems.flatMap(c => c.items || []))
    : (mr['overall_classroom'] ?? null);

  const allItems = [...modelItems, ...labItems, ...staffItems, ...classroomsWithItems.flatMap(c => c.items || [])];
  const computedReadiness = allItems.length === 0 ? 0 : Math.round((allItems.filter(i => i.status === 'Done' || i.status === 'N/A').length / allItems.length) * 100);

  return {
    ...uni,
    id: uni.id,
    code: uni.code || uni.id,
    name: uni.name,
    location: uni.location || 'TBD',
    targetDate: uni.targetDate || '',
    startDate: uni.startDate || '',
    internalTimeline: uni.internalTimeline || '',
    classCommencementDate: uni.classCommencementDate || '',
    zone_id: uni.zoneId ?? null,
    apmName: uni.apmName || '',
    numClassrooms: uni.numClassrooms || null,
    classroomCapacity: uni.classroomCapacity || null,
    classroomAllocationDone: uni.classroomAllocationDone || false,
    allocationPendingRemarks: uni.allocationPendingRemarks || '',
    studentsCount: uni.studentsCount || null,
    maxStudentsCount: uni.maxStudentsCount || null,
    effortsRequired: uni.effortsRequired || null,
    confidencePercentage: uni.confidencePercentage ?? null,
    probabilityStatus: uni.probabilityStatus || null,
    apmConfidenceDate: uni.apmConfidenceDate || '',
    reminderDays: uni.reminderDays ?? 5,
    lastUpdated: uni.lastUpdated || uni.updatedAt || '',
    priority: uni.priority || 'P2',
    isCritical: uni.isCritical === true,
    modelClassroomTimeline: uni.modelClassroomTimeline || '',
    lab5Timeline: uni.lab5Timeline || '',
    staffRoomTimeline: uni.staffRoomTimeline || '',
    allClassroomsTimeline: uni.allClassroomsTimeline || '',
    overallReadiness: allItems.length > 0 ? computedReadiness : (uni.overallReadiness || 0),
    latestUpdate: uni.updates?.[0]?.content || '',
    latestUpdateTime: uni.updates?.[0]?.createdAt || '',
    riskStatus: uni.riskStatus || 'GREEN',
    isLightData: !uni.spaces || spaces.every(s => !s.checklistStatuses || s.checklistStatuses.length === 0),
    spaceMetrics: {
      'Model Classroom': modelReadiness ?? 0,
      '5.0 Lab': labReadiness ?? 0,
      'Staff Room': staffReadiness ?? 0,
      'All Classrooms': classroomReadiness ?? 0,
    },
    trackers: {
      modelClassroom: { items: modelItems, spaceId: modelSpace?.id, roomNumber: modelSpace?.roomNumber || '', remarks: modelSpace?.remarks || '' },
      lab5: { items: labItems, spaceId: labSpace?.id, roomNumber: labSpace?.roomNumber || '', remarks: labSpace?.remarks || '' },
      staffRoom: { items: staffItems, spaceId: staffSpace?.id, roomNumber: staffSpace?.roomNumber || '', remarks: staffSpace?.remarks || '' },
      overallClassroom: { classrooms: classroomsWithItems },
    },
    classrooms: classroomsWithItems,
    spaces,
    updates: uni.updates || [],
    actionItems: uni.actionItems || [],
  };
}

function updateUniversityChecklistItem(university, statusId, updates) {
  if (!university) return university;
  const updateItems = items => (items || []).map(item =>
    String(item.id) === String(statusId) ? { ...item, ...updates } : item);
  const trackers = university.trackers || {};
  const classrooms = (university.classrooms || []).map(room => ({
    ...room,
    items: updateItems(room.items),
  }));
  return {
    ...university,
    trackers: {
      ...trackers,
      modelClassroom: trackers.modelClassroom
        ? { ...trackers.modelClassroom, items: updateItems(trackers.modelClassroom.items) }
        : trackers.modelClassroom,
      lab5: trackers.lab5
        ? { ...trackers.lab5, items: updateItems(trackers.lab5.items) }
        : trackers.lab5,
      staffRoom: trackers.staffRoom
        ? { ...trackers.staffRoom, items: updateItems(trackers.staffRoom.items) }
        : trackers.staffRoom,
      overallClassroom: trackers.overallClassroom
        ? { ...trackers.overallClassroom, classrooms }
        : trackers.overallClassroom,
    },
    classrooms,
  };
}

export const DataProvider = ({ children }) => {
  const { authFetch, user } = useAuth();
  const [universities, setUniversities] = useState([]);
  const [universityDetails, setUniversityDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pendingFetches = useRef(new Map());
  const detailGenerations = useRef(new Map());
  const universityDetailsRef = useRef({});
  const mutationRevisions = useRef(new Map());
  const pendingUniversityListRef = useRef(null);
  // This is feedback metadata only.  It is deliberately not consulted to
  // skip writes: a later identical draft still goes through the queue.
  const recentRemarkSaves = useRef(new Map());
  const authOwnerRef = useRef(user?.id || user?.email || 'anonymous');

  const normalizeWithDrafts = useCallback(data =>
    applyChecklistDraftsToUniversity(normalizeUniversity(data)), []);

  const commitItemToCache = useCallback((universityId, statusId, updates) => {
    const key = String(universityId);
    mutationRevisions.current.set(key, (mutationRevisions.current.get(key) || 0) + 1);
    setUniversityDetails(previous => {
      if (!previous[key]) return previous;
      const next = {
        ...previous,
        [key]: updateUniversityChecklistItem(previous[key], statusId, updates),
      };
      universityDetailsRef.current = next;
      return next;
    });
    setUniversities(previous => previous.map(university =>
      String(university.id) === key
        ? updateUniversityChecklistItem(university, statusId, updates)
        : university));
  }, []);

  useEffect(() => {
    const owner = user?.id || user?.email || 'anonymous';
    const changedIdentity = authOwnerRef.current !== owner;
    authOwnerRef.current = owner;
    setChecklistDraftOwner(owner);
    if (changedIdentity) {
      pendingFetches.current.forEach((_promise, key) => {
        mutationRevisions.current.set(key, (mutationRevisions.current.get(key) || 0) + 1);
      });
      pendingFetches.current.clear();
      pendingUniversityListRef.current = null;
      universityDetailsRef.current = {};
      recentRemarkSaves.current.clear();
      setUniversityDetails({});
      setUniversities([]);
    }
  }, [user?.id, user?.email]);

  const refreshUniversities = useCallback(async ({ initial = false } = {}) => {
    if (!user) {
      setLoading(false);
      return;
    }
    const ownerAtStart = user?.id || user?.email || 'anonymous';
    const pending = pendingUniversityListRef.current;
    if (pending?.owner === ownerAtStart) {
      if (!initial) return pending.promise;
      setLoading(true);
      return pending.promise.finally(() => {
        if (authOwnerRef.current === ownerAtStart) setLoading(false);
      });
    }
    if (initial) setLoading(true);
    const request = (async () => {
    try {
      const data = await authFetch('/universities', { cache: 'no-store' });
      if (authOwnerRef.current !== ownerAtStart) return;
      setUniversities((data || []).map(normalizeWithDrafts));
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load universities');
    } finally {
      if (initial) setLoading(false);
      if (pendingUniversityListRef.current?.promise === request) pendingUniversityListRef.current = null;
    }
    })();
    pendingUniversityListRef.current = { owner: ownerAtStart, promise: request };
    return request;
  }, [authFetch, normalizeWithDrafts, user]);

  useEffect(() => {
    refreshUniversities({ initial: true });
  }, [refreshUniversities]);

  useEffect(() => {
    if (!user) return undefined;
    let lastRefreshAt = 0;
    let timer = null;
    const refresh = () => {
      if (timer !== null || pendingUniversityListRef.current) return;
      const delay = Math.max(0, 10_000 - (Date.now() - lastRefreshAt));
      timer = window.setTimeout(() => {
        timer = null;
        lastRefreshAt = Date.now();
        refreshUniversities();
      }, delay);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [user, refreshUniversities]);

  const loadUniversityDetail = useCallback(async (id, force = false) => {
    const key = String(id);
    const cached = universityDetailsRef.current[key];
    if (cached && !force && !cached.isLightData) return cached;
    if (pendingFetches.current.has(key) && !force) return pendingFetches.current.get(key);
    const generation = (detailGenerations.current.get(key) || 0) + 1;
    detailGenerations.current.set(key, generation);

    const revisionAtStart = mutationRevisions.current.get(key) || 0;
    const ownerAtStart = authOwnerRef.current;
    const fetchPromise = (async () => {
      try {
        const data = await authFetch(`/universities/${key}`);
        const normalized = normalizeWithDrafts(data);
        if (authOwnerRef.current !== ownerAtStart) {
          return universityDetailsRef.current[key] || normalized;
        }
        // A forced retry or a committed mutation supersedes older fetches.
        if (detailGenerations.current.get(key) !== generation
          || (mutationRevisions.current.get(key) || 0) !== revisionAtStart) {
          return universityDetailsRef.current[key] || normalized;
        }
        setUniversityDetails(prev => {
          const next = { ...prev, [key]: normalized };
          universityDetailsRef.current = next;
          return next;
        });
        setUniversities(prev => prev.map(u => String(u.id) === key ? normalized : u));
        return normalized;
      } catch (err) {
        console.error(`Deep fetch error for ${key}:`, err);
        throw err;
      } finally {
        if (pendingFetches.current.get(key) === fetchPromise) {
          pendingFetches.current.delete(key);
        }
      }
    })();

    pendingFetches.current.set(key, fetchPromise);
    return fetchPromise;
  }, [authFetch, normalizeWithDrafts]);

  const getUniversity = (id) => {
    if (!id) return null;
    const key = String(id);
    if (universityDetails[key]) return universityDetails[key];
    return universities.find(u => u.id === key);
  };

  const addUniversity = async (data) => {
    const uni = await authFetch('/universities', { method: 'POST', body: JSON.stringify({
      name: data.name,
      location: data.location,
      targetDate: data.targetDate,
      zoneId: data.zone_id ? Number(data.zone_id) : null,
      apmName: data.apm_name,
      studentsCount: data.studentsCount ? Number(data.studentsCount) : null,
      effortsRequired: data.effortsRequired || null,
    })});
    const normalized = normalizeUniversity(uni);
    setUniversities(prev => [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name)));
    return normalized;
  };

  const updateUniversity = async (id, trackerName, newData) => {
    const key = String(id);
    const uni = getUniversity(key);
    if (!uni) throw new Error('University not found');

    const spaceTypeMap = {
      modelClassroom: 'model_classroom',
      lab5: 'lab',
      staffRoom: 'staff_room',
    };
    const spaceType = spaceTypeMap[trackerName];

    const saveChecklistItems = async (items) => {
      const intendedStatusIds = items.filter(item => item.id).map(item => item.id);
      const saveableItems = getChecklistDraftSubmissions(key, intendedStatusIds)
        .map(submission => ({
          id: submission.statusId,
          name: submission.label,
          ...submission,
        }));
      const manualStatusIds = new Set(saveableItems.map(item => String(item.id)));
      const resultCounts = {
        writeCount: 0,
        remarkWriteCount: 0,
        nonRemarkWriteCount: 0,
      };
      const result = await runRegisteredBoundedChecklistSaves(
        saveableItems,
        (item, execute) => {
          const saveKey = checklistRemarkSaveKey(key, item.id);
          cancelChecklistRemarkSaveTimer(saveKey);
          // A manual item save owns this snapshot.  Do not let an older
          // autosave marker make a later manual result look like a second
          // remark save.
          recentRemarkSaves.current.delete(saveKey);
          const fields = Object.keys(item.data || {});
          const hasRemark = Object.hasOwn(item.data || {}, 'remarks');
          const hasNonRemark = fields.some(field => field !== 'remarks');
          const payload = {
            ...(Object.hasOwn(item.data, 'status') && {
              currentStatus: item.data.status,
              isBlocker: item.data.status === 'Blocker',
            }),
            ...(Object.hasOwn(item.data, 'remarks') && { remarks: item.data.remarks }),
            ...(Object.hasOwn(item.data, 'photoLink') && { photoUrl: item.data.photoLink }),
            ...(Object.hasOwn(item.data, 'photoContentType') && { photoContentType: item.data.photoContentType }),
            ...(Object.hasOwn(item.data, 'universityTimeline') && { universityTimeline: item.data.universityTimeline }),
            ...(Object.hasOwn(item.data, 'targetDate') && { targetTimeline: item.data.targetDate }),
            ...(Object.hasOwn(item.data, 'itemStartDate') && { itemStartDate: item.data.itemStartDate }),
            ...(Object.hasOwn(item.data, 'itemEndDate') && { itemEndDate: item.data.itemEndDate }),
            ...(Object.hasOwn(item.data, 'actualDate') && { actualCompletionDate: item.data.actualDate }),
            ...(Object.hasOwn(item.data, 'capacity') && { capacity: item.data.capacity }),
          };
          return enqueueChecklistRemarkSave(
            saveKey,
            item.data.remarks,
            () => execute(() => runBoundedChecklistSaveTask(() => authFetch(`/universities/${key}/status/${item.id}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            }), key)).then(saveResult => {
              // Commit while this item's serialized queue slot is still held.
              // A newer save for the same item can then only commit after this
              // snapshot, so a slow sibling item cannot later restore old data.
              commitItemToCache(key, item.id, item.data);
              acknowledgeChecklistDraft(key, item);
              // The manual snapshot is now the latest acknowledged writer.
              // Clear any marker left by an autosave that it followed.
              recentRemarkSaves.current.delete(saveKey);
              resultCounts.writeCount += 1;
              if (hasRemark) resultCounts.remarkWriteCount += 1;
              if (hasNonRemark) resultCounts.nonRemarkWriteCount += 1;
              return saveResult;
            }),
            { coalesce: false },
          );
        },
        // The API serializes checklist mutations per university, so parallel
        // requests add transaction-pool pressure without improving throughput.
        1,
      );
      result.failed.forEach(({ item, error: saveError }) => {
        markChecklistDraftFailed(key, item.id, saveError);
      });
      if (result.failed.length > 0) {
        const saveError = checklistSaveFailureError(result.failed, saveableItems.length);
        throw saveError;
      }
      // A remark can be in flight even when its draft was acknowledged by a
      // separate writer before this manual snapshot was admitted.  Waiting
      // here makes a manual Save truthful without issuing a duplicate PATCH.
      const pendingRemarkWrites = items
        .filter(item => item.id && !manualStatusIds.has(String(item.id)))
        .map(item => {
          const state = getChecklistRemarkSaveState(checklistRemarkSaveKey(key, item.id));
          if (!state?.promise || state.remarks === undefined) return null;
          return state.promise;
        })
        .filter(Boolean);
      await Promise.all(pendingRemarkWrites);
      return resultCounts;
    };

    let committedWrites = 0;
    let remarkWriteCount = 0;
    let nonRemarkWriteCount = 0;
    if (spaceType && newData?.items) {
      const result = await saveChecklistItems(newData.items);
      committedWrites += result.writeCount;
      remarkWriteCount += result.remarkWriteCount;
      nonRemarkWriteCount += result.nonRemarkWriteCount;
    } else if (trackerName === 'overallClassroom' && newData?.classrooms) {
      const result = await saveChecklistItems(newData.classrooms.flatMap(c => c.items || []));
      committedWrites += result.writeCount;
      remarkWriteCount += result.remarkWriteCount;
      nonRemarkWriteCount += result.nonRemarkWriteCount;
    }

    // Save space-level roomNumber and remarks if provided
    if (spaceType && newData?.spaceId && (newData.remarks !== undefined || newData.roomNumber !== undefined)) {
      await authFetch(`/universities/${key}/spaces/${newData.spaceId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(newData.roomNumber !== undefined && { roomNumber: newData.roomNumber }),
          ...(newData.remarks !== undefined && { remarks: newData.remarks }),
        }),
      });
      mutationRevisions.current.set(key, (mutationRevisions.current.get(key) || 0) + 1);
      committedWrites += 1;
      if (newData.remarks !== undefined) remarkWriteCount += 1;
      if (newData.roomNumber !== undefined) nonRemarkWriteCount += 1;
    }

    // An autosave may have completed before the user pressed Save.  Consume
    // only a matching, one-shot feedback marker; this does not affect queue
    // admission or persistence.
    const submittedItems = [
      ...(spaceType && newData?.items ? newData.items : []),
      ...(trackerName === 'overallClassroom' && newData?.classrooms
        ? newData.classrooms.flatMap(classroom => classroom.items || [])
        : []),
    ];
    submittedItems.forEach(item => {
      if (!item?.id || !Object.hasOwn(item, 'remarks')) return;
      const saveKey = checklistRemarkSaveKey(key, item.id);
      const savedRemarks = recentRemarkSaves.current.get(saveKey);
      if (savedRemarks !== undefined && Object.is(savedRemarks, item.remarks)) {
        remarkWriteCount += 1;
        recentRemarkSaves.current.delete(saveKey);
      }
    });

    if (committedWrites === 0) {
      return {
        committed: true,
        refreshed: true,
        university: getUniversity(key),
        writeCount: 0,
        remarkWriteCount,
        nonRemarkWriteCount,
        savedRemarks: remarkWriteCount > 0,
        remarkOnly: remarkWriteCount > 0 && nonRemarkWriteCount === 0,
      };
    }
    try {
      const refreshed = await loadUniversityDetail(key, true);
      return {
        committed: true,
        refreshed: true,
        university: refreshed,
        writeCount: committedWrites,
        remarkWriteCount,
        nonRemarkWriteCount,
        savedRemarks: remarkWriteCount > 0,
        remarkOnly: remarkWriteCount > 0 && nonRemarkWriteCount === 0,
      };
    } catch (refreshError) {
      return {
        committed: true,
        refreshed: false,
        refreshError,
        writeCount: committedWrites,
        remarkWriteCount,
        nonRemarkWriteCount,
        savedRemarks: remarkWriteCount > 0,
        remarkOnly: remarkWriteCount > 0 && nonRemarkWriteCount === 0,
      };
    }
  };

  const updateUniversityMetadata = async (id, data) => {
    const payload = {
      name: data.name,
      location: data.location,
      zoneId: (data.zone_id != null && data.zone_id !== '') ? Number(data.zone_id)
        : (data.zoneId !== undefined ? data.zoneId : undefined),
      apmName: data.apm_name ?? data.apmName,
      targetDate: data.target_date ?? data.targetDate,
      startDate: data.start_date ?? data.startDate,
      internalTimeline: data.internal_timeline ?? data.internalTimeline,
      classCommencementDate: data.class_commencement_date ?? data.classCommencementDate ?? undefined,
      numClassrooms: (data.num_classrooms != null && data.num_classrooms !== '')
        ? Number(data.num_classrooms)
        : (data.numClassrooms !== undefined ? data.numClassrooms : undefined),
      classroomCapacity: (data.classroom_capacity != null && data.classroom_capacity !== '')
        ? Number(data.classroom_capacity)
        : (data.classroomCapacity !== undefined ? data.classroomCapacity : undefined),
      riskStatus: data.risk_status ?? data.riskStatus,
      classroomAllocationDone: data.classroomAllocationDone ?? data.classroom_allocation_done,
      allocationPendingRemarks: data.allocationPendingRemarks ?? data.allocation_pending_remarks,
      studentsCount: data.studentsCount != null && data.studentsCount !== ''
        ? Number(data.studentsCount) : undefined,
      maxStudentsCount: data.maxStudentsCount != null && data.maxStudentsCount !== ''
        ? Number(data.maxStudentsCount) : undefined,
      effortsRequired: data.effortsRequired ?? undefined,
      confidencePercentage: data.confidencePercentage != null && data.confidencePercentage !== ''
        ? Number(data.confidencePercentage) : undefined,
      probabilityStatus: data.probabilityStatus ?? undefined,
      apmConfidenceDate: data.apmConfidenceDate ?? undefined,
      reminderDays: data.reminderDays != null && data.reminderDays !== ''
        ? Number(data.reminderDays) : undefined,
      priority: data.priority ?? undefined,
      modelClassroomTimeline: data.modelClassroomTimeline ?? undefined,
      lab5Timeline: data.lab5Timeline ?? undefined,
      staffRoomTimeline: data.staffRoomTimeline ?? undefined,
      allClassroomsTimeline: data.allClassroomsTimeline ?? undefined,
      infraReadyMonth: data.infraReadyMonth !== undefined ? (data.infraReadyMonth || null) : undefined,
    };
    Object.keys(payload).forEach(k => {
      const v = payload[k];
      if (v === undefined) { delete payload[k]; return; }
      // Allow null through for infraReadyMonth (clears the field) and numeric/boolean fields
      if (v === null && k !== 'infraReadyMonth' && typeof payload[k] !== 'number' && typeof payload[k] !== 'boolean') {
        delete payload[k];
      }
    });

    await authFetch(`/universities/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    // Re-fetch full detail so spaces/trackers/checklist data are preserved in state
    return loadUniversityDetail(id, true);
  };

  const deleteUniversity = async (id) => {
    await authFetch(`/universities/${id}`, { method: 'DELETE' });
    setUniversities(prev => prev.filter(u => u.id !== id));
    setUniversityDetails(prev => {
      const n = { ...prev };
      delete n[id];
      universityDetailsRef.current = n;
      return n;
    });
  };

  const updateUniversityZone = async (uniId, zoneId) => {
    try {
      await authFetch(`/universities/${uniId}`, {
        method: 'PUT',
        body: JSON.stringify({ zoneId: zoneId ? Number(zoneId) : null }),
      });
      setUniversities(prev => prev.map(u => u.id === uniId ? { ...u, zone_id: zoneId ? Number(zoneId) : null } : u));
      return true;
    } catch { return false; }
  };

  const updateUniversityCriticalStatus = async (universityId, isCritical) => {
    const key = String(universityId);
    const updated = await authFetch(`/universities/${key}/critical`, {
      method: 'PATCH',
      body: JSON.stringify({ isCritical }),
    });
    const critical = updated.isCritical === true;
    mutationRevisions.current.set(key, (mutationRevisions.current.get(key) || 0) + 1);
    setUniversities(previous => previous.map(university =>
      String(university.id) === key
        ? { ...university, isCritical: critical, updatedAt: updated.updatedAt ?? university.updatedAt }
        : university,
    ));
    setUniversityDetails(previous => {
      if (!previous[key]) return previous;
      const next = {
        ...previous,
        [key]: {
          ...previous[key],
          isCritical: critical,
          updatedAt: updated.updatedAt ?? previous[key].updatedAt,
        },
      };
      universityDetailsRef.current = next;
      return next;
    });
    return critical;
  };

  const updateUniversityReportPriority = async (universityId, priority) => {
    const key = String(universityId);
    const updated = await authFetch(`/universities/${key}/report-priority`, {
      method: 'PATCH',
      body: JSON.stringify({ priority }),
    });
    mutationRevisions.current.set(key, (mutationRevisions.current.get(key) || 0) + 1);
    const patch = {
      priority: updated.priority,
      isCritical: updated.isCritical === true,
      updatedAt: updated.updatedAt,
    };
    setUniversities(previous => previous.map(university =>
      String(university.id) === key ? { ...university, ...patch } : university,
    ));
    setUniversityDetails(previous => previous[key]
      ? { ...previous, [key]: { ...previous[key], ...patch } }
      : previous);
    return updated;
  };

  const saveClassroom = async (universityId, classroomData) => {
    const result = await authFetch(`/universities/${universityId}/classrooms`, {
      method: 'POST',
      body: JSON.stringify({
        roomId: classroomData.roomId || classroomData.name,
        floor: classroomData.floor,
        capacity: classroomData.capacity,
        timeline: classroomData.timeline,
        driveLink: classroomData.driveLink,
        remarks: classroomData.remarks,
      }),
    });
    await loadUniversityDetail(universityId, true);
    return result;
  };

  const updateClassroom = async (universityId, classroomId, classroomData) => {
    const result = await authFetch(`/universities/${universityId}/classrooms/${classroomId}`, {
      method: 'PUT',
      body: JSON.stringify({
        roomId: classroomData.roomId || classroomData.room_id,
        floor: classroomData.floor,
        capacity: classroomData.capacity,
        timeline: classroomData.timeline,
        driveLink: classroomData.driveLink,
        remarks: classroomData.remarks,
      }),
    });
    await loadUniversityDetail(universityId, true);
    return result;
  };

  const deleteClassroom = async (classroomId, universityId) => {
    await authFetch(`/universities/${universityId}/classrooms/${classroomId}`, { method: 'DELETE' });
    await loadUniversityDetail(universityId, true);
  };

  const resolveClassroomAssociation = async (universityId, classroomId, spaceId) => {
    const selectedSpaceId = spaceId && typeof spaceId === 'object' ? spaceId.spaceId : spaceId;
    if (selectedSpaceId == null || selectedSpaceId === '') {
      const error = new Error('A checklist space is required');
      error.code = 'CLASSROOM_ASSOCIATION_SPACE_REQUIRED';
      throw error;
    }
    const result = await authFetch(
      `/universities/${universityId}/classrooms/${classroomId}/association`,
      { method: 'PUT', body: JSON.stringify({ spaceId: selectedSpaceId }) },
    );
    const refreshed = await loadUniversityDetail(universityId, true);
    return result || refreshed;
  };

  const patchChecklistStatus = useCallback(async (universityId, statusId, data) => {
    const snapshot = checklistApiDataToDraftSnapshot(universityId, statusId, data);
    const save = () => runBoundedChecklistSaveTask(() => authFetch(`/universities/${universityId}/status/${statusId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }), universityId);
    const saveKey = checklistRemarkSaveKey(universityId, statusId);
    if (data?.remarks !== undefined) recentRemarkSaves.current.delete(saveKey);
    if (data?.remarks !== undefined) cancelChecklistRemarkSaveTimer(saveKey);
    const onlyUpdatesRemark = Object.keys(data).every(field => field === 'remarks');
    try {
      const reconcile = result => {
        const localUpdates = {};
        Object.entries({
          currentStatus: 'status',
          remarks: 'remarks',
          photoUrl: 'photoLink',
          photoContentType: 'photoContentType',
          universityTimeline: 'universityTimeline',
          targetTimeline: 'targetDate',
          itemStartDate: 'itemStartDate',
          itemEndDate: 'itemEndDate',
          actualCompletionDate: 'actualDate',
          capacity: 'capacity',
        }).forEach(([apiField, localField]) => {
          if (Object.hasOwn(data, apiField)) localUpdates[localField] = data[apiField];
        });
        acknowledgeChecklistDraft(universityId, snapshot);
        commitItemToCache(universityId, statusId,
          mergeChecklistItemDraft(universityId, { id: statusId, ...localUpdates }));
          if (data?.remarks !== undefined) {
            recentRemarkSaves.current.set(saveKey, data.remarks);
          }
        return result;
      };
      return await enqueueChecklistRemarkSave(
        saveKey,
        data.remarks,
        () => save().then(reconcile),
        { coalesce: onlyUpdatesRemark },
      );
    } catch (saveError) {
      markChecklistDraftFailed(universityId, statusId, saveError);
      throw saveError;
    }
  }, [authFetch, commitItemToCache]);

  const patchChecklistBulk = useCallback(async (universityId, updates) => {
    // Capture the request at admission. Forms can rerender while a busy write
    // is waiting behind another writer; a queued mutation must retain the
    // source snapshot and positional destination ids it was admitted with.
    const payload = updates.map(cloneBulkChecklistUpdate);
    const targetStatusIds = [...new Set(payload.flatMap(update => update.targetStatusIds || []))];
    // A field-scoped prompt may intentionally copy a saved remark while an
    // unrelated local status/date draft is still being saved. The server
    // validates exactly the fields present in this snapshot, so guard source
    // drafts by those same fields rather than treating the whole row as dirty.
    const sourceFieldsByStatusId = new Map();
    payload.forEach(update => {
      const sourceStatusId = update.sourceStatusId == null
        ? null
        : String(update.sourceStatusId);
      if (!sourceStatusId) return;
      const fields = sourceFieldsByStatusId.get(sourceStatusId) || new Set();
      getChecklistDraftFieldsForApiData(update).forEach(field => fields.add(field));
      sourceFieldsByStatusId.set(sourceStatusId, fields);
    });
    const sourceDrafts = [
      ...sourceFieldsByStatusId.entries(),
    ].flatMap(([statusId, fields]) =>
      getPendingChecklistDrafts(universityId, [statusId], [...fields]));
    const targetDrafts = getPendingChecklistDrafts(universityId, targetStatusIds);
    const sourceDraftsWithoutLiveSave = sourceDrafts.filter(draft => (
      !getChecklistRemarkSaveState(
        checklistRemarkSaveKey(universityId, draft.statusId),
      )?.promise
    ));
    const conflictingDrafts = [
      ...targetDrafts,
      ...sourceDraftsWithoutLiveSave,
    ].filter((draft, index, drafts) =>
      drafts.findIndex(candidate =>
        String(candidate.statusId) === String(draft.statusId)) === index,
    );
    const throwDraftConflict = drafts => {
      if (drafts.length === 0) return;
      const conflict = new Error(
        `Bulk apply stopped because ${drafts.map(draft => draft.label).join(', ')} `
        + 'has a pending local edit. Save or retry that draft first.',
      );
      conflict.name = 'ChecklistBulkDraftConflict';
      conflict.code = 'CHECKLIST_BULK_DRAFT_CONFLICT';
      conflict.correlationId = null;
      conflict.conflictingItems = drafts.map(draft => ({
        id: draft.statusId,
        name: draft.label,
      }));
      throw conflict;
    };
    throwDraftConflict(conflictingDrafts);
    const result = await enqueueChecklistBatchSave(
      [
        ...targetStatusIds,
        ...sourceFieldsByStatusId.keys(),
      ].map(statusId => checklistRemarkSaveKey(universityId, statusId)),
      () => {
        // A source writer that was already admitted above is serialized ahead
        // of this callback by the shared per-item queue. Re-read its drafts
        // now: a successful acknowledgement permits this snapshot, while a
        // failed or newer generation remains a real conflict.
        const queuedSourceDrafts = [
          ...sourceFieldsByStatusId.entries(),
        ].flatMap(([statusId, fields]) =>
          getPendingChecklistDrafts(universityId, [statusId], [...fields]));
        throwDraftConflict(queuedSourceDrafts);
        return runBoundedChecklistSaveTask(() => authFetch(`/universities/${universityId}/status/bulk`, {
          method: 'POST',
          body: JSON.stringify({ updates: payload }),
        }), universityId).then(result => {
        for (const acknowledgement of result.results || []) {
          if (!['applied', 'unchanged'].includes(acknowledgement.outcome) || !acknowledgement.row) continue;
          const row = acknowledgement.row;
          const statusId = acknowledgement.statusId;
          commitItemToCache(universityId, statusId, mergeChecklistItemDraft(universityId, {
            id: statusId,
            status: row.isBlocker ? 'Blocker' : row.currentStatus,
            remarks: row.remarks || '',
            photoLink: row.photoUrl || '',
            photoUrl: row.photoUrl || '',
            photoContentType: row.photoContentType || null,
            photoHistory: row.photoHistory || [],
            universityTimeline: row.universityTimeline || '',
            targetDate: row.targetTimeline || '',
            itemStartDate: row.itemStartDate || '',
            itemEndDate: row.itemEndDate || '',
            actualDate: row.actualCompletionDate || '',
            capacity: row.capacity || '',
            lastUpdated: row.updatedAt,
          }));
        }
        return result;
        });
      },
    );
    const key = String(universityId);
    mutationRevisions.current.set(key, (mutationRevisions.current.get(key) || 0) + 1);
    return result;
  }, [authFetch, commitItemToCache]);

  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('niat_token');
    const resp = await fetch('/api/upload', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });
    if (!resp.ok) { const b = await resp.json().catch(() => ({})); throw new Error(b.error || 'Upload failed'); }
    return resp.json();
  };

  const dashboardStats = React.useMemo(() => {
    const totalUniversities = universities.length;
    const avgReadiness = totalUniversities > 0
      ? Math.round(universities.reduce((a, u) => a + (u.overallReadiness || 0), 0) / totalUniversities)
      : 0;
    const statusBreakdown = { Done: 0, 'In-Progress': 0, 'Yet to start': 0, Blocker: 0 };
    universities.forEach(uni => {
      const trackers = uni.trackers || {};
      [trackers.modelClassroom, trackers.lab5, trackers.staffRoom].forEach(t => {
        if (t?.items) t.items.forEach(i => {
          const s = i.status || 'Yet to start';
          statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
        });
      });
    });
    return { totalUniversities, avgReadiness, statusBreakdown };
  }, [universities]);

  return (
    <DataContext.Provider value={{
      universities, universityDetails, loading, error,
      getUniversity, addUniversity, updateUniversity,
      updateUniversityMetadata, saveClassroom, updateClassroom, deleteClassroom, resolveClassroomAssociation,
       deleteUniversity, updateUniversityZone, updateUniversityCriticalStatus, updateUniversityReportPriority,
      loadUniversityDetail, refreshUniversities, dashboardStats, uploadFile, patchChecklistStatus, patchChecklistBulk,
      recordChecklistDraft,
    }}>
      {children}
    </DataContext.Provider>
  );
};
