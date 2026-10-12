import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { logger } from "./logger";
import fs from "fs";
import path from "path";
import crypto from "crypto";

function loadOrGenerateSecret(): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  // In development, persist a generated secret so tokens survive restarts.
  // .local/ is gitignored — this secret is never committed to the repo.
  const secretFile = path.resolve(process.cwd(), ".local", "jwt.secret");
  if (fs.existsSync(secretFile)) {
    const stored = fs.readFileSync(secretFile, "utf8").trim();
    if (stored) return stored;
  }
  const generated = crypto.randomBytes(48).toString("base64url");
  try {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    logger.warn(
      "JWT_SECRET env var not set. Generated a dev-only secret and stored it at .local/jwt.secret. " +
      "Set JWT_SECRET via Replit Secrets for production use."
    );
  } catch (err) {
    logger.error({ err }, "Could not persist JWT secret — tokens will be invalidated on restart");
  }
  return generated;
}

const JWT_SECRET = loadOrGenerateSecret();

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  name: string;
  zoneIds: number[];
  universityIds: string[];
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    logger.warn({ err }, "Invalid JWT");
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}
