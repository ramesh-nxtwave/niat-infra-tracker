import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";
import { signToken, requireAuth, AuthRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import { validate, LoginBody } from "../middleware/validate";

const router = Router();

router.post("/auth/login", validate({ body: LoginBody }), async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      zoneIds: user.zoneIds,
      universityIds: user.universityIds,
    });
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        zoneIds: user.zoneIds,
        universityIds: user.universityIds,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    logger.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, name: true, email: true, role: true, zoneIds: true, universityIds: true, isActive: true },
    });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(user);
  } catch (err) {
    logger.error({ err }, "Auth me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
