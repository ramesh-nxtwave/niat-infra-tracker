import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "../lib/auth";
import {
  applyEvidenceGc,
  getEvidenceGcRun,
  runEvidenceGcDryRun,
} from "../lib/evidenceGc";
import { logger } from "../lib/logger";
import prisma from "../lib/prisma";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin"));

router.use(async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { email: true, role: true, isActive: true, isDeleted: true },
    });
    if (!user || user.role !== "admin" || !user.isActive || user.isDeleted) {
      res.status(403).json({ error: "Forbidden: an active administrator account is required" });
      return;
    }
    req.user = { ...req.user!, email: user.email };
    next();
  } catch (error) {
    logger.error({ err: error }, "Could not verify evidence GC administrator");
    res.status(503).json({ error: "Could not verify administrator access. Please retry." });
  }
});

const GcOptions = z.object({
  retentionDays: z.number().int().min(30).max(3650).optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict();

/**
 * POST /api/evidence-gc/dry-run
 *
 * A dry-run is durable and bounded. It never changes object state or calls
 * storage. It records bounded counts, not a frozen candidate manifest; apply
 * re-evaluates references and eligibility under its own transaction.
 */
router.post("/evidence-gc/dry-run", async (req: AuthRequest, res) => {
  const parsed = GcOptions.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid GC options" });
    return;
  }
  try {
    res.json(await runEvidenceGcDryRun({
      ...parsed.data,
      actorUserId: req.user?.userId,
      actorEmail: req.user?.email,
    }));
  } catch (error) {
    logger.error({ err: error }, "Evidence GC dry-run failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Evidence GC dry-run failed" });
  }
});

const ApplyBody = GcOptions.extend({
  dryRunId: z.string().min(1),
}).strict();

/**
 * POST /api/evidence-gc/apply
 *
 * Physical deletion is never implicit: the operator must submit the completed
 * dry-run id with matching retention and bound before this endpoint claims any
 * object. The apply transaction re-checks current references and eligibility,
 * so its bounded selection may differ from the preview. Claimed rows remain
 * in the deleting tombstone on a crash and can be retried by a later explicit
 * apply.
 */
router.post("/evidence-gc/apply", async (req: AuthRequest, res) => {
  const parsed = ApplyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "dryRunId and GC options are required" });
    return;
  }
  try {
    res.json(await applyEvidenceGc({
      ...parsed.data,
      actorUserId: req.user?.userId,
      actorEmail: req.user?.email,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evidence GC apply failed";
    if (/dry-run id|same retentionDays/.test(message)) {
      res.status(409).json({ error: message });
      return;
    }
    logger.error({ err: error }, "Evidence GC apply failed");
    res.status(500).json({ error: message });
  }
});

router.get("/evidence-gc/runs/:runId", async (req, res) => {
  try {
    const run = await getEvidenceGcRun(req.params.runId as string);
    if (!run) {
      res.status(404).json({ error: "Evidence GC run not found" });
      return;
    }
    res.json(run);
  } catch (error) {
    logger.error({ err: error }, "Evidence GC run lookup failed");
    res.status(500).json({ error: "Failed to read evidence GC run" });
  }
});

export default router;