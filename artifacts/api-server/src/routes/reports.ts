import { Router, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, requireRole, type AuthRequest } from "../lib/auth";
import { getSchedulerStatus } from "../lib/reportScheduler";
import { gatherReportData } from "../lib/reportGenerator";
import { logger } from "../lib/logger";
import prisma from "../lib/prisma";
import { PendingReportError, pendingReportService } from "../lib/pendingReport";

const router = Router();

router.use(requireAuth);

type CurrentAdmin = { id: string; email: string; role: string; isActive: boolean; isDeleted: boolean } | null;
type PendingReportRouteDependencies = {
  getCurrentAdmin?: (userId: string) => Promise<CurrentAdmin>;
  service?: Pick<typeof pendingReportService, "createPreview" | "confirm">;
};

const readCurrentAdmin = (userId: string): Promise<CurrentAdmin> => prisma.user.findUnique({
  where: { id: userId },
  select: { id: true, email: true, role: true, isActive: true, isDeleted: true },
});

// JWT roles are intentionally rechecked against the current user record for
// manual portfolio delivery. A demoted, deactivated, or deleted admin cannot
// use an otherwise-valid stale token to create or confirm a preview.
function currentAdminMiddleware(getCurrentAdmin: (userId: string) => Promise<CurrentAdmin>) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await getCurrentAdmin(req.user!.userId);
    if (!user || user.isDeleted || !user.isActive || user.role !== "admin") {
      res.status(403).json({ error: "Forbidden: an active administrator account is required" });
      return;
    }
    // Use the current database email in the audit trail, not a stale JWT claim.
    req.user = { ...req.user!, email: user.email, role: user.role };
    next();
  } catch (err) {
    logger.error({ err }, "Could not recheck pending report administrator");
    res.status(503).json({ error: "Could not verify administrator access. Please retry." });
  }
  };
}

const pendingReportLimiter = rateLimit({
  windowMs: 10 * 60 * 1_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many pending report requests. Please wait before trying again." },
});

export function createPendingReportRouter({
  getCurrentAdmin = readCurrentAdmin,
  service = pendingReportService,
}: PendingReportRouteDependencies = {}) {
  const pendingRouter = Router();
  pendingRouter.use(requireAuth);
  const requireCurrentAdmin = currentAdminMiddleware(getCurrentAdmin);

  pendingRouter.post("/reports/pending/preview", requireRole("admin"), requireCurrentAdmin, pendingReportLimiter, async (req: AuthRequest, res) => {
    try {
      // Only validated recipients, university IDs, and room-section keys are
      // accepted; rendered content and checklist data remain server-owned.
      res.json(await service.createPreview(req.user!.userId, req.user!.email, req.body));
    } catch (err: any) {
      if (err instanceof PendingReportError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Pending report preview failed");
      res.status(500).json({ error: "Failed to generate pending report preview" });
    }
  });

  pendingRouter.post("/reports/pending/send", requireRole("admin"), requireCurrentAdmin, pendingReportLimiter, async (req: AuthRequest, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 2 || typeof body.previewId !== "string" || body.confirmed !== true) {
      res.status(400).json({ error: "Send requires exactly { previewId, confirmed: true } after reviewing the preview." });
      return;
    }
    try {
      res.json(await service.confirm({
        previewId: body.previewId,
        confirmed: body.confirmed,
        userId: req.user!.userId,
        userEmail: req.user!.email,
      }));
    } catch (err: any) {
      if (err instanceof PendingReportError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Pending report confirmation failed");
      res.status(500).json({ error: "Failed to submit the pending report. No provider acceptance was recorded." });
    }
  });
  return pendingRouter;
}

router.use(createPendingReportRouter());

// GET /api/reports/status — scheduler status + last run info (admin only)
router.get("/reports/status", requireRole("admin"), (_req, res) => {
  res.json(getSchedulerStatus());
});

// GET /api/reports/preview — get the raw data that would be in the next report (admin only)
router.get("/reports/preview", requireRole("admin"), async (_req, res) => {
  try {
    const data = await gatherReportData();
    res.json(data);
  } catch (err: any) {
    logger.error({ err }, "Report preview failed");
    res.status(500).json({ error: "Failed to generate report preview" });
  }
});

// The scheduled report is deliberately not callable through a manual endpoint.
// Manual delivery must create a server-owned snapshot and explicitly confirm it.
router.post("/reports/send", requireRole("admin"), (_req, res) => {
  res.status(410).json({
    error: "This endpoint is retired. Create a pending report preview, review it, then confirm it at POST /api/reports/pending/send.",
  });
});

export default router;
