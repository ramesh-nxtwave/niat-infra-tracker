import { supabase } from '../config/supabase';

let heicPromise = null;

/**
 * Compress an image file using an offscreen canvas.
 */
export const compressImage = async (file, maxWidth = 1024, quality = 0.6) => {
  let processingFile = file;
  let isHeic = false;

  // 1. Handle HEIC/HEIF conversion
  isHeic = file.name?.toLowerCase().endsWith('.heic') || file.name?.toLowerCase().endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif';
  
  if (isHeic) {
    console.log('🔄 HEIC/HEIF detected, converting...');
    try {
      if (!heicPromise) {
        heicPromise = import('heic2any').then(m => m.default || m);
      }
      const heic2any = await heicPromise;
      
      const convertedBlob = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.7
      });
      
      processingFile = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
      console.log('✅ HEIC converted successfully');
    } catch (err) {
      // Only log if it's not a common browser limitation error
      if (!err.message?.includes('format not supported') && !err.message?.includes('libheif')) {
        console.warn('⚠️ HEIC conversion failed:', err.message);
      }
    }
  }

  return new Promise((resolve, reject) => {
    // Large files might take time to load into an Image object
    const timeout = setTimeout(() => {
      console.warn('⚠️ Image load timed out, falling back to raw upload.');
      resolve({ blob: file, size: Math.round(file.size / 1024), originalSize: Math.round(file.size / 1024), failed: true });
    }, 20000);

    const img = new Image();
    const objectUrl = URL.createObjectURL(processingFile);
    
    img.onload = () => {
      clearTimeout(timeout);
      
      try {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
        } else {
          if (height > maxWidth) { width = Math.round((width * maxWidth) / height); height = maxWidth; }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl);
            if (!blob) {
              console.warn('⚠️ Canvas toBlob failed, falling back to raw upload.');
              return resolve({ blob: file, size: Math.round(file.size / 1024), originalSize: Math.round(file.size / 1024), failed: true });
            }
            const sizeInKB = Math.round(blob.size / 1024);
            resolve({ blob, size: sizeInKB, originalSize: Math.round(file.size / 1024) });
          },
          'image/jpeg',
          quality
        );
      } catch (canvasErr) {
        console.warn('⚠️ Canvas processing failed:', canvasErr);
        URL.revokeObjectURL(objectUrl);
        resolve({ blob: file, size: Math.round(file.size / 1024), originalSize: Math.round(file.size / 1024), failed: true });
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      console.warn('⚠️ Browser could not load image for compression, falling back to raw upload.');
      // Resolve with original file so the upload can still proceed
      resolve({ blob: file, size: Math.round(file.size / 1024), originalSize: Math.round(file.size / 1024), failed: true });
    };

    img.src = objectUrl;
  });
};

/**
 * Upload a photo to the Supabase `audit-photos` storage bucket.
 */
export const uploadAuditPhoto = async (universityId, statusUpdateId, file, uploadedBy = 'Field Team') => {
  if (!supabase) throw new Error('Supabase client not initialised');

  // 1. Process/Compress before upload (Fail-safe)
  const processed = await compressImage(file);
  if (processed.failed) {
    console.log('📦 Using original file for upload (Compression skipped/failed)');
  } else {
    console.log(`📸 Compressed: ${processed.originalSize} KB → ${processed.size} KB`);
  }

  const { blob, size } = processed;

  // 2. Build a UNIQUE path
  const timestamp = Date.now();
  const fileName = (file.name || 'photo.jpg').replace(/[^a-z0-9.]/gi, '_').toLowerCase();
  const path = `university-${universityId}/${statusUpdateId}/${timestamp}_${fileName}`;
  
  // 3. Convert Blob to File for better compatibility, preserving the actual mime type
  const detectedType = blob.type || file.type || 'image/jpeg';
  const uploadFile = new File([blob], fileName, { type: detectedType });
  
  console.log(`📡 Uploading to storage: ${path} (${size} KB, Type: ${detectedType})...`);
  
  const uploadWithRetry = async (attempt = 1) => {
    try {
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('audit-photos')
        .upload(path, uploadFile, { 
          contentType: detectedType, 
          cacheControl: '3600', 
          upsert: true 
        });

      if (uploadError) throw uploadError;
      return uploadData;
    } catch (err) {
      // Retry on network errors or timeouts (Supabase client timeout is usually much longer)
      if (attempt < 3 && (err.message?.includes('timeout') || err.status === 504 || err.status === 502 || !err.status)) {
        console.warn(`⚠️ Upload attempt ${attempt} failed. Retrying in ${attempt * 2}s...`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
        return uploadWithRetry(attempt + 1);
      }
      throw err;
    }
  };

  try {
    await uploadWithRetry();
    console.log('📦 Storage upload successful');
  } catch (err) {
    console.error('❌ Supabase Storage Error:', err);
    throw new Error(`Upload failed: ${err.message || 'Check your internet connection.'}`);
  }

  // 4. Get the public URL
  const { data } = supabase.storage.from('audit-photos').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not retrieve public URL');

  const publicUrl = data.publicUrl;
  console.log(`✅ Photo uploaded → ${publicUrl}`);

  // 5. Record in photo_history table so the timeline is preserved
  const { error: historyError } = await supabase.from('photo_history').insert([{
    status_id: statusUpdateId,
    photo_url: publicUrl,
    uploaded_by: uploadedBy,
    uploaded_at: new Date().toISOString(),
  }]);

  if (historyError) {
    // Non-fatal — log but don't block the upload returning its URL
    console.warn('⚠️ photo_history insert failed (table may not exist yet):', historyError.message);
  } else {
    console.log('📜 Photo history record created');
  }

  return publicUrl;
};

/**
 * Fetch the full photo history for a single checklist item.
 * @param {string} statusUpdateId – the status_update UUID
 * @returns {Promise<Array>}       – array of { id, photo_url, uploaded_by, uploaded_at }
 */
export const fetchPhotoHistory = async (statusUpdateId) => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('photo_history')
    .select('id, photo_url, uploaded_by, uploaded_at')
    .eq('status_id', statusUpdateId)
    .order('uploaded_at', { ascending: false });
  if (error) {
    console.warn('fetchPhotoHistory error:', error.message);
    return [];
  }
  return data || [];
};
