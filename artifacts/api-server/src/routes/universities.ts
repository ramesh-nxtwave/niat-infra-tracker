import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Router, type Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, AuthRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  validate,
  CreateUniversityBody,
  UpdateUniversityBody,
  UpdateUniversityCriticalBody,
  UpdateUniversityReportPriorityBody,
  IdParam,
  CreateActionItemBody,
  UpdateActionItemBody,
   CreateClassroomBody,
   UpdateClassroomBody,
   ResolveClassroomSpaceBody,
} from "../middleware/validate";
import { stripObjectPathMetadata } from "../lib/objectStorage";
import { buildDailyReport, invalidateDailyReport } from "../lib/dailyReport";
import { inferEvidenceContentType, resolveEvidenceContentType } from "../lib/evidenceMedia";

const router = Router();
router.use(requireAuth);

const universityChecklistMutationTails = new Map<string, Promise<void>>();

type ChecklistMutationTiming = {
  admissionWaitMs: number;
  mutationMs: number;
};

async function withUniversityChecklistMutation<T>(
  universityId: string,
  mutation: () => Promise<T>,
  onTiming?: (timing: ChecklistMutationTiming) => void,
): Promise<T> {
  const queuedAt = performance.now();
  const previous = universityChecklistMutationTails.get(universityId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  universityChecklistMutationTails.set(universityId, current);

  await previous;
  const admittedAt = performance.now();
  try {
    return await mutation();
  } finally {
    onTiming?.({
      admissionWaitMs: Math.max(0, Math.round(admittedAt - queuedAt)),
      mutationMs: Math.max(0, Math.round(performance.now() - admittedAt)),
    });
    release();
    if (universityChecklistMutationTails.get(universityId) === current) {
      universityChecklistMutationTails.delete(universityId);
    }
  }
}

class ChecklistMutationRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly responseCode: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChecklistMutationRouteError";
  }
}

function checklistCorrelationId(req: AuthRequest): string {
  const existing = (req as AuthRequest & { id?: string | number }).id;
  if (existing !== undefined) return String(existing);
  const generated = randomUUID();
  (req as AuthRequest & { id?: string }).id = generated;
  return generated;
}

function sendChecklistMutationError(
  req: AuthRequest,
  res: Response,
  err: unknown,
  details: { operation: "single" | "bulk"; universityId: string; statusId?: string },
): void {
  const correlationId = checklistCorrelationId(req);
  res.set("X-Correlation-Id", correlationId);

  if (err instanceof ChecklistMutationRouteError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.responseCode,
      correlationId,
      ...(err.details ?? {}),
    });
    return;
  }

  const errorCode = (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof err.code === "string"
  ) ? err.code : undefined;
  const errorType = err instanceof Error ? err.name : typeof err;

  // Deliberately log identifiers and error classification only. Prisma validation
  // errors can echo input values, so logging the full error could expose remarks.
  (req.log ?? logger).error({
    correlationId,
    operation: details.operation,
    universityId: details.universityId,
    statusId: details.statusId,
    errorCode,
    errorType,
  }, "Checklist mutation failed");

  if (errorCode === "P2028") {
    res.status(503).json({
      error: "Checklist save is temporarily busy. No changes were saved; retry this save.",
      code: "CHECKLIST_SAVE_BUSY",
      correlationId,
    });
    return;
  }
  if (errorCode === "P2034") {
    res.status(409).json({
      error: "Checklist changed concurrently. Refresh the checklist and retry this save.",
      code: "CHECKLIST_SAVE_CONFLICT",
      correlationId,
    });
    return;
  }
  if (errorCode === "P2003") {
    res.status(409).json({
      error: "A related checklist record changed. Refresh and retry; sign in again if this continues.",
      code: "CHECKLIST_RELATED_RECORD_CHANGED",
      correlationId,
    });
    return;
  }

  res.status(500).json({
    error: "Checklist save could not be confirmed. Refresh the checklist before retrying.",
    code: "CHECKLIST_SAVE_UNCONFIRMED",
    correlationId,
  });
}

function buildVisibilityFilter(user: AuthRequest["user"]) {
  if (!user || user.role === "admin") return {};
  if (user.role === "zonal_manager") {
    if (!user.zoneIds?.length) return { id: "__NONE__" };
    return { zoneId: { in: user.zoneIds } };
  }
  if (user.role === "apm") {
    if (!user.universityIds?.length) return { id: "__NONE__" };
    return { id: { in: user.universityIds } };
  }
  return { id: "__NONE__" };
}

async function canAccessUniversity(user: AuthRequest["user"], universityId: string): Promise<boolean> {
  if (!user) return false;
  if (user.role === "admin") return true;
  // Keep the requested id authoritative.  In particular, the APM visibility
  // filter also contains an `id` predicate; spreading it after this id would
  // accidentally turn an access check into "any assigned university".  Keep
  // both predicates in AND so the deny-all id used for an unassigned APM is
  // not overwritten either.
  const visibility = buildVisibilityFilter(user);
  const where = {
    ...visibility,
    isDeleted: false,
    AND: [{ id: universityId }],
  };
  const count = await prisma.university.count({ where });
  return count > 0;
}

async function syncReadiness(
  db: Pick<Prisma.TransactionClient, "$executeRaw">,
  universityId: string,
): Promise<void> {
  await db.$executeRaw`
    UPDATE universities
    SET overall_readiness = COALESCE((
      SELECT ROUND(
        COUNT(*) FILTER (WHERE scs.current_status IN ('Done', 'N/A')) * 100.0 /
        NULLIF(COUNT(*), 0)
      )::int
      FROM space_checklist_status scs
      JOIN spaces s ON s.id = scs.space_id
      WHERE scs.university_id = ${universityId}
        AND s.is_deleted = false
        AND s.space_type IN ('model_classroom', 'lab', 'staff_room', 'overall_classroom')
    ), 0),
    last_updated = NOW()
    WHERE id = ${universityId}
  `;
}

router.get("/universities", async (req: AuthRequest, res) => {
  try {
    const where = buildVisibilityFilter(req.user);
    (where as any).isDeleted = false;
    const search = req.query.search as string;
    if (search) (where as any).name = { contains: search, mode: "insensitive" };

    const unis = await prisma.university.findMany({
      where,
      include: {
        updates: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { name: "asc" },
    });

    // Compute per-module readiness for all universities in a single query
    let moduleReadinessMap: Record<string, Record<string, number>> = {};
    let overallReadinessMap: Record<string, number> = {};
    if (unis.length > 0) {
      const uniIds = unis.map(u => u.id);
      const stats = await prisma.$queryRaw<{ university_id: string; space_type: string; total: number; done: number }[]>`
        SELECT s.university_id, s.space_type,
          COUNT(scs.id)::int as total,
          COUNT(CASE WHEN scs.current_status IN ('Done', 'N/A') THEN 1 END)::int as done
        FROM spaces s
        LEFT JOIN space_checklist_status scs ON scs.space_id = s.id
        WHERE s.university_id = ANY(${uniIds}::text[])
          AND s.is_deleted = false
          AND s.space_type IN ('model_classroom', 'lab', 'staff_room', 'overall_classroom')
        GROUP BY s.university_id, s.space_type
      `;
      const totals: Record<string, { total: number; done: number }> = {};
      for (const row of stats) {
        if (!moduleReadinessMap[row.university_id]) moduleReadinessMap[row.university_id] = {};
        const r = row.total === 0 ? 0 : Math.round((row.done / row.total) * 100);
        moduleReadinessMap[row.university_id][row.space_type] = r;
        if (!totals[row.university_id]) totals[row.university_id] = { total: 0, done: 0 };
        totals[row.university_id].total += row.total;
        totals[row.university_id].done += row.done;
      }
      for (const [universityId, total] of Object.entries(totals)) {
        overallReadinessMap[universityId] = total.total === 0
          ? 0
          : Math.round((total.done / total.total) * 100);
      }
    }

    const result = unis.map(u => ({
      ...u,
      overallReadiness: overallReadinessMap[u.id] ?? 0,
      moduleReadiness: moduleReadinessMap[u.id] || {},
    }));

    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "List universities error");
    res.status(500).json({ error: "Failed to list universities" });
  }
});

router.get("/universities/:id", async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }
    const uni = await prisma.university.findUnique({
      where: { id: uniId },
      include: {
        spaces: {
          where: { isDeleted: false },
          include: {
            checklistStatuses: {
              include: {
                checklistItem: true,
                photoHistory: { orderBy: { uploadedAt: "desc" }, take: 10 },
              },
            },
          },
        },
        classrooms: { where: { isDeleted: false }, include: { space: true } },
        updates: { orderBy: { createdAt: "desc" }, take: 20 },
        actionItems: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!uni) { res.status(404).json({ error: "University not found" }); return; }
    res.set("Cache-Control", "no-store");
    res.json(uni);
  } catch (err) {
    logger.error({ err }, "Get university error");
    res.status(500).json({ error: "Failed to get university" });
  }
});

router.get("/universities/:id/daily-report", async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }
    const date = String(req.query.date || "");
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== date) {
      res.status(400).json({ error: "A valid report date is required (YYYY-MM-DD)" });
      return;
    }
    const report = await buildDailyReport(uniId, date);
    if (!report) { res.status(404).json({ error: "University not found" }); return; }
    res.set("Cache-Control", "no-store");
    res.json(report);
  } catch (err: any) {
    if (err?.message === "INVALID_DATE") {
      res.status(400).json({ error: "A valid report date is required (YYYY-MM-DD)" });
      return;
    }
    req.log.error({ err }, "Build daily report error");
    res.status(500).json({ error: "Failed to build daily report" });
  }
});

router.post("/universities", requireRole("admin", "zonal_manager"), validate({ body: CreateUniversityBody }), async (req: AuthRequest, res) => {
  try {
    const { name, location, targetDate, startDate, internalTimeline, classCommencementDate, zoneId, apmName,
      studentsCount, maxStudentsCount, effortsRequired, confidencePercentage, probabilityStatus,
      apmConfidenceDate, reminderDays, allocationPendingRemarks, priority, infraReadyMonth } = req.body;

    const count = await prisma.university.count();
    const code = `UNI-${String(count + 1).padStart(3, "0")}`;

    const uni = await prisma.university.create({
      data: {
        code, name, location,
        targetDate, startDate, internalTimeline, classCommencementDate: classCommencementDate || null,
        zoneId: zoneId ? Number(zoneId) : null,
        apmName,
        studentsCount: studentsCount ? Number(studentsCount) : null,
        maxStudentsCount: maxStudentsCount ? Number(maxStudentsCount) : null,
        effortsRequired: effortsRequired || null,
        confidencePercentage: confidencePercentage ? Number(confidencePercentage) : null,
        probabilityStatus: probabilityStatus || null,
        apmConfidenceDate: apmConfidenceDate || null,
        reminderDays: reminderDays ? Number(reminderDays) : 5,
        allocationPendingRemarks: allocationPendingRemarks || null,
        priority: priority || "P2",
        infraReadyMonth: infraReadyMonth || null,
      },
    });

    const spaceTypes = [
      { name: "Model Classroom", spaceType: "model_classroom" },
      { name: "5.0 Lab", spaceType: "lab" },
      { name: "Staff Room", spaceType: "staff_room" },
    ];

    for (const st of spaceTypes) {
      const space = await prisma.space.create({
        data: { universityId: uni.id, ...st },
      });
      const items = await prisma.checklistItem.findMany({ where: { module: st.spaceType } });
      if (items.length) {
        await prisma.spaceChecklistStatus.createMany({
          data: items.map(item => ({
            universityId: uni.id,
            spaceId: space.id,
            checklistItemId: item.id,
            currentStatus: "Yet to start",
          })),
          skipDuplicates: true,
        });
      }
    }

    await prisma.auditLog.create({
      data: { userId: req.user!.userId, userEmail: req.user!.email, action: "CREATE", module: "Universities", entityId: uni.id, updatedValue: req.body },
    });

    res.status(201).json(uni);
  } catch (err) {
    logger.error({ err }, "Create university error");
    res.status(500).json({ error: "Failed to create university" });
  }
});

router.put("/universities/:id", requireRole("admin", "zonal_manager", "apm"), validate({ params: IdParam, body: UpdateUniversityBody }), async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }
    const isApm = req.user?.role === "apm";
    const {
      name, location, targetDate, startDate, internalTimeline, zoneId, apmName,
      riskStatus, numClassrooms, classroomCapacity, classroomAllocationDone,
      studentsCount, maxStudentsCount, effortsRequired, confidencePercentage, probabilityStatus,
      apmConfidenceDate, reminderDays, allocationPendingRemarks, priority,
      modelClassroomTimeline, lab5Timeline, staffRoomTimeline, allClassroomsTimeline,
      infraReadyMonth, classCommencementDate,
    } = req.body;

    const existing = await prisma.university.findUnique({ where: { id: uniId }, select: { infraReadyMonth: true } });

    const data: any = { lastUpdated: new Date() };
    if (name !== undefined) data.name = name;
    if (location !== undefined) data.location = location;
    if (targetDate !== undefined) data.targetDate = targetDate;
    if (startDate !== undefined) data.startDate = startDate;
    if (internalTimeline !== undefined) data.internalTimeline = internalTimeline;
    if (!isApm && apmName !== undefined) data.apmName = apmName;
    if (riskStatus !== undefined) data.riskStatus = riskStatus;
    if (!isApm && zoneId !== undefined) data.zoneId = zoneId ? Number(zoneId) : null;
    if (numClassrooms !== undefined) data.numClassrooms = numClassrooms ? Number(numClassrooms) : null;
    if (classroomCapacity !== undefined) data.classroomCapacity = classroomCapacity ? Number(classroomCapacity) : null;
    if (classroomAllocationDone !== undefined) data.classroomAllocationDone = classroomAllocationDone;
    if (studentsCount !== undefined) data.studentsCount = studentsCount ? Number(studentsCount) : null;
    if (maxStudentsCount !== undefined) data.maxStudentsCount = maxStudentsCount ? Number(maxStudentsCount) : null;
    if (effortsRequired !== undefined) data.effortsRequired = effortsRequired || null;
    if (confidencePercentage !== undefined) data.confidencePercentage = confidencePercentage ? Number(confidencePercentage) : null;
    if (probabilityStatus !== undefined) data.probabilityStatus = probabilityStatus || null;
    if (apmConfidenceDate !== undefined) data.apmConfidenceDate = apmConfidenceDate || null;
    if (reminderDays !== undefined) data.reminderDays = reminderDays ? Number(reminderDays) : 5;
    if (allocationPendingRemarks !== undefined) data.allocationPendingRemarks = allocationPendingRemarks || null;
    if (priority !== undefined) data.priority = priority;
    if (modelClassroomTimeline !== undefined) data.modelClassroomTimeline = modelClassroomTimeline || null;
    if (lab5Timeline !== undefined) data.lab5Timeline = lab5Timeline || null;
    if (staffRoomTimeline !== undefined) data.staffRoomTimeline = staffRoomTimeline || null;
    if (allClassroomsTimeline !== undefined) data.allClassroomsTimeline = allClassroomsTimeline || null;
    if (infraReadyMonth !== undefined) data.infraReadyMonth = infraReadyMonth || null;
    if (classCommencementDate !== undefined) data.classCommencementDate = classCommencementDate || null;

    const uni = await prisma.university.update({ where: { id: uniId }, data });
    invalidateDailyReport(uniId);

    // Audit infra ready month changes
    if (infraReadyMonth !== undefined && infraReadyMonth !== existing?.infraReadyMonth) {
      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          userEmail: req.user!.email,
          action: "UPDATE_INFRA_READY_MONTH",
          module: "Universities",
          entityId: uniId,
          previousValue: { infraReadyMonth: existing?.infraReadyMonth ?? null },
          updatedValue: { infraReadyMonth: infraReadyMonth || null },
        },
      });
    }

    res.json(uni);
  } catch (err: any) {
    logger.error({ err }, "Update university error");
    if (err.code === "P2025") { res.status(404).json({ error: "Not found" }); return; }
    res.status(500).json({ error: "Failed to update university" });
  }
});

// A university's critical designation is an administrative portfolio decision.
// Keep it separate from the broader metadata route so zonal managers and APMs
// can see the designation without being able to change it.
router.patch(
  "/universities/:id/critical",
  requireRole("admin"),
  validate({ params: IdParam, body: UpdateUniversityCriticalBody }),
  async (req: AuthRequest, res) => {
    try {
      const uniId = req.params.id as string;
      const { isCritical } = req.body as { isCritical: boolean };
      const university = await prisma.$transaction(async (tx) => {
        // Lock before reading the current value so simultaneous mark/unmark
        // requests audit the value they actually replace.
        const lockedRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM universities WHERE id = ${uniId} FOR UPDATE
        `;
        if (lockedRows.length === 0) return null;

        const existing = await tx.university.findUnique({
          where: { id: uniId },
        });
        if (!existing || existing.isDeleted) return null;
        // No-op mutations are deliberately side-effect free: no timestamp
        // change or audit event is written, but the current resource is still
        // returned as a successful, retry-safe response.
        if (existing.isCritical === isCritical) return existing;

        const updated = await tx.university.update({
          where: { id: uniId },
          data: { isCritical },
        });
        await tx.auditLog.create({
          data: {
            userId: req.user!.userId,
            userEmail: req.user!.email,
            action: isCritical ? "MARK_CRITICAL" : "UNMARK_CRITICAL",
            module: "Universities",
            entityId: uniId,
            previousValue: { isCritical: existing.isCritical },
            updatedValue: { isCritical },
          },
        });
        return updated;
      });

      if (!university) {
        res.status(404).json({ error: "University not found" });
        return;
      }
      res.json(university);
    } catch (err: any) {
      logger.error({ err }, "Update university critical status error");
      if (err.code === "P2025") {
        res.status(404).json({ error: "University not found" });
        return;
      }
      res.status(500).json({
        error: "Critical status could not be saved. No changes were saved; please retry.",
      });
    }
  },
);

router.patch(
  "/universities/:id/report-priority",
  requireRole("admin"),
  validate({ params: IdParam, body: UpdateUniversityReportPriorityBody }),
  async (req: AuthRequest, res) => {
    try {
      const uniId = req.params.id as string;
      const { priority } = req.body as { priority: "CRITICAL" | "MEDIUM" | "LOW" | "NA" };
      const university = await prisma.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM universities WHERE id = ${uniId} FOR UPDATE
        `;
        if (lockedRows.length === 0) return null;
        const existing = await tx.university.findUnique({ where: { id: uniId } });
        if (!existing || existing.isDeleted) return null;
        const isCritical = priority === "CRITICAL";
        if (existing.priority === priority && existing.isCritical === isCritical) return existing;
        const updated = await tx.university.update({
          where: { id: uniId },
          data: { priority, isCritical },
        });
        await tx.auditLog.create({
          data: {
            userId: req.user!.userId,
            userEmail: req.user!.email,
            action: "UPDATE_REPORT_PRIORITY",
            module: "Universities",
            entityId: uniId,
            previousValue: { priority: existing.priority, isCritical: existing.isCritical },
            updatedValue: { priority, isCritical },
          },
        });
        return updated;
      });
      if (!university) {
        res.status(404).json({ error: "University not found" });
        return;
      }
      res.json(university);
    } catch (err: any) {
      logger.error({ err }, "Update university report priority error");
      res.status(500).json({ error: "Failed to update university report priority" });
    }
  },
);

// ── Bulk update Infra Ready Month ────────────────────────────────────────────
router.patch("/universities/bulk-infra-month", requireRole("admin", "zonal_manager"), async (req: AuthRequest, res) => {
  try {
    const { universityIds, infraReadyMonth } = req.body as { universityIds: string[]; infraReadyMonth: string | null };
    if (!Array.isArray(universityIds) || universityIds.length === 0) {
      res.status(400).json({ error: "universityIds must be a non-empty array" }); return;
    }
    if (infraReadyMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(infraReadyMonth)) {
      res.status(400).json({ error: "infraReadyMonth must be YYYY-MM format" }); return;
    }

    // Restrict zonal_manager to their zones
    let allowed = universityIds;
    if (req.user?.role === "zonal_manager") {
      const unis = await prisma.university.findMany({
        where: { id: { in: universityIds }, zoneId: { in: req.user.zoneIds ?? [] } },
        select: { id: true },
      });
      allowed = unis.map(u => u.id);
    }

    if (allowed.length === 0) {
      res.status(403).json({ error: "No accessible universities in selection" }); return;
    }

    await prisma.university.updateMany({
      where: { id: { in: allowed } },
      data: { infraReadyMonth: infraReadyMonth || null, lastUpdated: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user!.userId,
        userEmail: req.user!.email,
        action: "BULK_UPDATE_INFRA_READY_MONTH",
        module: "Universities",
        updatedValue: { universityIds: allowed, infraReadyMonth: infraReadyMonth || null },
      },
    });

    res.json({ updated: allowed.length, infraReadyMonth: infraReadyMonth || null });
  } catch (err) {
    logger.error({ err }, "Bulk infra month update error");
    res.status(500).json({ error: "Failed to bulk update infra ready month" });
  }
});

router.delete("/universities/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    await prisma.university.update({
      where: { id: uniId },
      data: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.email },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.userId, userEmail: req.user!.email, action: "SOFT_DELETE", module: "Universities", entityId: uniId },
    });
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "Delete university error");
    if (err.code === "P2025") { res.status(404).json({ error: "Not found" }); return; }
    res.status(500).json({ error: "Failed to delete university" });
  }
});

router.patch("/universities/:id/status/:statusId", async (req: AuthRequest, res) => {
  const uniId = req.params.id as string;
  const statusId = req.params.statusId as string;
  res.set("X-Correlation-Id", checklistCorrelationId(req));
  try {
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }

    const { currentStatus, remarks, photoUrl, photoContentType,
      universityTimeline, targetTimeline, actualCompletionDate,
      itemStartDate, itemEndDate, capacity, isBlocker } = req.body;

    const updated = await withUniversityChecklistMutation(uniId, () =>
      prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM universities WHERE id = ${uniId} FOR UPDATE`;
        const existing = await tx.spaceChecklistStatus.findUnique({ where: { id: statusId } });
        if (!existing) {
          throw new ChecklistMutationRouteError(404, "CHECKLIST_STATUS_NOT_FOUND", "Status not found");
        }
        if (existing.universityId !== uniId) {
          throw new ChecklistMutationRouteError(
            403,
            "CHECKLIST_STATUS_UNIVERSITY_MISMATCH",
            "Status does not belong to this university",
          );
        }

        const data: Prisma.SpaceChecklistStatusUpdateInput = {};
        if (currentStatus !== undefined) data.currentStatus = currentStatus;
        if (remarks !== undefined) data.remarks = remarks;
        if (photoUrl !== undefined) {
          // An empty URL is the checklist form's explicit "remove current
          // evidence" value. Persist it as null so a retained PhotoHistory
          // entry cannot be mistaken for the current media on a later load.
          const nextPhotoUrl = photoUrl || null;
          data.photoUrl = nextPhotoUrl;
          data.photoContentType = resolveEvidenceContentType({
            photoUrl: nextPhotoUrl,
            contentType: nextPhotoUrl ? photoContentType : null,
            existingPhotoUrl: existing.photoUrl,
            existingContentType: existing.photoContentType,
          });
        } else if (photoContentType !== undefined) {
          data.photoContentType = photoContentType;
        }
        if (universityTimeline !== undefined) data.universityTimeline = universityTimeline;
        if (targetTimeline !== undefined) data.targetTimeline = targetTimeline;
        if (actualCompletionDate !== undefined) data.actualCompletionDate = actualCompletionDate;
        if (itemStartDate !== undefined) data.itemStartDate = itemStartDate;
        if (itemEndDate !== undefined) data.itemEndDate = itemEndDate;
        if (capacity !== undefined) data.capacity = capacity;
        if (currentStatus !== undefined) data.isBlocker = currentStatus === "Blocker";
        else if (isBlocker !== undefined) data.isBlocker = isBlocker;

        const intendedBlocker = data.isBlocker ?? existing.isBlocker;
        const reportFieldsChanged =
          (currentStatus !== undefined && currentStatus !== existing.currentStatus) ||
          (remarks !== undefined && remarks !== existing.remarks) ||
          (universityTimeline !== undefined && universityTimeline !== existing.universityTimeline) ||
          (targetTimeline !== undefined && targetTimeline !== existing.targetTimeline) ||
          (itemStartDate !== undefined && itemStartDate !== existing.itemStartDate) ||
          (itemEndDate !== undefined && itemEndDate !== existing.itemEndDate) ||
          intendedBlocker !== existing.isBlocker;
        const statusFieldsChanged = Object.entries(data).some(
          ([field, value]) => value !== existing[field as keyof typeof existing],
        );

        if (reportFieldsChanged) {
          const historyCount = await tx.checklistStatusHistory.count({ where: { statusId } });
          if (historyCount === 0) {
            await tx.checklistStatusHistory.create({
              data: {
                statusId, universityId: uniId,
                currentStatus: existing.currentStatus, remarks: existing.remarks,
                universityTimeline: existing.universityTimeline, targetTimeline: existing.targetTimeline,
                itemStartDate: existing.itemStartDate, itemEndDate: existing.itemEndDate,
                isBlocker: existing.isBlocker, changedAt: existing.createdAt,
              },
            });
          }
        }

        const saved = statusFieldsChanged
          ? await tx.spaceChecklistStatus.update({ where: { id: statusId }, data })
          : existing;
        if (reportFieldsChanged) {
          await tx.checklistStatusHistory.create({
            data: {
              statusId, universityId: uniId,
              currentStatus: saved.currentStatus, remarks: saved.remarks,
              universityTimeline: saved.universityTimeline, targetTimeline: saved.targetTimeline,
              itemStartDate: saved.itemStartDate, itemEndDate: saved.itemEndDate,
              isBlocker: saved.isBlocker, changedAt: new Date(),
              changedById: req.user?.userId, changedByName: req.user?.name,
            },
          });
        }
        if (photoUrl && photoUrl !== existing.photoUrl) {
          await tx.photoHistory.create({
            data: {
              statusId,
              photoUrl,
              contentType: inferEvidenceContentType(photoUrl, photoContentType),
              uploadedBy: req.user?.name,
              remarks,
            },
          });
        }
        await syncReadiness(tx, uniId);
        return tx.spaceChecklistStatus.findUniqueOrThrow({
          where: { id: statusId },
          include: { checklistItem: true, photoHistory: true },
        });
      }),
    );

    invalidateDailyReport(uniId);

    res.json(updated);
  } catch (err) {
    sendChecklistMutationError(req, res, err, {
      operation: "single",
      universityId: uniId,
      statusId,
    });
  }
});

async function findUniqueLegacyClassroomSpace(
  tx: any,
  universityId: string,
  classroom: { id: string; roomId: string; spaceId: string | null },
) {
  if (classroom.spaceId) {
    return tx.space.findFirst({
      where: {
        id: classroom.spaceId,
        universityId,
        spaceType: "overall_classroom",
        isDeleted: false,
      },
    });
  }
  const canonicalName = normalizeClassroomAssociationName(classroom.roomId);
  const [classrooms, spaces] = await Promise.all([
    tx.universityClassroom.findMany({
      where: { universityId, isDeleted: false },
      select: { id: true, roomId: true },
    }),
    tx.space.findMany({
      where: { universityId, spaceType: "overall_classroom", isDeleted: false },
      select: { id: true, name: true },
    }),
  ]);
  const matchingClassrooms = classrooms.filter((row: { roomId: string }) =>
    normalizeClassroomAssociationName(row.roomId) === canonicalName);
  const matchingSpaces = spaces.filter((space: { name: string }) =>
    normalizeClassroomAssociationName(space.name) === canonicalName);
  if (matchingClassrooms.length !== 1 ||
      matchingClassrooms[0].id !== classroom.id ||
      matchingSpaces.length !== 1) {
    throw Object.assign(new Error("Resolve the classroom checklist association before changing this room"), {
      code: "CLASSROOM_ASSOCIATION_AMBIGUOUS",
    });
  }
  return matchingSpaces[0];
}

router.post("/universities/:id/classrooms", requireRole("admin", "zonal_manager", "apm"), validate({ body: CreateClassroomBody }), async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }
    const { roomId, floor, capacity, timeline, driveLink, remarks } = req.body;
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM universities WHERE id = ${uniId} FOR UPDATE`;
      const activeClassrooms = await tx.universityClassroom.findMany({
        where: { universityId: uniId, isDeleted: false },
        select: { roomId: true },
      });
      const canonicalRoomId = normalizeClassroomAssociationName(roomId);
      if (activeClassrooms.some(row =>
        normalizeClassroomAssociationName(row.roomId) === canonicalRoomId)) {
        throw Object.assign(new Error("Duplicate active classroom"), { code: "P2002" });
      }
      const space = await tx.space.create({
        data: { universityId: uniId, spaceType: "overall_classroom", name: roomId },
      });
      const classroom = await tx.universityClassroom.create({
        data: { universityId: uniId, roomId, floor, capacity, timeline, driveLink, remarks, spaceId: space.id },
      });
      const items = await tx.checklistItem.findMany({ where: { module: "overall_classroom" } });
      if (items.length) await tx.spaceChecklistStatus.createMany({
        data: items.map(item => ({ universityId: uniId, spaceId: space.id, checklistItemId: item.id, currentStatus: "Yet to start" })),
        skipDuplicates: true,
      });
      await tx.auditLog.create({
        data: { userId: req.user!.userId, userEmail: req.user!.email, action: "CREATE", module: "UniversityClassrooms", entityId: classroom.id, updatedValue: req.body },
      });
      return { classroom, space };
    });
    invalidateDailyReport(uniId);
    res.status(201).json(result.classroom);
  } catch (err: any) {
    logger.error({ err }, "Create classroom error");
    if (err.code === "P2002") { res.status(409).json({ error: "An active classroom with this name already exists" }); return; }
    res.status(500).json({ error: "Failed to create classroom" });
  }
});

router.put("/universities/:id/classrooms/:classroomId", requireRole("admin", "zonal_manager", "apm"), validate({ body: UpdateClassroomBody }), async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    const classroomId = req.params.classroomId as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }
    const { roomId, floor, capacity, timeline, driveLink, remarks } = req.body;
    const classroom = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM universities WHERE id = ${uniId} FOR UPDATE`;
      const existing = await tx.universityClassroom.findUnique({ where: { id: classroomId } });
      if (!existing || existing.universityId !== uniId || existing.isDeleted) throw Object.assign(new Error("Not found"), { code: "P2025" });
      if (roomId !== undefined && roomId !== existing.roomId) {
        const activeClassrooms = await tx.universityClassroom.findMany({
          where: { universityId: uniId, isDeleted: false, id: { not: classroomId } },
          select: { roomId: true },
        });
        const canonicalRoomId = normalizeClassroomAssociationName(roomId);
        if (activeClassrooms.some(row =>
          normalizeClassroomAssociationName(row.roomId) === canonicalRoomId)) {
          throw Object.assign(new Error("Duplicate active classroom"), { code: "P2002" });
        }
      }
      let associatedSpace = null;
      if (roomId !== undefined && roomId !== existing.roomId) {
        associatedSpace = await findUniqueLegacyClassroomSpace(tx, uniId, existing);
        if (!associatedSpace) {
          throw Object.assign(new Error("Associated classroom space not found"), {
            code: "CLASSROOM_ASSOCIATION_AMBIGUOUS",
          });
        }
        await tx.space.update({ where: { id: associatedSpace.id }, data: { name: roomId } });
      }
      const updated = await tx.universityClassroom.update({
        where: { id: classroomId },
        data: {
          roomId, floor, capacity, timeline, driveLink, remarks,
          ...(associatedSpace && !existing.spaceId ? { spaceId: associatedSpace.id } : {}),
        },
      });
      await tx.auditLog.create({
        data: { userId: req.user!.userId, userEmail: req.user!.email, action: "UPDATE", module: "UniversityClassrooms", entityId: classroomId, previousValue: existing, updatedValue: req.body },
      });
      return updated;
    });
    invalidateDailyReport(uniId);
    res.json(classroom);
  } catch (err: any) {
    logger.error({ err }, "Update classroom error");
    if (err.code === "CLASSROOM_ASSOCIATION_AMBIGUOUS") { res.status(409).json({ error: err.message, code: err.code }); return; }
    if (err.code === "P2002") { res.status(409).json({ error: "An active classroom with this name already exists" }); return; }
    if (err.code === "P2025") { res.status(404).json({ error: "Not found" }); return; }
    res.status(500).json({ error: "Failed to update classroom" });
  }
});

router.delete("/universities/:id/classrooms/:classroomId", requireRole("admin", "zonal_manager", "apm"), async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    const classroomId = req.params.classroomId as string;
    if (!await canAccessUniversity(req.user, uniId)) { res.status(403).json({ error: "Access denied to this university" }); return; }
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM universities WHERE id = ${uniId} FOR UPDATE`;
      const classroom = await tx.universityClassroom.findUnique({ where: { id: classroomId } });
      if (!classroom || classroom.universityId !== uniId || classroom.isDeleted) throw Object.assign(new Error("Not found"), { code: "P2025" });
      const associatedSpace = await findUniqueLegacyClassroomSpace(tx, uniId, classroom);
      if (!associatedSpace) {
        throw Object.assign(new Error("Associated classroom space not found"), {
          code: "CLASSROOM_ASSOCIATION_AMBIGUOUS",
        });
      }
      await tx.universityClassroom.update({
        where: { id: classroomId },
        data: {
          isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.email,
          ...(!classroom.spaceId ? { spaceId: associatedSpace.id } : {}),
        },
      });
      await tx.space.update({ where: { id: associatedSpace.id }, data: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.email } });
      await tx.auditLog.create({ data: { userId: req.user!.userId, userEmail: req.user!.email, action: "SOFT_DELETE", module: "UniversityClassrooms", entityId: classroomId } });
    });
    invalidateDailyReport(uniId);
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "Delete classroom error");
    if (err.code === "CLASSROOM_ASSOCIATION_AMBIGUOUS") { res.status(409).json({ error: err.message, code: err.code }); return; }
    if (err.code === "P2025") { res.status(404).json({ error: "Classroom not found" }); return; }
    res.status(500).json({ error: "Failed to delete classroom" });
  }
});

// Deliberately explicit: only an administrator may repair an unassociated
// classroom, and the selected space must be an active, same-university overall
// classroom space. Association never changes checklist rows or their history.
router.put("/universities/:id/classrooms/:classroomId/association", requireRole("admin"), validate({ body: ResolveClassroomSpaceBody }), async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    const classroomId = req.params.classroomId as string;
    const { spaceId } = req.body;
    const classroom = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM universities WHERE id = ${uniId} FOR UPDATE`;
      const row = await tx.universityClassroom.findUnique({ where: { id: classroomId } });
      if (!row || row.universityId !== uniId || row.isDeleted) throw Object.assign(new Error("Classroom not found"), { code: "P2025" });
      const space = await tx.space.findUnique({ where: { id: spaceId } });
      if (!space || space.universityId !== uniId || space.isDeleted || space.spaceType !== "overall_classroom") throw Object.assign(new Error("Space not found"), { code: "P2025" });
      if (row.spaceId && row.spaceId !== spaceId) throw Object.assign(new Error("Classroom already resolved"), { code: "P2002" });
      const owner = await tx.universityClassroom.findFirst({ where: { spaceId, isDeleted: false, id: { not: classroomId } } });
      if (owner) throw Object.assign(new Error("Space is already assigned"), { code: "P2002" });
      const updated = await tx.universityClassroom.update({ where: { id: classroomId }, data: { spaceId } });
      await tx.auditLog.create({ data: { userId: req.user!.userId, userEmail: req.user!.email, action: "RESOLVE_SPACE", module: "UniversityClassrooms", entityId: classroomId, updatedValue: { spaceId } } });
      return updated;
    });
    res.json(classroom);
  } catch (err: any) {
    if (err.code === "P2025") { res.status(404).json({ error: err.message }); return; }
    if (err.code === "P2002") { res.status(409).json({ error: err.message }); return; }
    logger.error({ err }, "Resolve classroom space error");
    res.status(500).json({ error: "Failed to resolve classroom space" });
  }
});

router.patch("/universities/:id/spaces/:spaceId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    const spaceId = req.params.spaceId as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }
    const { roomNumber, remarks } = req.body as { roomNumber?: string; remarks?: string };
    const data: any = {};
    if (roomNumber !== undefined) data.roomNumber = roomNumber || null;
    if (remarks !== undefined) data.remarks = remarks || null;
    const space = await prisma.space.update({ where: { id: spaceId }, data });
    res.json(space);
  } catch (err: any) {
    if (err.code === "P2025") { res.status(404).json({ error: "Space not found" }); return; }
    res.status(500).json({ error: "Failed to update space" });
  }
});

router.get("/universities/:id/updates", async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }
    const updates = await prisma.universityUpdate.findMany({
      where: { universityId: uniId },
      orderBy: { createdAt: "desc" },
    });
    res.json(updates);
  } catch (err) {
    logger.error({ err }, "Get updates error");
    res.status(500).json({ error: "Failed to get updates" });
  }
});

router.post("/universities/:id/updates", async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }
    const { content, tags, imageUrl } = req.body;
    const update = await prisma.universityUpdate.create({
      data: {
        universityId: uniId,
        authorName: req.user!.name,
        authorRole: req.user!.role,
        content,
        imageUrl: imageUrl || null,
        tags: tags || [],
      },
    });
    res.status(201).json(update);
  } catch (err) {
    logger.error({ err }, "Create update error");
    res.status(500).json({ error: "Failed to create update" });
  }
});

router.put("/universities/:id/updates/:updateId", async (req: AuthRequest, res) => {
  try {
    const updateId = req.params.updateId as string;
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "Content is required" }); return; }

    const update = await prisma.universityUpdate.findUnique({ where: { id: updateId } });
    if (!update) { res.status(404).json({ error: "Update not found" }); return; }

    if (update.authorName !== req.user?.name) {
      res.status(403).json({ error: "You can only edit your own updates" });
      return;
    }
    const ageMs = Date.now() - update.createdAt.getTime();
    if (ageMs > 15 * 60 * 1000) {
      res.status(403).json({ error: "Edit window has expired (15 minutes)" });
      return;
    }

    const updated = await prisma.universityUpdate.update({
      where: { id: updateId },
      data: { content: content.trim() },
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Edit update error");
    res.status(500).json({ error: "Failed to edit update" });
  }
});

// ── Action Items ──────────────────────────────────────────────────────────────

router.get("/universities/:id/action-items", async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const items = await prisma.actionItem.findMany({
      where: { universityId: uniId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    res.json(items);
  } catch (err) {
    logger.error({ err }, "Get action items error");
    res.status(500).json({ error: "Failed to get action items" });
  }
});

router.post("/universities/:id/action-items", validate({ body: CreateActionItemBody }), async (req: AuthRequest, res) => {
  try {
    const uniId = req.params.id as string;
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const { content, dueDate, status } = req.body;
    const item = await prisma.actionItem.create({
      data: {
        universityId: uniId,
        authorName: req.user!.name,
        content,
        dueDate: dueDate || null,
        status: status || "open",
      },
    });
    res.status(201).json(item);
  } catch (err) {
    logger.error({ err }, "Create action item error");
    res.status(500).json({ error: "Failed to create action item" });
  }
});

router.put("/universities/:id/action-items/:itemId", validate({ body: UpdateActionItemBody }), async (req: AuthRequest, res) => {
  try {
    const itemId = req.params.itemId as string;
    const { content, dueDate, status } = req.body;
    const existing = await prisma.actionItem.findUnique({ where: { id: itemId } });
    if (!existing) { res.status(404).json({ error: "Action item not found" }); return; }
    const updated = await prisma.actionItem.update({
      where: { id: itemId },
      data: {
        ...(content !== undefined && { content }),
        ...(dueDate !== undefined && { dueDate: dueDate || null }),
        ...(status !== undefined && { status }),
      },
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Update action item error");
    res.status(500).json({ error: "Failed to update action item" });
  }
});

router.delete("/universities/:id/action-items/:itemId", async (req: AuthRequest, res) => {
  try {
    const itemId = req.params.itemId as string;
    await prisma.actionItem.delete({ where: { id: itemId } });
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "Delete action item error");
    if (err.code === "P2025") { res.status(404).json({ error: "Not found" }); return; }
    res.status(500).json({ error: "Failed to delete action item" });
  }
});

function normalizeClassroomAssociationName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeChecklistSemanticPart(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function canonicalChecklistSemanticKey(
  category: unknown,
  name: unknown,
): string | null {
  const canonicalCategory = normalizeChecklistSemanticPart(category);
  const canonicalName = normalizeChecklistSemanticPart(name);
  return canonicalCategory && canonicalName
    ? `${canonicalCategory}\u0000${canonicalName}`
    : null;
}

function checklistSemanticMapKey(spaceId: string, semanticKey: string): string {
  return `${spaceId}\u0001${semanticKey}`;
}

type BulkTargetPlan = {
  update: any;
  status: any;
  classroomId?: string;
  spaceId: string;
  data: Prisma.SpaceChecklistStatusUpdateInput;
  reportFieldsChanged: boolean;
  statusFieldsChanged: boolean;
  photoChanged: boolean;
  skip: boolean;
};

function buildBulkStatusData(
  update: any,
  existingStatus: any,
  modelClassroomCopy = existingStatus?.space?.spaceType === "model_classroom",
): Prisma.SpaceChecklistStatusUpdateInput {
  const {
    currentStatus,
    remarks,
    photoUrl,
    photoContentType,
    universityTimeline,
    targetTimeline,
    itemStartDate,
    itemEndDate,
    actualCompletionDate,
    capacity,
    isBlocker,
  } = update;
  // Model semantics come from the locked source row, not from a caller
  // supplied marker. The marker remains useful as an explicit contract, but
  // omitting it must never turn a persisted model source into a normal copy.
  const skipBlankValues = modelClassroomCopy || update.skipBlankValues === true;
  const includeValue = (value: unknown): boolean => !skipBlankValues
    || !(value == null || (typeof value === "string" && value.trim() === ""));
  const data: Prisma.SpaceChecklistStatusUpdateInput = {};
  // A model classroom is a template. Its readiness/status, capacity, and
  // lifecycle dates are never propagated even if a stale or hand-written
  // caller includes those fields; only the explicitly supported template
  // fields below can affect an ordinary classroom.
  if (!modelClassroomCopy && currentStatus !== undefined && includeValue(currentStatus)) {
    data.currentStatus = currentStatus;
  }
  if (remarks !== undefined && includeValue(remarks)) data.remarks = remarks;
  if (photoUrl !== undefined && includeValue(photoUrl)) {
    data.photoUrl = photoUrl;
    data.photoContentType = resolveEvidenceContentType({
      photoUrl,
      contentType: photoContentType,
      existingPhotoUrl: existingStatus.photoUrl,
      existingContentType: existingStatus.photoContentType,
    });
  } else if (!modelClassroomCopy &&
      photoContentType !== undefined && includeValue(photoContentType)) {
    data.photoContentType = photoContentType;
  }
  if (universityTimeline !== undefined && includeValue(universityTimeline)) {
    data.universityTimeline = universityTimeline;
  }
  if (targetTimeline !== undefined && includeValue(targetTimeline)) {
    data.targetTimeline = targetTimeline;
  }
  if (!modelClassroomCopy && itemStartDate !== undefined && includeValue(itemStartDate)) {
    data.itemStartDate = itemStartDate;
  }
  if (!modelClassroomCopy && itemEndDate !== undefined && includeValue(itemEndDate)) {
    data.itemEndDate = itemEndDate;
  }
  if (!modelClassroomCopy && actualCompletionDate !== undefined && includeValue(actualCompletionDate)) {
    data.actualCompletionDate = actualCompletionDate;
  }
  if (!modelClassroomCopy && capacity !== undefined && includeValue(capacity)) data.capacity = capacity;
  if (!modelClassroomCopy && currentStatus !== undefined && includeValue(currentStatus)) {
    data.isBlocker = currentStatus === "Blocker";
  } else if (!modelClassroomCopy && isBlocker !== undefined && includeValue(isBlocker)) {
    data.isBlocker = isBlocker;
  }
  return data;
}

/**
 * Validate the shape of one bulk update before opening any database transaction
 * work.  The actual ownership and freshness checks happen after the university
 * lock is acquired.
 *
 * The classroom registry predates spaces and has no FK to it.  Therefore a
 * caller must provide both sides of the association and the names must be
 * unique on both sides.  This deliberately does not fall back to array order,
 * creation order, or a first matching name.
 */
function validateBulkChecklistUpdate(
  update: any,
  seenTargetStatusIds: Set<string>,
): void {
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    throw new ChecklistMutationRouteError(
      400,
      "CHECKLIST_BULK_UPDATE_INVALID",
      "Each bulk update must be an object",
    );
  }

  const {
    checklistItemId,
    sourceStatusId,
    classroomIds,
    spaceIds,
    targetStatusIds,
    sourceSpaceType,
    skipBlankValues,
  } = update;
  const explicitTargets = (
    sourceStatusId !== undefined ||
    classroomIds !== undefined ||
    targetStatusIds !== undefined
  );

  // A model classroom copy is intentionally an opt-in contract. Keeping the
  // marker on each update lets the transaction enforce persisted source and
  // destination types instead of trusting the caller's UI mode.
  if (sourceSpaceType !== undefined && sourceSpaceType !== "model_classroom") {
    throw new ChecklistMutationRouteError(
      422,
      "CHECKLIST_SOURCE_SPACE_TYPE_INVALID",
      "sourceSpaceType must be model_classroom for a model classroom copy",
    );
  }
  if (skipBlankValues !== undefined && typeof skipBlankValues !== "boolean") {
    throw new ChecklistMutationRouteError(
      400,
      "CHECKLIST_BULK_UPDATE_INVALID",
      "skipBlankValues must be boolean",
    );
  }
  if (sourceSpaceType === "model_classroom" && sourceStatusId === undefined) {
    throw new ChecklistMutationRouteError(
      400,
      "CHECKLIST_SOURCE_STATUS_REQUIRED",
      "sourceStatusId is required for a model classroom copy",
    );
  }
  if (sourceSpaceType === "model_classroom" &&
      (classroomIds === undefined || targetStatusIds === undefined)) {
    throw new ChecklistMutationRouteError(
      422,
      "CHECKLIST_MODEL_DESTINATION_INVALID",
      "Model classroom copies must identify each destination classroom, space, and checklist row",
    );
  }

  if (typeof checklistItemId !== "string" || !checklistItemId) {
    throw new ChecklistMutationRouteError(
      400,
      "CHECKLIST_BULK_UPDATE_INVALID",
      "checklistItemId is required for every bulk update",
    );
  }
  if (!Array.isArray(spaceIds) || spaceIds.length === 0 ||
      spaceIds.some((spaceId: unknown) => typeof spaceId !== "string" || !spaceId)) {
    throw new ChecklistMutationRouteError(
      400,
      "CHECKLIST_BULK_TARGETS_REQUIRED",
      "Each bulk update must include at least one destination space",
    );
  }
  if (new Set(spaceIds).size !== spaceIds.length) {
    throw new ChecklistMutationRouteError(
      422,
      "CHECKLIST_BULK_TARGETS_AMBIGUOUS",
      "A destination space may only be requested once",
    );
  }

  if (sourceStatusId !== undefined) {
    if (typeof sourceStatusId !== "string" || !sourceStatusId) {
      throw new ChecklistMutationRouteError(
        400,
        "CHECKLIST_SOURCE_STATUS_REQUIRED",
        "sourceStatusId must identify the saved source checklist row",
      );
    }
  }

  // Evidence may only be copied from the current, authorized source row.
  if ((update.photoUrl !== undefined || update.photoContentType !== undefined) &&
      sourceStatusId === undefined) {
    throw new ChecklistMutationRouteError(
      400,
      "CHECKLIST_SOURCE_STATUS_REQUIRED",
      "sourceStatusId is required when copying evidence",
    );
  }

  if (classroomIds !== undefined) {
    if (!Array.isArray(classroomIds) || classroomIds.length !== spaceIds.length ||
        classroomIds.some((classroomId: unknown) =>
          typeof classroomId !== "string" || !classroomId)) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_CLASSROOM_ASSOCIATION_INVALID",
        "classroomIds and spaceIds must contain the same number of destinations",
      );
    }
    if (new Set(classroomIds).size !== classroomIds.length) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_CLASSROOM_ASSOCIATION_AMBIGUOUS",
        "A destination classroom may only be requested once",
      );
    }
  }

  if (targetStatusIds !== undefined) {
    if (!Array.isArray(targetStatusIds) || targetStatusIds.length !== spaceIds.length ||
        targetStatusIds.some((statusId: unknown) => typeof statusId !== "string" || !statusId)) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_BULK_TARGETS_MISSING",
        "targetStatusIds must contain one saved checklist row for every destination",
      );
    }
    if (new Set(targetStatusIds).size !== targetStatusIds.length) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_BULK_TARGET_STATUS_DUPLICATE",
        "A destination checklist row may only be requested once",
      );
    }
    for (const targetStatusId of targetStatusIds) {
      if (seenTargetStatusIds.has(targetStatusId)) {
        throw new ChecklistMutationRouteError(
          422,
          "CHECKLIST_BULK_TARGET_STATUS_DUPLICATE",
          "A destination checklist row may only be requested once",
        );
      }
      seenTargetStatusIds.add(targetStatusId);
    }
  } else if (explicitTargets) {
    throw new ChecklistMutationRouteError(
      422,
      "CHECKLIST_BULK_TARGETS_MISSING",
      "targetStatusIds are required for explicit classroom copies",
    );
  }
}

type BulkChecklistRequestContext = {
  sourceStatusById: Map<string, any>;
  requestedSpaceById: Map<string, any>;
  requestedClassroomById: Map<string, any>;
  classroomNames: Map<string, any[]>;
  spaceNames: Map<string, any[]>;
  semanticStatusesBySpaceAndKey: Map<string, any[]>;
  statusById: Map<string, any>;
  statusByItemAndSpace: Map<string, any>;
};

function bulkStatusKey(checklistItemId: string, spaceId: string): string {
  return `${checklistItemId}\u0000${spaceId}`;
}

/**
 * Fetch request-wide bulk inputs once, after the university lock is held.
 * Previously each update repeated source, space, classroom, and destination
 * status reads.  Keeping the reads in this transaction preserves the
 * authoritative checks while avoiding a query-per-item copy.
 */
async function loadBulkChecklistRequestContext(
  tx: Prisma.TransactionClient,
  universityId: string,
  updates: any[],
): Promise<BulkChecklistRequestContext> {
  const sourceStatusIds = Array.from(new Set(
    updates
      .map((update) => update.sourceStatusId)
      .filter((sourceStatusId): sourceStatusId is string => typeof sourceStatusId === "string"),
  ));
  const spaceIds = Array.from(new Set(
    updates.flatMap((update) => update.spaceIds as string[]),
  ));
  const classroomIds = Array.from(new Set(
    updates.flatMap((update) => Array.isArray(update.classroomIds) ? update.classroomIds : []),
  ));
  const targetStatusIds = Array.from(new Set(
    updates.flatMap((update) => Array.isArray(update.targetStatusIds) ? update.targetStatusIds : []),
  ));
  const checklistItemIds = Array.from(new Set(
    updates.map((update) => update.checklistItemId as string),
  ));

  // Keep source rows locked for the entire transaction.  A single lock query
  // is equivalent to the old per-source locks and avoids N round trips.
  if (sourceStatusIds.length > 0) {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM space_checklist_status
      WHERE id = ANY(${sourceStatusIds}::text[])
      FOR UPDATE
    `;
  }

  const statusConditions: any[] = [];
  if (targetStatusIds.length > 0) {
    // Do not scope explicit ids to this university: a foreign id must be
    // rejected as unauthorized, not silently reported as missing.
    statusConditions.push({ id: { in: targetStatusIds } });
  }
  if (checklistItemIds.length > 0 && spaceIds.length > 0) {
    statusConditions.push({
      universityId,
      checklistItemId: { in: checklistItemIds },
      spaceId: { in: spaceIds },
    });
  }

  const [
    sourceStatuses,
    requestedSpaces,
    requestedStatuses,
  ] = await Promise.all([
    sourceStatusIds.length > 0
      ? tx.spaceChecklistStatus.findMany({
        where: { id: { in: sourceStatusIds } },
        include: {
          space: {
            select: {
              id: true,
              universityId: true,
              spaceType: true,
              isDeleted: true,
            },
          },
          checklistItem: { select: { category: true, name: true } },
        },
      })
      : Promise.resolve([]),
    tx.space.findMany({
      where: { id: { in: spaceIds } },
      select: { id: true, universityId: true, spaceType: true, name: true, isDeleted: true },
    }),
    statusConditions.length > 0
      ? tx.spaceChecklistStatus.findMany({
        where: statusConditions.length === 1 ? statusConditions[0] : { OR: statusConditions },
          include: {
            checklistItem: { select: { category: true, name: true } },
          },
      })
      : Promise.resolve([]),
  ]);

  const semanticSpaceIds = Array.from(new Set([
    ...sourceStatuses.map((status) => status.spaceId),
    ...spaceIds,
  ]));
  const semanticStatuses = semanticSpaceIds.length > 0
    ? await tx.spaceChecklistStatus.findMany({
      where: { universityId, spaceId: { in: semanticSpaceIds } },
      select: {
        id: true,
        spaceId: true,
        checklistItemId: true,
        checklistItem: { select: { category: true, name: true } },
      },
    })
    : [];

  let requestedClassrooms: any[] = [];
  let activeClassrooms: any[] = [];
  let activeClassroomSpaces: any[] = [];
  if (classroomIds.length > 0) {
    [requestedClassrooms, activeClassrooms, activeClassroomSpaces] = await Promise.all([
      tx.universityClassroom.findMany({
        where: { id: { in: classroomIds } },
        select: { id: true, universityId: true, roomId: true, spaceId: true, isDeleted: true },
      }),
      tx.universityClassroom.findMany({
        where: { universityId, isDeleted: false },
        select: { id: true, roomId: true, spaceId: true },
      }),
      tx.space.findMany({
        where: { universityId, spaceType: "overall_classroom", isDeleted: false },
        select: { id: true, name: true },
      }),
    ]);
  }

  const classroomNames = new Map<string, any[]>();
  for (const classroom of activeClassrooms) {
    const name = normalizeClassroomAssociationName(classroom.roomId);
    if (!name) continue;
    const entries = classroomNames.get(name) ?? [];
    entries.push(classroom);
    classroomNames.set(name, entries);
  }
  const spaceNames = new Map<string, any[]>();
  for (const space of activeClassroomSpaces) {
    const name = normalizeClassroomAssociationName(space.name);
    if (!name) continue;
    const entries = spaceNames.get(name) ?? [];
    entries.push(space);
    spaceNames.set(name, entries);
  }

  const semanticStatusesBySpaceAndKey = new Map<string, any[]>();
  for (const status of semanticStatuses) {
    const semanticKey = canonicalChecklistSemanticKey(
      status.checklistItem?.category,
      status.checklistItem?.name,
    );
    if (!semanticKey) continue;
    const mapKey = checklistSemanticMapKey(status.spaceId, semanticKey);
    const entries = semanticStatusesBySpaceAndKey.get(mapKey) ?? [];
    entries.push(status);
    semanticStatusesBySpaceAndKey.set(mapKey, entries);
  }

  const statusById = new Map(requestedStatuses.map((status) => [status.id, status]));
  const statusByItemAndSpace = new Map<string, any>();
  for (const status of requestedStatuses) {
    if (status.universityId === universityId) {
      statusByItemAndSpace.set(bulkStatusKey(status.checklistItemId, status.spaceId), status);
    }
  }

  return {
    sourceStatusById: new Map(sourceStatuses.map((status) => [status.id, status])),
    requestedSpaceById: new Map(requestedSpaces.map((space) => [space.id, space])),
    requestedClassroomById: new Map(
      requestedClassrooms.map((classroom) => [classroom.id, classroom]),
    ),
    classroomNames,
    spaceNames,
    semanticStatusesBySpaceAndKey,
    statusById,
    statusByItemAndSpace,
  };
}

/**
 * Resolve one bulk update using request-wide data that was read while the
 * university row was locked.
 */
function planBulkChecklistUpdate(
  universityId: string,
  update: any,
  context: BulkChecklistRequestContext,
): BulkTargetPlan[] {
  const {
    checklistItemId,
    sourceStatusId,
    classroomIds,
    spaceIds,
    targetStatusIds,
    currentStatus,
    remarks,
    photoUrl,
    photoContentType,
    universityTimeline,
    targetTimeline,
    itemStartDate,
    itemEndDate,
    actualCompletionDate,
    capacity,
    isBlocker,
    skipDone,
    sourceSpaceType,
  } = update;

  let sourceStatus: any = null;
  if (sourceStatusId !== undefined) {
    sourceStatus = context.sourceStatusById.get(sourceStatusId) ?? null;
    if (!sourceStatus || sourceStatus.universityId !== universityId ||
        sourceStatus.space?.universityId !== universityId) {
      throw new ChecklistMutationRouteError(
        403,
        "CHECKLIST_SOURCE_STATUS_UNAUTHORIZED",
        "The source checklist row is not accessible in this university",
      );
    }
    if (sourceStatus.space?.isDeleted) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_SOURCE_STATUS_INVALID",
        "The source checklist row belongs to a deleted space",
      );
    }
    if (sourceSpaceType === "model_classroom" &&
        sourceStatus.space?.spaceType !== "model_classroom") {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_SOURCE_SPACE_TYPE_MISMATCH",
        "The source checklist row must belong to an active model classroom space",
      );
    }
    if (sourceStatus.checklistItemId !== checklistItemId) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_SOURCE_ITEM_MISMATCH",
        "checklistItemId does not match sourceStatusId",
      );
    }
  }

  const modelClassroomSource = sourceStatus?.space?.spaceType === "model_classroom";
  let sourceSemanticKey: string | null = null;
  if (modelClassroomSource) {
    sourceSemanticKey = canonicalChecklistSemanticKey(
      sourceStatus.checklistItem?.category,
      sourceStatus.checklistItem?.name,
    );
    const sourceSemanticCandidates = sourceSemanticKey
      ? context.semanticStatusesBySpaceAndKey.get(
        checklistSemanticMapKey(sourceStatus.spaceId, sourceSemanticKey),
      ) ?? []
      : [];
    if (!sourceSemanticKey ||
        sourceSemanticCandidates.length !== 1 ||
        sourceSemanticCandidates[0].id !== sourceStatus.id) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_MODEL_SOURCE_SEMANTIC_AMBIGUOUS",
        "The model classroom source checklist item does not have a unique category/name identity",
      );
    }
  }
  if (modelClassroomSource &&
      (classroomIds === undefined || targetStatusIds === undefined)) {
    throw new ChecklistMutationRouteError(
      422,
      "CHECKLIST_MODEL_DESTINATION_INVALID",
      "Model classroom copies must identify each destination classroom, space, and checklist row",
    );
  }

  if (sourceStatus) {
    if (Object.prototype.hasOwnProperty.call(update, "expectedSourcePhotoUrl") &&
        update.expectedSourcePhotoUrl !== (sourceStatus.photoUrl || null)) {
      throw new ChecklistMutationRouteError(
        409, "CHECKLIST_SOURCE_CHANGED",
        "The source evidence changed. Reopen the source and retry the copy.",
      );
    }
    // Compare the explicit snapshot to the locked source, rather than
    // allowing a stale editor to overwrite a newer saved source.
    const sourceData = buildBulkStatusData(update, sourceStatus, modelClassroomSource);
    const normalizedSource = buildBulkStatusData({
      currentStatus: sourceStatus.currentStatus,
      remarks: sourceStatus.remarks,
      photoUrl: sourceStatus.photoUrl,
      photoContentType: sourceStatus.photoContentType,
      universityTimeline: sourceStatus.universityTimeline,
      targetTimeline: sourceStatus.targetTimeline,
      itemStartDate: sourceStatus.itemStartDate,
      itemEndDate: sourceStatus.itemEndDate,
      actualCompletionDate: sourceStatus.actualCompletionDate,
      capacity: sourceStatus.capacity,
      isBlocker: sourceStatus.isBlocker,
    }, sourceStatus, modelClassroomSource);
    const sourceFields = [
      "currentStatus",
      "remarks",
      "photoUrl",
      "photoContentType",
      "universityTimeline",
      "targetTimeline",
      "itemStartDate",
      "itemEndDate",
      "actualCompletionDate",
      "capacity",
      "isBlocker",
    ] as const;
    const nullableTextFields = new Set([
      "remarks", "universityTimeline", "targetTimeline", "itemStartDate",
      "itemEndDate", "actualCompletionDate", "capacity",
    ]);
    const changedSourceFields = sourceFields.filter((field) => {
      if (!Object.prototype.hasOwnProperty.call(sourceData, field)) return false;
      // Forms display optional database nulls as empty controls. Their empty
      // snapshot is still current; evidence and status identities stay strict.
      const requested = nullableTextFields.has(field) ? (sourceData[field] ?? "") : sourceData[field];
      const saved = nullableTextFields.has(field) ? (normalizedSource[field] ?? "") : normalizedSource[field];
      return !Object.is(requested, saved);
    });
    if (changedSourceFields.length > 0) {
      throw new ChecklistMutationRouteError(
        409,
        "CHECKLIST_SOURCE_CHANGED",
        "The source checklist row changed. Reopen the source and retry the copy.",
        { sourceStatusId, fields: changedSourceFields, action: "reopen_source" },
      );
    }
  }

  const requestedSpaces: any[] = spaceIds.map((spaceId: string) =>
    context.requestedSpaceById.get(spaceId),
  );
  if (requestedSpaces.some((space) => space?.universityId !== undefined &&
      space.universityId !== universityId)) {
    throw new ChecklistMutationRouteError(
      403,
      "CHECKLIST_BULK_TARGET_UNAUTHORIZED",
      "A requested destination space belongs to another university",
    );
  }
  if (modelClassroomSource &&
      (requestedSpaces.length !== spaceIds.length ||
       requestedSpaces.some((space) =>
         !space || space.isDeleted || space.spaceType !== "overall_classroom"))) {
    throw new ChecklistMutationRouteError(
      422,
      "CHECKLIST_MODEL_DESTINATION_INVALID",
      "Every model classroom destination must be an active overall classroom space",
    );
  }
  if (requestedSpaces.length !== spaceIds.length ||
      requestedSpaces.some((space) =>
        !space || space.isDeleted || (
          classroomIds !== undefined && space.spaceType !== "overall_classroom"
        ),
      )) {
    // Existing callers can still bulk-copy model/lab/staff modules when they
    // use the legacy spaceIds-only contract. Explicit classroom associations
    // are restricted to overall_classroom spaces.
    if (classroomIds !== undefined) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_CLASSROOM_ASSOCIATION_INVALID",
        "Every destination must be an active overall classroom space",
      );
    }
    if (requestedSpaces.length !== spaceIds.length ||
        requestedSpaces.some((space) => !space || space.isDeleted)) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_BULK_TARGETS_MISSING",
        "Every destination space must be active and belong to this university",
      );
    }
  }

  if (classroomIds !== undefined) {
    // Prefer the persisted association. Legacy null links may use only a
    // unique normalized room name on each side; never use array order or a
    // first matching duplicate.
    const requestedClassrooms: any[] = classroomIds.map((classroomId: string) =>
      context.requestedClassroomById.get(classroomId),
    );
    if (requestedClassrooms.some((classroom) => classroom?.universityId !== undefined &&
        classroom.universityId !== universityId)) {
      throw new ChecklistMutationRouteError(
        403,
        "CHECKLIST_BULK_TARGET_UNAUTHORIZED",
        "A requested classroom belongs to another university",
      );
    }
    if (requestedClassrooms.length !== classroomIds.length ||
        requestedClassrooms.some((classroom) => !classroom || classroom.isDeleted)) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_CLASSROOM_ASSOCIATION_INVALID",
        "Every requested classroom must be active and belong to this university",
      );
    }

    classroomIds.forEach((classroomId: string, index: number) => {
      const classroom = context.requestedClassroomById.get(classroomId);
      const name = normalizeClassroomAssociationName(classroom?.roomId);
      const matchingClassrooms = name ? context.classroomNames.get(name) ?? [] : [];
      const matchingSpaces = name ? context.spaceNames.get(name) ?? [] : [];
      const requestedSpace = context.requestedSpaceById.get(spaceIds[index]);
      const persistedAssociationMatches = classroom?.spaceId != null
        && classroom.spaceId === requestedSpace?.id;
      const uniqueLegacyAssociationMatches = classroom?.spaceId == null
        && matchingClassrooms.length === 1
        && matchingClassrooms[0].id === classroom.id
        && matchingSpaces.length === 1
        && matchingSpaces[0].id === requestedSpace?.id;
      if (!classroom || (!persistedAssociationMatches && !uniqueLegacyAssociationMatches)) {
        throw new ChecklistMutationRouteError(
          422,
          "CHECKLIST_CLASSROOM_ASSOCIATION_AMBIGUOUS",
          "A destination classroom has no unique authorized space association",
        );
      }
    });
  }

  let statuses: any[];
  if (Array.isArray(targetStatusIds)) {
    // Validate exact identity rather than resolving a status by room name. It
    // also catches a target status from another university.
    const requestedStatuses = targetStatusIds.map((targetStatusId: string) =>
      context.statusById.get(targetStatusId),
    );
    if (requestedStatuses.some((status) => status && status.universityId !== universityId)) {
      throw new ChecklistMutationRouteError(
        403,
        "CHECKLIST_BULK_TARGET_UNAUTHORIZED",
        "A requested destination checklist row belongs to another university",
      );
    }
    if (requestedStatuses.length !== targetStatusIds.length ||
        requestedStatuses.some((status, index) => !status ||
           status.spaceId !== spaceIds[index] ||
           (!modelClassroomSource && status.checklistItemId !== checklistItemId))) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_BULK_TARGETS_MISSING",
        "A requested destination does not have the source checklist item",
      );
    }
    statuses = requestedStatuses;
  } else {
    statuses = spaceIds.map((spaceId: string) =>
      context.statusByItemAndSpace.get(bulkStatusKey(checklistItemId, spaceId)),
    );
    if (statuses.some((status) => !status)) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_BULK_TARGETS_MISSING",
        "One or more destination spaces do not have the source checklist item",
      );
    }
  }

  if (modelClassroomSource) {
    statuses.forEach((status) => {
      const targetSemanticKey = canonicalChecklistSemanticKey(
        status.checklistItem?.category,
        status.checklistItem?.name,
      );
      if (targetSemanticKey !== sourceSemanticKey) {
        throw new ChecklistMutationRouteError(
          422,
          "CHECKLIST_MODEL_TARGET_SEMANTIC_MISMATCH",
          "A model classroom destination does not have the matching checklist category and name",
        );
      }
      const candidates = context.semanticStatusesBySpaceAndKey.get(
        checklistSemanticMapKey(status.spaceId, sourceSemanticKey as string),
      ) ?? [];
      if (candidates.length !== 1 || candidates[0].id !== status.id) {
        throw new ChecklistMutationRouteError(
          422,
          "CHECKLIST_MODEL_TARGET_SEMANTIC_AMBIGUOUS",
          "A model classroom destination does not have a unique matching checklist category and name",
        );
      }
    });
  }

  return statuses.map((status, index) => {
    const data = buildBulkStatusData(update, status, modelClassroomSource);

    const hasDataField = (field: string): boolean =>
      Object.prototype.hasOwnProperty.call(data, field);
    const intendedBlocker = hasDataField("isBlocker") ? data.isBlocker : status.isBlocker;
    const reportFieldsChanged =
      (hasDataField("currentStatus") && data.currentStatus !== status.currentStatus) ||
      (hasDataField("remarks") && data.remarks !== status.remarks) ||
      (hasDataField("universityTimeline") &&
        data.universityTimeline !== status.universityTimeline) ||
      (hasDataField("targetTimeline") && data.targetTimeline !== status.targetTimeline) ||
      (hasDataField("itemStartDate") && data.itemStartDate !== status.itemStartDate) ||
      (hasDataField("itemEndDate") && data.itemEndDate !== status.itemEndDate) ||
      (hasDataField("isBlocker") && intendedBlocker !== status.isBlocker);
    const statusFieldsChanged = Object.entries(data).some(
      ([field, value]) => value !== status[field as keyof typeof status],
    );
    const skip = Boolean(
      skipDone && (status.currentStatus === "Done" || status.currentStatus === "N/A"),
    );
    return {
      update,
      status,
      classroomId: classroomIds?.[index],
      spaceId: spaceIds[index],
      data,
      reportFieldsChanged,
      statusFieldsChanged: !skip && statusFieldsChanged,
      photoChanged: !skip && hasDataField("photoUrl") && data.photoUrl !== status.photoUrl,
      skip,
    };
  });
}

/**
 * A bulk request is planned from one locked snapshot. Reusing a destination
 * status in that snapshot would make later updates project from stale data
 * (and can duplicate the initial history row), so reject all duplicate
 * destinations before any history or status write begins. The same guard also
 * rejects a source row being used as any destination in the request.
 */
function validateBulkPlanTargetConflicts(
  updates: any[],
  plans: BulkTargetPlan[],
): void {
  const sourceStatusIds = new Set(
    updates
      .map((update) => update.sourceStatusId)
      .filter((sourceStatusId): sourceStatusId is string => typeof sourceStatusId === "string"),
  );
  const seenTargetStatusIds = new Set<string>();

  for (const plan of plans) {
    if (sourceStatusIds.has(plan.status.id)) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_BULK_SOURCE_TARGET_OVERLAP",
        "A bulk source checklist row cannot also be a destination",
      );
    }
    if (seenTargetStatusIds.has(plan.status.id)) {
      throw new ChecklistMutationRouteError(
        422,
        "CHECKLIST_BULK_TARGET_STATUS_DUPLICATE",
        "A destination checklist row may only be requested once in a bulk save",
      );
    }
    seenTargetStatusIds.add(plan.status.id);
  }
}

function includeResultsForBulk(updates: unknown): boolean {
  return Array.isArray(updates) && updates.some((update: any) =>
    update && typeof update === "object" && (
      update.sourceStatusId !== undefined ||
      update.classroomIds !== undefined ||
      update.targetStatusIds !== undefined ||
      update.photoUrl !== undefined ||
      update.photoContentType !== undefined
    ),
  );
}

function bulkStatusDataKey(data: Prisma.SpaceChecklistStatusUpdateInput): string {
  return JSON.stringify(
    Object.keys(data)
      .sort()
      .map((field) => [field, data[field as keyof typeof data]]),
  );
}

async function buildBulkResults(
  tx: Prisma.TransactionClient,
  plans: BulkTargetPlan[],
): Promise<Array<{
  statusId: string;
  classroomId?: string;
  spaceId?: string;
  outcome: "applied" | "unchanged" | "skipped";
  row?: unknown;
}>> {
  if (plans.length === 0) return [];
  const rows = await tx.spaceChecklistStatus.findMany({
    where: { id: { in: plans.map((plan) => plan.status.id) } },
    include: {
      checklistItem: true,
      photoHistory: { orderBy: { uploadedAt: "desc" }, take: 10 },
    },
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  return plans.map((plan) => ({
    statusId: plan.status.id,
    classroomId: plan.classroomId,
    spaceId: plan.spaceId,
    outcome: plan.skip
      ? "skipped"
      : plan.statusFieldsChanged
        ? "applied"
        : "unchanged",
    row: rowById.get(plan.status.id),
  }));
}

// ── Bulk Status Update ────────────────────────────────────────────────────────

// Bulk status mutation. Legacy spaceIds-only requests remain supported by the
// same handler; explicit source/classroom/target ids additionally receive
// per-target acknowledgements.
router.post("/universities/:id/status/bulk", async (req: AuthRequest, res: Response) => {
  const uniId = req.params.id as string;
  const body = req.body as { updates?: unknown };
  const updates = body?.updates;
  res.set("X-Correlation-Id", checklistCorrelationId(req));
  try {
    if (!await canAccessUniversity(req.user, uniId)) {
      res.status(403).json({ error: "Access denied to this university" });
      return;
    }
    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({ error: "updates array is required" });
      return;
    }
    // Shape and duplicate-target validation is request-local and does not
    // need a connection. Do it before queue admission; ownership and source
    // freshness remain authoritative checks under the university lock.
    const seenTargetStatusIds = new Set<string>();
    for (const update of updates as any[]) {
      validateBulkChecklistUpdate(update, seenTargetStatusIds);
    }

    let lockWaitMs: number | undefined;
    const result = await withUniversityChecklistMutation(
      uniId,
      () =>
        prisma.$transaction(async (tx) => {
          const lockStartedAt = performance.now();
          try {
            await tx.$queryRaw`SELECT id FROM universities WHERE id = ${uniId} FOR UPDATE`;
          } finally {
            // Record failed lock waits too. A transaction deadline can fire
            // while this statement is waiting, before the normal assignment.
            lockWaitMs = Math.max(0, Math.round(performance.now() - lockStartedAt));
          }

          const context = await loadBulkChecklistRequestContext(tx, uniId, updates as any[]);
          const plans = (updates as any[]).flatMap((update) =>
            planBulkChecklistUpdate(uniId, update, context),
          );
          validateBulkPlanTargetConflicts(updates as any[], plans);
        const changedPlans = plans.filter((plan) => plan.statusFieldsChanged);
        const reportPlans = changedPlans.filter((plan) => plan.reportFieldsChanged);

        if (reportPlans.length > 0) {
          const reportStatusIds = reportPlans.map((plan) => plan.status.id);
          const existingHistory = await tx.checklistStatusHistory.findMany({
            where: { statusId: { in: reportStatusIds } },
            select: { statusId: true },
            distinct: ["statusId"],
          });
          const statusIdsWithHistory = new Set(existingHistory.map((entry) => entry.statusId));
          const initialHistory = reportPlans
            .filter((plan) => !statusIdsWithHistory.has(plan.status.id))
            .map((plan) => ({
              statusId: plan.status.id,
              universityId: uniId,
              currentStatus: plan.status.currentStatus,
              remarks: plan.status.remarks,
              universityTimeline: plan.status.universityTimeline,
              targetTimeline: plan.status.targetTimeline,
              itemStartDate: plan.status.itemStartDate,
              itemEndDate: plan.status.itemEndDate,
              isBlocker: plan.status.isBlocker,
              changedAt: plan.status.createdAt,
            }));
          if (initialHistory.length > 0) {
            await tx.checklistStatusHistory.createMany({ data: initialHistory });
          }
        }

        // Older rows may have a current photo URL but no PhotoHistory entry.
        // Before replacing that URL, preserve it as a history snapshot so a
        // copied photo does not erase legacy evidence.
        const legacyPhotoPlans = changedPlans.filter((plan) =>
          plan.photoChanged && plan.status.photoUrl,
        );
        if (legacyPhotoPlans.length > 0) {
          const legacyStatusIds = legacyPhotoPlans.map((plan) => plan.status.id);
          const existingPhotoHistory = await tx.photoHistory.findMany({
            where: { statusId: { in: legacyStatusIds } },
            select: { statusId: true, photoUrl: true, uploadedAt: true },
          });
          const historyByStatus = new Map<string, Array<{ photoUrl: string; uploadedAt: Date }>>();
          for (const entry of existingPhotoHistory) {
            const urls = historyByStatus.get(entry.statusId) ?? [];
            urls.push({ photoUrl: entry.photoUrl, uploadedAt: entry.uploadedAt });
            historyByStatus.set(entry.statusId, urls);
          }
          const legacySnapshots = legacyPhotoPlans
            .filter((plan) => {
              const history = historyByStatus.get(plan.status.id) ?? [];
              const currentPath = stripObjectPathMetadata(plan.status.photoUrl);
              return !history.some((entry) => stripObjectPathMetadata(entry.photoUrl) === currentPath);
            })
            .map((plan) => ({
              statusId: plan.status.id,
              photoUrl: plan.status.photoUrl as string,
              contentType: inferEvidenceContentType(
                plan.status.photoUrl,
                plan.status.photoContentType,
              ),
              uploadedBy: null,
              uploadedAt: plan.status.updatedAt ?? plan.status.createdAt,
              remarks: plan.status.remarks,
            }));
          if (legacySnapshots.length > 0) {
            await tx.photoHistory.createMany({ data: legacySnapshots });
          }
        }

        // A persisted status can predate PhotoHistory. If a copy explicitly
        // carries the same current object path as an existing destination,
        // there is no photoChanged transition and the old code treated the
        // request as a no-op. That left the current evidence invisible in the
        // destination's gallery because the gallery is backed by
        // PhotoHistory, not only by the current status row. Backfill the
        // current reference once, without turning retries into duplicate
        // gallery entries.
        const sameCurrentPhotoPlans = plans.filter((plan) =>
          !plan.skip &&
          plan.data.photoUrl &&
          plan.status.photoUrl &&
          plan.data.photoUrl === plan.status.photoUrl,
        );
        if (sameCurrentPhotoPlans.length > 0) {
          const sameCurrentStatusIds = sameCurrentPhotoPlans.map((plan) => plan.status.id);
          const existingCurrentHistory = await tx.photoHistory.findMany({
            where: { statusId: { in: sameCurrentStatusIds } },
            select: { statusId: true, photoUrl: true, uploadedAt: true },
          });
          const currentHistoryByStatus = new Map<
            string,
            Array<{ photoUrl: string; uploadedAt: Date }>
          >();
          for (const entry of existingCurrentHistory) {
            const entries = currentHistoryByStatus.get(entry.statusId) ?? [];
            entries.push({ photoUrl: entry.photoUrl, uploadedAt: entry.uploadedAt });
            currentHistoryByStatus.set(entry.statusId, entries);
          }
          const now = Date.now();
          const currentSnapshots = sameCurrentPhotoPlans
            .filter((plan) => {
              const history = currentHistoryByStatus.get(plan.status.id) ?? [];
              const currentPath = stripObjectPathMetadata(plan.status.photoUrl);
              return !history.some((entry) =>
                stripObjectPathMetadata(entry.photoUrl) === currentPath,
              );
            })
            .map((plan) => {
              const history = currentHistoryByStatus.get(plan.status.id) ?? [];
              const latestHistoryAt = history.reduce(
                (latest, entry) => Math.max(latest, entry.uploadedAt.getTime()),
                0,
              );
              return {
                statusId: plan.status.id,
                photoUrl: plan.status.photoUrl as string,
                contentType: inferEvidenceContentType(
                  plan.status.photoUrl,
                  plan.status.photoContentType,
                ),
                uploadedBy: null,
                uploadedAt: new Date(Math.max(
                  now,
                  latestHistoryAt,
                  plan.status.updatedAt.getTime(),
                ) + 1),
                remarks: plan.status.remarks,
              };
            });
          if (currentSnapshots.length > 0) {
            await tx.photoHistory.createMany({ data: currentSnapshots });
          }
        }

        // Duplicate destination rows and source-target overlap were rejected
        // above, so compatible field maps can be batched without projecting
        // one update over another.
        const writeGroups = new Map<string, {
          data: Prisma.SpaceChecklistStatusUpdateInput;
          statusIds: string[];
        }>();
        for (const plan of changedPlans) {
          const key = bulkStatusDataKey(plan.data);
          const group = writeGroups.get(key);
          if (group) group.statusIds.push(plan.status.id);
          else writeGroups.set(key, { data: plan.data, statusIds: [plan.status.id] });
        }
        for (const group of writeGroups.values()) {
          await tx.spaceChecklistStatus.updateMany({
            where: { id: { in: group.statusIds } },
            data: group.data,
          });
        }

        if (reportPlans.length > 0) {
          const savedRows = await tx.spaceChecklistStatus.findMany({
            where: { id: { in: reportPlans.map((plan) => plan.status.id) } },
          });
          const savedById = new Map(savedRows.map((row) => [row.id, row]));
          const changedAt = new Date();
          await tx.checklistStatusHistory.createMany({
            data: reportPlans.map((plan) => {
              const saved = savedById.get(plan.status.id) ?? plan.status;
              return {
                statusId: saved.id,
                universityId: uniId,
                currentStatus: saved.currentStatus,
                remarks: saved.remarks,
                universityTimeline: saved.universityTimeline,
                targetTimeline: saved.targetTimeline,
                itemStartDate: saved.itemStartDate,
                itemEndDate: saved.itemEndDate,
                isBlocker: saved.isBlocker,
                changedAt,
                changedById: req.user?.userId,
                changedByName: req.user?.name,
              };
            }),
          });
        }

        const photoPlans = changedPlans.filter((plan) => plan.photoChanged && plan.data.photoUrl);
        if (photoPlans.length > 0) {
          const existingPhotoHistory = await tx.photoHistory.findMany({
            where: { statusId: { in: photoPlans.map((plan) => plan.status.id) } },
            select: { statusId: true, uploadedAt: true },
          });
          const latestPhotoAt = new Map<string, number>();
          for (const entry of existingPhotoHistory) {
            const timestamp = entry.uploadedAt.getTime();
            latestPhotoAt.set(entry.statusId, Math.max(
              latestPhotoAt.get(entry.statusId) ?? 0,
              timestamp,
            ));
          }
          const copiedPhotoAt = new Map<string, number>();
          const now = Date.now();
          await tx.photoHistory.createMany({
            data: photoPlans.map((plan) => {
              const statusId = plan.status.id;
              const previous = Math.max(
                latestPhotoAt.get(statusId) ?? 0,
                copiedPhotoAt.get(statusId) ?? 0,
                plan.status.updatedAt.getTime(),
              );
              const uploadedAt = new Date(Math.max(now, previous) + 1);
              copiedPhotoAt.set(statusId, uploadedAt.getTime());
              return {
                statusId,
                photoUrl: plan.data.photoUrl as string,
                contentType: inferEvidenceContentType(
                  plan.data.photoUrl as string,
                  plan.data.photoContentType as string | null | undefined,
                ),
                uploadedBy: req.user?.name,
                uploadedAt,
                remarks: plan.update.remarks,
              };
            }),
          });
        }

        const applied = changedPlans.length;
        const skipped = plans.length - applied;
        const readinessChanged = changedPlans.some((plan) =>
          plan.data.currentStatus !== undefined &&
          plan.data.currentStatus !== plan.status.currentStatus,
        );
        if (readinessChanged) await syncReadiness(tx, uniId);
        if (applied > 0) {
          await tx.auditLog.create({
            data: {
              userId: req.user!.userId,
              userEmail: req.user!.email,
              action: "BULK_STATUS_UPDATE",
              module: "Checklist",
              entityId: uniId,
              updatedValue: { applied, skipped } as any,
            },
          });
        }

        const results = includeResultsForBulk(updates)
          ? await buildBulkResults(tx, plans)
          : undefined;
          return { applied, skipped, results };
        }),
      (timing) => {
        const lockWait = lockWaitMs ?? 0;
        const slowestPhase = Math.max(timing.admissionWaitMs, timing.mutationMs, lockWait);
        // Keep diagnostics bounded and non-sensitive: emit only phase
        // timings and counts, never payload fields, remarks, or evidence URLs.
        if (slowestPhase >= 250) {
          (req.log ?? logger).info({
            correlationId: checklistCorrelationId(req),
            operation: "bulk",
            universityId: uniId,
            updateCount: updates.length,
            targetCount: updates.reduce(
              (count, update: any) => count + update.spaceIds.length,
              0,
            ),
            admissionWaitMs: timing.admissionWaitMs,
            lockWaitMs: lockWait,
            transactionMs: timing.mutationMs,
            transactionWorkMs: Math.max(0, timing.mutationMs - lockWait),
          }, "Checklist bulk timing");
        }
      },
    );
    if (result.applied > 0) invalidateDailyReport(uniId);
    res.json({
      applied: result.applied,
      skipped: result.skipped,
      ...(result.results ? { results: result.results } : {}),
    });
  } catch (err) {
    sendChecklistMutationError(req, res, err, {
      operation: "bulk",
      universityId: uniId,
    });
  }
});

router.delete("/photo-history/:historyId", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const historyId = req.params.historyId as string;
    const owner = await prisma.photoHistory.findUnique({
      where: { id: historyId },
      select: { status: { select: { universityId: true } } },
    });
    if (!owner) { res.status(404).json({ error: "Photo not found" }); return; }

    const deletion = await withUniversityChecklistMutation(owner.status.universityId, () =>
      prisma.$transaction(async (tx) => {
        // Single and bulk checklist writers take this same university lock.
        // Admission plus the lock keeps a concurrent copy from racing this
        // transactional history/current-row removal in this process.
        await tx.$queryRaw`SELECT id FROM universities WHERE id = ${owner.status.universityId} FOR UPDATE`;
        const entry = await tx.photoHistory.findUnique({ where: { id: historyId } });
        if (!entry) return null;

        // Re-point the current row and remove the history row in the same
        // transaction. A copied object path can be referenced by another
        // history row or by another status' current evidence.
        await tx.photoHistory.delete({ where: { id: historyId } });
        const nextLatest = await tx.photoHistory.findFirst({
          where: { statusId: entry.statusId },
          orderBy: { uploadedAt: "desc" },
        });
        const updatedStatus = await tx.spaceChecklistStatus.update({
          where: { id: entry.statusId },
          data: {
            photoUrl: nextLatest?.photoUrl || null,
            photoContentType: inferEvidenceContentType(nextLatest?.photoUrl, nextLatest?.contentType),
          },
          select: { id: true, universityId: true },
        });

        return {
          entry,
          updatedStatus,
          nextLatest,
        };
      }),
    );
    if (!deletion) { res.status(404).json({ error: "Photo not found" }); return; }

    // Keep the underlying object for a future audited garbage collector. The
    // history/current-row removal above remains transactional, and never races
    // a new reference with asynchronous physical deletion.

    invalidateDailyReport(deletion.updatedStatus.universityId);

    res.json({
      success: true,
      newPhotoUrl: deletion.nextLatest?.photoUrl || null,
      newPhotoContentType: inferEvidenceContentType(
        deletion.nextLatest?.photoUrl,
        deletion.nextLatest?.contentType,
      ),
    });
  } catch (err) {
    logger.error({ err }, "Delete photo history error");
    if ((err as { code?: string })?.code === "P2025") {
      res.status(404).json({ error: "Photo not found" });
      return;
    }
    res.status(500).json({ error: "Failed to delete photo" });
  }
});

export default router;
