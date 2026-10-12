import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ExternalLink, FileText, Loader, MessageSquare } from 'lucide-react';
import EvidenceMedia from './EvidenceMedia';
import useViewportGate from '../hooks/useViewportGate';
import useReportRefreshAnchor from '../hooks/useReportRefreshAnchor';
import { getImageUrl } from '../utils/imageUtils';

function mediaEntries(value) {
  if (Array.isArray(value)) {
    return value.flatMap(item => mediaEntries(item));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return mediaEntries(parsed);
      if (typeof parsed === 'string' && parsed !== value) return mediaEntries(parsed);
    } catch {
      // A legacy single path is not JSON; use it as-is.
    }
    return [{ path: trimmed, contentType: undefined }];
  }

  if (value && typeof value === 'object') {
    const path = value.url || value.path || value.objectPath;
    return typeof path === 'string'
      ? [{ path: path.trim(), contentType: value.contentType || value.mimeType }]
      : [];
  }

  return [];
}

export function normalizeUpdateMedia(value) {
  return mediaEntries(value).map(entry => entry.path).filter(Boolean);
}

export function updateDateKey(update) {
  if (!update?.createdAt) return 'Unknown';
  const value = String(update.createdAt);
  return value.split('T')[0] || 'Unknown';
}

export function sortUpdatesNewestFirst(updates) {
  return updates
    .map((update, index) => ({ update, index, timestamp: Date.parse(update?.createdAt || '') }))
    .sort((a, b) => {
      const aValid = Number.isFinite(a.timestamp);
      const bValid = Number.isFinite(b.timestamp);
      if (aValid && bValid) return b.timestamp - a.timestamp || a.index - b.index;
      if (aValid) return -1;
      if (bValid) return 1;
      return a.index - b.index;
    })
    .map(item => item.update);
}

export function formatUpdateDate(dateKey) {
  if (dateKey === 'Unknown') return 'Unknown date';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function absoluteAttachmentUrl(path) {
  try {
    const resolved = getImageUrl(path);
    if (!resolved) return '';
    return new URL(resolved, window.location.origin).href;
  } catch {
    return path || '';
  }
}

function formatUpdateTime(createdAt) {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function groupUpdates(updates) {
  const groups = new Map();
  updates.forEach(update => {
    const key = updateDateKey(update);
    const group = groups.get(key) || [];
    group.push(update);
    groups.set(key, group);
  });
  return [...groups.entries()];
}

function ReportUpdateMedia({ updateId, value }) {
  const entries = mediaEntries(value);
  if (!entries.length) return null;

  return (
    <div className="report-daily-updates-media-list" aria-label="Update attachments">
      {entries.map((entry, index) => (
        <ReportUpdateMediaItem
          key={`${updateId || 'update'}-${entry.path}-${index}`}
          entry={entry}
          index={index}
        />
      ))}
    </div>
  );
}

function ReportUpdateMediaItem({ entry, index }) {
  const { targetRef, visible, load } = useViewportGate(false);
  const originalUrl = absoluteAttachmentUrl(entry.path);
  const alt = `Daily update attachment ${index + 1}`;

  return (
    <figure className="report-daily-updates-media" ref={targetRef}>
      <div className="report-daily-updates-media-preview">
        {visible ? (
          <EvidenceMedia
            path={entry.path}
            contentType={entry.contentType}
            alt={alt}
            controls
            preload="none"
            failureMessage="Preview unavailable. Use Open original below."
            imageStyle={{ width: '100%', height: '100%', objectFit: 'contain' }}
            videoStyle={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
        ) : (
          <button
            type="button"
            className="report-daily-updates-media-placeholder"
            onClick={load}
            aria-label={`Load preview for attachment ${index + 1}`}
          >
            <FileText size={18} aria-hidden="true" />
            Load preview
          </button>
        )}
      </div>
      <figcaption className="report-daily-updates-media-caption">
        <a href={originalUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={12} aria-hidden="true" />
          Open original
        </a>
      </figcaption>
      <div className="report-daily-updates-print-only">
        <strong>Attachment {index + 1}</strong>
        <a href={originalUrl}>{originalUrl}</a>
      </div>
    </figure>
  );
}

function ReportUpdateCard({ update, index }) {
  const author = update.authorName || 'Team';
  const text = update.content || update.update_text || '';
  const time = formatUpdateTime(update.createdAt);

  return (
    <article className="report-daily-updates-card" data-report-anchor={`update:${update.id || `${update.createdAt}:${index}`}`}>
      <header className="report-daily-updates-card-header">
        <div className="report-daily-updates-author">
          <span className="report-daily-updates-avatar" aria-hidden="true">
            {author.charAt(0).toUpperCase()}
          </span>
          <strong>{author}</strong>
        </div>
        {time && (
          <time dateTime={update.createdAt} className="report-daily-updates-time">
            {time}
          </time>
        )}
      </header>
      <p className="report-daily-updates-card-text">{text}</p>
      <ReportUpdateMedia updateId={update.id || index} value={update.imageUrl} />
    </article>
  );
}

export default function ReportDailyUpdates({ universityId, authFetch, refreshKey, onReadinessChange }) {
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const loadedUniversityRef = useRef(null);
  const loadedRefreshRef = useRef(null);
  const rootRef = useRef(null);
  const captureRefreshAnchor = useReportRefreshAnchor(rootRef, String(universityId));

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const universityKey = String(universityId ?? '');
    const isInitialLoad = loadedUniversityRef.current !== universityKey;

    setLoading(true);
    setError('');
    if (isInitialLoad) setUpdates([]);

    const loadUpdates = async () => {
      try {
        if (!universityId) {
          throw new Error('Daily updates could not be loaded because no university was selected.');
        }
        if (typeof authFetch !== 'function') {
          throw new Error('Daily updates could not be loaded because authentication is unavailable.');
        }

        const data = await authFetch(`/universities/${universityId}/updates`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!Array.isArray(data)) {
          throw new Error('Daily updates could not be loaded because the server returned an invalid response (expected an array).');
        }
        if (active) {
          if (!isInitialLoad) captureRefreshAnchor();
          setUpdates(sortUpdatesNewestFirst(data));
          loadedUniversityRef.current = universityKey;
          loadedRefreshRef.current = refreshKey;
        }
      } catch (requestError) {
        if (requestError?.name === 'AbortError' || controller.signal.aborted || !active) return;
        if (active) {
          setError(requestError?.message || 'Failed to load daily updates. Please retry.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadUpdates();
    return () => {
      active = false;
      controller.abort();
    };
  }, [authFetch, refreshKey, retryKey, universityId, captureRefreshAnchor]);

  const groupedUpdates = useMemo(() => groupUpdates(updates), [updates]);
  const hasLoaded = loadedUniversityRef.current === String(universityId ?? '');
  useEffect(() => {
    onReadinessChange?.({
      universityId,
      refreshKey,
      ready: !loading && !error && loadedRefreshRef.current === refreshKey,
    });
  }, [universityId, refreshKey, loading, error, onReadinessChange]);

  return (
    <section ref={rootRef} className="report-daily-updates" aria-labelledby="report-daily-updates-title">
      <div className="report-daily-updates-heading">
        <div className="report-daily-updates-heading-copy">
          <div className="report-daily-updates-heading-label">
            <MessageSquare size={19} aria-hidden="true" />
            <h2 id="report-daily-updates-title">Daily Updates</h2>
          </div>
          <p className="report-daily-updates-subtitle">
            University-wide history across all dates and checklist areas.
          </p>
        </div>
        <span className="report-daily-updates-total">
          {hasLoaded ? `${updates.length} update${updates.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <div className="report-daily-updates-feedback no-print">
        <span role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}
          className={error ? 'report-daily-updates-feedback-error' : ''} title={error || undefined}>
          {error ? `${hasLoaded ? 'Showing previously loaded history. ' : ''}${error}` :
            loading && hasLoaded ? 'Refreshing daily updates…' : ''}
        </span>
        <button type="button" className="button button-secondary"
          disabled={loading || !error} style={{ visibility: error ? 'visible' : 'hidden' }}
          onClick={() => setRetryKey(value => value + 1)}>
          Retry daily updates
        </button>
      </div>
      {loading && !hasLoaded ? (
        <div className="report-daily-updates-state" role="status">
          <Loader size={22} className="report-daily-updates-spinner" aria-hidden="true" />
          <span>Loading daily updates…</span>
        </div>
      ) : error && !hasLoaded ? (
        <div className="report-daily-updates-state report-daily-updates-error">
          <p>Daily updates unavailable. Use Retry daily updates above.</p>
        </div>
      ) : !updates.length ? (
        <div className="report-daily-updates-state report-daily-updates-empty">
          <Calendar size={28} aria-hidden="true" />
          <p>No daily updates yet.</p>
        </div>
      ) : (
        <div className="report-daily-updates-groups">
          {groupedUpdates.map(([dateKey, dayUpdates]) => (
            <section className="report-daily-updates-day" key={dateKey}>
              <div className="report-daily-updates-day-heading">
                <time dateTime={dateKey} className="report-daily-updates-date-pill">
                  {formatUpdateDate(dateKey)}
                </time>
                <span className="report-daily-updates-day-rule" aria-hidden="true" />
                <span className="report-daily-updates-day-count">
                  {dayUpdates.length} update{dayUpdates.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="report-daily-updates-card-list">
                {dayUpdates.map((update, index) => (
                  <ReportUpdateCard
                    key={update.id || `${dateKey}-${index}`}
                    update={update}
                    index={index}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}