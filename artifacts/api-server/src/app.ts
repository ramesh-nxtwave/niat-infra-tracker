import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import storageRouter from "./routes/storage";
import { logger } from "./lib/logger";
import { uploadsDir } from "./lib/paths";
import { errorHandler } from "./middleware/errorHandler";

const app: Express = express();

// Security headers — applied before anything else
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting — applied selectively to sensitive endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", authLimiter);

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 60,
  message: { error: "Upload rate limit exceeded. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/storage/uploads", uploadLimiter);
app.use("/api/upload", uploadLimiter);

// Serve legacy local uploads (dev/existing files) — kept for backward compatibility.
// New uploads go to Replit Object Storage via /api/storage/uploads/request-url.
app.use("/api/uploads", express.static(uploadsDir));
app.use("/api/uploads", (_req: Request, res: Response) => {
  res.status(404).json({ error: "File not found" });
});

// Serve object storage images at their canonical stored path /objects/<...>
// so that window.location.origin + photoUrl opens the image directly in the browser.
// The Replit proxy is configured to route /objects/* to this server (not the frontend).
// Internally we rewrite /objects/<rest> → /storage/objects/<rest> and delegate
// to the existing storageRouter handler (public, no auth required).
app.use("/objects", (req: Request, _res: Response, next: NextFunction) => {
  req.url = "/storage/objects" + req.url;
  next();
}, storageRouter);

app.use("/api", router);
// /api/v1 is an alias for forward-compatibility — clients can migrate gradually
app.use("/api/v1", router);

// Centralized error handler — MUST be last
app.use(errorHandler);

export default app;
