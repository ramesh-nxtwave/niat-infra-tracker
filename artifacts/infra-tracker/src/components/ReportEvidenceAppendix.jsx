import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { Paperclip } from 'lucide-react';
import EvidenceMedia from './EvidenceMedia';
import { getImageUrl, isVideoFile } from '../utils/imageUtils';
import useViewportGate from '../hooks/useViewportGate';

function loadPrintableImage(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    const timeout = window.setTimeout(() => reject(new Error(`Timed out loading attachment: ${url}`)), timeoutMs);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error(`Could not load attachment: ${url}`));
    };
    image.src = url;
  });
}

export async function prepareReportImages(attachments, onProgress, loadImage = loadPrintableImage) {
  const urls = attachments
    .filter(attachment => !isVideoFile(attachment.url, attachment.contentType))
    .map(attachment => getImageUrl(attachment.url));
  let nextIndex = 0;
  let loaded = 0;
  onProgress?.({ loaded, total: urls.length });

  const worker = async () => {
    while (nextIndex < urls.length) {
      const index = nextIndex++;
      await loadImage(urls[index]);
      loaded += 1;
      onProgress?.({ loaded, total: urls.length });
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, urls.length) }, worker));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function AppendixCard({ attachment, index, forceLoad, onOpen }) {
  const isVideo = isVideoFile(attachment.url, attachment.contentType);
  const { targetRef, visible, load } = useViewportGate(forceLoad);
  const context = [attachment.area, attachment.classroomName, attachment.category].filter(Boolean).join(' · ');
  const alt = `${isVideo ? 'Video evidence' : 'Evidence'} for ${attachment.lineItem}${attachment.classroomName ? ` in ${attachment.classroomName}` : ''}`;

  return (
    <figure className="evidence-appendix-card" ref={targetRef}
      data-report-anchor={`attachment:${attachment.reportItemId}:${attachment.id || attachment.url}:${attachment.classroomName || attachment.area || ''}`}>
      {visible ? (
        isVideo ? (
          <>
            <div className="evidence-appendix-media no-print">
              <EvidenceMedia path={attachment.url} contentType={attachment.contentType} alt={alt} controls preload="none"
                failureMessage="Video preview unavailable." />
            </div>
            <div className="evidence-appendix-print-media print-only">
              <div className="evidence-video-reference"><Paperclip size={18} /> Video attachment<br /><small>{attachment.url}</small></div>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="evidence-appendix-media evidence-appendix-image-button"
            onClick={() => onOpen(attachment)}
            aria-label={`Open attachment for ${attachment.lineItem}${attachment.classroomName ? ` in ${attachment.classroomName}` : ''}`}
          >
            <EvidenceMedia path={attachment.url} contentType={attachment.contentType} alt={alt}
              reloadKey={forceLoad}
              failureMessage="Preview unavailable. Open attachment to view the original." />
          </button>
        )
      ) : (
        <button
          type="button"
          className="evidence-appendix-media evidence-appendix-placeholder no-print"
          onClick={load}
          aria-label={`Load attachment preview for ${attachment.lineItem}`}
        >
          <Paperclip size={20} aria-hidden="true" />
          Load preview
        </button>
      )}
      <figcaption>
        <strong>{attachment.lineItem}</strong>
        <span>{context}</span>
        <small>Attachment {index + 1}</small>
        <a className="no-print" href={getImageUrl(attachment.url)} target="_blank" rel="noopener noreferrer">
          Open original evidence
        </a>
      </figcaption>
    </figure>
  );
}

const ReportEvidenceAppendix = forwardRef(function ReportEvidenceAppendix({ attachments, onOpen }, ref) {
  const [forceLoad, setForceLoad] = useState(false);
  const attachmentKey = useMemo(
    () => attachments.map(attachment => `${attachment.id || ''}:${attachment.url}`).join('|'),
    [attachments],
  );
  const printImageCount = useMemo(
    () => attachments.filter(attachment => !isVideoFile(attachment.url, attachment.contentType)).length,
    [attachments],
  );

  useEffect(() => {
    setForceLoad(false);
  }, [attachmentKey]);

  useImperativeHandle(ref, () => ({
    printImageCount,
    mountForPrint: () => setForceLoad(true),
    prepareForPrint: async onProgress => {
      await prepareReportImages(attachments, onProgress);
      setForceLoad(true);
    },
  }), [attachments, printImageCount]);

  return (
    <section className="glass-panel work-report-section evidence-appendix" aria-labelledby="evidence-appendix-title">
      <div className="work-report-section-title">
        <Paperclip size={19} />
        <h2 id="evidence-appendix-title">Attachment Appendix</h2>
        <span>{attachments.length} attachment{attachments.length === 1 ? '' : 's'} for visible items</span>
      </div>
      {attachments.length ? (
        <div className="evidence-appendix-grid">
          {attachments.map((attachment, index) => (
            <AppendixCard
              attachment={attachment}
              index={index}
              forceLoad={forceLoad}
              onOpen={onOpen}
              key={`${attachment.reportItemId}-${attachment.id || attachment.url}-${attachment.classroomName || attachment.area || ''}`}
            />
          ))}
        </div>
      ) : <p className="evidence-appendix-empty">No attachments are available for the currently visible report items.</p>}
    </section>
  );
});

export default ReportEvidenceAppendix;