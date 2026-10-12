import prisma from "../lib/prisma";
import { ensureEvidenceGcSchema } from "../lib/evidenceGc";

try {
  await ensureEvidenceGcSchema();
  console.log("Evidence GC schema, reference triggers, and canonical backfill are ready.");
} finally {
  await prisma.$disconnect();
}