import React, { useState, useEffect } from 'react';
import { useAuth, ZONES } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { Users, Shield, MapPin, Building2, UserCheck, Mail, Edit, Trash2, Plus, X, Lock } from 'lucide-react';
import { logAuditAction } from '../utils/auditLogger';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

export default function AccessManagement() {
  const { user: currentUser, users, refreshUsers } = useAuth();
  const { universities, loading: dataLoading } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    name: '', email: '', password: '', role: 'apm', zoneIds: '', universityIds: '', is_active: true
  });

  if (currentUser?.role !== 'admin') {
    return (
      <div className="app-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Shield size={48} className="text-danger mb-4" />
        <h2 className="text-xl font-bold">Unauthorized Access</h2>
        <p className="text-secondary">Only system administrators can access personnel management.</p>
      </div>
    );
  }

  const getZoneName = (zoneIds, legacyZoneId) => {
    const zones = zoneIds || (legacyZoneId ? [legacyZoneId] : []);
    if (zones.length === 0) return 'No Zones Assigned';
    return zones.map(id => ZONES[id]?.name?.split('—')[0]?.trim() || `Zone ${id}`).join(', ');
  };
  
  const getUniNames = (ids) => {
    if (!ids || ids.length === 0) return 'No Universities Assigned';
    return ids.map(id => {
      const uni = universities.find(u => String(u.id) === String(id));
      return uni ? uni.name : `Uni ID: ${id}`;
    }).join(', ');
  };

  const handleOpenModal = (user = null) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name || '',
        email: user.email || '',
        password: '', // Don't show existing password
        role: user.role || 'apm',
        zoneIds: user.zone_ids ? user.zone_ids.join(', ') : '',
        universityIds: user.university_ids ? user.university_ids.join(', ') : '',
        is_active: user.is_active !== false
      });
    } else {
      setEditingUser(null);
      setFormData({ name: '', email: '', password: '', role: 'apm', zoneIds: '', universityIds: '', is_active: true });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: formData.name,
      email: formData.email,
      role: formData.role,
      is_active: formData.is_active,
      zone_ids: formData.role === 'zonal_manager' 
        ? (Array.isArray(formData.zoneIds) ? formData.zoneIds : String(formData.zoneIds).split(',')).map(id => Number(id)).filter(id => !isNaN(id))
        : [],
      university_ids: formData.role === 'apm'
        ? (Array.isArray(formData.universityIds) ? formData.universityIds : String(formData.universityIds).split(',')).map(id => String(id).trim()).filter(id => id !== '')
        : []
    };

    try {
      const { supabase } = await import('../config/supabase');
      const { data: { session } } = await supabase.auth.getSession();
      
      let response;
      if (editingUser) {
        // Update user via Admin API to sync metadata + personnel record
        response = await fetch('/api/update-user', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            id: editingUser.id,
            ...payload
          })
        });

        await logAuditAction({
          action: 'UPDATE_USER',
          module: 'AccessManagement',
          entityId: editingUser.id,
          previousValue: editingUser,
          updatedValue: payload
        });
      } else {
        // Create user via Admin API
        response = await fetch('/api/create-user', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            ...payload,
            password: formData.password
          })
        });

        await logAuditAction({
          action: 'CREATE_USER',
          module: 'AccessManagement',
          entityId: payload.email,
          updatedValue: payload
        });
      }

      const apiResult = await response.json();
      if (!response.ok) throw new Error(apiResult.error || `Failed to ${editingUser ? 'update' : 'create'} user via Admin API`);
      
      showToast(`User ${editingUser ? 'updated' : 'created'} successfully`, 'success');
      
      // If updating SELF, warn about re-login
      if (editingUser?.id === currentUser?.id && payload.role !== currentUser?.role) {
        showToast('Your role has changed. Please log out and back in to apply changes.', 'warning');
      }

      await refreshUsers();
      handleCloseModal();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error saving user', 'error');
    }
  };

  const handleDelete = async (id) => {
    const isConfirmed = await confirm(
      'Delete Personnel Record?',
      'This will remove the user from the directory and assignments. (Note: Login account must be deleted manually in Supabase Auth)',
      { confirmLabel: 'Delete Record', isDanger: true }
    );
    if (!isConfirmed) return;

    try {
      const { supabase } = await import('../config/supabase');
      const { error } = await supabase
        .from('personnel')
        .delete()
        .eq('id', id);
        
      if (!error) {
        await logAuditAction({
          action: 'DELETE',
          module: 'AccessManagement',
          entityId: id
        });
        await refreshUsers();
        showToast('Personnel record removed', 'info');
      } else {
        throw error;
      }
    } catch (err) {
      console.error(err);
      showToast('Error deleting record: ' + err.message, 'error');
    }
  };

  return (
    <div className="app-container fade-in pb-20">
      <div className="page-header mb-8">
        <div className="page-header-column">
          <h1 className="page-title text-gradient">Access Management</h1>
          <p className="page-subtitle">Configure role-based visibility and personnel assignments.</p>
        </div>
        <div className="header-actions">
          <button className="button button-primary" onClick={() => handleOpenModal()}>
            <Plus size={16} /> Add User
          </button>
        </div>
      </div>

      <div className="glass-panel p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-accent-primary/10 rounded-lg text-accent-primary">
            <Users size={24} />
          </div>
          <h2 className="text-xl font-bold">User Directory & Assignments</h2>
        </div>

        <div className="table-container overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>Personnel</th>
                <th>Role</th>
                <th>Access Scope</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="table-row-hover">
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '2.5rem', height: '2.5rem', borderRadius: '50%', backgroundColor: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', fontWeight: 'bold', border: '1px solid var(--border)' }}>
                        {user.name ? user.name.charAt(0) : '?'}
                      </div>
                      <div>
                        <p className="font-bold m-0" style={{ color: 'var(--text-primary)', marginBottom: '0.25rem' }}>{user.name}</p>
                        <p className="text-secondary text-xs m-0" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Mail size={10} /> {user.email}
                        </p>
                        {user.last_sign_in_at && (
                          <p className="text-secondary italic" style={{ fontSize: '0.65rem', marginTop: '0.1rem' }}>
                            Last login: {new Date(user.last_sign_in_at).toLocaleString()}
                          </p>
                        )}
                        {user.password && user.password !== '' && (
                          <p className="text-accent-primary font-mono" style={{ fontSize: '0.7rem', marginTop: '0.25rem', background: 'var(--bg-primary)', padding: '0.1rem 0.4rem', borderRadius: '4px', width: 'fit-content', border: '1px solid var(--border)' }}>
                            <Lock size={10} style={{ display: 'inline', marginRight: '4px' }} /> {user.password}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${
                      user.role === 'admin' ? 'badge-danger' : 
                      user.role === 'zonal_manager' ? 'badge-warning' : 
                      'badge-neutral'
                    }`}>
                      {user.role ? user.role.replace('_', ' ').toUpperCase() : 'UNKNOWN'}
                    </span>
                    <div style={{ marginTop: '0.25rem' }}>
                      <span className={`badge ${user.is_active !== false ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.6rem', padding: '0.1rem 0.4rem' }}>
                        {user.is_active !== false ? 'ACTIVE' : 'DEACTIVATED'}
                      </span>
                    </div>
                  </td>
                  <td>
                    {user.role === 'admin' && (
                      <div className="text-success text-sm font-semibold" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Shield size={14} /> Full System Access
                      </div>
                    )}
                    {user.role === 'zonal_manager' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <div className="text-sm font-medium" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <MapPin size={14} className="text-accent-primary" /> {getZoneName(user.zone_ids, user.zoneId)}
                        </div>
                        <p className="text-secondary font-bold uppercase tracking-wider" style={{ fontSize: '0.65rem', paddingLeft: '1.5rem', margin: 0 }}>
                          All institutions in region
                        </p>
                      </div>
                    )}
                    {user.role === 'apm' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <div className="text-sm font-medium" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Building2 size={14} className="text-accent-primary" /> 
                          {user.university_ids?.length || 0} Universities
                        </div>
                        <p className="text-secondary italic" style={{ fontSize: '0.7rem', paddingLeft: '1.5rem', margin: 0 }}>
                          {getUniNames(user.university_ids)}
                        </p>
                      </div>
                    )}
                    {user.role === 'ops' && (
                      <p className="text-sm text-secondary">On-Ground Field Access</p>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <button className="button button-secondary" style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => handleOpenModal(user)} title="Edit User">
                        <Edit size={16} />
                      </button>
                      <button className="button button-secondary text-danger" style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderColor: 'rgba(239,68,68,0.2)' }} onClick={() => handleDelete(user.id)} title="Delete User">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan="4" className="text-center p-4">No users found. Please refresh.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CRUD Modal */}
      {isModalOpen && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '5rem', overflowY: 'auto' }}>
          <div className="glass-panel fade-in" style={{ background: 'var(--bg-secondary)', position: 'relative', width: '100%', maxWidth: '42rem', margin: '0 1rem 3rem 1rem', padding: '2rem', borderRadius: '24px' }}>
            <button onClick={handleCloseModal} style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} className="text-secondary" /></button>
            
            <h2 className="text-xl font-bold" style={{ marginBottom: '1.5rem', paddingRight: '2rem' }}>{editingUser ? 'Edit Personnel' : 'Add New Personnel'}</h2>
            
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input type="text" className="form-input" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" className="form-input" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-select" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                    <option value="apm">APM (University Level)</option>
                    <option value="zonal_manager">Zonal Manager (Zone Level)</option>
                    <option value="admin">Admin (Full Access)</option>
                    <option value="ops">Ops (Field Access)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input type="text" className="form-input" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} placeholder="e.g. User123!" />
                  <p className="text-secondary" style={{ fontSize: '0.65rem', marginTop: '0.25rem' }}>
                    {editingUser ? 'Warning: Changing this will NOT update their login password, only the directory reference.' : 'This will be used for their initial login.'}
                  </p>
                </div>
                {editingUser && (
                  <div className="form-group">
                    <label className="form-label">Account Status</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border)', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={formData.is_active} 
                        onChange={e => setFormData({...formData, is_active: e.target.checked})}
                        style={{ width: '18px', height: '18px', accentColor: 'var(--accent-primary)' }}
                      />
                      <span className="font-bold" style={{ color: formData.is_active ? 'var(--text-success)' : 'var(--text-danger)' }}>
                        {formData.is_active ? 'Active Account' : 'Deactivated / Suspended'}
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {formData.role === 'zonal_manager' && (
                <div className="form-group">
                  <label className="form-label">Assigned Zones</label>
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.5rem', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {Object.entries(ZONES).map(([id, z]) => {
                      const idStr = String(id);
                      const idsString = String(formData.zoneIds || '');
                      const selectedIds = idsString.split(',').map(id => id.trim()).filter(Boolean);
                      const isSelected = selectedIds.includes(idStr);
                      
                      const handleToggle = () => {
                        let newIds;
                        if (isSelected) {
                          newIds = selectedIds.filter(val => val !== idStr);
                        } else {
                          newIds = [...selectedIds, idStr];
                        }
                        setFormData({ ...formData, zoneIds: newIds.join(', ') });
                      };

                      return (
                        <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.2s', background: isSelected ? 'var(--bg-secondary)' : 'transparent' }} className="hover:bg-white/50">
                          <input 
                            type="checkbox" 
                            checked={isSelected}
                            onChange={handleToggle}
                            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent-primary)' }}
                          />
                          <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1 }}>{z.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {formData.role === 'apm' && (
                <div className="form-group">
                  <label className="form-label">Assigned Universities</label>
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.5rem', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {dataLoading ? (
                      <p className="text-secondary text-sm p-2 text-center flex items-center justify-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent-primary"></div>
                        Loading universities...
                      </p>
                    ) : (
                      <>
                        {universities.map(uni => {
                          const idStr = String(uni.id);
                          const idsString = String(formData.universityIds || '');
                          const selectedIds = idsString.split(',').map(id => id.trim()).filter(Boolean);
                          const isSelected = selectedIds.includes(idStr);
                          
                          const handleToggle = () => {
                            let newIds;
                            if (isSelected) {
                              newIds = selectedIds.filter(id => id !== idStr);
                            } else {
                              newIds = [...selectedIds, idStr];
                            }
                            setFormData({ ...formData, universityIds: newIds.join(', ') });
                          };

                          return (
                            <label key={uni.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.2s', background: isSelected ? 'var(--bg-secondary)' : 'transparent' }} className="hover:bg-white/50">
                              <input 
                                type="checkbox" 
                                checked={isSelected}
                                onChange={handleToggle}
                                style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent-primary)' }}
                              />
                              <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1 }}>{uni.name}</span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)' }}>ID: {uni.id}</span>
                            </label>
                          );
                        })}
                        {(!universities || universities.length === 0) && (
                          <p className="text-secondary text-sm p-2 text-center">No universities available.</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" className="button button-secondary" onClick={handleCloseModal}>Cancel</button>
                <button type="submit" className="button button-primary">Save User</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
