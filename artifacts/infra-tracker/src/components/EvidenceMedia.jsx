import React, { useEffect, useState } from 'react';
import { getImageUrl, isImageMime, isVideoFile } from '../utils/imageUtils';

export default function EvidenceMedia({
  path,
  contentType,
  alt = 'Evidence',
  imageStyle,
  videoStyle,
  controls = true,
  muted = false,
  autoPlay = false,
  loop = false,
  preload = 'metadata',
  onImageError,
  failureMessage,
  reloadKey,
}) {
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState(() => {
    if (isVideoFile(path, contentType)) return 'video';
    if (isImageMime(contentType)) return 'image';
    return 'unknown';
  });
  const src = getImageUrl(path);

  useEffect(() => {
    setFailed(false);
    let active = true;
    if (!path) {
      setKind('unknown');
      return () => { active = false; };
    }
    if (isVideoFile(path, contentType)) {
      setKind('video');
      return () => { active = false; };
    }
    if (isImageMime(contentType)) {
      setKind('image');
      return () => { active = false; };
    }

    setKind('unknown');
    fetch(src, { method: 'HEAD' })
      .then(response => {
        if (!active) return;
        const type = response.headers.get('content-type') || '';
        setFailed(false);
        setKind(type.toLowerCase().startsWith('video/') ? 'video' : 'image');
      })
      .catch(() => {
        if (active) setKind('image');
      });
    return () => { active = false; };
  }, [path, src, contentType, reloadKey]);

  const handleError = event => {
    if (failureMessage) setFailed(true);
    if (kind !== 'video') onImageError?.(event);
  };
  if (failed && failureMessage) {
    return <span className="evidence-media-error" role="status">{failureMessage}</span>;
  }

  if (kind === 'video') {
    return (
      <video
        src={src}
        controls={controls}
        muted={muted}
        autoPlay={autoPlay}
        loop={loop}
        preload={preload}
        playsInline
        style={videoStyle || imageStyle}
        aria-label={alt}
        onError={handleError}
      />
    );
  }

  return <img src={src} alt={alt} style={imageStyle} onError={handleError} />;
}