import React, { useEffect, useState, useRef } from 'react';
import { X, Mail, AlertTriangle, CheckCircle2, Info, FileText, Clock, AlertOctagon } from 'lucide-react';
import { reportRemarkEntries } from '../utils/reportRemarks';

const validRecipient = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function normalizePreviewText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizePreviewLookup(value) {
  return normalizePreviewText(value).toLocaleLowerCase().replace(/_/g, ' ');
}

function normalizePreviewStatus(status, isBlocker) {
  const normalized = normalizePreviewLookup(status);
  if (isBlocker || normalized === 'blocker') return 'Blocker';
  if (normalized === 'in-progress' || normalized === 'in progress') return 'In-Progress';
  if (normalized === 'partially done' || normalized === 'partial done') return 'Partially Done';
  if (normalized === 'yet to start') return 'Yet to start';
  return normalizePreviewText(status) || 'Unknown';
}

function previewStatusStyle(status, isBlocker) {
  const normalized = normalizePreviewStatus(status, isBlocker);
  if (normalized === 'Blocker') return { color: '#b91c1c', background: '#fef2f2' };
  if (normalized === 'In-Progress') return { color: '#1d4ed8', background: '#eff6ff' };
  if (normalized === 'Partially Done') return { color: '#6d28d9', background: '#f5f3ff' };
  if (normalized === 'Yet to start') return { color: '#92400e', background: '#fffbeb' };
  return { color: '#475569', background: '#f1f5f9' };
}

function classifyPreviewArea(value) {
  const normalized = normalizePreviewLookup(value);
  if ([
    'classrooms',
    'classroom',
    'model classroom',
    'all classrooms',
    'overall classroom',
    'cr',
  ].includes(normalized)) return 'classrooms';
  if (['lab', 'labs', '5.0 lab', 'lab room'].includes(normalized)) return 'lab';
  if (['staff', 'staff room'].includes(normalized)) return 'staff';
  if (normalized === 'other' || normalized === 'other areas') return 'other';
  return null;
}

const REPORT_SECTIONS = [
  { key: 'classrooms', label: 'CR (Classrooms)' },
  { key: 'lab', label: 'Lab Room' },
  { key: 'staff', label: 'Staff Room' },
  { key: 'dailyRemarks', label: 'Daily Remarks' },
];

const PRIORITY_OPTIONS = [
  { key: 'ALL', label: 'All Priorities', color: '#334155', background: '#e2e8f0' },
  { key: 'CRITICAL', label: 'Critical', color: '#991b1b', background: '#fee2e2' },
  { key: 'MEDIUM', label: 'Medium Priority', color: '#92400e', background: '#fef3c7' },
  { key: 'LOW', label: 'Low Priority', color: '#166534', background: '#dcfce7' },
  { key: 'NA', label: 'NA', color: '#475569', background: '#f1f5f9' },
];

function normalizePreviewSections(value) {
  if (value === undefined || value === null) {
    return REPORT_SECTIONS.map(section => section.key);
  }
  if (!Array.isArray(value) || value.length === 0) return [];
  const selected = new Set(value.map(section => {
    const normalized = normalizePreviewLookup(section);
    return normalized === 'daily remarks' || normalized === 'dailyremarks'
      ? 'dailyRemarks'
      : classifyPreviewArea(section);
  }).filter(Boolean));
  return REPORT_SECTIONS.map(section => section.key).filter(key => selected.has(key));
}

function previewSelectedSections(preview) {
  return normalizePreviewSections(preview?.sections);
}

function previewAreaGroup(item) {
  // roomGroup is the report contract. Fall back to space/area for previews
  // captured before the room-group field was added.
  const roomGroup = normalizePreviewText(item?.roomGroup);
  const directGroup = classifyPreviewArea(roomGroup);
  if (roomGroup && directGroup) return directGroup;
  return classifyPreviewArea(item?.space || item?.area) || 'other';
}

function previewSectionDataState(university, sectionKey) {
  const states = university?.sectionDataStates;
  if (states && typeof states === 'object' && !Array.isArray(states)) {
    const stateKey = Object.keys(states).find(key => normalizePreviewLookup(key) === sectionKey);
    const state = stateKey ? normalizePreviewLookup(states[stateKey]) : '';
    if (state === 'available' || state === 'missing') return state;
    return 'unknown';
  }

  // Legacy previews only have a university-level missing state. Preserve
  // that known signal, but do not infer that an available university has
  // complete data for each of the newly displayed sections.
  return normalizePreviewLookup(university?.checklistDataState) === 'missing'
    ? 'missing'
    : 'unknown';
}

function previewEmptySectionMessage(state) {
  if (state === 'missing') return 'Checklist data is missing; this section is not described as complete.';
  if (state === 'available') return 'No pending items reported.';
  return 'No pending items in reviewed data; completeness not established.';
}

function previewDate(value) {
  const source = value instanceof Date ? value.toISOString() : normalizePreviewText(value);
  if (!source) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(source) ? `${source}T00:00:00.000Z` : source);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatPreviewDate(value) {
  const parsed = previewDate(value);
  if (!parsed) return normalizePreviewText(value) || '—';
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatPreviewGeneratedAt(value) {
  const parsed = previewDate(value);
  if (!parsed) return 'Not provided';
  const date = parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return `${date}, ${time} UTC`;
}

function previewItemLocation(item) {
  return normalizePreviewText(item.areaLabel)
    || normalizePreviewText(item.classroomName)
    || `${normalizePreviewText(item.space)}${normalizePreviewText(item.classroom) ? ` — ${normalizePreviewText(item.classroom)}` : ''}`;
}

function previewItemLineItem(item) {
  return normalizePreviewText(item.item || item.lineItem) || 'Unnamed item';
}

function previewItemTimeline(item) {
  const value = item.timeline || item.targetDate;
  return value ? formatPreviewDate(value) : 'Not provided';
}

function previewItemRemark(item) {
  const entries = reportRemarkEntries(item);
  if (!entries.length) return '—';
  return entries.map(entry => entries.length > 1
    ? `${entry.labels.join(', ')}: ${entry.text}`
    : entry.text).join(' | ');
}

function previewItemRemarkDate(item) {
  const entries = reportRemarkEntries(item);
  if (!entries.length) return '—';
  return entries.map(entry => {
    const date = entry.remarkDate ? formatPreviewDate(entry.remarkDate) : 'Not provided';
    return entries.length > 1 ? `${entry.labels.join(', ')}: ${date}` : date;
  }).join(' | ');
}

function previewItemAttachments(item) {
  return Array.isArray(item.attachments) ? item.attachments : [];
}

function PreviewItemTable({ items, university, selectedSections, showOther = false }) {
  const grouped = { classrooms: [], lab: [], staff: [], other: [] };
  (Array.isArray(items) ? items : []).forEach(item => {
    const group = previewAreaGroup(item);
    if (selectedSections.includes(group) || (showOther && group === 'other')) {
      grouped[group].push(item);
    }
  });

  const sections = [
    { key: 'classrooms', label: 'CR (Classrooms)', legacyLabel: 'Classrooms', items: grouped.classrooms },
    { key: 'lab', label: 'Lab Room', items: grouped.lab },
    { key: 'staff', label: 'Staff Room', items: grouped.staff },
    { key: 'other', label: 'Other Areas', items: grouped.other },
  ].filter(section => selectedSections.includes(section.key) || (
    section.key === 'other' && section.items.length > 0 && showOther
  ));

  return (
    <div className="table-responsive" style={{ overflowX: 'auto', margin: '0.75rem 0', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
      <table className="data-table daily-report-table" style={{ margin: 0, minWidth: '600px', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ background: 'var(--bg-secondary)' }}>
            <th style={{ padding: '0.5rem 0.75rem' }}>Location</th>
            <th style={{ padding: '0.5rem 0.75rem' }}>Line Item</th>
            <th style={{ padding: '0.5rem 0.75rem', width: '140px' }}>Status</th>
            <th style={{ padding: '0.5rem 0.75rem', width: '140px' }}>Timeline</th>
            <th style={{ padding: '0.5rem 0.75rem' }}>Line Item Remark</th>
            <th style={{ padding: '0.5rem 0.75rem', width: '130px' }}>Remark Date</th>
            <th style={{ padding: '0.5rem 0.75rem', width: '130px' }}>Attachment</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section, sIdx) => {
            const startsGroup = sIdx > 0;
            const dataState = section.key === 'other'
              ? null
              : previewSectionDataState(university, section.key);
            const itemKeys = new Map();
            return (
              <React.Fragment key={section.key}>
                <tr className={`daily-area-group daily-area-${section.key}${startsGroup ? ' daily-area-group-start' : ''}`}>
                  <td colSpan="7" style={{ padding: '0.5rem 0.75rem', fontWeight: 700, fontSize: '0.85em', borderBottom: '1px solid var(--border-color)', opacity: 0.9 }}>
                    <div>
                      {section.label} ({section.items.length})
                      {section.legacyLabel && (
                        <span style={{ display: 'none' }}> {section.legacyLabel} ({section.items.length})</span>
                      )}
                    </div>
                    {section.items.length === 0 && (
                      <div style={{ marginTop: '0.25rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                        {previewEmptySectionMessage(dataState)}
                      </div>
                    )}
                    {section.items.length > 0 && dataState === 'missing' && (
                      <div style={{ marginTop: '0.25rem', fontWeight: 400, color: '#92400e' }}>
                        {previewEmptySectionMessage(dataState)}
                      </div>
                    )}
                  </td>
                </tr>
                {section.items.map((item, idx) => (
                  <tr
                    key={(() => {
                      const base = normalizePreviewText(item.id) ? `id-${normalizePreviewText(item.id)}` : `index-${idx}`;
                      const occurrence = itemKeys.get(base) || 0;
                      itemKeys.set(base, occurrence + 1);
                      return `${section.key}-${base}-${occurrence}`;
                    })()}
                    className={`daily-area-group daily-area-${section.key}`}
                  >
                    <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{previewItemLocation(item)}</div>
                      <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                        {item.roomGroup
                          ? normalizePreviewText(item.space || item.roomGroup)
                          : `${normalizePreviewText(item.category)} • ${normalizePreviewText(item.space || item.roomGroup)}`}
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600 }}>{previewItemLineItem(item)}</div>
                    </td>
                    <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                      <span className="daily-status" style={previewStatusStyle(item.status, item.isBlocker)}>{normalizePreviewStatus(item.status, item.isBlocker)}</span>
                      {(item.isBlocker || item.isOverdue) && (
                        <div style={{ display: 'flex', gap: '4px', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          {item.isBlocker && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '0.75rem', fontWeight: 600, color: '#b91c1c', background: '#fef2f2', padding: '2px 6px', borderRadius: '4px' }}><AlertOctagon size={10}/> Blocker</span>}
                          {item.isOverdue && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '0.75rem', fontWeight: 600, color: '#b45309', background: '#fffbeb', padding: '2px 6px', borderRadius: '4px' }}><Clock size={10}/> Overdue</span>}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 500 }}>{previewItemTimeline(item)}</div>
                    </td>
                    <td style={{ padding: '0.75rem', verticalAlign: 'top', whiteSpace: 'normal', minWidth: '150px' }}>
                      {previewItemRemark(item)}
                    </td>
                    <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>{previewItemRemarkDate(item)}</td>
                    <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                      {previewItemAttachments(item).length ? previewItemAttachments(item).map((attachment, attachmentIndex) => (
                        <a
                          key={`${normalizePreviewText(attachment.id) || 'attachment'}-${attachmentIndex}`}
                          href={`/university/${encodeURIComponent(university.id)}?item=${encodeURIComponent(normalizePreviewText(attachment.sourceStatusId) || normalizePreviewText(attachment.id))}`}
                          style={{ display: 'block', marginBottom: '0.25rem' }}
                        >
                          View attachment {attachmentIndex + 1}
                          {attachment.uploadedAt && <small style={{ display: 'block', color: 'var(--text-secondary)' }}>{formatPreviewDate(attachment.uploadedAt)}</small>}
                        </a>
                      )) : <span style={{ color: 'var(--text-secondary)' }}>None</span>}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SendReportDialog({ onClose, authFetch, user, universities = [], currentUniversityId }) {
  const [setup, setSetup] = useState(true);
  const [emails, setEmails] = useState([
    'karthik@nxtwave.tech',
    'Varshith@nxtwave.tech',
    'satish.jada@nxtwave.co.in',
    'srinivas.vatturi@nxtwave.tech',
    'ramesh@nxtwave.co.in',
  ]);
  const [selectedUniIds, setSelectedUniIds] = useState(() => currentUniversityId ? [currentUniversityId] : []);
  const [newEmail, setNewEmail] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('ALL');
  const [selectedSections, setSelectedSections] = useState(() => REPORT_SECTIONS.map(section => section.key));

  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState('loading'); // loading, preview, sending, success, error, expired
  const [errorMessage, setErrorMessage] = useState('');
  const [sendResult, setSendResult] = useState(null);
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const attemptedRef = useRef(false);

  const [scopeMode, setScopeMode] = useState(currentUniversityId ? 'selected' : 'all');

  // Close immediately if role changes to non-admin
  useEffect(() => {
    if (user && user.role !== 'admin') {
      onClose();
    }
  }, [user, onClose]);

  // Focus trap
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    if (dialogRef.current) {
      dialogRef.current.focus();
    }
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && status !== 'sending') {
      onClose();
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const focusableElements = dialogRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      // If the dialog container itself is focused, Tab goes to first element, Shift+Tab to last
      if (document.activeElement === dialogRef.current) {
        if (e.shiftKey) {
          lastElement.focus();
        } else {
          firstElement.focus();
        }
        e.preventDefault();
        return;
      }

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    }
  };

  const fetchPreview = async () => {
    // Validate
    const trimmedNewEmail = newEmail.trim();
    const allEmails = [...emails];
    
    if (trimmedNewEmail) {
      if (validRecipient(trimmedNewEmail) && !allEmails.includes(trimmedNewEmail)) {
        allEmails.push(trimmedNewEmail);
        setNewEmail(''); // Clear the dirty input since we consumed it
      } else if (!validRecipient(trimmedNewEmail)) {
        setErrorMessage('Please fix the invalid email in the new recipient field.');
        return;
      }
    }

    const cleanEmails = allEmails.map(e => e.trim());
    if (cleanEmails.length === 0) {
      setErrorMessage('Please provide at least one recipient email.');
      return;
    }
    
    if (cleanEmails.length > 50 || cleanEmails.some(e => !validRecipient(e))) {
      setErrorMessage('One or more recipient emails are invalid.');
      return;
    }
    
    if (scopeMode === 'selected' && selectedUniIds.length === 0) {
      setErrorMessage('Please select at least one university, or switch to All active universities.');
      return;
    }

    if (selectedSections.length === 0) {
      setErrorMessage('Select at least one report section.');
      return;
    }
    
    setEmails(cleanEmails);
    
    setSetup(false);
    setStatus('loading');
    setErrorMessage('');
    attemptedRef.current = false;
    try {
      const payload = { recipients: cleanEmails, sections: selectedSections, priority: selectedPriority };
      if (scopeMode === 'selected') {
        payload.universityIds = selectedUniIds;
      }
      
      const data = await authFetch('/reports/pending/preview', { 
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setPreview(data);
      setStatus('preview');
    } catch (err) {
      setErrorMessage(err.message || 'Failed to load report preview.');
      setStatus('error');
    }
  };

  const handleEditSettings = () => {
    if (attemptedRef.current) return;
    setSetup(true);
    setPreview(null);
    setStatus('loading');
    setErrorMessage('');
  };

  const toggleSection = (sectionKey) => {
    if (attemptedRef.current) return;
    const nextSections = selectedSections.includes(sectionKey)
      ? selectedSections.filter(key => key !== sectionKey)
      : [...selectedSections, sectionKey];
    setSelectedSections(REPORT_SECTIONS
      .map(section => section.key)
      .filter(key => nextSections.includes(key)));
    setErrorMessage('');
    // A reviewed preview is bound to the section selection. Never leave an
    // older preview or confirmation action available after it changes.
    if (preview) {
      setPreview(null);
      setSetup(true);
      setStatus('loading');
      attemptedRef.current = false;
    }
  };

  const addEmail = () => {
    const trimmed = newEmail.trim();
    if (trimmed) {
      if (!validRecipient(trimmed)) {
        setErrorMessage('Invalid email format.');
        return;
      }
      if (!emails.includes(trimmed)) {
        setEmails([...emails, trimmed]);
        setNewEmail('');
        setErrorMessage('');
      }
    }
  };

  const updateEmail = (index, value) => {
    const newEmails = [...emails];
    newEmails[index] = value;
    setEmails(newEmails);
  };

  const removeEmail = (index) => {
    setEmails(emails.filter((_, i) => i !== index));
  };

  const toggleUniversity = (id) => {
    setScopeMode('selected');
    if (selectedUniIds.includes(id)) {
      setSelectedUniIds(selectedUniIds.filter(i => i !== id));
    } else {
      setSelectedUniIds([...selectedUniIds, id]);
    }
  };

  const selectAll = () => {
    setScopeMode('all');
  };
  
  const displayedUniversities = universities.filter(university => {
    if (selectedPriority === 'ALL') return true;
    const storedPriority = normalizePreviewText(university.priority || 'NA').toUpperCase();
    const priority = university.isCritical
      ? 'CRITICAL'
      : ({ P1: 'CRITICAL', P2: 'MEDIUM', P3: 'LOW' }[storedPriority] || storedPriority);
    return priority === selectedPriority;
  });

  // Fetch preview on mount ONLY if not in setup mode anymore. We start in setup mode now.
  // We removed the on-mount fetchPreview() call to respect the setup step.

  const checkExpiry = () => {
    if (attemptedRef.current) return false;
    if (!preview?.expiresAt) return false;
    return Date.now() > new Date(preview.expiresAt).getTime();
  };

  const handleSend = async () => {
    if (!preview?.previewId) return;
    
    if (checkExpiry()) {
      setStatus('expired');
      setErrorMessage('This preview has expired. Please regenerate the report to send.');
      return;
    }

    attemptedRef.current = true;
    setStatus('sending');
    setErrorMessage('');
    try {
      const data = await authFetch('/reports/pending/send', {
        method: 'POST',
        body: JSON.stringify({ previewId: preview.previewId, confirmed: true }),
      });
      
      if (data.accepted === true) {
        setSendResult(data);
        setStatus('success');
      } else {
        throw new Error(data.message || 'Provider did not accept the report.');
      }
    } catch (err) {
      if (err.status === 410) {
        setStatus('expired');
        setErrorMessage('This preview has expired on the server. Please regenerate the report to send.');
      } else {
        setStatus('error');
        setErrorMessage(err.message || 'Failed to send report. Setup might be incomplete.');
      }
    }
  };

  const isExpired = checkExpiry();
  const disableActions = !setup && (status === 'sending' || status === 'loading');
  const selectedPreviewSections = previewSelectedSections(preview);
  const previewHasExplicitSections = Array.isArray(preview?.sections);

  return (
    <div 
      className="send-report-dialog-overlay" 
      onKeyDown={handleKeyDown} 
      onClick={(e) => {
        if (e.target === e.currentTarget && !disableActions) onClose();
      }}
    >
      <div 
        ref={dialogRef}
        className="send-report-dialog" 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="send-report-title"
        tabIndex={-1}
        style={{ outline: 'none' }}
      >
        <header className="send-report-dialog-header">
          <h2 id="send-report-title">Send Pending Work Report</h2>
          <button 
            type="button" 
            ref={closeBtnRef}
            className="send-report-close-btn" 
            onClick={onClose} 
            disabled={disableActions}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>
        
        <div className="send-report-dialog-content" aria-live="polite">
          {setup ? (
            <div className="send-report-setup-section">
              {errorMessage && (
                <div className="send-report-message error">
                  <AlertTriangle size={20} className="flex-shrink-0" />
                  <div>
                    <strong>Setup Error</strong>
                    <p>{errorMessage}</p>
                  </div>
                </div>
              )}

              <div className="send-report-setup-group">
                <h3>Recipients</h3>
                <div className="send-report-email-list">
                  {emails.map((email, idx) => (
                    <div key={idx} className="send-report-email-item">
                      <input 
                        type="email" 
                        className="form-control" 
                        value={email} 
                        onChange={(e) => updateEmail(idx, e.target.value)}
                        aria-label={`Edit recipient ${idx + 1}`}
                      />
                      <button type="button" className="send-report-remove-email" onClick={() => removeEmail(idx)} aria-label={`Remove recipient ${idx + 1}`}>
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="send-report-email-item">
                  <input 
                    type="email" 
                    className="form-control" 
                    placeholder="Add recipient email..." 
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEmail())}
                  />
                  <button type="button" className="button button-secondary" onClick={addEmail}>Add</button>
                </div>
              </div>

              <div className="send-report-setup-group">
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Report Sections</legend>
                  <p style={{ margin: '0 0 0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Choose which report sections to include. At least one is required.
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {REPORT_SECTIONS.map(section => (
                      <label key={section.key} className="send-report-uni-checkbox">
                        <input
                          type="checkbox"
                          name="reportSections"
                          value={section.key}
                          checked={selectedSections.includes(section.key)}
                          onChange={() => toggleSection(section.key)}
                          aria-label={section.label}
                        />
                        {section.label}
                      </label>
                    ))}
                  </div>
                  {selectedSections.length === 0 && (
                    <div role="alert" style={{ marginTop: '0.5rem', color: 'var(--text-danger, #b91c1c)', fontSize: '0.85rem' }}>
                      Select at least one report section.
                    </div>
                  )}
                </fieldset>
              </div>

              <div className="send-report-setup-group">
                <div className="send-report-uni-header">
                  <h3>University Scope</h3>
                </div>
                <fieldset style={{ border: 0, padding: 0, margin: '0 0 0.75rem' }}>
                  <legend style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem' }}>Priority option</legend>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {PRIORITY_OPTIONS.map(option => (
                      <label key={option.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.6rem', borderRadius: '999px', background: option.background, color: option.color, fontWeight: 700, fontSize: '0.8rem' }}>
                        <input type="radio" name="reportPriority" value={option.key} checked={selectedPriority === option.key} onChange={() => setSelectedPriority(option.key)} />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="send-report-uni-controls">
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                    <label className="send-report-uni-select-all">
                      <input 
                        type="radio" 
                        name="scopeMode" 
                        value="all" 
                        checked={scopeMode === 'all'} 
                        onChange={selectAll} 
                      />
                      All active universities
                    </label>
                    <label className="send-report-uni-select-all">
                      <input 
                        type="radio" 
                        name="scopeMode" 
                        value="selected" 
                        checked={scopeMode === 'selected'} 
                        onChange={() => setScopeMode('selected')} 
                      />
                      Selected universities
                    </label>
                  </div>
                  
                  <div className="send-report-uni-scroll">
                    {displayedUniversities.map(u => (
                      <label key={u.id} className="send-report-uni-checkbox">
                        <input 
                          type="checkbox" 
                          checked={selectedUniIds.includes(u.id)}
                          onChange={() => toggleUniversity(u.id)}
                        />
                        {u.name} {u.isCritical && <span style={{ color: 'var(--text-warning)', fontWeight: 800 }}>★</span>}
                      </label>
                    ))}
                    {displayedUniversities.length === 0 && (
                      <div style={{ padding: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No universities found matching filters.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : status === 'loading' || status === 'sending' ? (
            <div className="send-report-loading">
              <div className="send-report-spinner"></div>
              <p>{status === 'loading' ? 'Generating portfolio report preview...' : 'Sending report...'}</p>
            </div>
          ) : status === 'success' && sendResult ? (
            <>
              <div className="send-report-message success" style={{ marginBottom: '1rem' }}>
                <CheckCircle2 size={20} className="flex-shrink-0" />
                <div>
                  <strong>Report Request Accepted</strong>
                  <p>{sendResult.message}</p>
                  {sendResult.deliveryMode === 'demonstration' && (
                    <p style={{ marginTop: '0.5rem', fontWeight: 500 }}>
                      Demonstration mode active: No actual email was sent.
                    </p>
                  )}
                </div>
              </div>
              
              <section className="send-report-section">
                <h3>Actual Recipients</h3>
                <div className="send-report-recipients">
                  {(sendResult.recipients || []).map(email => (
                    <div key={email} className="send-report-recipient">
                      <Mail size={16} />
                      <span>{email}</span>
                    </div>
                  ))}
                </div>
              </section>

              {sendResult.auditRecorded === false && (
                <div className="send-report-message error" style={{ marginTop: '1rem' }}>
                  <AlertTriangle size={20} className="flex-shrink-0" />
                  <div>
                    <strong>Audit Logging Failed</strong>
                    <p>The report was accepted by the provider, but recording the audit log failed.</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {(status === 'error' || status === 'expired' || isExpired) && (
                <div className="send-report-message error">
                  <AlertTriangle size={20} className="flex-shrink-0" />
                  <div>
                    <strong>{(status === 'expired' || isExpired) ? 'Preview Expired' : 'Error'}</strong>
                    <p>{errorMessage || 'This preview has expired. Please regenerate.'}</p>
                    {status === 'error' && preview?.previewId && (
                      <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', opacity: 0.8 }}>Report ID: {preview.previewId}</p>
                    )}
                    {status === 'error' && preview?.delivery?.provider === 'gmail' && (
                      <p>Retrying confirmation rechecks this saved report. Gmail sends with an unknown outcome will not be submitted again. Do not create a replacement report until the outcome is checked.</p>
                    )}
                  </div>
                </div>
              )}
              
              <div className="send-report-message info">
                <Info size={20} className="flex-shrink-0" />
                <div>
                  <strong>Selected Scope</strong>
                  <p>This report targets your explicitly selected active universities and will be sent to your customized recipients list.</p>
                </div>
              </div>
              
              {preview?.delivery && (
                <div className="send-report-message info" style={{ marginTop: '-0.5rem' }}>
                  <Info size={20} className="flex-shrink-0" />
                  <div>
                    <strong>{preview.delivery.mode === 'demonstration' ? 'Demonstration Mode' : 'Email Delivery'}</strong>
                    <p>{preview.delivery.message || (preview.delivery.mode === 'demonstration'
                      ? 'Demonstration mode: confirmation records mocked provider acceptance and sends no email.'
                      : 'Confirmation submits this reviewed report to the configured email provider.')}</p>
                  </div>
                </div>
              )}

              {preview && (
                <>
                  <section className="send-report-section">
                    <h3>Report Scope</h3>
                    <div className="send-report-info-box">
                      <p><strong>Generated:</strong> {formatPreviewGeneratedAt(preview.generatedAt)}</p>
                      <p><strong>Universities:</strong> {preview.scope?.universityCount || preview.universityCount || 0} locations</p>
                      <p><strong>Sections:</strong> {REPORT_SECTIONS
                        .filter(section => selectedPreviewSections.includes(section.key))
                        .map(section => section.label)
                        .join(', ')}</p>
                      <p>
                        <strong>Priority:</strong>{' '}
                        <span style={{
                          display: 'inline-block',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '999px',
                          color: preview.priority?.color || '#334155',
                          background: preview.priority?.background || '#e2e8f0',
                          fontWeight: 700,
                        }}>
                          {preview.priority?.label || 'All Priorities'}
                        </span>
                      </p>
                      <p><strong>Total Pending Items:</strong> {preview.summary?.pendingItems || preview.totalPendingItems || 0} across portfolio</p>
                      <p><strong>Blockers:</strong> {preview.summary?.blockers ?? 0} · <strong>Overdue:</strong> {preview.summary?.overdue ?? 0}</p>
                    </div>
                  </section>
                  
                  <section className="send-report-section">
                    <h3>Recipients</h3>
                    <div className="send-report-recipients">
                      {(preview.recipients || []).map(email => (
                        <div key={email} className="send-report-recipient">
                          <Mail size={16} />
                          <span>{email}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  
                  {preview.universities && preview.universities.length > 0 && (
                    <section className="send-report-section">
                      <h3>University Summary</h3>
                      <div className="send-report-universities-list">
                        {preview.universities.map((u, i) => (
                          <div key={u.id || i} className="send-report-university-detail">
                            <div className="send-report-university-header">
                              <span className="send-report-university-name">{u.name}</span>
                              <span className="send-report-university-meta">
                                {(() => {
                                  const pendingCount = u.counts?.pending ?? u.pendingCount ?? (Array.isArray(u.pendingItems) ? u.pendingItems.length : 0);
                                  const blockerCount = u.counts?.blockers ?? u.blockerCount ?? 0;
                                   const sectionStates = selectedPreviewSections
                                     .filter(sectionKey => sectionKey !== 'dailyRemarks')
                                     .map(sectionKey => previewSectionDataState(u, sectionKey));
                                  if (pendingCount > 0) {
                                    return `${pendingCount} pending item${pendingCount === 1 ? '' : 's'} · ${blockerCount} blockers · ${u.counts?.overdue ?? 0} overdue`;
                                  }
                                  if (sectionStates.includes('missing')) return 'Checklist data is missing; this university is not described as complete';
                                  if (sectionStates.includes('unknown')) return 'No pending items in reviewed data; completeness not established.';
                                  return 'No pending items reported.';
                                })()}
                              </span>
                            </div>
                            
                             {selectedPreviewSections.includes('dailyRemarks') && (
                                <section style={{ margin: '1rem 0 0' }} aria-label={`Daily Remarks for ${u.name}`}>
                                  <h4 style={{ margin: '0 0 0.5rem', paddingBottom: '0.4rem', borderBottom: '2px solid var(--border-color)' }}>Daily Remarks</h4>
                                  {Array.isArray(u.dailyRemarks) && u.dailyRemarks.length > 0 ? (
                                    u.dailyRemarks.map(remark => (
                                      <article key={remark.id} style={{ marginBottom: '0.5rem', padding: '0.65rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)' }}>
                                        <div style={{ marginBottom: '0.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                          <strong>{formatPreviewDate(remark.createdAt)}</strong> · {remark.authorName || 'Team'}
                                        </div>
                                        <div>{remark.content}</div>
                                      </article>
                                    ))
                                  ) : (
                                    <p style={{ color: 'var(--text-secondary)' }}>No daily remarks reported.</p>
                                  )}
                                </section>
                              )}
                             <PreviewItemTable
                               items={u.pendingItems}
                               university={u}
                               selectedSections={selectedPreviewSections}
                               showOther={!previewHasExplicitSections}
                             />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  
                  <section className="send-report-section">
                    <h3>Attachments</h3>
                    <div className="send-report-recipient">
                      <FileText size={16} />
                      <span>{preview.attachment?.filename || preview.csvFilename || 'pending-work-report.csv'} (Complete portfolio data)</span>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>
        
        <footer className="send-report-dialog-footer">
          {status === 'success' ? (
            <button type="button" className="button button-primary" onClick={onClose}>
              <span className="btn-text">Close</span>
            </button>
          ) : (
            <>
              <button type="button" className="button button-secondary" onClick={onClose} disabled={disableActions}>
                <span className="btn-text">Cancel</span>
              </button>
              
              {(status === 'expired' || isExpired) ? (
                <button type="button" className="button button-primary" onClick={handleEditSettings} disabled={disableActions}>
                  <span className="btn-text">Regenerate Preview</span>
                </button>
              ) : status === 'error' ? (
                <>
                  <button type="button" className="button button-primary" onClick={handleSend} disabled={disableActions}>
                    <Mail size={16} />
                    <span className="btn-text">{preview?.delivery?.provider === 'gmail' ? 'Retry Confirmation' : 'Retry Send'}</span>
                  </button>
                </>
              ) : setup ? (
                <button type="button" className="button button-primary" onClick={fetchPreview} disabled={disableActions}>
                  <span className="btn-text">Generate Preview</span>
                </button>
              ) : (
                <>
                  {!attemptedRef.current && (
                    <button type="button" className="button button-secondary" onClick={handleEditSettings} disabled={disableActions}>
                      <span className="btn-text">Edit Settings</span>
                    </button>
                  )}
                  <button type="button" className="button button-primary" onClick={handleSend} disabled={disableActions || !preview}>
                    <Mail size={16} />
                    <span className="btn-text">Confirm & Send</span>
                  </button>
                </>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
