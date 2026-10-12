/**
 * Build an absolute, click-able URL for any stored image/video path.
 */
export const getImageUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/objects/')) {
    return `${window.location.origin}${path}`;
  }
  const clean = path.replace(/^(\/api\/uploads\/)+/, '/api/uploads/');
  return `${window.location.origin}${clean}`;
};

export const isVideoFile = (path, contentType) => {
  if (isVideoMime(contentType)) return true;
  if (!path) return false;
  try {
    const url = new URL(path, window.location.origin);
    if (url.searchParams.get('media') === 'video') return true;
  } catch {
    // Fall through to extension detection for legacy relative paths.
  }
  const ext = (path.split('?')[0].split('.').pop() || '').toLowerCase();
  return ['mp4', 'mov', 'avi', 'quicktime'].includes(ext);
};

export const markMediaPath = (path, file) => {
  if (!path || !(isVideoMime(file?.type) || isVideoFile(file?.name))) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}media=video`;
};

export const isVideoMime = (mimeType) => {
  return (mimeType || '').startsWith('video/');
};

export const isImageMime = (mimeType) => {
  return (mimeType || '').startsWith('image/');
};

export const UNSUPPORTED_VIDEO_MESSAGE =
  'This video cannot be played in your browser and was not added. Convert it to MP4 using H.264 video and AAC audio, then try again.';

/**
 * Ask the current browser to decode enough of a local video to produce frame data.
 * A matching extension or MIME type alone is not sufficient because MP4/MOV/AVI
 * containers can hold codecs that HTML video cannot play.
 */
export const validateVideoPlayback = (file, {
  createVideo = () => document.createElement('video'),
  createObjectURL = (value) => URL.createObjectURL(value),
  revokeObjectURL = (value) => URL.revokeObjectURL(value),
  timeoutMs = 10000,
} = {}) => {
  if (!(isVideoMime(file?.type) || isVideoFile(file?.name || ''))) {
    return Promise.resolve({ supported: true });
  }

  return new Promise(resolve => {
    const video = createVideo();
    const objectUrl = createObjectURL(file);
    let settled = false;

    const finish = (supported) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
      video.removeAttribute?.('src');
      video.load?.();
      revokeObjectURL(objectUrl);
      resolve(supported
        ? { supported: true }
        : { supported: false, message: UNSUPPORTED_VIDEO_MESSAGE });
    };
    const onLoadedData = () => finish(true);
    const onError = () => finish(false);
    const timeout = setTimeout(onError, timeoutMs);

    video.preload = 'auto';
    video.muted = true;
    video.addEventListener('loadeddata', onLoadedData, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.src = objectUrl;
    video.load?.();
  });
};

export const validateSelectedMediaFiles = async (files) => {
  const accepted = [];
  const rejected = [];

  for (const file of Array.from(files || [])) {
    const result = await validateVideoPlayback(file);
    if (result.supported) accepted.push(file);
    else rejected.push({ file, message: result.message });
  }

  return { accepted, rejected };
};

let heicPromise = null;

export const compressImage = async (file, maxWidth = 1280, quality = 0.75) => {
  if (isVideoMime(file.type)) {
    return { blob: file, size: Math.round(file.size / 1024), originalSize: Math.round(file.size / 1024) };
  }

  let processingFile = file;

  const isHeic =
    file.name?.toLowerCase().endsWith('.heic') ||
    file.name?.toLowerCase().endsWith('.heif') ||
    file.type === 'image/heic' ||
    file.type === 'image/heif';

  if (isHeic) {
    try {
      if (!heicPromise) heicPromise = import('heic2any').then(m => m.default || m);
      const heic2any = await heicPromise;
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 });
      processingFile = Array.isArray(converted) ? converted[0] : converted;
    } catch (err) {
      if (!err.message?.includes('format not supported')) console.warn('HEIC conversion failed:', err.message);
    }
  }

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      resolve({ blob: file, size: Math.round(file.size / 1024), originalSize: Math.round(file.size / 1024), failed: true });
    }, 20000);

    const img = new Image();
    const objectUrl = URL.createObjectURL(processingFile);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height) {
          if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
        } else {
          if (height > maxWidth) { width = Math.round((width * maxWidth) / height); height = maxWidth; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) return resolve({ blob: file, size: Math.round(file.size / 1024), originalSize: Math.round(file.size / 1024), failed: true });
          resolve({ blob, size: Math.round(blob.size / 1024), originalSize: Math.round(file.size / 1024) });
        }, 'image/jpeg', quality);
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve({ blob: file, size: Math.round(file.size / 1024), originalSize: Math.round(file.size / 1024), failed: true });
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      resolve({ blob: file, size: Math.round(file.size / 1024), originalSize: Math.round(file.size / 1024), failed: true });
    };

    img.src = objectUrl;
  });
};

async function withRetry(fn, maxAttempts = 3, baseDelayMs = 800) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const isNetworkErr = err.message?.includes('network') || err.message?.includes('GCS upload');
      if (!isNetworkErr || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[upload] Attempt ${attempt} failed (${err.message}), retrying in ${delay}ms…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Upload a single file (image or video) using Replit Object Storage.
 * Returns the objectPath stored in DB.
 */
export const uploadAuditPhoto = async (_universityId, _statusUpdateId, file, _uploadedBy = 'Field Team', onProgress) => {
  onProgress?.(5);

  const isVideo = isVideoMime(file.type) || isVideoFile(file.name);
  let uploadFile = file;

  if (!isVideo) {
    const { blob } = await compressImage(file);
    const detectedType = blob.type || file.type || 'image/jpeg';
    const fileName = (file.name || 'photo.jpg').replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    uploadFile = new File([blob], fileName, { type: detectedType });
  } else {
    const fileName = (file.name || 'video.mp4').replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const mimeType = file.type || 'video/mp4';
    uploadFile = new File([file], fileName, { type: mimeType });
  }

  onProgress?.(15);

  const token = localStorage.getItem('niat_token');
  const detectedType = uploadFile.type;

  const { uploadURL, objectPath } = await withRetry(async () => {
    const urlResp = await fetch('/api/storage/uploads/request-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ name: uploadFile.name, size: uploadFile.size, contentType: detectedType }),
    });
    if (!urlResp.ok) {
      const body = await urlResp.json().catch(() => ({}));
      throw new Error(body.error || `Failed to get upload URL (HTTP ${urlResp.status})`);
    }
    return urlResp.json();
  });

  onProgress?.(25);

  await withRetry(async (attempt) => {
    if (attempt > 1) onProgress?.(25);
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(25 + Math.round((e.loaded / e.total) * 65));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`GCS upload failed: ${xhr.status} ${xhr.statusText}`));
      });
      xhr.addEventListener('error', () => reject(new Error('GCS upload network error')));
      xhr.addEventListener('abort', () => reject(new Error('GCS upload aborted')));

      xhr.open('PUT', uploadURL);
      xhr.setRequestHeader('Content-Type', detectedType);
      xhr.send(uploadFile);
    });
  });

  onProgress?.(95);
  return { objectPath, contentType: detectedType };
};

/**
 * Upload multiple files concurrently (up to `concurrency` at a time).
 * Returns array of { file, objectPath, error } results.
 */
export const uploadMultipleFiles = async (files, universityId, statusUpdateId, uploadedBy, onFileProgress) => {
  const CONCURRENCY = 3;
  const results = [];
  const queue = [...files];
  const inFlight = new Set();

  const runOne = async (file, index) => {
    try {
      const upload = await uploadAuditPhoto(universityId, statusUpdateId, file, uploadedBy, (pct) => {
        onFileProgress?.(index, pct);
      });
      results[index] = { file, ...upload, error: null };
    } catch (err) {
      results[index] = { file, objectPath: null, error: err.message };
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, async (_, workerIdx) => {
    let i = workerIdx;
    while (i < files.length) {
      await runOne(files[i], i);
      i += CONCURRENCY;
    }
  });

  await Promise.all(workers);
  return results;
};

/**
 * Fetch photo history for a checklist status item from the API.
 */
export const fetchPhotoHistory = async (statusUpdateId) => {
  try {
    const token = localStorage.getItem('niat_token');
    const resp = await fetch(`/api/photo-history/${statusUpdateId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data || []).map(h => ({
      ...h,
      photo_url: h.photoUrl,
      content_type: h.contentType,
      uploaded_at: h.uploadedAt,
      uploaded_by: h.uploadedBy,
    }));
  } catch {
    return [];
  }
};
