import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock3, FileText, Paperclip, Printer, RefreshCw, Search, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth, ZONES } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import ImageLightbox from '../components/ImageLightbox';
import ReportEvidenceAppendix from '../components/ReportEvidenceAppendix';
import ReportDailyUpdates from '../components/ReportDailyUpdates';
import SendReportDialog from '../components/SendReportDialog';
import ReportPriorityControl, {
  REPORT_PRIORITY_OPTIONS,
  reportUniversityPriority,
} from '../components/ReportPriorityControl';
import useReportPrint from '../hooks/useReportPrint';
import useReportReturnPosition from '../hooks/useReportReturnPosition';
import useReportRefreshAnchor from '../hooks/useReportRefreshAnchor';
import { latestDatedRemark, reportRemarkEntries } from '../utils/reportRemarks';

export const REPORT_REFRESH_INTERVAL_MS = 30_000;
export const REPORT_AUTO_REFRESH_MIN_GAP_MS = 10_000;
export const REPORT_REFRESH_RETRY_DELAYS_MS = [15_000, 30_000, 60_000];

function currentDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export function filterReportUniversities(universities, {
  zone = 'all',
  apm = 'all',
  search = '',
  priority = 'all',
  critical = false,
} = {}) {
  const query = search.trim().toLowerCase();
  const selectedPriority = critical ? 'CRITICAL' : String(priority || 'all').toUpperCase();
  return universities.filter(item =>
    (zone === 'all' || String(item.zone_id) === zone) &&
    (apm === 'all' || item.apmName === apm) &&
    (selectedPriority === 'ALL' || reportUniversityPriority(item) === selectedPriority) &&
    (!query || item.name.toLowerCase().includes(query))
  );
}

export function UniversityReportSearch({
  universities,
  selectedUniversity,
  selectedUniversityName,
  inputId,
  value,
  onChange,
  onSelect,
}) {
  const listboxId = useId();
  const [popupOpen, setPopupOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const results = universities;
  const open = popupOpen;
  const activeOption = open && results.length ? results[Math.min(activeIndex, results.length - 1)] : null;

  useEffect(() => {
    setActiveIndex(0);
  }, [value, universities]);

  useEffect(() => {
    if (open && activeOption) {
      const el = document.getElementById(`${listboxId}-${activeOption.id}`);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [open, activeIndex, activeOption, listboxId]);

  const choose = useCallback((item) => {
    if (!item) return;
    onSelect(item);
    setPopupOpen(false);
  }, [onSelect]);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setPopupOpen(false);
      return;
    }
    if (!results.length) return;
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActiveIndex(event.key === 'ArrowUp' ? results.length - 1 : 0);
      setPopupOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeOption);
    }
  };

  const displayValue = open ? value : (selectedUniversityName || value || '');

  return (
    <div className="daily-report-search-wrap">
      <div className="daily-report-search">
        <Search size={16} aria-hidden="true" className="search-icon" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          value={displayValue}
          onChange={event => {
            onChange(event.target.value);
            setPopupOpen(true);
          }}
          onFocus={e => {
            setPopupOpen(true);
            if (!value && selectedUniversityName) {
              e.target.select();
            }
          }}
          onClick={() => setPopupOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setPopupOpen(false), 150);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search universities"
          aria-label="Search universities"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOption ? `${listboxId}-${activeOption.id}` : undefined}
          autoComplete="off"
          className="form-input search-input"
        />
        {(selectedUniversity || value) && (
          <button
            type="button"
            className="daily-report-clear-university"
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              onSelect(null);
              setPopupOpen(false);
            }}
            aria-label="Clear selected university"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div className="daily-report-search-results" id={listboxId} role="listbox">
          {results.length ? results.map((item, index) => (
            <button
              type="button"
              id={`${listboxId}-${item.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={item.id === selectedUniversity}
              className={index === activeIndex ? 'is-active' : ''}
              key={item.id}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(item)}
            >
              {item.name}
            </button>
          )) : (
            <div className="daily-report-search-empty">No universities found</div>
          )}
        </div>
      )}
    </div>
  );
}

function formatReportDate(value) {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(match[2]) - 1];
  return month ? `${match[3]}-${month}-${match[1]}` : value;
}

function statusStyle(item) {
  if (item.isBlocker || item.status === 'Blocker') return { color: '#dc2626', background: '#fef2f2' };
  if (item.status === 'Done' || item.status === 'N/A') return { color: '#047857', background: '#ecfdf5' };
  if (item.status === 'In-Progress') return { color: '#1d4ed8', background: '#eff6ff' };
  return { color: '#92400e', background: '#fffbeb' };
}

function pendingAreaRank(item) {
  if (item.area === 'Model Classroom' || item.area === 'All Classrooms' ||
      item.area === 'Classrooms' || item.area === 'CR') return 0;
  if (item.area === '5.0 Lab' || item.area === 'Lab Room' || item.area === 'Lab') return 1;
  if (item.area === 'Staff Room') return 2;
  return 3;
}

export function isPendingReportItem(item) {
  return item.status !== 'Done' && item.status !== 'N/A';
}

function distinctAttachments(items) {
  const seen = new Set();
  return items.flatMap(item => item.attachments || []).filter(attachment => {
    const key = `${attachment.url}::${attachment.classroomName || attachment.area || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceLabel(item) {
  return item.classroomName ? `${item.area} — ${item.classroomName}` : item.area;
}

function itemSources(item) {
  return item.sources?.length
    ? item.sources
    : [{ id: item.id, label: sourceLabel(item) }];
}

function itemRemarkSources(item) {
  return item.remarkSources || [{
    id: item.id,
    label: sourceLabel(item),
    remark: item.remark,
    remarkDate: item.remarkDate,
    remarkIsHistorical: item.remarkIsHistorical,
    remarkDiffersFromCurrent: item.remarkDiffersFromCurrent,
  }];
}

function latestDisplayedRemarkDate(items) {
  const entries = reportRemarkEntries({
    remarkSources: items.flatMap(itemRemarkSources),
  });
  return entries.map(entry => entry.remarkDate).filter(Boolean).sort().at(-1) || null;
}

export function compactClassroomItems(items) {
  const regularItems = items
    .filter(item => item.area !== 'All Classrooms')
    .map(item => ({ ...item, sources: itemSources(item), remarkSources: itemRemarkSources(item) }));
  const classroomItems = items.filter(item => item.area === 'All Classrooms');
  const lineItemGroups = new Map();

  classroomItems.forEach(item => {
    const key = `${item.category}::${item.lineItem}`;
    const group = lineItemGroups.get(key) || [];
    group.push(item);
    lineItemGroups.set(key, group);
  });

  const compacted = [];
  lineItemGroups.forEach(group => {
    const stateGroups = new Map();
    group.forEach(item => {
      const signature = JSON.stringify([
        item.status,
        item.timeline || '',
        item.remark || '',
      ]);
      const stateGroup = stateGroups.get(signature) || [];
      stateGroup.push(item);
      stateGroups.set(signature, stateGroup);
    });

    stateGroups.forEach(stateGroup => {
      const first = stateGroup[0];
      const roomNames = stateGroup.map(item => item.classroomName).filter(Boolean);
      const editors = [...new Set(stateGroup.map(item => item.lastUpdatedBy).filter(Boolean))];
      const allRoomsMatch = stateGroup.length === group.length;
      compacted.push({
        ...first,
        id: stateGroup.map(item => item.id).sort().join('-'),
        sources: stateGroup.flatMap(itemSources),
        remarkSources: stateGroup.flatMap(itemRemarkSources),
        classroomName: allRoomsMatch
          ? `All classrooms (${stateGroup.length})`
          : stateGroup.length === 1
            ? roomNames[0]
            : `${stateGroup.length} classrooms`,
        classroomNames: roomNames,
        attachments: distinctAttachments(stateGroup),
        remarkDate: latestDisplayedRemarkDate(stateGroup),
        lastUpdatedBy: editors.length === 1 ? editors[0] : editors.length > 1 ? 'Multiple editors' : null,
      });
    });
  });

  return [...regularItems, ...compacted];
}

export function combineModelAndClassrooms(items) {
  const compacted = compactClassroomItems(items);
  const candidates = compacted.filter(item =>
    item.area === 'Model Classroom' || item.area === 'All Classrooms'
  );
  const untouched = compacted.filter(item =>
    item.area !== 'Model Classroom' && item.area !== 'All Classrooms'
  );
  const groups = new Map();

  candidates.forEach(item => {
    const isPending = item.status !== 'Done' && item.status !== 'N/A';
    const key = JSON.stringify([
      item.category,
      item.lineItem,
      isPending ? 'pending' : item.status,
    ]);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  });

  const combined = [];
  groups.forEach(group => {
    const model = group.find(item => item.area === 'Model Classroom');
    const classrooms = group.filter(item => item.area === 'All Classrooms');
    if (!model || !classrooms.length) {
      combined.push(...group);
      return;
    }

    const classroomNames = classrooms.flatMap(item => item.classroomNames || [item.classroomName]).filter(Boolean);
    const editors = [...new Set(group.map(item => item.lastUpdatedBy).filter(Boolean))];
    const statusPriority = ['Blocker', 'In-Progress', 'Partially Done', 'Need to revamp', 'No info as of now', 'Yet to start'];
    const mergedStatus = statusPriority.find(status => group.some(item => item.status === status)) || model.status;
    const preferredRemarkItem = [model, ...classrooms].find(item => item.remark?.trim());
    const preferredTimelineItem = [model, ...classrooms].find(item => item.timeline);
    combined.push({
      ...model,
      id: group.map(item => item.id).sort().join('-'),
      sources: group.flatMap(itemSources),
      remarkSources: group.flatMap(itemRemarkSources),
      status: mergedStatus,
      isBlocker: group.some(item => item.isBlocker || item.status === 'Blocker'),
      timeline: preferredTimelineItem?.timeline || null,
      remark: preferredRemarkItem?.remark || null,
      areaLabel: classroomNames.length
        ? `Model + All Classrooms (${classroomNames.length})`
        : 'Model + All Classrooms',
      classroomNames,
      attachments: distinctAttachments(group),
      remarkDate: latestDisplayedRemarkDate(group),
      lastUpdatedBy: editors.length === 1 ? editors[0] : editors.length > 1 ? 'Multiple editors' : null,
    });
  });

  return [...untouched, ...combined];
}

export function priorityFollowUps(attention = {}) {
  const records = new Map();
  for (const [items, blocker] of [[attention.blockers || [], true], [attention.overdue || [], false]]) {
    for (const item of items.filter(isPendingReportItem)) {
      const existing = records.get(item.id);
      records.set(item.id, {
        ...(existing || item),
        isBlocker: Boolean(existing?.isBlocker || blocker || item.isBlocker || item.status === 'Blocker'),
      });
    }
  }
  // Keep table grouping unchanged; recover priority details from original records,
  // not the combiner's preferred remark/timeline.
  return combineModelAndClassrooms([...records.values()])
    .map(item => {
      const sources = item.sources.map(source => records.get(source.id));
      const details = new Map();
      for (const source of sources) {
        const key = JSON.stringify([source.remark || '', source.timeline || '']);
        const detail = details.get(key) || { remark: source.remark, timeline: source.timeline, labels: [] };
        detail.labels.push(sourceLabel(source));
        details.set(key, detail);
      }
      return {
        ...item,
        isBlocker: sources.some(source => source.isBlocker),
        affectedLocations: [...new Set(sources.map(sourceLabel))],
        priorityDetails: [...details.values()],
      };
    })
    .sort((a, b) =>
      Number(b.isBlocker) - Number(a.isBlocker) ||
      pendingAreaRank(a) - pendingAreaRank(b)
    )
    .slice(0, 5);
}

function reportAreaGroup(item) {
  if (item.area === '5.0 Lab' || item.area === 'Lab Room' || item.area === 'Lab') return 'lab';
  if (item.area === 'Staff Room') return 'staff';
  if (item.area === 'Model Classroom' || item.area === 'All Classrooms' ||
      item.area === 'Classrooms' || item.area === 'CR') return 'classrooms';
  return 'other';
}

export function reportAttachments(items) {
  return items.flatMap(item => (item.attachments || []).map(attachment => ({
    ...attachment,
    reportItemId: item.id,
    area: attachment.area || item.area,
    classroomName: attachment.classroomName || null,
    category: item.category,
    lineItem: item.lineItem,
  })));
}

function ItemLink({ item, universityId }) {
  const sources = itemSources(item);
  const destination = source => ({
    pathname: `/university/${encodeURIComponent(universityId)}`,
    search: `?item=${encodeURIComponent(source.id)}`,
  });

  if (sources.length === 1) {
    const source = sources[0];
    return (
      <>
        <strong>{item.lineItem}</strong>
        {' '}
        <Link
          className="daily-checklist-link no-print"
          to={destination(source)}
          aria-label={`Open ${item.lineItem} for ${source.label}`}
        >
          Open checklist item
        </Link>
      </>
    );
  }

  return (
    <>
      <strong>{item.lineItem}</strong>
      <details className="daily-checklist-chooser no-print">
        <summary aria-label={`Choose a source for ${item.lineItem}`}>
          Choose checklist item
        </summary>
        <ul>
          {sources.map(source => (
            <li key={source.id}>
              <Link
                className="daily-checklist-link"
                to={destination(source)}
                aria-label={`Open ${item.lineItem} for ${source.label}`}
              >
                {source.label}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

function ItemRemarks({ item, universityId, datesOnly = false }) {
  const entries = reportRemarkEntries(item);
  if (!entries.length) return '—';
  const showLabels = entries.length > 1;
  return entries.map(entry => (
    <div key={entry.key} style={{ marginBottom: entries.length > 1 ? '0.75rem' : 0 }}>
      {showLabels && <div><strong>{entry.labels.join(', ')}</strong></div>}
      {datesOnly ? formatReportDate(entry.remarkDate) : (
        <>
          <div>{entry.text}</div>
          {entry.remarkIsHistorical && (
            <small>
              Historical report remark.
              {entry.remarkDiffersFromCurrent ? ' Current saved remark differs.' : ''}
              {' '}Checklist links open current saved notes.
            </small>
          )}
          {entry.sources.map(source => (
            <div className="no-print" key={source.id || source.label}>
              <Link
                className="daily-checklist-link"
                to={{
                  pathname: `/university/${encodeURIComponent(universityId)}`,
                  search: `?item=${encodeURIComponent(source.id)}`,
                }}
                aria-label={`Open saved remark for ${item.lineItem} in ${source.label}`}
              >
                Open source checklist
              </Link>
            </div>
          ))}
        </>
      )}
    </div>
  ));
}

function ItemTable({ items, emptyText, groupAreas = false, onOpenEvidence, universityId }) {
  return (
    <div className="daily-table-wrap">
      <table className="data-table daily-report-table">
        <thead>
          <tr>
            <th>Location</th>
            <th>Line Item</th>
            <th>Status</th>
            <th>Timeline</th>
            <th>Line Item Remark</th>
            <th>Remark Date</th>
            <th>Attachment</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const areaGroup = reportAreaGroup(item);
            const previousGroup = index > 0 ? reportAreaGroup(items[index - 1]) : null;
            const startsGroup = groupAreas && index > 0 && areaGroup !== previousGroup;
            return (
            <tr
              key={item.id}
              data-report-anchor={`item:${itemSources(item).map(source => source.id).sort().join('|')}`}
              className={!isPendingReportItem(item) ? 'daily-report-completed' : groupAreas ? `daily-area-group daily-area-${areaGroup}${startsGroup ? ' daily-area-group-start' : ''}` : ''}
            >
              <td title={item.classroomNames?.join(', ') || ''}>
                {item.areaLabel || (item.classroomName ? `${item.area} — ${item.classroomName}` : item.area)}
              </td>
              <td><ItemLink item={item} universityId={universityId} /></td>
              <td><span className="daily-status" style={statusStyle(item)}>{item.status}</span></td>
              <td className="daily-report-date">{formatReportDate(item.timeline)}</td>
              <td><ItemRemarks item={item} universityId={universityId} /></td>
              <td className="daily-report-date"><ItemRemarks item={item} datesOnly /></td>
              <td className="daily-attachment-cell">
                {item.attachments?.length ? (
                  <button
                    type="button"
                    className="daily-attachment-button no-print"
                    onClick={() => onOpenEvidence(item.attachments, item)}
                    aria-label={`Open ${item.attachments.length} attachment${item.attachments.length === 1 ? '' : 's'} for ${item.lineItem}`}
                  >
                    <Paperclip size={14} /> {item.attachments.length === 1 ? 'View' : `View (${item.attachments.length})`}
                  </button>
                ) : <span className="daily-no-attachment">None</span>}
                {!!item.attachments?.length && <span className="print-only">{item.attachments.length} — see appendix</span>}
              </td>
            </tr>
            );
          })}
          {!items.length && (
            <tr><td colSpan={7} className="text-center text-secondary">{emptyText}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function DailyReports({ authFetch: authFetchOverride, universities: universitiesOverride } = {}) {
  const authContext = useAuth() || {};
  const dataContext = useData() || {};
  const authFetch = authFetchOverride || authContext.authFetch;
  const universities = universitiesOverride || dataContext.universities || [];
  const universitiesLoading = universitiesOverride === undefined && dataContext.loading;
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedUniversity = searchParams.get('university') || '';
  const requestedUniversitySearch = searchParams.get('universitySearch') || '';
  const selectedUniversity = universities.some(item => item.id === requestedUniversity)
    ? requestedUniversity
    : '';
  const [reportResult, setReportResult] = useState(null);
  const [universitySearch, setUniversitySearch] = useState(requestedUniversitySearch);
  const [sendReportOpen, setSendReportOpen] = useState(false);
  const [criticalMessage, setCriticalMessage] = useState(null);
  const searchClearedByUserRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatesRefreshKey, setUpdatesRefreshKey] = useState(0);
  const [updatesPrintState, setUpdatesPrintState] = useState(null);
  const updatesPrintReady = updatesPrintState?.universityId === selectedUniversity &&
    updatesPrintState?.refreshKey === updatesRefreshKey && updatesPrintState?.ready;
  const printReadinessRef = useRef(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState(null);
  const appendixRef = useRef(null);
  const { printStatus, printReport } = useReportPrint(appendixRef, printReadinessRef);
  const activeUniversityRef = useRef(selectedUniversity);
  const reportUniversityRef = useRef('');
  const latestReportRequestRef = useRef(0);
  const pendingReportRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const lastReportRequestAtRef = useRef(0);
  const refreshFailuresRef = useRef(0);
  activeUniversityRef.current = selectedUniversity;
  reportUniversityRef.current = reportResult?.universityId || '';
  const report = reportResult?.universityId === selectedUniversity
    ? reportResult.data
    : null;
  const reportRefreshing = refreshing || (loading && Boolean(report));
  const printReady = Boolean(report && updatesPrintReady && !reportRefreshing && !error);
  printReadinessRef.current = printReady;
  // A refresh must not make the report disappear. Apart from being jarring,
  // replacing the report with a loading panel changes the document height and
  // makes the browser move the user's viewport. The return-position hook only
  // needs the report to be mounted, not for its request to be idle.
  const { rootRef, capturePosition } = useReportReturnPosition(Boolean(report));
  const captureRefreshAnchor = useReportRefreshAnchor(rootRef,
    `${selectedUniversity}:${searchParams.get('area') || ''}:${searchParams.get('category') || ''}`);

  const updateReportFilters = useCallback((updates, options) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      Object.entries(updates).forEach(([key, value]) => {
        if (value) next.set(key, value);
        else next.delete(key);
      });
      return next;
    }, options);
  }, [setSearchParams]);

  const loadReport = useCallback(async ({ silent = false } = {}) => {
    const requestedUniversity = selectedUniversity;
    if (requestedUniversity && pendingReportRef.current?.universityId === requestedUniversity) {
      return pendingReportRef.current.promise;
    }
    const requestId = ++latestReportRequestRef.current;
    lastReportRequestAtRef.current = Date.now();
    pendingReportRef.current?.controller.abort();
    pendingReportRef.current = null;
    if (!requestedUniversity) {
      pendingReportRef.current = null;
      setReportResult(null);
      setLoading(false);
      setRefreshing(false);
      setError('');
      return;
    }
    const isLatestRequest = () =>
      requestId === latestReportRequestRef.current &&
      requestedUniversity === activeUniversityRef.current;
    setLoading(!silent || reportUniversityRef.current !== requestedUniversity);
    setRefreshing(silent);
    if (silent) setUpdatesRefreshKey(key => key + 1);
    setError('');
    const controller = new AbortController();
    const request = (async () => {
    try {
      const data = await authFetch(
        `/universities/${requestedUniversity}/daily-report?date=${currentDate()}`,
        { cache: 'no-store', signal: controller.signal, priority: 'high' },
      );
      if (isLatestRequest()) {
        if (silent) captureRefreshAnchor();
        setReportResult({ universityId: requestedUniversity, data });
        refreshFailuresRef.current = 0;
      }
    } catch (err) {
      if (err.name === 'AbortError' || !isLatestRequest()) return;
      refreshFailuresRef.current = Math.min(
        refreshFailuresRef.current + 1,
        REPORT_REFRESH_RETRY_DELAYS_MS.length,
      );
      if (!silent) setReportResult(null);
      setError(err.message || 'Failed to load report');
    } finally {
      if (isLatestRequest()) {
        setLoading(false);
        setRefreshing(false);
      }
      if (pendingReportRef.current?.requestId === requestId) {
        pendingReportRef.current = null;
      }
    }
    })();
    pendingReportRef.current = { universityId: requestedUniversity, requestId, promise: request, controller };
    return request;
  }, [selectedUniversity, authFetch, captureRefreshAnchor]);

  const scheduleReportRefresh = useCallback(({ immediate = false } = {}) => {
    if (!selectedUniversity || document.visibilityState === 'hidden') return;
    if (pendingReportRef.current?.universityId === selectedUniversity) return;
    if (immediate && refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    const failureDelay = refreshFailuresRef.current
      ? REPORT_REFRESH_RETRY_DELAYS_MS[refreshFailuresRef.current - 1]
      : 0;
    const minGap = immediate ? 0 : Math.max(REPORT_AUTO_REFRESH_MIN_GAP_MS, failureDelay);
    const delay = Math.max(0, lastReportRequestAtRef.current + minGap - Date.now());
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      loadReport({ silent: true });
    }, delay);
  }, [selectedUniversity, loadReport]);

  useEffect(() => {
    loadReport();
    return () => {
      latestReportRequestRef.current += 1;
      pendingReportRef.current?.controller.abort();
      pendingReportRef.current = null;
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [loadReport]);

  useEffect(() => {
    if (!selectedUniversity) return undefined;
    const refresh = () => scheduleReportRefresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = window.setInterval(refresh, REPORT_REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
    };
  }, [selectedUniversity, scheduleReportRefresh]);

  const requestedArea = searchParams.get('area') || '';
  const requestedCategory = searchParams.get('category') || '';
  const requestedStatus = searchParams.get('status') || '';
  const areas = report?.areaSummaries?.map(item => item.area) || [];
  const area = requestedArea && areas.includes(requestedArea) ? requestedArea : 'all';
  const compactItems = useMemo(() => {
    const reportItems = report?.items || [];
    return area === 'all'
      ? combineModelAndClassrooms(reportItems)
      : compactClassroomItems(reportItems).filter(item => item.area === area);
  }, [report, area]);

  const categories = useMemo(() =>
    [...new Set(compactItems.map(item => item.category))].sort(),
  [compactItems]);
  const category = requestedCategory && categories.includes(requestedCategory) ? requestedCategory : 'all';
  const visibleItems = useMemo(() => compactItems.filter(item =>
    category === 'all' || item.category === category
  ), [compactItems, category]);
  const appendixItems = useMemo(() => reportAttachments(visibleItems), [visibleItems]);
  const pendingItems = useMemo(() => visibleItems
    .filter(isPendingReportItem)
    .sort((a, b) =>
      pendingAreaRank(a) - pendingAreaRank(b) ||
      a.category.localeCompare(b.category) ||
      a.lineItem.localeCompare(b.lineItem)
    ), [visibleItems]);
  const doneItems = useMemo(() => visibleItems
    .filter(item => !isPendingReportItem(item))
    .sort((a, b) =>
      pendingAreaRank(a) - pendingAreaRank(b) ||
      a.category.localeCompare(b.category) ||
      a.lineItem.localeCompare(b.lineItem)
    ), [visibleItems]);
  const reportSections = useMemo(() => {
    const reportItems = report?.items || [];
    const sourceAreas = area === 'all'
      ? [...new Set([
        ...areas,
        ...reportItems.map(item => item.area).filter(Boolean),
        ...pendingItems.map(item => item.area).filter(Boolean),
      ])]
      : [area];
    const labels = {
      classrooms: 'CR (Classrooms)',
      staff: 'Staff Room',
      lab: 'Lab Room',
    };
    const sections = new Map();
    sourceAreas.forEach(areaName => {
      const group = reportAreaGroup({ area: areaName });
      const key = group === 'other' ? `other:${areaName}` : group;
      if (!sections.has(key)) {
        sections.set(key, { key, label: labels[group] || areaName, items: [] });
      }
    });
    pendingItems.forEach(item => {
      const group = reportAreaGroup(item);
      const key = group === 'other' ? `other:${item.area}` : group;
      if (!sections.has(key)) {
        sections.set(key, { key, label: item.area, items: [] });
      }
      sections.get(key).items.push(item);
    });
    return [...sections.values()].sort((a, b) => {
      const rank = section => section.key === 'classrooms' ? 0
        : section.key === 'lab' ? 1
          : section.key === 'staff' ? 2
            : 3;
      return rank(a) - rank(b) || a.label.localeCompare(b.label);
    });
  }, [area, areas, pendingItems, report]);
  const university = universities.find(item => item.id === selectedUniversity);
  const managerAttention = useMemo(() => {
    if (!report?.attention) return [];
    return priorityFollowUps(report.attention);
  }, [report]);
  const zoneOptions = useMemo(() =>
    [...new Set(universities.map(item => String(item.zone_id || '')).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b)),
  [universities]);
  const requestedZone = searchParams.get('zone') || '';
  const requestedApm = searchParams.get('apm') || '';
  const requestedPriority = (searchParams.get('priority') ||
    (searchParams.get('critical') === '1' ? 'CRITICAL' : '')).toUpperCase();
  const validPriority = !requestedPriority ||
    REPORT_PRIORITY_OPTIONS.some(option => option.value === requestedPriority);
  const validZone = !requestedZone || zoneOptions.includes(requestedZone);
  const zoneApmOptions = useMemo(() =>
    [...new Set(universities
      .filter(item => !requestedZone || String(item.zone_id) === requestedZone)
      .map(item => item.apmName)
      .filter(Boolean))]
      .sort(),
  [universities, requestedZone]);
  const validApm = !requestedApm || zoneApmOptions.includes(requestedApm);
  const shortlistFiltersValid = validZone && validApm && validPriority;
  const zone = shortlistFiltersValid && requestedZone ? requestedZone : 'all';
  const apm = shortlistFiltersValid && requestedApm ? requestedApm : 'all';
  const priority = shortlistFiltersValid && requestedPriority ? requestedPriority : 'all';
  const apmOptions = useMemo(() =>
    [...new Set(universities
      .filter(item => zone === 'all' || String(item.zone_id) === zone)
      .map(item => item.apmName)
      .filter(Boolean))]
      .sort(),
  [universities, zone]);
  const eligibleUniversities = useMemo(() => filterReportUniversities(universities, {
    zone,
    apm,
    priority,
  }), [universities, zone, apm, priority]);
  const filteredUniversities = useMemo(() => filterReportUniversities(eligibleUniversities, {
    search: universitySearch,
  }), [eligibleUniversities, universitySearch]);
  const updateShortlistFilters = useCallback((nextZone, nextApm, nextPriority) => {
    const normalizedZone = nextZone === 'all' ? '' : nextZone;
    const normalizedApm = nextApm === 'all' ? '' : nextApm;
    const normalizedPriority = nextPriority === 'all' ? '' : nextPriority;
    const selectedRemainsEligible = !selectedUniversity || universities.some(item =>
      item.id === selectedUniversity &&
      (!normalizedZone || String(item.zone_id) === normalizedZone) &&
      (!normalizedApm || item.apmName === normalizedApm)
    );
    updateReportFilters({
      zone: normalizedZone,
      apm: normalizedApm,
      priority: normalizedPriority,
      critical: '',
      university: selectedRemainsEligible ? selectedUniversity : '',
    });
    if (!selectedRemainsEligible) {
      setUniversitySearch('');
      setReportResult(null);
    }
  }, [selectedUniversity, universities, updateReportFilters]);

  useEffect(() => {
    if (!universitiesLoading && !shortlistFiltersValid) {
      updateReportFilters({ zone: '', apm: '', priority: '', critical: '' }, { replace: true });
    }
  }, [shortlistFiltersValid, universitiesLoading, updateReportFilters]);

  useEffect(() => {
    if (!universitiesLoading && requestedUniversity && !selectedUniversity) {
      setSearchParams(current => {
        const next = new URLSearchParams(current);
        next.delete('university');
        return next;
      }, { replace: true });
      setUniversitySearch('');
      setReportResult(null);
    }
  }, [requestedUniversity, selectedUniversity, setSearchParams, universitiesLoading]);

  useEffect(() => {
    if (requestedStatus) {
      updateReportFilters({ status: '' }, { replace: true });
    }
  }, [requestedStatus, updateReportFilters]);

  useEffect(() => {
    if (!report) return;
    const invalidFilters = {};
    if (requestedArea && area === 'all') invalidFilters.area = '';
    if (requestedCategory && category === 'all') invalidFilters.category = '';
    if (Object.keys(invalidFilters).length) {
      updateReportFilters(invalidFilters, { replace: true });
    }
  }, [
    area,
    category,
    report,
    requestedArea,
    requestedCategory,
    updateReportFilters,
  ]);

  useEffect(() => {
    const selectedMatchesLocationFilters = !selectedUniversity || universities.some(item =>
      item.id === selectedUniversity &&
      (zone === 'all' || String(item.zone_id) === zone) &&
      (apm === 'all' || item.apmName === apm)
    );
    // Category filters narrow the university picker, but must not close the
    // report currently being viewed. Administrators need to recategorize that
    // university repeatedly without its data or category controls disappearing.
    if (selectedUniversity && !selectedMatchesLocationFilters) {
      updateReportFilters({ university: '' }, { replace: true });
      setUniversitySearch('');
      setReportResult(null);
    }
  }, [apm, selectedUniversity, universities, updateReportFilters, zone]);

  useEffect(() => {
    if (searchClearedByUserRef.current && !requestedUniversitySearch) {
      searchClearedByUserRef.current = false;
      setUniversitySearch('');
      return;
    }
    setUniversitySearch(requestedUniversitySearch);
  }, [requestedUniversitySearch]);

  return (
    <div ref={rootRef} onClickCapture={capturePosition} className="app-container daily-reports-page">
      <header className="daily-reports-header">
        <div className="daily-reports-header-main">
          <h1 className="page-title">Work Status Report</h1>
          <p className="page-subtitle">A simple view of completed and outstanding infrastructure work.</p>
        </div>
        <div className="daily-report-actions no-print" role="group" aria-label="Report actions">
          <button className="button button-secondary daily-report-refresh-button" disabled={!selectedUniversity || refreshing} onClick={() => scheduleReportRefresh({ immediate: true })}>
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            <span className="btn-text">
              <span className="refresh-label-size" aria-hidden="true">Refreshing…</span>
              <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
            </span>
          </button>
          <button className="button button-secondary" disabled={!printReady || printStatus.state === 'preparing'} onClick={printReport}>
            <Printer size={16} />
            <span className="btn-text">
              {printStatus.state === 'preparing'
                ? `Preparing ${printStatus.loaded}/${printStatus.total}…`
                : 'Print / Save PDF'}
            </span>
          </button>
          {authContext?.user?.role === 'admin' && (
            <button className="button button-primary" onClick={() => setSendReportOpen(true)}>
              <span className="btn-text">Send Report</span>
            </button>
          )}
        </div>
      </header>
      <div className="daily-report-refresh-feedback no-print">
        {error && report ? (
          <div className="daily-report-refresh-error" role="alert">{error}</div>
        ) : reportRefreshing ? (
          <div className="daily-report-refresh-indicator" role="status" aria-live="polite">
            <RefreshCw size={14} className="spin" aria-hidden="true" />
            <span>Refreshing report…</span>
          </div>
        ) : null}
      </div>
      {authContext?.user?.role === 'admin' && (
        <div className="daily-report-selected-action no-print">
          <span>Selected university{university ? ` · ${university.name}` : ''}</span>
          <ReportPriorityControl
            university={universities.find(item => item.id === selectedUniversity)}
            role={authContext?.user?.role}
            onUpdate={dataContext.updateUniversityReportPriority}
            onMessage={(message, failed) => setCriticalMessage(message ? { message, failed } : null)}
          />
        </div>
      )}

      <div className="daily-report-messages no-print">
        {criticalMessage && <p role={criticalMessage.failed ? 'alert' : 'status'}>{criticalMessage.message}</p>}
        {printStatus.message && <p className="daily-report-print-error text-danger" role="alert">{printStatus.message}</p>}
        <span className="sr-only" aria-live="polite">
          {printStatus.state === 'preparing'
            ? `Preparing ${printStatus.loaded} of ${printStatus.total} image attachments for print.`
            : report && !updatesPrintReady
              ? 'Print and PDF will be available when Daily Updates finishes loading.'
              : ''}
        </span>
      </div>

      <div className="daily-report-filters-panel no-print">
        <div className="filter-group">
          <label className="form-label" htmlFor="filter-zone">Zone</label>
          <select id="filter-zone" className="form-select daily-report-filter-select" value={zone} onChange={event => {
            updateShortlistFilters(event.target.value, 'all', priority);
          }}>
            <option value="all">All zones</option>
            {zoneOptions.map(value => (
              <option key={value} value={value}>{ZONES[value]?.name?.split('—')[1]?.trim() || ZONES[value]?.name || `Zone ${value}`}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="filter-apm">APM</label>
          <select id="filter-apm" className="form-select daily-report-filter-select" value={apm} onChange={event => {
            updateShortlistFilters(zone, event.target.value, priority);
          }}>
            <option value="all">All APMs</option>
            {apmOptions.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="filter-priority">University category</label>
          <select
            id="filter-priority"
            className="form-select daily-report-filter-select"
            value={priority}
            onChange={event => updateShortlistFilters(zone, apm, event.target.value)}
          >
            <option value="all">All categories</option>
            {REPORT_PRIORITY_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="filter-group university-chooser-group">
          <label className="form-label" htmlFor="report-university">University</label>
          <UniversityReportSearch
            inputId="report-university"
            universities={filteredUniversities}
            selectedUniversity={selectedUniversity}
            selectedUniversityName={university?.name || ''}
            value={universitySearch}
            onChange={value => {
              searchClearedByUserRef.current = !value;
              setUniversitySearch(value);
              updateReportFilters({ universitySearch: value });
            }}
            onSelect={item => {
              setUniversitySearch('');
              updateReportFilters({ university: item?.id || '', universitySearch: '' });
            }}
          />
        </div>
      </div>

      {sendReportOpen && (
        <SendReportDialog
          onClose={() => setSendReportOpen(false)}
          authFetch={authFetch}
          user={authContext?.user}
          universities={universities}
          currentUniversityId={selectedUniversity}
        />
      )}

      {!selectedUniversity && (
        <div className="glass-panel daily-report-empty">
          <FileText size={34} />
          <strong>Select a university to view completed and pending work.</strong>
        </div>
      )}
      {loading && !report && <div className="glass-panel daily-report-empty daily-report-loading" role="status">Loading work status…</div>}
      {error && !report && <div className="glass-panel daily-report-empty text-danger" role="alert">{error}</div>}

      {report && (
        <>
          <div className="print-only daily-report-document-title">
            <p className="manager-report-kicker">NIAT InfraTracker · Daily Management Report</p>
            <h1>{university?.name}</h1>
            <p>Report date {formatReportDate(report.reportDate)} · Generated {new Date(report.generatedAt).toLocaleString('en-IN')}</p>
          </div>

          <section className="glass-panel manager-priority-section" aria-labelledby="manager-priority-title">
              <div className="manager-section-heading" data-report-anchor="priority-heading">
              <div>
                <p className="manager-report-kicker">Manager attention</p>
                <h2 id="manager-priority-title">Priority follow-ups</h2>
              </div>
              <span>{managerAttention.length ? `Top ${managerAttention.length} exceptions` : 'No critical exceptions'}</span>
            </div>
            {managerAttention.length ? (
              <div className="manager-priority-list">
                {managerAttention.map(item => (
                  <article className="manager-priority-item" key={item.id} data-report-anchor={`priority:${item.id}`}>
                    <span className={`manager-priority-type ${item.isBlocker ? 'is-blocker' : 'is-overdue'}`}>
                      {item.isBlocker ? 'Blocker' : 'Overdue'}
                    </span>
                    <div>
                      <strong>{item.lineItem}</strong>
                      <p>{item.areaLabel || (item.classroomName ? `${item.area} · ${item.classroomName}` : item.area)} · {item.category}</p>
                      {item.sources.length > 1 && <p>{item.affectedLocations.join('; ')}</p>}
                    </div>
                    <div className="manager-priority-note">
                      {item.priorityDetails.map((detail, index) => (
                        <React.Fragment key={index}>
                          {item.priorityDetails.length > 1 && <strong>{detail.labels.join('; ')}</strong>}
                          <span>{latestDatedRemark(detail.remark) || 'No field remark provided'}</span>
                          {(detail.timeline || item.priorityDetails.length > 1) && <small>Timeline: {formatReportDate(detail.timeline)}</small>}
                        </React.Fragment>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="manager-priority-clear"><CheckCircle2 size={18} /> No blockers or overdue items require escalation.</div>
            )}
          </section>

          <div className="work-report-toolbar" data-report-anchor="report-toolbar">
            <div className="work-report-total work-report-done">
              <CheckCircle2 size={20} />
              <span><strong>{doneItems.length}</strong> Done</span>
            </div>
            <div className="work-report-total work-report-pending">
              <Clock3 size={20} />
              <span><strong>{pendingItems.length}</strong> Pending</span>
            </div>
            <select aria-label="Filter report by area" className="form-select no-print" value={area} onChange={event => {
              updateReportFilters({
                area: event.target.value === 'all' ? '' : event.target.value,
                category: '',
              });
            }}>
              <option value="all">All areas</option>
              {areas.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <select aria-label="Filter report by category" className="form-select no-print" value={category} onChange={event => {
              updateReportFilters({ category: event.target.value === 'all' ? '' : event.target.value });
            }}>
              <option value="all">All categories</option>
              {categories.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            {(area !== 'all' || category !== 'all') && (
              <button className="button button-secondary no-print" onClick={() => {
                updateReportFilters({ area: '', category: '' });
              }}>Clear filters</button>
            )}
          </div>

          <section className="work-report-pending-group" aria-labelledby="pending-report-title">
            <div className="work-report-section-title work-report-section-pending">
              <Clock3 size={19} />
              <h2 id="pending-report-title">Pending</h2>
              <span>{pendingItems.length} items, including in-progress, blockers, and delayed work</span>
            </div>
            {reportSections.length ? reportSections.map(section => (
              <section className={`glass-panel work-report-section work-report-area-${section.key}`} key={section.key}>
                <div className="work-report-section-title work-report-section-pending">
                  <Clock3 size={19} />
                  <h2>{section.label}</h2>
                  <span>{section.items.length} pending items</span>
                </div>
                <ItemTable
                  items={section.items}
                  emptyText="No pending line items."
                  groupAreas
                  universityId={selectedUniversity}
                  onOpenEvidence={(attachments, item) => setViewer({ attachments, item })}
                />
              </section>
            )) : (
              <section className="glass-panel work-report-section">
                <ItemTable
                  items={[]}
                  emptyText="No pending line items."
                  universityId={selectedUniversity}
                  onOpenEvidence={(attachments, item) => setViewer({ attachments, item })}
                />
              </section>
            )}
          </section>

          <section className="glass-panel work-report-section">
            <div className="work-report-section-title work-report-section-done">
              <CheckCircle2 size={19} />
              <h2>Done</h2>
              <span>{doneItems.length} items, including Done and N/A</span>
            </div>
            <ItemTable
              items={doneItems}
              emptyText="No completed line items."
              universityId={selectedUniversity}
              onOpenEvidence={(attachments, item) => setViewer({ attachments, item })}
            />
          </section>

          <ReportEvidenceAppendix
            ref={appendixRef}
            attachments={appendixItems}
            onOpen={attachment => setViewer({
              attachments: [attachment],
              item: { lineItem: attachment.lineItem, category: attachment.category },
            })}
          />
          {viewer && (
            <ImageLightbox
              images={viewer.attachments.map(attachment => ({
                ...attachment,
                photoUrl: attachment.url,
                itemName: viewer.item.lineItem,
                label: `${viewer.item.lineItem} — ${attachment.classroomName || attachment.area || viewer.item.category}`,
              }))}
              onClose={() => setViewer(null)}
            />
          )}
        </>
      )}
      {selectedUniversity && (
        <ReportDailyUpdates
          key={selectedUniversity}
          universityId={selectedUniversity}
          authFetch={authFetch}
          refreshKey={updatesRefreshKey}
          onReadinessChange={setUpdatesPrintState}
        />
      )}
    </div>
  );
}