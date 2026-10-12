import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, AuthRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import { validate, CreateUserBody, UpdateUserBody, PaginationQuery, IdParam } from "../middleware/validate";

const router = Router();
router.use(requireAuth);

const USER_SELECT = {
  id: true, name: true, email: true, role: true,
  zoneIds: true, universityIds: true, isActive: true, createdAt: true,
};

router.get("/users", requireRole("admin"), validate({ query: PaginationQuery }), async (req: AuthRequest, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const search = req.query.search as string | undefined;

    const where: any = { isDeleted: false };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: users, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error({ err }, "List users error");
    res.status(500).json({ error: "Failed to list users" });
  }
});

router.post("/users", requireRole("admin"), validate({ body: CreateUserBody }), async (req: AuthRequest, res) => {
  const { name, email, password, role, zoneIds, universityIds, isActive } = req.body;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role, zoneIds, universityIds, isActive },
      select: USER_SELECT,
    });
    res.status(201).json(user);
  } catch (err: any) {
    logger.error({ err }, "Create user error");
    if (err.code === "P2002") { res.status(409).json({ error: "Email already exists" }); return; }
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.put("/users/:id", requireRole("admin"), validate({ params: IdParam, body: UpdateUserBody }), async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const { name, email, password, role, zoneIds, universityIds, isActive } = req.body;
  try {
    // Partial-safe update: only include fields that were explicitly provided in the request body.
    // This prevents toggleActive({ isActive }) from silently resetting role/assignments.
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (password) data.passwordHash = await bcrypt.hash(password, 12);
    if (role !== undefined) data.role = role;
    if (zoneIds !== undefined) data.zoneIds = zoneIds;
    if (universityIds !== undefined) data.universityIds = universityIds;
    if (isActive !== undefined) data.isActive = isActive;

    const user = await prisma.user.update({ where: { id }, data, select: USER_SELECT });
    res.json(user);
  } catch (err: any) {
    logger.error({ err }, "Update user error");
    if (err.code === "P2025") { res.status(404).json({ error: "User not found" }); return; }
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.delete("/users/:id", requireRole("admin"), validate({ params: IdParam }), async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  try {
    if (id === req.user!.userId) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }
    // Soft delete — preserves all audit trail and associations
    await prisma.user.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.email, isActive: false },
    });
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "Delete user error");
    if (err.code === "P2025") { res.status(404).json({ error: "User not found" }); return; }
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
