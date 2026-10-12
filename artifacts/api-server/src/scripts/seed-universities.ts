/**
 * Bulk-seed 29 universities with full default checklist structures.
 *
 * Safe to run multiple times — skips any university whose name already exists.
 * Codes are generated to avoid collisions with the current highest code in the DB.
 *
 * Usage:
 *   cd artifacts/api-server && pnpm dlx tsx src/scripts/seed-universities.ts
 */

import prisma from "../lib/prisma";

const UNIVERSITIES = [
  "Bharatiya Engineering Science and Technology Innovation University",
  "Joy University",
  "St. Peter's Institute of Higher Education and Research",
  "Alard University",
  "Ajeenkya DY Patil University",
  "Annamacharya University",
  "Vivekananda Global University",
  "S-VYASA (Deemed to be University)",
  "AMET University (Chennai)",
  "AMET University (Thenpattinam)",
  "Sanjay Ghodawat University",
  "Chaitanya University",
  "NRI",
  "Yenepoya Mangalore Campus",
  "Yenepoya Bangalore Campus",
  "Malla Reddy Technical Campus (MRV)",
  "Crescent University",
  "Noida International University",
  "Chalapathi (CITY)",
  "Scope Global Skills University",
  "SMR University",
  "Sandip University",
  "Sanskriti University",
  "Sushant University",
  "Geeta University",
  "Universal SkillTech University",
  "SNS College of Technology",
  "T. S Mishra University",
  "Subharti University",
];

const SPACE_TYPES = [
  { name: "Model Classroom", spaceType: "model_classroom" },
  { name: "5.0 Lab",         spaceType: "lab" },
  { name: "Staff Room",      spaceType: "staff_room" },
];

async function main() {
  console.log("🌱 Bulk-seeding universities...\n");

  // ── 1. Determine the next safe code number ────────────────────────────────
  // Find the highest existing numeric suffix in codes like UNI-042
  const existingCodes = await prisma.university.findMany({
    select: { code: true },
    where: { code: { not: null } },
  });
  const maxNum = existingCodes.reduce((max, { code }) => {
    const m = code?.match(/^UNI-(\d+)$/);
    const n = m ? parseInt(m[1], 10) : 0;
    return Math.max(max, n);
  }, 0);
  let nextCodeNum = maxNum + 1;

  // ── 2. Fetch all checklist items once (reused for every university) ───────
  const allItems = await prisma.checklistItem.findMany({
    select: { id: true, module: true },
  });
  if (!allItems.length) {
    console.error("❌ No checklist items found. Run the main seed first:\n   cd artifacts/api-server && pnpm dlx tsx src/scripts/seed.ts");
    process.exit(1);
  }
  const itemsByModule: Record<string, string[]> = {};
  for (const item of allItems) {
    if (!itemsByModule[item.module]) itemsByModule[item.module] = [];
    itemsByModule[item.module].push(item.id);
  }
  console.log(`  ✓ Loaded ${allItems.length} checklist items across ${Object.keys(itemsByModule).length} modules\n`);

  // ── 3. Fetch names of universities that already exist ─────────────────────
  const existing = await prisma.university.findMany({
    select: { name: true },
    where: { isDeleted: false },
  });
  const existingNames = new Set(existing.map(u => u.name.trim().toLowerCase()));

  // ── 4. Insert each university ─────────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  const failed: { name: string; error: string }[] = [];

  for (const uniName of UNIVERSITIES) {
    const normalised = uniName.trim().toLowerCase();

    if (existingNames.has(normalised)) {
      console.log(`  ⏭  SKIP  "${uniName}" — already exists`);
      skipped++;
      continue;
    }

    const code = `UNI-${String(nextCodeNum).padStart(3, "0")}`;
    nextCodeNum++;

    try {
      await prisma.$transaction(async (tx) => {
        // Create university
        const uni = await tx.university.create({
          data: { code, name: uniName.trim() },
        });

        // Create 3 spaces + their checklist statuses
        for (const { name: spaceName, spaceType } of SPACE_TYPES) {
          const space = await tx.space.create({
            data: { universityId: uni.id, spaceType, name: spaceName },
          });

          const itemIds = itemsByModule[spaceType] ?? [];
          if (itemIds.length) {
            await tx.spaceChecklistStatus.createMany({
              data: itemIds.map(checklistItemId => ({
                universityId: uni.id,
                spaceId: space.id,
                checklistItemId,
                currentStatus: "Yet to start",
              })),
              skipDuplicates: true,
            });
          }
        }
      });

      console.log(`  ✅ CREATED  "${uniName}" (${code})`);
      created++;
      existingNames.add(normalised); // prevent re-insert if name appears twice in list
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`  ❌ FAILED   "${uniName}" — ${msg}`);
      failed.push({ name: uniName, error: msg });
      // rollback happened automatically; safe to continue
    }
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────");
  console.log(`✅ Created : ${created}`);
  console.log(`⏭  Skipped : ${skipped}`);
  console.log(`❌ Failed  : ${failed.length}`);
  if (failed.length) {
    console.log("\nFailed universities:");
    failed.forEach(f => console.log(`  • ${f.name}\n    ${f.error}`));
  }
  console.log("────────────────────────────────────────\n");
}

main()
  .catch(err => { console.error("Fatal error:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
