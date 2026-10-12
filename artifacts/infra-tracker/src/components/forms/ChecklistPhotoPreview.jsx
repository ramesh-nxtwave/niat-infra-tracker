import React, { useState } from 'react';
import EvidenceMedia from '../EvidenceMedia';

export default function ChecklistPhotoPreview({ path, contentType, onOpen }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const isRetry = attempt > 0;
  const retryPath = isRetry
    ? `${path}${path.includes('?') ? '&' : '?'}photoRetry=${attempt}`
    : path;

  return (
    <>
      {failed ? (
        <div role="alert" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary)', padding: '0.5rem', textAlign: 'center' }}>
          <span>This photo could not be loaded. The saved reference is still here.</span>
          <button type="button" onClick={() => { setAttempt(previous => previous + 1); setFailed(false); }}>
            Retry photo
          </button>
        </div>
      ) : (
        <EvidenceMedia
          key={retryPath}
          path={retryPath}
          contentType={contentType}
          alt="Evidence"
          imageStyle={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.2s', cursor: 'zoom-in' }}
          onImageError={() => setFailed(true)}
        />
      )}
      {!failed && (
        <button type="button" aria-label="Open photo" onClick={onOpen}
          style={{ position: 'absolute', inset: 0, border: 0, background: 'transparent', cursor: 'zoom-in' }} />
      )}
    </>
  );
}