import { Router } from "express";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, AuthRequest } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

router.get("/dashboard", async (req: AuthRequest, res) => {
  try {
    let where: any = {};
    if (req.user?.role === "zonal_manager") {
      where = req.user.zoneIds?.length
        ? { zoneId: { in: req.user.zoneIds } }
        : { id: "__NONE__" };
    } else if (req.user?.role === "apm") {
      where = req.user.universityIds?.length
        ? { id: { in: req.user.universityIds } }
        : { id: "__NONE__" };
    }

    const unis = await prisma.university.findMany({
      where,
      select: {
        id: true, name: true, location: true, zoneId: true, riskStatus: true,
        overallReadiness: true, classroomAllocationDone: true, targetDate: true,
        apmName: true, effortsRequired: true, studentsCount: true,
        confidencePercentage: true, probabilityStatus: true, reminderDays: true,
        allocationPendingRemarks: true, infraReadyMonth: true,
        _count: { select: { spaces: true, classrooms: true } },
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const total = unis.length;
    const avgReadiness = total > 0
      ? Math.round(unis.reduce((a, u) => a + (u.overallReadiness || 0), 0) / total)
      : 0;
    const redRisk = unis.filter(u => u.riskStatus === "RED").length;
    const allocationDone = unis.filter(u => u.classroomAllocationDone).length;
    const withTarget = unis.filter(u => u.targetDate && u.targetDate !== "TBD").length;

    // Overdue: target date passed and readiness < 100
    const overdueUnis = unis.filter(u => {
      if (!u.targetDate || u.targetDate === "TBD") return false;
      const t = new Date(u.targetDate);
      return !isNaN(t.getTime()) && t < today && (u.overallReadiness || 0) < 100;
    });

    // Upcoming: within reminderDays of target date
    const upcomingUnis = unis.filter(u => {
      if (!u.targetDate || u.targetDate === "TBD") return false;
      const t = new Date(u.targetDate);
      if (isNaN(t.getTime())) return false;
      const diffDays = (t.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      const reminder = u.reminderDays ?? 5;
      return diffDays >= 0 && diffDays <= reminder;
    });

    // Infra Ready Month stats
    const nowDate = new Date();
    const thisMonth = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}`;
    const nextMonthDate = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1);
    const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;
    const threeMonthsLater = new Date(nowDate.getFullYear(), nowDate.getMonth() + 3, 1);
    const threeMonthsStr = `${threeMonthsLater.getFullYear()}-${String(threeMonthsLater.getMonth() + 1).padStart(2, "0")}`;

    const infraThisMonth = unis.filter(u => u.infraReadyMonth === thisMonth);
    const infraNextMonth = unis.filter(u => u.infraReadyMonth === nextMonth);
    const infraNext3Months = unis.filter(u => u.infraReadyMonth && u.infraReadyMonth > thisMonth && u.infraReadyMonth < threeMonthsStr);
    const infraDelayed = unis.filter(u => u.infraReadyMonth && u.infraReadyMonth < thisMonth && (u.overallReadiness || 0) < 100);
    const infraNotSet = unis.filter(u => !u.infraReadyMonth);

    // Effort breakdown
    const effortsBreakdown = { HIGH: 0, MEDIUM: 0, LOW: 0, unset: 0 };
    unis.forEach(u => {
      const e = u.effortsRequired?.toUpperCase();
      if (e === "HIGH") effortsBreakdown.HIGH++;
      else if (e === "MEDIUM") effortsBreakdown.MEDIUM++;
      else if (e === "LOW") effortsBreakdown.LOW++;
      else effortsBreakdown.unset++;
    });

    const statusBreakdown = await prisma.spaceChecklistStatus.groupBy({
      by: ["currentStatus"],
      where: req.user?.role === "admin"
        ? {}
        : { universityId: { in: unis.map(u => u.id) } },
      _count: { currentStatus: true },
    });

    const breakdown: Record<string, number> = {};
    statusBreakdown.forEach(s => { breakdown[s.currentStatus] = s._count.currentStatus; });

    const auditWhere: any = {};
    if (req.user?.role !== "admin" && unis.length > 0) {
      auditWhere.entityId = { in: unis.map(u => u.id) };
    } else if (req.user?.role !== "admin") {
      auditWhere.id = "none";
    }
    const recentActivity = await prisma.auditLog.findMany({
      where: auditWhere,
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, module: true, entityId: true, userEmail: true, createdAt: true },
    });

    res.json({
      totalUniversities: total,
      avgReadiness,
      redRiskCount: redRisk,
      allocationDoneCount: allocationDone,
      withTimelineCount: withTarget,
      overdueCount: overdueUnis.length,
      overdueUniversities: overdueUnis.slice(0, 10),
      upcomingCount: upcomingUnis.length,
      upcomingUniversities: upcomingUnis.slice(0, 10),
      effortsBreakdown,
      statusBreakdown: breakdown,
      universities: unis,
      recentActivity,
      infraReadyMonth: {
        thisMonth,
        nextMonth,
        thisMonthCount: infraThisMonth.length,
        nextMonthCount: infraNextMonth.length,
        next3MonthsCount: infraNext3Months.length,
        delayedCount: infraDelayed.length,
        notSetCount: infraNotSet.length,
        thisMonthUniversities: infraThisMonth.slice(0, 10),
        nextMonthUniversities: infraNextMonth.slice(0, 10),
        delayedUniversities: infraDelayed.slice(0, 10),
        upcomingUniversities: infraNext3Months.slice(0, 10),
      },
    });
  } catch (err) {
    logger.error({ err }, "Dashboard error");
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

router.get("/audit", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.auditLog.count(),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error({ err }, "Audit logs error");
    res.status(500).json({ error: "Failed to load audit logs" });
  }
});

router.get("/audit-logs", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count(),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error({ err }, "Audit logs error");
    res.status(500).json({ error: "Failed to load audit logs" });
  }
});

router.post("/audit", async (req: AuthRequest, res) => {
  try {
    const { action, module, entityId, previousValue, updatedValue } = req.body;
    await prisma.auditLog.create({
      data: {
        userId: req.user?.userId,
        userEmail: req.user?.email,
        action: (action || "ACTION").toUpperCase(),
        module: module || "Unknown",
        entityId: entityId ? String(entityId) : null,
        previousValue,
        updatedValue,
      },
    });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Audit log create error");
    res.status(500).json({ error: "Failed to log audit action" });
  }
});

export default router;
