import cron from "node-cron";
import { logger } from "./logger";
import { gatherReportData, generateAiInsights } from "./reportGenerator";
import { sendReport } from "./emailSender";
import prisma from "./prisma";

let lastRunAt: Date | null = null;
let isRunning = false;

export async function runReport(): Promise<{ success: boolean; message: string; data?: object }> {
  if (isRunning) {
    return { success: false, message: "Report generation already in progress. Please wait." };
  }
  isRunning = true;
  try {
    logger.info("Starting automated infra tracker report generation...");

    const data = await gatherReportData();
    logger.info({ totalUniversities: data.totalUniversities }, "Report data gathered");

    const aiInsights = await generateAiInsights(data);
    logger.info("AI insights generated");

    await sendReport(data, aiInsights);
    logger.info("Report email sent");

    lastRunAt = new Date();

    await prisma.auditLog.create({
      data: {
        action: "automated_report_sent",
        module: "reports",
        entityId: "scheduled",
        updatedValue: {
          recipients: ["varshith@nxtwave.tech", "karthik@nxtwave.tech"],
          totalUniversities: data.totalUniversities,
          overallReadiness: data.overallReadiness,
          notAllocated: data.notAllocated,
          delayed: data.timelineSummary.delayed,
        },
        userEmail: "system@niat.ac.in",
      },
    });

    return {
      success: true,
      message: `Report sent successfully to varshith@nxtwave.tech, karthik@nxtwave.tech`,
      data: {
        totalUniversities: data.totalUniversities,
        overallReadiness: data.overallReadiness,
        notAllocated: data.notAllocated,
        timelineSummary: data.timelineSummary,
        sentAt: lastRunAt,
      },
    };
  } catch (err: any) {
    logger.error({ err }, "Report generation/send failed");
    throw err;
  } finally {
    isRunning = false;
  }
}

export function startReportScheduler(): void {
  // Every 3 days at 8:00 AM — "0 8 */3 * *"
  const schedule = "0 8 */3 * *";

  if (!cron.validate(schedule)) {
    logger.error("Invalid cron schedule for report scheduler");
    return;
  }

  cron.schedule(schedule, async () => {
    logger.info("Scheduled report triggered (every 3 days)");
    try {
      await runReport();
    } catch (err) {
      logger.error({ err }, "Scheduled report failed");
    }
  }, {
    timezone: "Asia/Kolkata",
  });

  logger.info("Report scheduler started — runs every 3 days at 08:00 IST");
}

export function getSchedulerStatus(): { lastRunAt: string | null; isRunning: boolean; schedule: string } {
  return {
    lastRunAt: lastRunAt?.toISOString() ?? null,
    isRunning,
    schedule: "Every 3 days at 08:00 IST",
  };
}
