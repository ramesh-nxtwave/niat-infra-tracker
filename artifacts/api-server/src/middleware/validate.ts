import { type RequestHandler } from "express";
import { z, type ZodSchema } from "zod";

type ValidateShape = {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
};

export function validate(shape: ValidateShape): RequestHandler {
  return (req, res, next) => {
    if (shape.body) {
      const r = shape.body.safeParse(req.body);
      if (!r.success) {
        res.status(400).json({
          error: r.error.issues[0]?.message ?? "Invalid request body",
          field: r.error.issues[0]?.path?.join("."),
        });
        return;
      }
      req.body = r.data;
    }
    if (shape.params) {
      const r = shape.params.safeParse(req.params);
      if (!r.success) {
        res.status(400).json({ error: r.error.issues[0]?.message ?? "Invalid URL parameter" });
        return;
      }
    }
    if (shape.query) {
      const r = shape.query.safeParse(req.query);
      if (!r.success) {
        res.status(400).json({ error: r.error.issues[0]?.message ?? "Invalid query parameter" });
        return;
      }
      Object.assign(req.query, r.data);
    }
    next();
  };
}

export const PaginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().trim().optional(),
});

export const IdParam = z.object({ id: z.string().min(1, "ID is required") });

const ROLES = ["admin", "zonal_manager", "apm"] as const;

export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const LoginBody = z.object({
  email: z.string().email("A valid email address is required").toLowerCase().trim(),
  password: z.string().min(1, "Password is required"),
});

export const CreateUserBody = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().email("A valid email address is required").toLowerCase().trim(),
  password: PasswordSchema,
  role: z.enum(ROLES).default("apm"),
  zoneIds: z.array(z.number().int()).default([]),
  universityIds: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

export const UpdateUserBody = z.object({
  name: z.string().trim().min(2).optional(),
  email: z.string().email().toLowerCase().trim().optional(),
  password: PasswordSchema.optional(),
  role: z.enum(ROLES).optional(),
  zoneIds: z.array(z.number().int()).optional(),
  universityIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const CreateUniversityBody = z.object({
  name: z.string().trim().min(2, "University name must be at least 2 characters"),
  location: z.string().trim().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  internalTimeline: z.string().nullable().optional(),
  classCommencementDate: z.string().nullable().optional(),
  zoneId: z.number().int().positive().nullable().optional(),
  apmName: z.string().trim().nullable().optional(),
  studentsCount: z.number().int().nonnegative().nullable().optional(),
  maxStudentsCount: z.number().int().nonnegative().nullable().optional(),
  effortsRequired: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
  confidencePercentage: z.number().int().min(0).max(100).nullable().optional(),
  probabilityStatus: z.string().trim().nullable().optional(),
  apmConfidenceDate: z.string().nullable().optional(),
  reminderDays: z.number().int().min(1).max(365).default(5),
  allocationPendingRemarks: z.string().trim().nullable().optional(),
  priority: z.enum(["P1", "P2", "P3"]).default("P2"),
  infraReadyMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be YYYY-MM format").nullable().optional(),
});

export const UpdateUniversityBody = CreateUniversityBody.partial().extend({
  riskStatus: z.enum(["GREEN", "YELLOW", "RED"]).optional(),
  numClassrooms: z.number().int().nonnegative().nullable().optional(),
  classroomCapacity: z.number().int().nonnegative().nullable().optional(),
  classroomAllocationDone: z.boolean().optional(),
  modelClassroomTimeline: z.string().nullable().optional(),
  lab5Timeline: z.string().nullable().optional(),
  staffRoomTimeline: z.string().nullable().optional(),
  allClassroomsTimeline: z.string().nullable().optional(),
});

export const UpdateUniversityCriticalBody = z.object({
  isCritical: z.boolean(),
});

export const UpdateUniversityReportPriorityBody = z.object({
  priority: z.enum(["CRITICAL", "MEDIUM", "LOW", "NA"]),
});

const NullableCapacity = z.preprocess(
  value => value === "" || value == null ? null : value,
  z.coerce.number().int().nonnegative().nullable(),
);

export const CreateClassroomBody = z.object({
  roomId: z.string().trim().min(1, "Room name is required"),
  floor: z.string().nullable().optional(),
  capacity: NullableCapacity.optional(),
  timeline: z.string().nullable().optional(),
  driveLink: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
});

export const UpdateClassroomBody = CreateClassroomBody.partial();

export const ResolveClassroomSpaceBody = z.object({
  spaceId: z.string().min(1, "spaceId is required"),
});

const STATUSES = ["Done", "N/A", "In-Progress", "Partially Done", "Blocker", "Yet to start", "No info as of now", "Need to revamp"] as const;

export const PatchStatusBody = z.object({
  currentStatus: z.enum(STATUSES).optional(),
  remarks: z.string().trim().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  photoContentType: z.string().trim().max(255).nullable().optional(),
  universityTimeline: z.string().nullable().optional(),
  targetTimeline: z.string().nullable().optional(),
  actualCompletionDate: z.string().nullable().optional(),
  itemStartDate: z.string().nullable().optional(),
  itemEndDate: z.string().nullable().optional(),
  capacity: z.string().nullable().optional(),
  isBlocker: z.boolean().optional(),
});

export const CreateActionItemBody = z.object({
  content: z.string().trim().min(1, "Content is required"),
  dueDate: z.string().nullable().optional(),
  status: z.enum(["open", "in_progress", "resolved"]).default("open"),
});

export const UpdateActionItemBody = z.object({
  content: z.string().trim().min(1).optional(),
  dueDate: z.string().nullable().optional(),
  status: z.enum(["open", "in_progress", "resolved"]).optional(),
});
