import React, { useState, useMemo, useCallback } from 'react';
import { Save, Plus, Trash2, LayoutDashboard, Calendar, FileText, CheckCircle, Clock, AlertTriangle, Link as LinkIcon, Edit2, Check, X, Copy } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import ChecklistSection from './ChecklistSection';
import ItemBulkApplyModal from './ItemBulkApplyModal';
import ModelClassroomForm from './ModelClassroomForm';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  mergeChecklistItemsWithDrafts,
  getChecklistDraftOwner,
  getChecklistDraftVersion,
  getPendingChecklistDrafts,
  recordChecklistDraft,
  subscribeChecklistDrafts,
} from '../../utils/checklistDraftStore';
import { ChecklistSaveFeedback } from './useChecklistFormDraft';
import { MODEL_CLASSROOM_ID } from '../../utils/checklistDestination';

export default function OverallClassroomForm({
  data,
  universityId,
  onSave,
  target,
  onTargetRevealed,
  modelClassroom,
  // `modelData` is accepted as an alias for callers that name the
  // space-level tracker rather than the UI label.
  modelData,
  modelReadiness,
  onModelSave,
  initialClassroomId,
}) {
  const { user } = useAuth();
  const { saveClassroom, updateClassroom, deleteClassroom, resolveClassroomAssociation } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const classrooms = useMemo(() => data?.classrooms || [], [data]);
  const model = modelClassroom || modelData || null;
  const targetIsModel = Boolean(
    target?.modelClassroom
      || target?.isModelClassroom
      || target?.tab === 'model'
      || target?.classroomId === MODEL_CLASSROOM_ID
      || (target?.tab === 'overall' && target?.classroomId == null),
  );

  const initialTargetRoom = target
    ? classrooms.find(room => String(room.id) === String(target.classroomId))
    : null;
  const [activeRoomId, setActiveRoomId] = useState(
    initialClassroomId != null
      ? initialClassroomId
      : targetIsModel
        ? MODEL_CLASSROOM_ID
        : target
          ? (initialTargetRoom?.id ?? null)
          : (classrooms.length > 0 ? classrooms[0].id : null)
  );
  const selectedTargetNavigation = React.useRef({ key: null, applied: false });
  const targetNavigationKey = target?.navigationKey ?? null;
  if (selectedTargetNavigation.current.key !== targetNavigationKey) {
    selectedTargetNavigation.current = { key: targetNavigationKey, applied: false };
  }
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [associationSpaceId, setAssociationSpaceId] = useState('');
  const [associationSaving, setAssociationSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState(null);
  const checklistSubmitting = React.useRef(false);

  // Item copy prompts are queued at the room level so updates committed in
  // different checklist sections can never open competing dialogs.
  const [copyPromptQueue, setCopyPromptQueue] = useState([]);
  const nextCopyPromptId = React.useRef(1);
  const [pendingUploadStates, setPendingUploadStates] = useState({});

  const handleUploadStateChange = useCallback((itemId, hasPendingWork, sourceId = activeRoomId) => {
    if (itemId == null) return;
    const key = `${sourceId == null ? '' : String(sourceId)}:${String(itemId)}`;
    setPendingUploadStates(previous => (
      previous[key] === hasPendingWork
        ? previous
        : { ...previous, [key]: hasPendingWork }
    ));
  }, []);

  // Edit existing classroom metadata
  const [isEditing, setIsEditing] = useState(false);
  const [editRoom, setEditRoom] = useState({ room_id: '', floor: '', capacity: '' });

  // Create a new blank classroom registry record
  const [newRoom, setNewRoom] = useState({
    room_id: '', floor: '', capacity: '', timeline: '', drive_link: '', remarks: ''
  });

  const activeClassroom = useMemo(() => classrooms.find(c => c.id === activeRoomId) || null, [classrooms, activeRoomId]);
  const isAdmin = user?.role === 'admin';
  const associationCandidates = activeClassroom?.associationCandidates || [];

  React.useEffect(() => {
    setAssociationSpaceId(activeClassroom?.spaceId || associationCandidates[0]?.id || '');
  }, [activeClassroom?.id, activeClassroom?.spaceId]);

  const handleResolveAssociation = async () => {
    if (!activeClassroom || !associationSpaceId) return;
    setAssociationSaving(true);
    try {
      await resolveClassroomAssociation(String(universityId), activeClassroom.id, associationSpaceId);
      showToast('Classroom checklist association resolved.', 'success');
    } catch (err) {
      showToast('Failed to resolve classroom association: ' + err.message, 'error');
    } finally {
      setAssociationSaving(false);
    }
  };

  // Handle local state for the active room's checklist
  const [roomItems, setRoomItems] = useState([]);
  const roomItemsRef = React.useRef([]);
  const draftVersion = React.useSyncExternalStore(
    subscribeChecklistDrafts,
    getChecklistDraftVersion,
    () => 0,
  );
  const draftOwnerRef = React.useRef(getChecklistDraftOwner());
  const syncedRoomId = React.useRef(null);
  const authoritativeItemsSignatureRef = React.useRef(null);
  // Detail reloads can reuse a classroom array while replacing an item in
  // that array.  Track the values as well as the array reference so a saved
  // remark that arrives for the active room is not left behind in the local
  // snapshot.
  const authoritativeItemsSignature = JSON.stringify(activeClassroom?.items || []);

  React.useEffect(() => {
    if (!target?.navigationKey) return;
    if (selectedTargetNavigation.current.applied) return;
    if (targetIsModel) {
      selectedTargetNavigation.current.applied = true;
      setActiveRoomId(MODEL_CLASSROOM_ID);
      return;
    }
    const exactRoom = classrooms.find(room => String(room.id) === String(target.classroomId));
    if (!exactRoom) return;

    selectedTargetNavigation.current.applied = true;
    setActiveRoomId(exactRoom.id);
  }, [classrooms, target, targetIsModel]);

  // Summary/deep-link navigation can change the preferred choice while the
  // unified form stays mounted.  Synchronize only when that preference
  // changes; ordinary room clicks remain local browsing state.
  const initialSelectionRef = React.useRef(initialClassroomId);
  React.useEffect(() => {
    if (initialSelectionRef.current === initialClassroomId) return;
    initialSelectionRef.current = initialClassroomId;
    if (initialClassroomId != null) {
      setActiveRoomId(initialClassroomId);
    } else if (!target?.navigationKey) {
      setActiveRoomId(classrooms[0]?.id ?? (model ? MODEL_CLASSROOM_ID : null));
    }
  }, [classrooms, initialClassroomId, model, target]);

  React.useEffect(() => {
    if (!activeClassroom) {
      syncedRoomId.current = null;
      authoritativeItemsSignatureRef.current = null;
      roomItemsRef.current = [];
      setRoomItems([]);
      return;
    }
    const authoritativeItems = activeClassroom.items || [];
    const roomChanged = syncedRoomId.current !== activeClassroom.id;
    const serverItemsChanged = authoritativeItemsSignatureRef.current !== authoritativeItemsSignature;
    if (roomChanged || serverItemsChanged) {
      syncedRoomId.current = activeClassroom.id;
      authoritativeItemsSignatureRef.current = authoritativeItemsSignature;
      // A refresh is authoritative for every field that is not represented
      // by a local draft.  Never carry a non-draft value from the previous
      // roomItemsRef: that was the source of copied rows appearing stale
      // until the form was remounted.
      const nextItems = mergeChecklistItemsWithDrafts(universityId, authoritativeItems);
      roomItemsRef.current = nextItems;
      setRoomItems(nextItems);
    } else if (roomItemsRef.current.length === 0 && (activeClassroom.items || []).length > 0) {
      // A selected room may arrive before its checklist. Hydrate that one
      // delayed payload, but never replace a non-empty local draft on refresh.
      const nextItems = mergeChecklistItemsWithDrafts(universityId, activeClassroom.items);
      authoritativeItemsSignatureRef.current = authoritativeItemsSignature;
      roomItemsRef.current = nextItems;
      setRoomItems(nextItems);
    }
  }, [activeClassroom, authoritativeItemsSignature, universityId]);

  React.useEffect(() => {
    if (!activeClassroom) return;
    const owner = getChecklistDraftOwner();
    const baseItems = draftOwnerRef.current === owner
      ? roomItemsRef.current
      : activeClassroom.items || [];
    draftOwnerRef.current = owner;
    const nextItems = mergeChecklistItemsWithDrafts(universityId, baseItems);
    roomItemsRef.current = nextItems;
    setRoomItems(nextItems);
  }, [activeClassroom, draftVersion, universityId]);

  const calculateReadiness = (room) => {
    if (!room || !room.items || room.items.length === 0) return 0;
    const doneCount = room.items.filter(i => i.status === 'Done' || i.status === 'N/A').length;
    return Math.round((doneCount / room.items.length) * 100);
  };

  const handleCreate = async () => {
    if (!newRoom.room_id) return showToast('Room ID / Name is required', 'warning');
    setSaving(true);
    try {
      const saved = await saveClassroom(String(universityId), {
        roomId: newRoom.room_id,
        floor: newRoom.floor,
        capacity: newRoom.capacity,
        timeline: newRoom.timeline,
        driveLink: newRoom.drive_link,
        remarks: newRoom.remarks,
      });
      if (saved && saved.id) {
        setActiveRoomId(saved.id);
        setIsAdding(false);
        setNewRoom({
          room_id: '', floor: '', capacity: '', timeline: '', drive_link: '', remarks: ''
        });
        showToast('✅ Classroom created!', 'success');
      }
    } catch (err) {
      showToast('Failed to create classroom: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateItem = (itemId, updates, { committed = false } = {}) => {
    const item = roomItemsRef.current.find(candidate => candidate.id === itemId);
    if (item && !committed) recordChecklistDraft(universityId, item, updates);
    const nextItems = roomItemsRef.current.map(candidate =>
      candidate.id === itemId ? { ...candidate, ...updates } : candidate);
    roomItemsRef.current = nextItems;
    setRoomItems(nextItems);
  };

  const handleCopyPrompt = useCallback((item, copyFields, source = {}) => {
    const sourceClassroomId = source.currentClassroomId ?? activeClassroom?.id;
    const sourceClassroomName = source.currentClassroomName ?? activeClassroom?.room_id;
    if (!sourceClassroomId) return;
    setCopyPromptQueue(previous => [
      ...previous,
      {
        promptId: nextCopyPromptId.current++,
        item: { ...item, copyFields: [...copyFields] },
        copyFields: [...copyFields],
        sourceClassroomId,
        sourceClassroomName,
      },
    ]);
  }, [activeClassroom]);

  const handleSaveChecklist = async () => {
    if (!activeClassroom || checklistSubmitting.current) return;
    checklistSubmitting.current = true;
    setSaving(true);
    // Capture the submit payload once.  The whole-room chooser must represent
    // the source that was actually submitted, not drafts typed after the
    // request started or a later draft-store merge.
    const submittedItems = roomItemsRef.current.map(item => ({ ...item }));
    try {
      // Deliberately submit only the selected room. Sending the form's cached
      // copies of every room can overwrite edits made in another room.
      const result = await onSave({
        classrooms: [{ ...activeClassroom, items: submittedItems }],
      });
      const outcome = result === false
        ? { ok: false, error: new Error('Classroom checklist was not saved.') }
        : (result?.ok === false ? result : { ok: true, ...(result || {}) });
      if (!outcome.ok) {
        setSaveFailure(outcome.error || new Error('Classroom checklist was not saved.'));
        return;
      }
      setSaveFailure(null);
      const pendingSourceDrafts = getPendingChecklistDrafts(
        universityId,
        submittedItems.map(item => item.id),
      );
      if (pendingSourceDrafts.length > 0) {
        // A newer edit arrived while the source request was in flight.  Do
        // not open a whole-room copy chooser around the older snapshot; the
        // user must let that generation save (or retry it) first.
        showToast(
          `Classroom saved, but newer edits remain unsaved for ${pendingSourceDrafts.map(draft => draft.label).join(', ')}. `
            + 'Wait for the latest save or retry before continuing.',
          'warning',
        );
        return;
      }
      // Saving a room is deliberately independent from propagation.  Item
      // prompts are raised only after an individual field is committed.
    } catch (err) {
      setSaveFailure(err);
      showToast('Failed to save checklist: ' + err.message, 'error');
    } finally {
      checklistSubmitting.current = false;
      setSaving(false);
    }
  };

  const handleStartEdit = () => {
    if (!activeClassroom) return;
    setEditRoom({
      room_id: activeClassroom.room_id || '',
      floor: activeClassroom.floor || '',
      capacity: activeClassroom.capacity || '',
    });
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!editRoom.room_id) return showToast('Room ID is required', 'warning');
    setSaving(true);
    try {
      await updateClassroom(String(universityId), activeRoomId, {
        roomId: editRoom.room_id,
        floor: editRoom.floor,
        capacity: editRoom.capacity,
      });
      setIsEditing(false);
      showToast('Classroom updated!', 'success');
    } catch (err) {
      showToast('Failed to update: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const isConfirmed = await confirm(
      'Delete Classroom?',
      'This will permanently remove the classroom and all its checklist data. This action cannot be undone.',
      { confirmLabel: 'Delete Room', isDanger: true }
    );
    if (!isConfirmed) return;
    
    try {
      await deleteClassroom(id, universityId);
      if (activeRoomId === id) setActiveRoomId(classrooms.find(c => c.id !== id)?.id || null);
      showToast('Classroom deleted', 'info');
    } catch (err) {
      showToast('Failed to delete: ' + err.message, 'error');
    }
  };

  const handleNewRoomChange = (e) => {
    const { name, value } = e.target;
    setNewRoom(prev => ({ ...prev, [name]: value }));
  };

  const categories = [...roomItems.reduce((map, i) => {
    const cur = map.has(i.category) ? map.get(i.category) : (i.sortOrder ?? 999);
    return map.set(i.category, Math.min(cur, i.sortOrder ?? 999));
  }, new Map()).entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([cat]) => cat);

  return (
    <div className="fade-in">
      <div className="page-header mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LayoutDashboard size={24} className="text-accent-primary" /> All Classrooms
          </h2>
          <p className="text-secondary mt-1 text-sm">Manage multiple classrooms and their detailed readiness.</p>
        </div>
        {!isAdding && (user?.role === 'admin' || user?.role === 'zonal_manager' || user?.role === 'apm') && (
          <button onClick={() => setIsAdding(true)} className="button button-primary">
            <Plus size={16} /> Add Classroom
          </button>
        )}
      </div>

      {isAdding ? (
        <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid var(--accent-primary)' }}>
          <h3 className="font-semibold mb-4 text-accent-primary">Adding New Classroom</h3>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Room ID / Name *</label>
              <input type="text" className="form-input" name="room_id" value={newRoom.room_id} onChange={handleNewRoomChange} placeholder="e.g. Classroom 101" />
            </div>
            <div className="form-group">
              <label className="form-label">Floor</label>
              <input type="text" className="form-input" name="floor" value={newRoom.floor} onChange={handleNewRoomChange} placeholder="e.g. 1st Floor" />
            </div>
            <div className="form-group">
              <label className="form-label">Capacity</label>
              <input type="number" className="form-input" name="capacity" value={newRoom.capacity} onChange={handleNewRoomChange} placeholder="75" />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
            <button type="button" onClick={() => setIsAdding(false)} className="button button-secondary">Cancel</button>
            <button type="button" onClick={handleCreate} disabled={saving} className="button button-primary">
              <Check size={16} /> Create Registry Record
            </button>
          </div>
        </div>
      ) : classrooms.length === 0 && !model ? (
        <div className="text-center p-12 glass-panel" style={{ borderStyle: 'dashed', borderWidth: '2px', borderColor: 'var(--border)' }}>
          <LayoutDashboard size={48} className="text-secondary mx-auto mb-4 opacity-50" />
          <h3 className="font-semibold text-lg mb-2">No classrooms added</h3>
          <p className="text-secondary mb-6 max-w-md mx-auto">Create your first classroom to start tracking detailed infrastructure readiness.</p>
          {(user?.role === 'admin' || user?.role === 'zonal_manager' || user?.role === 'apm') && (
            <button onClick={() => setIsAdding(true)} className="button button-primary">
              <Plus size={16} /> Create Classroom
            </button>
          )}
        </div>
      ) : (
        <div className="glass-panel">
          {/* Tabs header - Improved UI */}
          <div style={{ 
            display: 'flex', 
            borderBottom: '1px solid var(--border)', 
            overflowX: 'auto', 
            background: 'rgba(59,130,246,0.03)',
            padding: '0.5rem 0.5rem 0 0.5rem',
            gap: '0.25rem'
          }}>
            {model && (
              <button
                key={MODEL_CLASSROOM_ID}
                onClick={() => setActiveRoomId(MODEL_CLASSROOM_ID)}
                style={{
                  padding: '0.75rem 1.25rem',
                  background: activeRoomId === MODEL_CLASSROOM_ID ? 'var(--bg-secondary)' : 'transparent',
                  border: '1px solid ' + (activeRoomId === MODEL_CLASSROOM_ID ? 'var(--border)' : 'transparent'),
                  borderBottom: activeRoomId === MODEL_CLASSROOM_ID ? '1px solid var(--bg-secondary)' : 'none',
                  borderRadius: '8px 8px 0 0',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  fontWeight: activeRoomId === MODEL_CLASSROOM_ID ? 700 : 500,
                  color: activeRoomId === MODEL_CLASSROOM_ID ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '-1px',
                  zIndex: activeRoomId === MODEL_CLASSROOM_ID ? 2 : 1,
                }}
              >
                Model Classroom
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '10px',
                  background: activeRoomId === MODEL_CLASSROOM_ID ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                  color: activeRoomId === MODEL_CLASSROOM_ID ? 'white' : 'var(--text-secondary)',
                }}>
                  {(model.items?.length
                    ? calculateReadiness(model)
                    : (modelReadiness ?? model.readiness ?? 0))}%
                </span>
              </button>
            )}
            {classrooms.map(room => (
              <button
                key={room.id}
                onClick={() => setActiveRoomId(room.id)}
                style={{
                  padding: '0.75rem 1.25rem', 
                  background: activeRoomId === room.id ? 'var(--bg-secondary)' : 'transparent',
                  border: '1px solid ' + (activeRoomId === room.id ? 'var(--border)' : 'transparent'),
                  borderBottom: activeRoomId === room.id ? '1px solid var(--bg-secondary)' : 'none',
                  borderRadius: '8px 8px 0 0',
                  cursor: 'pointer', 
                  whiteSpace: 'nowrap',
                  fontWeight: activeRoomId === room.id ? 700 : 500,
                  color: activeRoomId === room.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  transition: 'all 0.2s', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  marginBottom: '-1px',
                  zIndex: activeRoomId === room.id ? 2 : 1
                }}
              >
                {room.room_id || 'Unnamed Room'}
                <span style={{ 
                  fontSize: '0.65rem', 
                  padding: '0.1rem 0.4rem', 
                  borderRadius: '10px', 
                  background: activeRoomId === room.id ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                  color: activeRoomId === room.id ? 'white' : 'var(--text-secondary)'
                }}>
                  {calculateReadiness(room)}%
                </span>
              </button>
            ))}
          </div>

           {/* Model checklist content keeps its space metadata and readiness
               separate from ordinary classroom registry rows. */}
           {activeRoomId === MODEL_CLASSROOM_ID && model ? (
             <div style={{ padding: '1.5rem' }}>
               <ModelClassroomForm
                 universityId={universityId}
                 data={model}
                 classrooms={classrooms}
                 onSave={onModelSave}
                 target={targetIsModel ? target : undefined}
                 onTargetRevealed={onTargetRevealed}
               />
             </div>
           ) : activeClassroom && (
            <div style={{ padding: '1.5rem' }}>
              <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(59,130,246,0.05)', borderRadius: '12px', border: '1px solid rgba(59,130,246,0.1)' }}>
                {isEditing ? (
                  <div>
                    <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--accent-primary)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>Editing Classroom</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.7rem' }}>Room ID / Name *</label>
                        <input type="text" className="form-input" value={editRoom.room_id} onChange={e => setEditRoom(p => ({ ...p, room_id: e.target.value }))} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.7rem' }}>Floor</label>
                        <input type="text" className="form-input" value={editRoom.floor} onChange={e => setEditRoom(p => ({ ...p, floor: e.target.value }))} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.7rem' }}>Capacity (seats)</label>
                        <input type="number" className="form-input" value={editRoom.capacity} onChange={e => setEditRoom(p => ({ ...p, capacity: e.target.value }))} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      <button onClick={() => setIsEditing(false)} className="button button-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.875rem' }}>
                        <X size={13} /> Cancel
                      </button>
                      <button onClick={handleSaveEdit} disabled={saving} className="button button-primary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.875rem' }}>
                        <Check size={13} /> {saving ? 'Saving…' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 className="font-bold text-xl m-0">{activeClassroom.room_id}</h3>
                      <p className="text-secondary text-sm mt-1 mb-0">
                        {activeClassroom.floor ? `${activeClassroom.floor} · ` : ''}
                        {activeClassroom.capacity ? `${activeClassroom.capacity} seats` : ''}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button onClick={handleStartEdit} className="button button-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}>
                        <Edit2 size={12} /> Edit
                      </button>
                      <button onClick={() => handleDelete(activeRoomId)} className="button button-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {roomItems.length === 0 && activeClassroom.associationState
                && activeClassroom.associationState !== 'resolved' ? (
                <div className="text-center p-8">
                  <AlertTriangle size={32} className="mx-auto mb-2 text-warning opacity-50" />
                  <p className="text-secondary">
                    {activeClassroom.associationState === 'ambiguous'
                      ? 'This classroom has an ambiguous checklist association.'
                      : activeClassroom.associationState === 'invalid'
                        ? 'This classroom has an invalid checklist association.'
                        : 'This classroom has no checklist association.'}
                  </p>
                  {isAdmin ? (
                    <div style={{ maxWidth: '34rem', margin: '1rem auto 0', textAlign: 'left' }}>
                      <p className="text-secondary text-sm mb-3">
                        Choose the active overall classroom checklist space to restore this room without recreating it.
                      </p>
                      {associationCandidates.length === 0 ? (
                        <p className="text-secondary text-sm">No active overall classroom checklist spaces are available.</p>
                      ) : (
                        <>
                          <label className="form-label" htmlFor="classroom-association-space">Checklist space</label>
                          <select
                            id="classroom-association-space"
                            className="form-input"
                            value={associationSpaceId}
                            onChange={event => setAssociationSpaceId(event.target.value)}
                          >
                            {associationCandidates.map(candidate => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name} — {candidate.checklistCount} checklist items, {candidate.statusCount} with status
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="button button-primary"
                            style={{ marginTop: '0.75rem' }}
                            disabled={associationSaving || !associationSpaceId}
                            onClick={handleResolveAssociation}
                          >
                            <LinkIcon size={15} /> {associationSaving ? 'Resolving…' : 'Resolve association'}
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-secondary text-sm mt-3">
                      Ask an administrator to resolve this classroom checklist association.
                    </p>
                  )}
                </div>
              ) : roomItems.length === 0 ? (
                <div className="text-center p-8">
                  <AlertTriangle size={32} className="mx-auto mb-2 text-warning opacity-50" />
                  <p className="text-secondary">No checklist items have been configured for this room yet.</p>
                </div>
              ) : (
                <>
                  <div className="mb-8">
                    {categories.map(cat => (
                      <ChecklistSection
                        key={cat}
                        category={cat}
                        items={roomItems}
                        onUpdateItem={handleUpdateItem}
                        universityId={universityId}
                        classrooms={classrooms}
                        currentClassroomId={activeRoomId}
                        currentClassroomName={activeClassroom?.room_id}
                        target={String(target?.classroomId) === String(activeRoomId) ? target : undefined}
                        onTargetRevealed={onTargetRevealed}
                        onUploadStateChange={handleUploadStateChange}
                        onCopyPrompt={handleCopyPrompt}
                        enableItemBulkApply={false}
                      />
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'sticky', bottom: '1rem', zIndex: 10 }}>
                    <div>
                      <ChecklistSaveFeedback error={saveFailure} onRetry={handleSaveChecklist} saving={saving} />
                      <button onClick={handleSaveChecklist} disabled={saving} className="button button-primary" style={{ boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                        <Save size={18} /> {saving ? 'Saving...' : `Save ${activeClassroom.room_id} Checklist`}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {copyPromptQueue[0] && (
        <ItemBulkApplyModal
          key={copyPromptQueue[0].promptId}
          item={copyPromptQueue[0].item}
          universityId={universityId}
          classrooms={classrooms}
          currentClassroomId={copyPromptQueue[0].sourceClassroomId}
          currentClassroomName={copyPromptQueue[0].sourceClassroomName}
          copyFields={copyPromptQueue[0].copyFields}
          pendingUploads={Boolean(
            pendingUploadStates[
              `${copyPromptQueue[0].sourceClassroomId == null ? '' : String(copyPromptQueue[0].sourceClassroomId)}:${String(copyPromptQueue[0].item.id)}`
            ],
          )}
          onClose={() => setCopyPromptQueue(previous => (
            previous[0]?.promptId === copyPromptQueue[0].promptId
              ? previous.slice(1)
              : previous
          ))}
          onApplied={() => setCopyPromptQueue(previous => (
            previous[0]?.promptId === copyPromptQueue[0].promptId
              ? previous.slice(1)
              : previous
          ))}
        />
      )}
    </div>
  );
}
