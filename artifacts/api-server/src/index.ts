import app from "./app";
import { logger } from "./lib/logger";
import prisma from "./lib/prisma";
import { startReportScheduler } from "./lib/reportScheduler";
import { ensureEvidenceGcSchema } from "./lib/evidenceGc";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const start = async () => {
  // Prisma db push supplies modeled tables during deploy; this idempotent
  // startup installation supplies the cross-table reference triggers and
  // backfills existing canonical references before accepting writes.
  await ensureEvidenceGcSchema();
  const server = app.listen(port, (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    startReportScheduler();
  });

  return server;
};

const serverPromise = start().catch((err) => {
  logger.error({ err }, "Database/evidence GC startup setup failed");
  process.exit(1);
});

/**
 * Graceful shutdown — drain in-flight HTTP requests before exiting.
 * Gives the load balancer time to route new traffic elsewhere while
 * existing requests complete. Force-exits after 10 s if connections stall.
 */
const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutdown signal received — draining connections…");

  const server = await serverPromise;
  server.close(async (err) => {
    if (err) logger.error({ err }, "Error closing HTTP server");
    try {
      await prisma.$disconnect();
      logger.info("Database connection closed");
    } catch (disconnectErr) {
      logger.error({ err: disconnectErr }, "Error disconnecting from database");
    }
    logger.info("Graceful shutdown complete");
    process.exit(err ? 1 : 0);
  });

  // Safety net: force kill if requests don't drain within 10 s
  const forceExit = setTimeout(() => {
    logger.warn("Forced shutdown after 10 s timeout");
    process.exit(1);
  }, 10_000);
  forceExit.unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — shutting down");
  shutdown("unhandledRejection");
});
