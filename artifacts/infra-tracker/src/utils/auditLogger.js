const TOKEN_KEY = 'niat_token';

export const logAuditAction = async ({
  action,
  module,
  entityId = null,
  previousValue = null,
  updatedValue = null,
}) => {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: action.toUpperCase(),
        module,
        entityId: entityId ? String(entityId) : null,
        previousValue,
        updatedValue,
      }),
    });
  } catch (err) {
    console.warn('Audit log failed (non-fatal):', err.message);
  }
};
