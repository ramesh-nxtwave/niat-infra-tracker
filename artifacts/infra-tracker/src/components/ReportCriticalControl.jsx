import React, { useRef, useState } from 'react';

export default function ReportCriticalControl({ university, role, onUpdate, onRemoved, onMessage }) {
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  
  // If onMessage is not provided, we fallback to internal state for backwards compatibility
  const [internalMessage, setInternalMessage] = useState('');
  const [internalFailed, setInternalFailed] = useState(false);

  if (role !== 'admin') return null;

  const toggle = async () => {
    if (!university || inFlight.current) return;
    const { id, name, isCritical } = university;
    inFlight.current = true;
    setSaving(true);
    if (onMessage) {
      onMessage('', false);
    } else {
      setInternalMessage('');
      setInternalFailed(false);
    }
    
    try {
      await onUpdate(id, !isCritical);
      const successMsg = `${name} ${isCritical ? 'removed from critical universities' : 'marked as critical'}.`;
      if (onMessage) {
        onMessage(successMsg, false);
      } else {
        setInternalMessage(successMsg);
      }
      if (isCritical) onRemoved(id);
    } catch (error) {
      const errorMsg = error.message || 'Could not update critical status. Please try again.';
      if (onMessage) {
        onMessage(errorMsg, true);
      } else {
        setInternalFailed(true);
        setInternalMessage(errorMsg);
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="critical-control-wrapper">
      <button
        type="button"
        className="button button-secondary"
        disabled={!university || saving}
        aria-pressed={Boolean(university?.isCritical)}
        onClick={toggle}
        title={!university ? 'Select a university first' : undefined}
      >
        {saving ? 'Saving…' : university?.isCritical ? 'Remove critical' : 'Mark as critical'}
      </button>
      {!onMessage && internalMessage && (
        <p className={`critical-control-message ${internalFailed ? 'text-danger' : 'text-success'}`} role={internalFailed ? 'alert' : 'status'}>
          {internalMessage}
        </p>
      )}
    </div>
  );
}