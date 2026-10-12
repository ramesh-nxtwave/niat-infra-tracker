import React, { useRef, useState } from 'react';

export const REPORT_PRIORITY_OPTIONS = [
  { value: 'CRITICAL', label: 'Critical', color: '#991b1b', background: '#fee2e2' },
  { value: 'MEDIUM', label: 'Medium Priority', color: '#92400e', background: '#fef3c7' },
  { value: 'LOW', label: 'Low Priority', color: '#166534', background: '#dcfce7' },
  { value: 'NA', label: 'NA', color: '#475569', background: '#f1f5f9' },
];

export function reportUniversityPriority(university) {
  if (university?.isCritical) return 'CRITICAL';
  const value = String(university?.priority || 'NA').trim().toUpperCase();
  return { P1: 'CRITICAL', P2: 'MEDIUM', P3: 'LOW' }[value] || value;
}

export default function ReportPriorityControl({ university, role, onUpdate, onMessage }) {
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  if (role !== 'admin') return null;

  const currentPriority = reportUniversityPriority(university);
  const update = async (priority) => {
    if (!university || inFlight.current || priority === currentPriority) return;
    inFlight.current = true;
    setSaving(true);
    onMessage?.('', false);
    try {
      await onUpdate(university.id, priority);
      const label = REPORT_PRIORITY_OPTIONS.find(option => option.value === priority)?.label || priority;
      onMessage?.(`${university.name} categorized as ${label}.`, false);
    } catch (error) {
      onMessage?.(error.message || 'Could not update the university category. Please try again.', true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <fieldset className="report-priority-control" disabled={!university || saving}>
      <legend>University category</legend>
      <div className="report-priority-options">
        {REPORT_PRIORITY_OPTIONS.map(option => {
          const selected = currentPriority === option.value;
          return (
            <label
              key={option.value}
              className={selected ? 'is-selected' : ''}
              style={{
                '--priority-color': option.color,
                '--priority-background': option.background,
              }}
            >
              <input
                type="radio"
                name="universityReportPriority"
                value={option.value}
                checked={selected}
                onChange={() => update(option.value)}
              />
              <span className="report-priority-indicator" aria-hidden="true" />
              <span>{option.label}</span>
              {selected && <span className="report-priority-selected" aria-hidden="true">Selected</span>}
            </label>
          );
        })}
      </div>
      <small>
        {!university
          ? 'Select a university first.'
          : saving
            ? 'Saving category…'
            : `${REPORT_PRIORITY_OPTIONS.find(option => option.value === currentPriority)?.label || 'NA'} is selected. Used by report filtering.`}
      </small>
    </fieldset>
  );
}