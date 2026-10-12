import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import universitiesRouter from "./universities";
import evidenceRouter from "./evidence";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";
import reportsRouter from "./reports";
import assistantRouter from "./assistant";
import evidenceGcRouter from "./evidenceGc";

const router: IRouter = Router();

// Health + Auth first — always public, no token needed
router.use(healthRouter);
router.use(authRouter);
// Storage BEFORE any router that has a catch-all router.use(requireAuth),
// otherwise unauthenticated GET /storage/objects/* requests are blocked by
// the users/universities/evidence routers' global auth middleware before
// they ever reach the storage router — breaking <img> tag previews.
router.use(storageRouter);
router.use(usersRouter);
router.use(universitiesRouter);
router.use(evidenceRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(assistantRouter);
router.use(evidenceGcRouter);

export default router;
