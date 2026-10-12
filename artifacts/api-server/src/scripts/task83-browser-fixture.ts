import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";

const action = process.argv[2];
const fixtureId = process.env.TASK83_FIXTURE_ID;
const email = process.env.TASK83_FIXTURE_EMAIL;
const password = process.env.TASK83_FIXTURE_PASSWORD;

function requireFixtureEnvironment(): string {
  if (process.env.NODE_ENV === "production" || process.env.TASK83_ALLOW_FIXTURE !== "1") {
    throw new Error("Task 83 fixtures are disabled; use an isolated development database and set TASK83_ALLOW_FIXTURE=1");
  }
  if (!fixtureId || !/^[a-z0-9-]{6,40}$/i.test(fixtureId)) {
    throw new Error("TASK83_FIXTURE_ID must contain 6-40 letters, numbers, or hyphens");
  }
  return fixtureId;
}

async function setup(): Promise<void> {
  const safeFixtureId = requireFixtureEnvironment();
  if (!email || !password) {
    throw new Error("TASK83_FIXTURE_EMAIL and TASK83_FIXTURE_PASSWORD are required");
  }
  const code = `TASK83-${safeFixtureId}`;
  const existingUniversity = await prisma.university.findUnique({ where: { code } });
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUniversity || existingUser) {
    throw new Error("Fixture university or user already exists; clean it up or choose a new fixture ID and email");
  }

  const modules = ["model_classroom", "lab", "staff_room", "overall_classroom"];
  const itemCounts = await Promise.all(
    modules.map((module) => prisma.checklistItem.count({ where: { module } })),
  );
  const missingModules = modules.filter((_, index) => itemCounts[index] === 0);
  if (missingModules.length > 0) {
    throw new Error(`Seed checklist items before creating the fixture; missing modules: ${missingModules.join(", ")}`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: `Task 83 browser ${safeFixtureId}`,
        email,
        passwordHash,
        role: "admin",
      },
    });
    const university = await tx.university.create({
      data: {
        code,
        name: `Task 83 Checklist Save ${safeFixtureId}`,
        location: "Isolated browser fixture",
      },
    });
    const spaces = await Promise.all([
      tx.space.create({
        data: { universityId: university.id, name: "Model Classroom", spaceType: "model_classroom" },
      }),
      tx.space.create({
        data: { universityId: university.id, name: "5.0 Lab", spaceType: "lab" },
      }),
      tx.space.create({
        data: { universityId: university.id, name: "Staff Room", spaceType: "staff_room" },
      }),
      tx.space.create({
        data: { universityId: university.id, name: "TASK83 Room A", spaceType: "overall_classroom" },
      }),
      tx.space.create({
        data: { universityId: university.id, name: "TASK83 Room B", spaceType: "overall_classroom" },
      }),
    ]);
    await tx.universityClassroom.createMany({
      data: [
        { universityId: university.id, roomId: "TASK83 Room A", floor: "Fixture floor 1" },
        { universityId: university.id, roomId: "TASK83 Room B", floor: "Fixture floor 2" },
      ],
    });

    for (const space of spaces) {
      const items = await tx.checklistItem.findMany({
        where: { module: space.spaceType },
        select: { id: true },
      });
      await tx.spaceChecklistStatus.createMany({
        data: items.map((item) => ({
          universityId: university.id,
          spaceId: space.id,
          checklistItemId: item.id,
        })),
      });
    }
    return { userId: user.id, universityId: university.id };
  });

  console.log(JSON.stringify({
    action: "created",
    fixtureId: safeFixtureId,
    universityId: created.universityId,
  }));
}

async function cleanup(): Promise<void> {
  const safeFixtureId = requireFixtureEnvironment();
  if (!email) {
    throw new Error("TASK83_FIXTURE_EMAIL is required for exact fixture cleanup");
  }
  const code = `TASK83-${safeFixtureId}`;
  const university = await prisma.university.findUnique({
    where: { code },
    select: { id: true, name: true },
  });
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  });
  if (university && university.name !== `Task 83 Checklist Save ${safeFixtureId}`) {
    throw new Error("Refusing cleanup because the university does not match the fixture identity");
  }
  if (user && user.name !== `Task 83 browser ${safeFixtureId}`) {
    throw new Error("Refusing cleanup because the user does not match the fixture identity");
  }

  await prisma.$transaction(async (tx) => {
    if (user) {
      await tx.auditLog.deleteMany({ where: { userId: user.id } });
    }
    if (university) {
      await tx.university.delete({ where: { id: university.id } });
    }
    if (user) {
      await tx.user.delete({ where: { id: user.id } });
    }
  });
  console.log(JSON.stringify({ action: "cleaned", fixtureId: safeFixtureId }));
}

async function main(): Promise<void> {
  if (action === "setup") {
    await setup();
  } else if (action === "cleanup") {
    await cleanup();
  } else {
    throw new Error("Usage: task83-browser-fixture.ts setup|cleanup");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Task 83 fixture command failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });