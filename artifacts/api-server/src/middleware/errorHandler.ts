import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Centralized error handler — must be registered LAST in app.ts.
 * Catches all errors passed to next(err) or thrown in async routes.
 * Never leaks Prisma internals or stack traces to the client in production.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }

  // Prisma known errors — surface a clean message, not raw DB details
  if (
    err instanceof Error &&
    "code" in err &&
    typeof (err as any).code === "string" &&
    (err as any).code.startsWith("P")
  ) {
    const prismaCode = (err as any).code as string;
    if (prismaCode === "P2002") {
      res.status(409).json({ error: "A record with that value already exists" });
      return;
    }
    if (prismaCode === "P2025") {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    logger.error({ err, prismaCode, url: req.url }, "Unhandled Prisma error");
    res.status(500).json({ error: "Database error" });
    return;
  }

  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Invalid JSON in request body" });
    return;
  }

  logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
  const message = process.env.NODE_ENV === "production" ? "Internal server error" : String(err);
  res.status(500).json({ error: message });
}
