export function inferEvidenceContentType(
  photoUrl: string | null | undefined,
  contentType?: string | null,
): string | null {
  if (contentType) return contentType;
  if (!photoUrl) return null;
  try {
    const url = new URL(photoUrl, "http://localhost");
    if (url.searchParams.get("media") === "video") return "video/mp4";
  } catch {
    // Fall through to extension detection for legacy relative paths.
  }
  const extension = photoUrl.split("?")[0].split(".").pop()?.toLowerCase();
  const videoTypes: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
  };
  const imageTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return (extension && (videoTypes[extension] || imageTypes[extension])) || null;
}

export function resolveEvidenceContentType({
  photoUrl,
  contentType,
  existingPhotoUrl,
  existingContentType,
}: {
  photoUrl: string | null;
  contentType?: string | null;
  existingPhotoUrl?: string | null;
  existingContentType?: string | null;
}): string | null {
  if (contentType !== undefined) {
    return inferEvidenceContentType(photoUrl, contentType);
  }
  if (photoUrl === existingPhotoUrl && existingContentType) {
    return existingContentType;
  }
  return inferEvidenceContentType(photoUrl);
}