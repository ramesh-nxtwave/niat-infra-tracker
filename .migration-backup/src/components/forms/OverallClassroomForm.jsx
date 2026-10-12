import React, { useState, useMemo } from 'react';
import { Save, Plus, Trash2, LayoutDashboard, Calendar, FileText, CheckCircle, Clock, AlertTriangle, Link as LinkIcon, Edit2, Check, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import ChecklistSection from './ChecklistSection';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

export default function OverallClassroomForm({ data, universityId, onSave }) {
  const { user } = useAuth();
  const { saveClassroom, deleteClassroom } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const classrooms = useMemo(() => data?.classrooms || [], [data]);

  const [activeRoomId, setActiveRoomId] = useState(classrooms.length > 0 ? classrooms[0].id : null);
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  // Create a new blank classroom registry record
  const [newRoom, setNewRoom] = useState({
    room_id: '', floor: '', capacity: '', timeline: '', drive_link: '', poc_name: '', poc_number: '', remarks: ''
  });

  const activeClassroom = useMemo(() => classrooms.find(c => c.id === activeRoomId) || null, [classrooms, activeRoomId]);

  // Handle local state for the active room's checklist
  const [roomItems, setRoomItems] = useState([]);

  React.useEffect(() => {
    if (activeClassroom) setRoomItems(activeClassroom.items || []);
    else setRoomItems([]);
  }, [activeClassroom]);

  const calculateReadiness = (room) => {
    if (!room || !room.items || room.items.length === 0) return 0;
    const doneCount = room.items.filter(i => i.status === 'Done').length;
    return Math.round((doneCount / room.items.length) * 100);
  };

  const handleCreate = async () => {
    if (!newRoom.room_id) return showToast('Room ID / Name is required', 'warning');
    setSaving(true);
    try {
      const saved = await saveClassroom({ ...newRoom, university_id: String(universityId) });
      if (saved && saved.id) {
        setActiveRoomId(saved.id);
        setIsAdding(false);
        setNewRoom({
          room_id: '', floor: '', capacity: '', timeline: '', drive_link: '', poc_name: '', poc_number: '', remarks: ''
        });
        showToast('✅ Classroom created!', 'success');
      }
    } catch (err) {
      showToast('Failed to create classroom: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateItem = (itemId, updates) => {
    setRoomItems(prev => prev.map(item => item.id === itemId ? { ...item, ...updates } : item));
  };

  const handleSaveChecklist = async () => {
    if (!activeClassroom) return;
    setSaving(true);
    try {
      // We pass the entire classrooms array with updated items for the active room
      const updatedClassrooms = classrooms.map(c =>
        c.id === activeRoomId ? { ...c, items: roomItems } : c
      );
      await onSave({ ...data, classrooms: updatedClassrooms });
      showToast('Classroom checklist saved successfully!', 'success');
    } catch (err) {
      showToast('Failed to save checklist: ' + err.message, 'error');
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

  const categories = [...new Set(roomItems.map(i => i.category))];

  return (
    <div className="fade-in">
      <div className="page-header mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LayoutDashboard size={24} className="text-accent-primary" /> Overall Classrooms
          </h2>
          <p className="text-secondary mt-1 text-sm">Manage multiple classrooms and their detailed readiness.</p>
        </div>
        {!isAdding && (user?.role === 'admin' || user?.role === 'zonal_manager') && (
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
      ) : classrooms.length === 0 ? (
        <div className="text-center p-12 glass-panel" style={{ borderStyle: 'dashed', borderWidth: '2px', borderColor: 'var(--border)' }}>
          <LayoutDashboard size={48} className="text-secondary mx-auto mb-4 opacity-50" />
          <h3 className="font-semibold text-lg mb-2">No classrooms added</h3>
          <p className="text-secondary mb-6 max-w-md mx-auto">Create your first classroom to start tracking detailed infrastructure readiness.</p>
          {(user?.role === 'admin' || user?.role === 'zonal_manager') && (
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

          {/* Checklist Content */}
          {activeClassroom && (
            <div style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', padding: '1rem', background: 'rgba(59,130,246,0.05)', borderRadius: '12px', border: '1px solid rgba(59,130,246,0.1)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <h3 className="font-bold text-xl m-0">{activeClassroom.room_id}</h3>
                  </div>
                  <p className="text-secondary text-sm mt-1 mb-0">
                    {activeClassroom.floor ? `${activeClassroom.floor} · ` : ''}
                    {activeClassroom.capacity ? `${activeClassroom.capacity} seats` : ''}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  {(user?.role === 'admin' || user?.role === 'zonal_manager') && (
                    <button onClick={() => handleDelete(activeRoomId)} className="button button-secondary text-xs" style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}>
                      <Trash2 size={12} /> Delete Room
                    </button>
                  )}
                </div>
              </div>

              {roomItems.length === 0 ? (
                <div className="text-center p-8">
                  <AlertTriangle size={32} className="mx-auto mb-2 text-warning opacity-50" />
                  <p className="text-secondary">No checklist items found for this room. Try creating a new room to initialize items.</p>
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
                      />
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'sticky', bottom: '1rem', zIndex: 10 }}>
                    <button onClick={handleSaveChecklist} disabled={saving} className="button button-primary" style={{ boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                      <Save size={18} /> {saving ? 'Saving...' : `Save ${activeClassroom.room_id} Checklist`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
