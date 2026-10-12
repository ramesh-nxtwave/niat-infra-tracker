import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth, AuthRequest } from "../lib/auth";
import { registerEvidenceUploadIntent } from "../lib/evidenceGc";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const RequestUploadUrlBody = z.object({
  name: z.string().min(1),
  size: z.number().positive().max(500 * 1024 * 1024),
  contentType: z.string().regex(/^(image\/(jpeg|jpg|png|gif|webp|heic|heif)|video\/(mp4|quicktime|x-msvideo|avi|mov)|application\/pdf)$/i, {
    message: "Only images, videos (MP4/MOV/AVI), and PDFs are allowed",
  }),
});

/**
 * POST /storage/uploads/request-url
 * Request a presigned URL for direct-to-GCS upload (requires auth to prevent abuse).
 * Client sends JSON metadata (NOT the file bytes), then uploads directly to GCS.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }

  try {
    // Register the canonical object before returning its URL. This makes an
    // upload intent visible to GC even when the browser abandons the PUT.
    const { uploadURL, objectPath } = await objectStorageService.getObjectEntityUploadIntent();
    await registerEvidenceUploadIntent({
      objectPath,
      contentType: parsed.data.contentType,
      sizeBytes: parsed.data.size,
      originalName: parsed.data.name,
      requestedByUserId: req.user?.userId,
    });
    res.json({ uploadURL, objectPath });
  } catch (error) {
    req.log?.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 * Serve public assets unconditionally — no auth or ACL checks.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) { res.status(404).json({ error: "File not found" }); return; }

    const response = await objectStorageService.downloadObject(file, 3600, req.headers.range);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log?.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 * Serve uploaded evidence objects — NO auth required.
 * Browser <img> tags cannot send Authorization headers, so this must be public.
 * Write operations (upload, delete) remain protected.
 * Images are stored in GCS so they persist across deployments.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile, 3600, req.headers.range);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log?.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
