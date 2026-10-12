import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth, AuthRequest } from "../lib/auth";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { uploadsDir as uploadDir } from "../lib/paths";

const router = Router();

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    // Randomized filenames make files unguessable — safe to serve publicly
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|heic|heif|pdf)$/i;
    if (allowed.test(file.originalname)) cb(null, true);
    else cb(new Error("Only images and PDFs are allowed"));
  },
});

// DEPRECATED: Use the presigned-URL flow via POST /api/storage/uploads/request-url instead.
// This endpoint is kept to serve legacy in-flight requests but returns 410 Gone for new calls.
router.post("/upload", requireAuth, (_req, res) => {
  res.status(410).json({
    error: "This upload endpoint is deprecated. Use POST /api/storage/uploads/request-url for presigned GCS uploads.",
    docs: "POST /api/storage/uploads/request-url → PUT to uploadURL → store objectPath",
  });
});

// NOTE: /uploads/:filename is served as static files from app.ts (before this router)
// so <img src> browser requests work without a Bearer token.

// All routes below this line require authentication
router.use(requireAuth);

// Get all evidence (photos with metadata) — paginated
router.get("/evidence", async (req: AuthRequest, res) => {
  try {
    const { category, search } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 48));

    const where: any = { photoUrl: { not: null } };
    if (category && category !== "All") {
      where.checklistItem = { category: { contains: category as string, mode: "insensitive" } };
    }
    if (search) {
      where.OR = [
        { university: { name: { contains: search as string, mode: "insensitive" } } },
        { checklistItem: { name: { contains: search as string, mode: "insensitive" } } },
      ];
    }

    // Role-based scoping — mirrors buildVisibilityFilter in universities.ts.
    // Empty assignments must resolve to deny-all, not unscoped global access.
    if (req.user?.role === "zonal_manager") {
      where.university = req.user.zoneIds?.length
        ? { ...where.university, zoneId: { in: req.user.zoneIds } }
        : { id: "__NONE__" };
    } else if (req.user?.role === "apm") {
      where.university = req.user.universityIds?.length
        ? { ...where.university, id: { in: req.user.universityIds } }
        : { id: "__NONE__" };
    }

    const [evidence, total] = await Promise.all([
      prisma.spaceChecklistStatus.findMany({
        where,
        include: {
          university: { select: { id: true, name: true, location: true, zoneId: true } },
          space: { select: { id: true, name: true, spaceType: true } },
          checklistItem: { select: { name: true, category: true } },
          photoHistory: { orderBy: { uploadedAt: "desc" }, take: 5 },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.spaceChecklistStatus.count({ where }),
    ]);

    const formatted = evidence.map(e => ({
      id: e.id,
      uniName: e.university.name,
      uniId: e.university.id,
      location: e.university.location || "",
      source: e.space.name,
      category: e.checklistItem.category,
      itemName: e.checklistItem.name,
      status: e.currentStatus,
      photoUrl: e.photoUrl,
      photoContentType: e.photoContentType,
      lastUpdated: e.updatedAt,
      photoHistory: e.photoHistory,
    }));

    res.json({ data: formatted, total, page, pages: Math.ceil(total / limit), limit });
  } catch (err) {
    logger.error({ err }, "Get evidence error");
    res.status(500).json({ error: "Failed to get evidence" });
  }
});

// Photo history for a specific status item
// Ownership check: verify the status belongs to a university visible to the caller
router.get("/photo-history/:statusId", async (req: AuthRequest, res) => {
  try {
    const statusId = req.params.statusId as string;
    const status = await prisma.spaceChecklistStatus.findUnique({
      where: { id: statusId },
      select: { universityId: true },
    });
    if (!status) { res.status(404).json({ error: "Not found" }); return; }

    const role = req.user?.role;
    if (role === "apm") {
      const uniIds = req.user?.universityIds ?? [];
      if (!uniIds.includes(status.universityId)) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    const history = await prisma.photoHistory.findMany({
      where: { statusId },
      orderBy: { uploadedAt: "desc" },
    });
    res.json(history);
  } catch (err) {
    logger.error({ err }, "Photo history error");
    res.status(500).json({ error: "Failed to get photo history" });
  }
});

export default router;
