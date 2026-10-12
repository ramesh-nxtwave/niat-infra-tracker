import { supabase } from '../config/supabase';

/**
 * Centralized Audit Logging Utility
 * Records user actions, module affected, and state changes.
 */
export const logAuditAction = async ({
  action,           // 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'
  module,           // 'AccessManagement', 'Checklist', 'University', etc.
  entityId = null,  // The ID of the item being changed
  previousValue = null,
  updatedValue = null
}) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    const { error } = await supabase.from('audit_logs').insert([{
      user_id: user?.id || null,
      user_email: user?.email || 'Anonymous',
      action: action.toUpperCase(),
      module,
      entity_id: entityId ? String(entityId) : null,
      previous_value: previousValue,
      updated_value: updatedValue,
      timestamp: new Date().toISOString()
    }]);

    if (error) {
      console.error('Audit Logging Failed:', error.message);
    }
  } catch (err) {
    console.error('Audit Logging Error:', err);
  }
};
