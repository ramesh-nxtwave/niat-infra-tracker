import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { signToken } from "../lib/auth";
import prisma from "../lib/prisma";
import { PatchStatusBody } from "../middleware/validate";
import evidenceRouter from "./evidence";
import universitiesRouter from "./universities";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function createStatusFixture(
  t: test.TestContext,
  label: string,
  beforeCleanup?: () => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { id: string }).id = `${label}-${Date.now()}`;
    next();
  });
  app.use("/api", universitiesRouter);

  const suffix = `${process.pid}-${Date.now()}-${label}`;
  const user = await prisma.user.create({
    data: {
      name: `${label} user`,
      email: `${label}-${suffix}@example.test`,
      passwordHash: "not-used",
      role: "admin",
    },
  });
  const university = await prisma.university.create({
    data: {
      code: `${label.slice(0, 4).toUpperCase()}-${suffix}`,
      name: `${label} university ${suffix}`,
    },
  });
  const item = await prisma.checklistItem.create({
    data: {
      module: "model_classroom",
      category: label,
      name: `${label} item ${suffix}`,
    },
  });
  const space = await prisma.space.create({
    data: {
      universityId: university.id,
      spaceType: "model_classroom",
      name: `${label} room`,
    },
  });
  const status = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: university.id,
      spaceId: space.id,
      checklistItemId: item.id,
    },
  });
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const authorization = `Bearer ${signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    zoneIds: [],
    universityIds: [],
  })}`;
  const request = (path: string, body: unknown, token = authorization) =>
    fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method: path.endsWith("/bulk")
        ? "POST"
        : path.startsWith("/photo-history/")
          ? "DELETE"
          : "PATCH",
      headers: {
        authorization: token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const get = (path: string, token = authorization) =>
    fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      headers: { authorization: token },
    });

  t.after(async () => {
    await beforeCleanup?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
    await prisma.university.delete({ where: { id: university.id } });
    await prisma.checklistItem.delete({ where: { id: item.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  return { user, university, item, space, status, request, get, authorization };
}

/**
 * Synthetic whole-classroom fixture used by the reliability tests below.
 * Every row belongs to a throwaway university created by the test and the
 * cleanup hook removes that university and its checklist items afterwards.
 * Keeping source and destination identities explicit mirrors the browser
 * contract without depending on seeded development data.
 */
async function createClassroomCopyFixture(
  t: test.TestContext,
  label: string,
  itemCount: number,
  destinationCount: number,
  beforeCleanup?: () => Promise<void>,
  sourceSpaceType: "overall_classroom" | "model_classroom" = "overall_classroom",
  distinctDestinationItems = false,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { id: string }).id = `${label}-${Date.now()}`;
    next();
  });
  app.use("/api", universitiesRouter);
  app.use("/api", evidenceRouter);

  const suffix = `${process.pid}-${Date.now()}-${label}`;
  const user = await prisma.user.create({
    data: {
      name: `${label} user`,
      email: `${label}-${suffix}@example.test`,
      passwordHash: "not-used",
      role: "admin",
    },
  });
  const university = await prisma.university.create({
    data: {
      code: `${label.slice(0, 4).toUpperCase()}-${suffix}`,
      name: `${label} university ${suffix}`,
    },
  });
  const items = await Promise.all(
    Array.from({ length: itemCount }, (_, index) =>
      prisma.checklistItem.create({
        data: {
          module: sourceSpaceType,
          category: `${label} category`,
          name: `${label} item ${index + 1} ${suffix}`,
        },
      }),
    ),
  );
  const destinationItems = distinctDestinationItems
    ? await Promise.all(
      items.map((item) =>
        prisma.checklistItem.create({
          data: {
            module: "overall_classroom",
            category: item.category,
            name: item.name,
          },
        }),
      ),
    )
    : items;
  const sourceClassroom = await prisma.universityClassroom.create({
    data: {
      universityId: university.id,
      roomId: `${label} source ${suffix}`,
    },
  });
  const destinationClassrooms = await Promise.all(
    Array.from({ length: destinationCount }, (_, index) =>
      prisma.universityClassroom.create({
        data: {
          universityId: university.id,
          roomId: `${label} destination ${index + 1} ${suffix}`,
        },
      }),
    ),
  );
  const sourceSpace = await prisma.space.create({
    data: {
      universityId: university.id,
      spaceType: sourceSpaceType,
      name: sourceClassroom.roomId,
    },
  });
  const destinationSpaces = await Promise.all(
    destinationClassrooms.map((classroom) =>
      prisma.space.create({
        data: {
          universityId: university.id,
          spaceType: "overall_classroom",
          name: classroom.roomId,
        },
      }),
    ),
  );
  const sourceStatuses = await Promise.all(
    items.map((item, index) =>
      prisma.spaceChecklistStatus.create({
        data: {
          universityId: university.id,
          spaceId: sourceSpace.id,
          checklistItemId: item.id,
          currentStatus: "In-Progress",
          remarks: `${label} source remark ${index + 1}`,
          photoUrl: `/objects/${label}-${suffix}-${index + 1}.jpg`,
          photoContentType: "image/jpeg",
        },
      }),
    ),
  );
  const destinationStatuses = await Promise.all(
    items.flatMap((item, itemIndex) =>
      destinationSpaces.map((space) =>
        prisma.spaceChecklistStatus.create({
          data: {
            universityId: university.id,
            spaceId: space.id,
            checklistItemId: destinationItems[itemIndex].id,
          },
        }),
      ),
    ),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const authorization = `Bearer ${signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    zoneIds: [],
    universityIds: [],
  })}`;
  const request = (path: string, body: unknown, token = authorization) =>
    fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method: path.endsWith("/bulk") ? "POST" : "PATCH",
      headers: {
        authorization: token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const get = (path: string, token = authorization) =>
    fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      headers: { authorization: token },
    });

  t.after(async () => {
    await beforeCleanup?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
    await prisma.university.delete({ where: { id: university.id } });
    await prisma.checklistItem.deleteMany({
      where: {
        id: {
          in: [
            ...items.map((item) => item.id),
            ...destinationItems
              .filter((item) => !items.some((sourceItem) => sourceItem.id === item.id))
              .map((item) => item.id),
          ],
        },
      },
    });
    await prisma.user.delete({ where: { id: user.id } });
  });

  return {
    user,
    university,
    items,
    destinationItems,
    sourceClassroom,
    destinationClassrooms,
    sourceSpace,
    destinationSpaces,
    sourceStatuses,
    destinationStatuses,
    request,
    get,
    authorization,
  };
}

function buildClassroomCopyUpdates(fixture: Awaited<ReturnType<typeof createClassroomCopyFixture>>) {
  const destinationsByItem = new Map<string, typeof fixture.destinationStatuses>();
  for (const item of fixture.items) {
    destinationsByItem.set(
      item.id,
      fixture.destinationStatuses.filter((status) => status.checklistItemId === item.id),
    );
  }
  return fixture.items.map((item, itemIndex) => {
    const source = fixture.sourceStatuses[itemIndex];
    const destinations = destinationsByItem.get(item.id) ?? [];
    return {
      checklistItemId: item.id,
      sourceStatusId: source.id,
      classroomIds: fixture.destinationClassrooms.map((classroom) => classroom.id),
      spaceIds: fixture.destinationSpaces.map((space) => space.id),
      targetStatusIds: destinations.map((status) => status.id),
      currentStatus: source.currentStatus,
      remarks: source.remarks,
      photoUrl: source.photoUrl,
      photoContentType: source.photoContentType,
    };
  });
}

test("single saves accept and persist the exact Partially Done status", async (t) => {
  assert.equal(
    PatchStatusBody.safeParse({ currentStatus: "Partially Done" }).success,
    true,
  );
  assert.equal(
    PatchStatusBody.safeParse({ currentStatus: "Partially done" }).success,
    false,
  );
  const fixture = await createStatusFixture(t, "partially-done");
  const response = await fixture.request(
    `/universities/${fixture.university.id}/status/${fixture.status.id}`,
    { currentStatus: "Partially Done" },
  );

  assert.equal(response.status, 200);
  const body = await response.json() as { currentStatus: string };
  assert.equal(body.currentStatus, "Partially Done");
  const saved = await prisma.spaceChecklistStatus.findUniqueOrThrow({
    where: { id: fixture.status.id },
    select: { currentStatus: true },
  });
  assert.equal(saved.currentStatus, "Partially Done");
});

test("same-university saves wait outside the database pool while its row is locked", async (t) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { id: string }).id = `pool-test-${Date.now()}`;
    next();
  });
  app.use("/api", universitiesRouter);

  const suffix = `${process.pid}-${Date.now()}`;
  const user = await prisma.user.create({
    data: {
      name: "Checklist pool test",
      email: `checklist-pool-${suffix}@example.test`,
      passwordHash: "not-used",
      role: "admin",
    },
  });
  const university = await prisma.university.create({
    data: {
      code: `CPT-${suffix}`,
      name: `Checklist pool test ${suffix}`,
    },
  });
  const item = await prisma.checklistItem.create({
    data: {
      module: "model_classroom",
      category: "Pool test",
      name: `Pool test item ${suffix}`,
    },
  });
  const space = await prisma.space.create({
    data: {
      universityId: university.id,
      spaceType: "model_classroom",
      name: "Pool test room",
    },
  });
  const status = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: university.id,
      spaceId: space.id,
      checklistItemId: item.id,
    },
  });

  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  let releaseUniversityLock!: () => void;
  const releaseLock = new Promise<void>((resolve) => {
    releaseUniversityLock = resolve;
  });
  let lockAcquired!: () => void;
  const acquiredLock = new Promise<void>((resolve) => {
    lockAcquired = resolve;
  });
  const lockTransaction = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM universities WHERE id = ${university.id} FOR UPDATE`;
    lockAcquired();
    await releaseLock;
  });

  t.after(async () => {
    releaseUniversityLock();
    await lockTransaction.catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.university.delete({ where: { id: university.id } });
    await prisma.checklistItem.delete({ where: { id: item.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  await acquiredLock;
  const address = server.address();
  assert(address && typeof address === "object");
  const authorization = `Bearer ${signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    zoneIds: [],
    universityIds: [],
  })}`;

  let settled = 0;
  const requests = Array.from({ length: 24 }, (_, index) =>
    fetch(
      `http://127.0.0.1:${address.port}/api/universities/${university.id}/status/${status.id}`,
      {
        method: "PATCH",
        headers: {
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ remarks: `queued save ${index + 1}` }),
      },
    ).finally(() => {
      settled++;
    }),
  );

  await delay(2_500);
  assert.equal(
    settled,
    0,
    "requests should be queued before transaction acquisition instead of exhausting the pool",
  );

  releaseUniversityLock();
  await lockTransaction;
  const responses = await Promise.all(requests);
  assert.deepEqual(new Set(responses.map((response) => response.status)), new Set([200]));

  const saved = await prisma.spaceChecklistStatus.findUniqueOrThrow({
    where: { id: status.id },
    select: { remarks: true },
  });
  assert.match(saved.remarks ?? "", /^queued save \d+$/);
  assert.equal(
    await prisma.checklistStatusHistory.count({ where: { statusId: status.id } }),
    25,
    "the initial state and every serialized edit should be represented in history",
  );
});

test("single saves read the previous row after acquiring the university lock", async (t) => {
  let releaseUniversityLock: (() => void) | undefined;
  let lockTransaction: Promise<unknown> | undefined;
  const fixture = await createStatusFixture(t, "previous-row", async () => {
    releaseUniversityLock?.();
    await lockTransaction?.catch(() => undefined);
  });
  const releaseLock = new Promise<void>((resolve) => {
    releaseUniversityLock = resolve;
  });
  let lockAcquired!: () => void;
  const acquiredLock = new Promise<void>((resolve) => {
    lockAcquired = resolve;
  });
  lockTransaction = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM universities WHERE id = ${fixture.university.id} FOR UPDATE`;
    lockAcquired();
    await releaseLock;
  });
  await acquiredLock;

  const path = `/universities/${fixture.university.id}/status/${fixture.status.id}`;
  const first = fixture.request(path, { currentStatus: "In-Progress" });
  await delay(50);
  const second = fixture.request(path, { currentStatus: "Yet to start" });
  await delay(100);
  releaseUniversityLock?.();
  await lockTransaction;

  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const saved = await prisma.spaceChecklistStatus.findUniqueOrThrow({
    where: { id: fixture.status.id },
    select: { currentStatus: true },
  });
  assert.equal(saved.currentStatus, "Yet to start");
  const history = await prisma.checklistStatusHistory.findMany({
    where: { statusId: fixture.status.id },
    select: { currentStatus: true },
  });
  assert.equal(history.length, 3);
  assert.equal(history.filter((row) => row.currentStatus === "Yet to start").length, 2);
  assert.equal(history.filter((row) => row.currentStatus === "In-Progress").length, 1);
});

test("status, photo, and report history commit atomically with actionable errors", async (t) => {
  const fixture = await createStatusFixture(t, "photo-atomic");
  const path = `/universities/${fixture.university.id}/status/${fixture.status.id}`;
  const missingUserToken = `Bearer ${signToken({
    userId: `missing-${Date.now()}`,
    email: "missing-user@example.test",
    role: "admin",
    name: "Missing user",
    zoneIds: [],
    universityIds: [],
  })}`;
  const failedResponse = await fixture.request(path, {
    remarks: "must roll back",
    photoUrl: "/objects/atomic-failure.jpg",
    photoContentType: "image/jpeg",
  }, missingUserToken);
  assert.equal(failedResponse.status, 409);
  const failedBody = await failedResponse.json() as {
    code: string;
    correlationId: string;
  };
  assert.equal(failedBody.code, "CHECKLIST_RELATED_RECORD_CHANGED");
  assert.equal(failedResponse.headers.get("x-correlation-id"), failedBody.correlationId);
  assert.deepEqual(
    await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: fixture.status.id },
      select: { remarks: true, photoUrl: true },
    }),
    { remarks: null, photoUrl: null },
  );
  assert.equal(
    await prisma.checklistStatusHistory.count({ where: { statusId: fixture.status.id } }),
    0,
  );
  assert.equal(await prisma.photoHistory.count({ where: { statusId: fixture.status.id } }), 0);

  const savedResponse = await fixture.request(path, {
    remarks: "committed atomically",
    photoUrl: "/objects/atomic-success.jpg",
    photoContentType: "image/jpeg",
  });
  assert.equal(savedResponse.status, 200);
  const savedBody = await savedResponse.json() as {
    remarks: string;
    photoUrl: string;
    photoHistory: Array<{ photoUrl: string }>;
  };
  assert.equal(savedBody.remarks, "committed atomically");
  assert.equal(savedBody.photoUrl, "/objects/atomic-success.jpg");
  assert.equal(savedBody.photoHistory.length, 1);
  assert.equal(savedBody.photoHistory[0].photoUrl, "/objects/atomic-success.jpg");
  assert.equal(
    await prisma.checklistStatusHistory.count({ where: { statusId: fixture.status.id } }),
    2,
  );
  assert.equal(await prisma.photoHistory.count({ where: { statusId: fixture.status.id } }), 1);

  const noOpResponse = await fixture.request(path, {
    remarks: "committed atomically",
    photoUrl: "/objects/atomic-success.jpg",
    photoContentType: "image/jpeg",
  });
  assert.equal(noOpResponse.status, 200);
  assert.equal(
    await prisma.checklistStatusHistory.count({ where: { statusId: fixture.status.id } }),
    2,
  );
  assert.equal(await prisma.photoHistory.count({ where: { statusId: fixture.status.id } }), 1);
});

test("explicit empty evidence removal clears current media but retains audit history", async (t) => {
  const fixture = await createStatusFixture(t, "photo-remove");
  const path = `/universities/${fixture.university.id}/status/${fixture.status.id}`;

  const uploadResponse = await fixture.request(path, {
    currentStatus: "Yet to start",
    photoUrl: "/objects/photo-remove-current.png",
    photoContentType: "image/png",
  });
  assert.equal(uploadResponse.status, 200);

  const removeResponse = await fixture.request(path, {
    currentStatus: "Yet to start",
    photoUrl: "",
    photoContentType: null,
  });
  assert.equal(removeResponse.status, 200);
  const removed = await removeResponse.json() as {
    photoUrl: string | null;
    photoContentType: string | null;
    photoHistory: Array<{ photoUrl: string }>;
  };
  assert.equal(removed.photoUrl, null);
  assert.equal(removed.photoContentType, null);
  assert.deepEqual(
    removed.photoHistory.map((entry) => entry.photoUrl),
    ["/objects/photo-remove-current.png"],
  );

  const persisted = await prisma.spaceChecklistStatus.findUniqueOrThrow({
    where: { id: fixture.status.id },
    select: { photoUrl: true, photoContentType: true },
  });
  assert.deepEqual(persisted, { photoUrl: null, photoContentType: null });

  const reloadedResponse = await fixture.get(`/universities/${fixture.university.id}`);
  assert.equal(reloadedResponse.status, 200);
  const reloaded = await reloadedResponse.json() as {
    spaces: Array<{
      checklistStatuses: Array<{
        photoUrl: string | null;
        photoContentType: string | null;
        photoHistory: Array<{ photoUrl: string }>;
      }>;
    }>;
  };
  const reloadedStatus = reloaded.spaces
    .flatMap((space) => space.checklistStatuses)
    .find((status) => status.photoHistory.some(
      (entry) => entry.photoUrl === "/objects/photo-remove-current.png",
    ));
  assert.ok(reloadedStatus);
  assert.equal(reloadedStatus.photoUrl, null);
  assert.equal(reloadedStatus.photoContentType, null);
  assert.deepEqual(
    reloadedStatus.photoHistory.map((entry) => entry.photoUrl),
    ["/objects/photo-remove-current.png"],
  );
});

test("large bulk saves maintain readiness and do not add no-op history", async (t) => {
  const fixture = await createStatusFixture(t, "large-bulk");
  const extraSpaceIds = Array.from(
    { length: 499 },
    (_, index) => `large-bulk-${process.pid}-${Date.now()}-${index}`,
  );
  await prisma.space.createMany({
    data: extraSpaceIds.map((id, index) => ({
      id,
      universityId: fixture.university.id,
      spaceType: "model_classroom",
      name: `Large bulk room ${index + 2}`,
    })),
  });
  await prisma.spaceChecklistStatus.createMany({
    data: extraSpaceIds.map((spaceId) => ({
      universityId: fixture.university.id,
      spaceId,
      checklistItemId: fixture.item.id,
    })),
  });
  const allSpaceIds = [fixture.space.id, ...extraSpaceIds];
  const path = `/universities/${fixture.university.id}/status/bulk`;
  const body = {
    updates: [{
      checklistItemId: fixture.item.id,
      spaceIds: allSpaceIds,
      currentStatus: "Done",
      remarks: "large checklist save",
    }],
  };

  const firstResponse = await fixture.request(path, body);
  assert.equal(firstResponse.status, 200);
  assert.deepEqual(await firstResponse.json(), { applied: 500, skipped: 0 });
  const university = await prisma.university.findUniqueOrThrow({
    where: { id: fixture.university.id },
    select: { overallReadiness: true },
  });
  assert.equal(university.overallReadiness, 100);
  assert.equal(
    await prisma.checklistStatusHistory.count({
      where: { universityId: fixture.university.id },
    }),
    1_000,
  );

  const noOpResponse = await fixture.request(path, body);
  assert.equal(noOpResponse.status, 200);
  assert.deepEqual(await noOpResponse.json(), { applied: 0, skipped: 500 });
  assert.equal(
    await prisma.checklistStatusHistory.count({
      where: { universityId: fixture.university.id },
    }),
    1_000,
  );
  assert.equal(
    await prisma.spaceChecklistStatus.count({
      where: { universityId: fixture.university.id, currentStatus: "Done" },
    }),
    500,
  );
});

test("explicit classroom bulk copies evidence atomically and acknowledges every target", async (t) => {
  const foreignCodePrefix = `COPY-${process.pid}-`;
  // Register this hook before createStatusFixture's hook so foreign rows are
  // removed before its checklist item cleanup. Include the fixed fixture name
  // and generated code prefix so a prior failed process can be cleaned safely
  // without touching application data.
  const cleanupForeignFixtures = () => prisma.university.deleteMany({
    where: {
      name: "Foreign copy university",
      code: { startsWith: "COPY-" },
    },
  });
  await cleanupForeignFixtures();
  t.after(async () => {
    await cleanupForeignFixtures();
  });
  const fixture = await createStatusFixture(t, "classroom-copy");
  const sourceClassroom = await prisma.universityClassroom.create({
    data: { universityId: fixture.university.id, roomId: "Room A" },
  });
  const targetClassroom = await prisma.universityClassroom.create({
    data: { universityId: fixture.university.id, roomId: "Room B" },
  });
  const sourceSpace = await prisma.space.create({
    data: {
      universityId: fixture.university.id,
      spaceType: "overall_classroom",
      name: "Room A",
    },
  });
  const targetSpace = await prisma.space.create({
    data: {
      universityId: fixture.university.id,
      spaceType: "overall_classroom",
      name: "Room B",
    },
  });
  const sourceStatus = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: fixture.university.id,
      spaceId: sourceSpace.id,
      checklistItemId: fixture.item.id,
      currentStatus: "In-Progress",
      remarks: "copied note",
      photoUrl: "/objects/classroom-copy.jpg",
      photoContentType: "image/jpeg",
    },
  });
  const targetStatus = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: fixture.university.id,
      spaceId: targetSpace.id,
      checklistItemId: fixture.item.id,
      photoUrl: "/objects/legacy-target.jpg",
      photoContentType: "image/jpeg",
    },
  });
  await prisma.photoHistory.create({
    data: {
      statusId: sourceStatus.id,
      photoUrl: "/objects/classroom-copy.jpg",
      contentType: "image/jpeg",
    },
  });

  const body = {
    updates: [{
      checklistItemId: fixture.item.id,
      sourceStatusId: sourceStatus.id,
      classroomIds: [targetClassroom.id],
      spaceIds: [targetSpace.id],
      targetStatusIds: [targetStatus.id],
      currentStatus: "In-Progress",
      remarks: "copied note",
      photoUrl: "/objects/classroom-copy.jpg",
      photoContentType: "image/jpeg",
    }],
  };
  await prisma.spaceChecklistStatus.update({
    where: { id: sourceStatus.id },
    data: { remarks: "changed while source editor was open" },
  });
  const conflictResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    body,
  );
  assert.equal(conflictResponse.status, 409);
  assert.equal(
    (await conflictResponse.json() as { code: string }).code,
    "CHECKLIST_SOURCE_CHANGED",
  );
  await prisma.spaceChecklistStatus.update({
    where: { id: sourceStatus.id },
    data: { remarks: "copied note" },
  });

  const firstResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    body,
  );
  assert.equal(firstResponse.status, 200);
  const firstBody = await firstResponse.json() as {
    applied: number;
    skipped: number;
    results: Array<{
      statusId: string;
      outcome: string;
      row: { id: string; remarks: string; photoUrl: string; photoContentType: string };
    }>;
  };
  assert.equal(firstBody.applied, 1);
  assert.equal(firstBody.skipped, 0);
  assert.equal(firstBody.results.length, 1);
  assert.equal(firstBody.results[0].statusId, targetStatus.id);
  assert.equal(firstBody.results[0].outcome, "applied");
  assert.equal(firstBody.results[0].row.remarks, "copied note");
  assert.equal(firstBody.results[0].row.photoUrl, "/objects/classroom-copy.jpg");
  assert.equal(firstBody.results[0].row.photoContentType, "image/jpeg");
  assert.equal(await prisma.photoHistory.count({ where: { statusId: targetStatus.id } }), 2);
  assert.deepEqual(
    (await prisma.photoHistory.findMany({
      where: { statusId: targetStatus.id },
      select: { photoUrl: true },
    })).map((entry) => entry.photoUrl).sort(),
    ["/objects/classroom-copy.jpg", "/objects/legacy-target.jpg"],
  );
  assert.equal(await prisma.checklistStatusHistory.count({ where: { statusId: targetStatus.id } }), 2);

  const retryResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    body,
  );
  assert.equal(retryResponse.status, 200);
  const retryBody = await retryResponse.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string; row: unknown }>;
  };
  assert.equal(retryBody.applied, 0);
  assert.equal(retryBody.skipped, 1);
  assert.deepEqual(retryBody.results.map((result) => ({
    statusId: result.statusId,
    outcome: result.outcome,
  })), [{ statusId: targetStatus.id, outcome: "unchanged" }]);
  assert.equal(await prisma.photoHistory.count({ where: { statusId: targetStatus.id } }), 2);
  assert.equal(await prisma.checklistStatusHistory.count({ where: { statusId: targetStatus.id } }), 2);

  // Exact whole-classroom form boundary: untouched nullable optional source
  // fields arrive as empty strings, not database nulls.
  const wholeClassroomBody = { updates: [{
    ...body.updates[0],
    universityTimeline: "", targetTimeline: "", itemStartDate: "",
    itemEndDate: "", actualCompletionDate: "", capacity: "",
  }] };
  const wholeClassroomResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`, wholeClassroomBody,
  );
  assert.equal(wholeClassroomResponse.status, 200);
  await prisma.spaceChecklistStatus.update({
    where: { id: sourceStatus.id }, data: { capacity: "new capacity" },
  });
  const changedWholeSource = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`, wholeClassroomBody,
  );
  assert.equal(changedWholeSource.status, 409);
  assert.equal((await changedWholeSource.json() as { code: string }).code, "CHECKLIST_SOURCE_CHANGED");
  await prisma.spaceChecklistStatus.update({
    where: { id: sourceStatus.id }, data: { capacity: null },
  });

  const staleEmptyEvidence = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [{
      sourceStatusId: sourceStatus.id, checklistItemId: fixture.item.id,
      classroomIds: [targetClassroom.id], spaceIds: [targetSpace.id],
      targetStatusIds: [targetStatus.id], expectedSourcePhotoUrl: null,
      remarks: "copied note",
    }] },
  );
  assert.equal(staleEmptyEvidence.status, 409);
  assert.equal((await staleEmptyEvidence.json() as { code: string }).code, "CHECKLIST_SOURCE_CHANGED");

  const foreignUniversity = await prisma.university.create({
    data: {
      code: `${foreignCodePrefix}${Date.now()}`,
      name: "Foreign copy university",
    },
  });
  const foreignSpace = await prisma.space.create({
    data: {
      universityId: foreignUniversity.id,
      spaceType: "overall_classroom",
      name: "Room B",
    },
  });
  const foreignStatus = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: foreignUniversity.id,
      spaceId: foreignSpace.id,
      checklistItemId: fixture.item.id,
    },
  });
  const foreignResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    {
      updates: [{
        ...body.updates[0],
        spaceIds: [foreignSpace.id],
        targetStatusIds: [foreignStatus.id],
      }],
    },
  );
  assert.equal(foreignResponse.status, 403);
  assert.equal(
    await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: targetStatus.id },
      select: { remarks: true },
    }).then((row) => row.remarks),
    "copied note",
  );

  // A duplicate normalized space name makes a legacy null association
  // ambiguous; the server must not guess and must leave the target untouched.
  await prisma.space.create({
    data: {
      universityId: fixture.university.id,
      spaceType: "overall_classroom",
      name: " room   b ",
    },
  });
  const ambiguousResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    body,
  );
  assert.equal(ambiguousResponse.status, 422);
  const unchanged = await prisma.spaceChecklistStatus.findUniqueOrThrow({
    where: { id: targetStatus.id },
    select: { remarks: true, currentStatus: true },
  });
  assert.deepEqual(unchanged, { remarks: "copied note", currentStatus: "In-Progress" });

  // An administrator's persisted choice is authoritative even while duplicate
  // legacy names remain. It must select the existing status row, not recreate it.
  await prisma.universityClassroom.update({
    where: { id: targetClassroom.id },
    data: { spaceId: targetSpace.id },
  });
  const resolvedResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    body,
  );
  assert.equal(resolvedResponse.status, 200);
  assert.equal(
    await prisma.spaceChecklistStatus.count({ where: { id: targetStatus.id } }),
    1,
  );

  // Keep references alive for cleanup diagnostics and to make the association
  // being tested explicit.
  assert.equal(sourceClassroom.roomId, "Room A");
});

test("APM bulk access is scoped to the requested assigned university", async (t) => {
  const fixture = await createStatusFixture(t, "apm-copy-scope");
  const forbidden = await prisma.university.create({
    data: {
      code: `APM-${process.pid}-${Date.now()}`,
      name: "Forbidden bulk university",
    },
  });
  const apm = await prisma.user.create({
    data: {
      name: "Assigned APM",
      email: `apm-copy-${process.pid}-${Date.now()}@example.test`,
      passwordHash: "not-used",
      role: "apm",
      universityIds: [fixture.university.id],
    },
  });
  t.after(async () => {
    await prisma.university.delete({ where: { id: forbidden.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: apm.id } }).catch(() => undefined);
  });

  const token = `Bearer ${signToken({
    userId: apm.id,
    email: apm.email,
    role: apm.role,
    name: apm.name,
    zoneIds: [],
    universityIds: [fixture.university.id],
  })}`;
  const response = await fixture.request(
    `/universities/${forbidden.id}/status/bulk`,
    { updates: [{ checklistItemId: fixture.item.id, spaceIds: [fixture.space.id], remarks: "must not write" }] },
    token,
  );
  assert.equal(response.status, 403);
  assert.equal(
    await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: fixture.status.id },
      select: { remarks: true },
    }).then((row) => row.remarks),
    null,
  );

  const unassignedToken = `Bearer ${signToken({
    userId: apm.id,
    email: apm.email,
    role: apm.role,
    name: apm.name,
    zoneIds: [],
    universityIds: [],
  })}`;
  const unassignedResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [{ checklistItemId: fixture.item.id, spaceIds: [fixture.space.id], remarks: "must not write" }] },
    unassignedToken,
  );
  assert.equal(unassignedResponse.status, 403);
});

test("photo-history deletion keeps an object referenced by a copied current row", async (t) => {
  const fixture = await createStatusFixture(t, "shared-photo-delete");
  const sharedPhotoUrl = "/objects/shared-delete.jpg";
  await prisma.spaceChecklistStatus.update({
    where: { id: fixture.status.id },
    data: { photoUrl: sharedPhotoUrl, photoContentType: "image/jpeg" },
  });
  const targetSpace = await prisma.space.create({
    data: {
      universityId: fixture.university.id,
      spaceType: "model_classroom",
      name: "Copied photo target",
    },
  });
  const targetStatus = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: fixture.university.id,
      spaceId: targetSpace.id,
      checklistItemId: fixture.item.id,
      photoUrl: sharedPhotoUrl,
      photoContentType: "image/jpeg",
    },
  });
  const history = await prisma.photoHistory.create({
    data: {
      statusId: fixture.status.id,
      photoUrl: sharedPhotoUrl,
      contentType: "image/jpeg",
    },
  });

  const response = await fixture.request(`/photo-history/${history.id}`, {});
  assert.equal(response.status, 200);
  assert.deepEqual(
    await prisma.spaceChecklistStatus.findMany({
      where: { id: { in: [fixture.status.id, targetStatus.id] } },
      select: { id: true, photoUrl: true },
      orderBy: { id: "asc" },
    }),
    [
      { id: fixture.status.id, photoUrl: null },
      { id: targetStatus.id, photoUrl: sharedPhotoUrl },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  );
});

test("large whole-classroom copies acknowledge every target and persist evidence after reload", async (t) => {
  const fixture = await createClassroomCopyFixture(t, "bulk-large", 8, 10);
  await prisma.photoHistory.createMany({
    data: fixture.sourceStatuses.map((source) => ({
      statusId: source.id,
      photoUrl: source.photoUrl!,
      contentType: source.photoContentType,
      uploadedBy: fixture.user.name,
    })),
  });
  const updates = buildClassroomCopyUpdates(fixture);
  const expectedTargetIds = updates.flatMap((update) => update.targetStatusIds);
  const startedAt = performance.now();
  const response = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates },
  );
  const elapsedMs = performance.now() - startedAt;
  if (process.env.BULK_COPY_REPORT_TIMING === "1") {
    console.info(
      `[bulk-copy measurement] large whole-classroom ${fixture.items.length} items x `
      + `${fixture.destinationSpaces.length} destinations: ${elapsedMs.toFixed(1)} ms`,
    );
  }
  assert.equal(response.status, 200);
  assert.ok(
    elapsedMs < 5_000,
    `large copy should complete before the 5-second transaction deadline (${elapsedMs.toFixed(1)} ms)`,
  );
  const body = await response.json() as {
    applied: number;
    skipped: number;
    results: Array<{
      statusId: string;
      classroomId: string;
      spaceId: string;
      outcome: string;
      row: {
        id: string;
        currentStatus: string;
        remarks: string;
        photoUrl: string;
        photoContentType: string;
      };
    }>;
  };
  assert.equal(body.applied, expectedTargetIds.length);
  assert.equal(body.skipped, 0);
  assert.deepEqual(
    body.results.map((result) => ({
      statusId: result.statusId,
      classroomId: result.classroomId,
      spaceId: result.spaceId,
      outcome: result.outcome,
    })),
    updates.flatMap((update) => update.targetStatusIds.map((statusId, index) => ({
      statusId,
      classroomId: update.classroomIds[index],
      spaceId: update.spaceIds[index],
      outcome: "applied",
    }))),
  );
  for (const result of body.results) {
    assert.equal(result.row.id, result.statusId);
    assert.equal(result.row.currentStatus, "In-Progress");
    assert.ok(result.row.remarks.startsWith("bulk-large source remark "));
    assert.match(result.row.photoUrl, /^\/objects\/bulk-large-/);
    assert.equal(result.row.photoContentType, "image/jpeg");
  }
  assert.equal(
    await prisma.checklistStatusHistory.count({
      where: { universityId: fixture.university.id },
    }),
    expectedTargetIds.length * 2,
    "each changed target has one initial and one committed history snapshot",
  );
  assert.equal(
    await prisma.photoHistory.count({
      where: { status: { universityId: fixture.university.id } },
    }),
    expectedTargetIds.length + fixture.sourceStatuses.length,
  );

  const reloadResponse = await fixture.get(`/universities/${fixture.university.id}`);
  assert.equal(reloadResponse.status, 200);
  const reloaded = await reloadResponse.json() as {
    spaces: Array<{
      id: string;
      checklistStatuses: Array<{
        id: string;
        currentStatus: string;
        remarks: string;
        photoUrl: string;
        photoContentType: string;
        photoHistory: Array<{ photoUrl: string; contentType: string }>;
      }>;
    }>;
  };
  const reloadedTargets = reloaded.spaces
    .flatMap((space) => space.checklistStatuses)
    .filter((status) => expectedTargetIds.includes(status.id));
  assert.equal(reloadedTargets.length, expectedTargetIds.length);
  for (const target of reloadedTargets) {
    assert.equal(target.currentStatus, "In-Progress");
    assert.ok(target.remarks.startsWith("bulk-large source remark "));
    assert.equal(target.photoContentType, "image/jpeg");
    assert.deepEqual(target.photoHistory.map((entry) => entry.photoUrl), [target.photoUrl]);
  }

  const retryResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates },
  );
  assert.equal(retryResponse.status, 200);
  const retry = await retryResponse.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  assert.equal(retry.applied, 0);
  assert.equal(retry.skipped, expectedTargetIds.length);
  assert.deepEqual(
    retry.results.map((result) => ({
      statusId: result.statusId,
      outcome: result.outcome,
    })),
    expectedTargetIds.map((statusId) => ({ statusId, outcome: "unchanged" })),
  );
  assert.equal(
    await prisma.checklistStatusHistory.count({
      where: { universityId: fixture.university.id },
    }),
    expectedTargetIds.length * 2,
    "retrying a committed copy must not duplicate report history",
  );
  assert.equal(
    await prisma.photoHistory.count({
      where: { status: { universityId: fixture.university.id } },
    }),
    expectedTargetIds.length + fixture.sourceStatuses.length,
    "retrying a committed copy must not duplicate evidence history",
  );
});

test("model classroom copies apply selected fields, omit blank values, and keep retries no-op", async (t) => {
  const fixture = await createClassroomCopyFixture(
    t,
    "model-copy-selected",
    1,
    1,
    undefined,
    "model_classroom",
  );
  const source = fixture.sourceStatuses[0];
  const target = fixture.destinationStatuses[0];
  await prisma.spaceChecklistStatus.update({
    where: { id: source.id },
    data: {
      currentStatus: "In-Progress",
      remarks: "",
      universityTimeline: "",
      targetTimeline: "",
      photoUrl: "/objects/model-selected.jpg",
      photoContentType: "image/jpeg",
    },
  });
  await prisma.spaceChecklistStatus.update({
    where: { id: target.id },
    data: {
      currentStatus: "Done",
      remarks: "keep target remark",
      universityTimeline: "keep university timeline",
      targetTimeline: "keep target timeline",
      photoUrl: "/objects/old-target.jpg",
      photoContentType: "image/jpeg",
    },
  });
  const update = {
    checklistItemId: fixture.items[0].id,
    sourceStatusId: source.id,
    classroomIds: fixture.destinationClassrooms.map((classroom) => classroom.id),
    spaceIds: fixture.destinationSpaces.map((space) => space.id),
    targetStatusIds: [target.id],
    // Deliberately omit currentStatus: model copies may only carry the
    // selected template fields.
    remarks: "",
    universityTimeline: "",
    targetTimeline: "",
    photoUrl: "/objects/model-selected.jpg",
    photoContentType: "image/jpeg",
    sourceSpaceType: "model_classroom" as const,
    skipBlankValues: true,
  };
  const response = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [update] },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  assert.equal(body.applied, 1);
  assert.equal(body.skipped, 0);
  assert.deepEqual(body.results.map((result) => ({
    statusId: result.statusId,
    outcome: result.outcome,
  })), [{ statusId: target.id, outcome: "applied" }]);
  assert.deepEqual(
    await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: target.id },
      select: {
        currentStatus: true,
        remarks: true,
        universityTimeline: true,
        targetTimeline: true,
        photoUrl: true,
        photoContentType: true,
      },
    }),
    {
      currentStatus: "Done",
      remarks: "keep target remark",
      universityTimeline: "keep university timeline",
      targetTimeline: "keep target timeline",
      photoUrl: "/objects/model-selected.jpg",
      photoContentType: "image/jpeg",
    },
  );
  const historyCount = await prisma.checklistStatusHistory.count({
    where: { universityId: fixture.university.id },
  });
  const photoHistoryCount = await prisma.photoHistory.count({
    where: { status: { universityId: fixture.university.id } },
  });
  const retryResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [update] },
  );
  assert.equal(retryResponse.status, 200);
  const retry = await retryResponse.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  assert.equal(retry.applied, 0);
  assert.equal(retry.skipped, 1);
  assert.deepEqual(
    retry.results.map((result) => ({
      statusId: result.statusId,
      outcome: result.outcome,
    })),
    [{ statusId: target.id, outcome: "unchanged" }],
  );
  assert.equal(
    await prisma.checklistStatusHistory.count({
      where: { universityId: fixture.university.id },
    }),
    historyCount,
  );
  assert.equal(
    await prisma.photoHistory.count({
      where: { status: { universityId: fixture.university.id } },
    }),
    photoHistoryCount,
  );
});

test("model copies match distinct module checklist ids by unique canonical category and name", async (t) => {
  const fixture = await createClassroomCopyFixture(
    t,
    "model-copy-distinct-ids",
    1,
    1,
    undefined,
    "model_classroom",
    true,
  );
  const source = fixture.sourceStatuses[0];
  const target = fixture.destinationStatuses[0];
  assert.notEqual(source.checklistItemId, target.checklistItemId);
  assert.equal(fixture.items[0].category, fixture.destinationItems[0].category);
  assert.equal(fixture.items[0].name, fixture.destinationItems[0].name);

  const response = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    {
      updates: [{
        checklistItemId: source.checklistItemId,
        sourceStatusId: source.id,
        classroomIds: [fixture.destinationClassrooms[0].id],
        spaceIds: [fixture.destinationSpaces[0].id],
        targetStatusIds: [target.id],
        remarks: source.remarks,
        sourceSpaceType: "model_classroom",
        skipBlankValues: true,
      }],
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  assert.equal(body.applied, 1);
  assert.equal(body.skipped, 0);
  assert.deepEqual(
    body.results.map((result) => ({
      statusId: result.statusId,
      outcome: result.outcome,
    })),
    [{ statusId: target.id, outcome: "applied" }],
  );
  assert.equal(
    (await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: target.id },
      select: { remarks: true },
    })).remarks,
    source.remarks,
  );
});

test("model copy to Room 102 preserves existing evidence and readiness in the destination gallery", async (t) => {
  const fixture = await createClassroomCopyFixture(
    t,
    "model-copy-room-102",
    1,
    1,
    undefined,
    "model_classroom",
    true,
  );
  const source = fixture.sourceStatuses[0];
  const target = fixture.destinationStatuses[0];
  assert.notEqual(source.checklistItemId, target.checklistItemId);

  await prisma.universityClassroom.update({
    where: { id: fixture.destinationClassrooms[0].id },
    data: { roomId: "Room 102" },
  });
  await prisma.space.update({
    where: { id: fixture.destinationSpaces[0].id },
    data: { name: "Room 102" },
  });
  await prisma.spaceChecklistStatus.update({
    where: { id: target.id },
    data: {
      currentStatus: "Done",
      isBlocker: false,
      remarks: "keep destination status",
      photoUrl: "/objects/room-102-existing.jpg",
      photoContentType: "image/jpeg",
      universityTimeline: "keep destination timeline",
      targetTimeline: "keep destination target",
      capacity: "keep destination capacity",
    },
  });
  const beforeReadiness = await prisma.university.findUniqueOrThrow({
    where: { id: fixture.university.id },
    select: { overallReadiness: true },
  });

  const response = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    {
      updates: [{
        checklistItemId: source.checklistItemId,
        sourceStatusId: source.id,
        classroomIds: [fixture.destinationClassrooms[0].id],
        spaceIds: [fixture.destinationSpaces[0].id],
        targetStatusIds: [target.id],
        remarks: source.remarks,
        photoUrl: source.photoUrl,
        photoContentType: source.photoContentType,
        sourceSpaceType: "model_classroom",
        skipBlankValues: true,
      }],
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  assert.equal(body.applied, 1);
  assert.equal(body.skipped, 0);
  assert.deepEqual(
    body.results.map((result) => ({
      statusId: result.statusId,
      outcome: result.outcome,
    })),
    [{ statusId: target.id, outcome: "applied" }],
  );

  const savedTarget = await prisma.spaceChecklistStatus.findUniqueOrThrow({
    where: { id: target.id },
    select: {
      checklistItemId: true,
      currentStatus: true,
      remarks: true,
      photoUrl: true,
      photoContentType: true,
      universityTimeline: true,
      targetTimeline: true,
      capacity: true,
    },
  });
  assert.deepEqual(savedTarget, {
    checklistItemId: target.checklistItemId,
    currentStatus: "Done",
    remarks: source.remarks,
    photoUrl: source.photoUrl,
    photoContentType: source.photoContentType,
    universityTimeline: "keep destination timeline",
    targetTimeline: "keep destination target",
    capacity: "keep destination capacity",
  });
  assert.deepEqual(
    await prisma.university.findUniqueOrThrow({
      where: { id: fixture.university.id },
      select: { overallReadiness: true },
    }),
    beforeReadiness,
  );

  const detailResponse = await fixture.get(`/universities/${fixture.university.id}`);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json() as {
    spaces: Array<{
      id: string;
      checklistStatuses: Array<{
        id: string;
        photoUrl: string;
        photoHistory: Array<{ photoUrl: string }>;
      }>;
    }>;
  };
  const reloadedTarget = detail.spaces
    .flatMap((space) => space.checklistStatuses)
    .find((status) => status.id === target.id);
  assert.ok(reloadedTarget);
  assert.equal(reloadedTarget.photoUrl, source.photoUrl);
  assert.deepEqual(
    reloadedTarget.photoHistory.map((entry) => entry.photoUrl),
    [source.photoUrl, "/objects/room-102-existing.jpg"],
  );

  const galleryResponse = await fixture.get(`/photo-history/${target.id}`);
  assert.equal(galleryResponse.status, 200);
  const gallery = await galleryResponse.json() as Array<{ photoUrl: string }>;
  assert.deepEqual(
    gallery.map((entry) => entry.photoUrl),
    [source.photoUrl, "/objects/room-102-existing.jpg"],
  );
});

test("model evidence copy backfills a same-path destination photo into the gallery once", async (t) => {
  const fixture = await createClassroomCopyFixture(
    t,
    "model-copy-gallery-backfill",
    1,
    1,
    undefined,
    "model_classroom",
    true,
  );
  const source = fixture.sourceStatuses[0];
  const target = fixture.destinationStatuses[0];
  await prisma.spaceChecklistStatus.update({
    where: { id: target.id },
    data: {
      remarks: "destination note",
      photoUrl: source.photoUrl,
      photoContentType: source.photoContentType,
    },
  });

  const update = {
    checklistItemId: source.checklistItemId,
    sourceStatusId: source.id,
    classroomIds: [fixture.destinationClassrooms[0].id],
    spaceIds: [fixture.destinationSpaces[0].id],
    targetStatusIds: [target.id],
    remarks: source.remarks,
    photoUrl: source.photoUrl,
    photoContentType: source.photoContentType,
    sourceSpaceType: "model_classroom" as const,
    skipBlankValues: true,
  };
  const response = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [update] },
  );
  assert.equal(response.status, 200);
  const firstBody = await response.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  assert.equal(firstBody.applied, 1);
  assert.equal(firstBody.skipped, 0);
  assert.deepEqual(firstBody.results.map((result) => ({
    statusId: result.statusId,
    outcome: result.outcome,
  })), [{ statusId: target.id, outcome: "applied" }]);
  assert.deepEqual(
    await prisma.photoHistory.findMany({
      where: { statusId: target.id },
      orderBy: { uploadedAt: "desc" },
      select: { photoUrl: true },
    }),
    [{ photoUrl: source.photoUrl }],
  );

  const retryResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [update] },
  );
  assert.equal(retryResponse.status, 200);
  const retryBody = await retryResponse.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  assert.equal(retryBody.applied, 0);
  assert.equal(retryBody.skipped, 1);
  assert.deepEqual(retryBody.results.map((result) => ({
    statusId: result.statusId,
    outcome: result.outcome,
  })), [{ statusId: target.id, outcome: "unchanged" }]);
  assert.equal(await prisma.photoHistory.count({ where: { statusId: target.id } }), 1);
  const galleryResponse = await fixture.get(`/photo-history/${target.id}`);
  assert.equal(galleryResponse.status, 200);
  assert.deepEqual(
    (await galleryResponse.json() as Array<{ photoUrl: string }>).map((entry) => entry.photoUrl),
    [source.photoUrl],
  );
});

test("model semantic matching fails closed on ambiguous source and destination identities", async (t) => {
  let duplicateSourceItemId: string | undefined;
  let duplicateSourceStatusId: string | undefined;
  const sourceFixture = await createClassroomCopyFixture(
    t,
    "model-copy-source-ambiguous",
    1,
    1,
    async () => {
      if (duplicateSourceStatusId) {
        await prisma.spaceChecklistStatus.delete({ where: { id: duplicateSourceStatusId } });
      }
      if (duplicateSourceItemId) {
        await prisma.checklistItem.delete({ where: { id: duplicateSourceItemId } });
      }
    },
    "model_classroom",
    true,
  );
  const source = sourceFixture.sourceStatuses[0];
  const target = sourceFixture.destinationStatuses[0];
  const duplicateSourceItem = await prisma.checklistItem.create({
    data: {
      module: "model_classroom",
      category: sourceFixture.items[0].category,
      name: sourceFixture.items[0].name,
    },
  });
  duplicateSourceItemId = duplicateSourceItem.id;
  const duplicateSourceStatus = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: sourceFixture.university.id,
      spaceId: sourceFixture.sourceSpace.id,
      checklistItemId: duplicateSourceItem.id,
    },
  });
  duplicateSourceStatusId = duplicateSourceStatus.id;
  const sourceAmbiguousResponse = await sourceFixture.request(
    `/universities/${sourceFixture.university.id}/status/bulk`,
    {
      updates: [{
        checklistItemId: source.checklistItemId,
        sourceStatusId: source.id,
        classroomIds: [sourceFixture.destinationClassrooms[0].id],
        spaceIds: [sourceFixture.destinationSpaces[0].id],
        targetStatusIds: [target.id],
        remarks: source.remarks,
        sourceSpaceType: "model_classroom",
        skipBlankValues: true,
      }],
    },
  );
  assert.equal(sourceAmbiguousResponse.status, 422);
  assert.equal(
    (await sourceAmbiguousResponse.json() as { code: string }).code,
    "CHECKLIST_MODEL_SOURCE_SEMANTIC_AMBIGUOUS",
  );
  assert.equal(
    (await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: target.id },
      select: { remarks: true },
    })).remarks,
    null,
  );

  let duplicateDestinationItemId: string | undefined;
  let duplicateDestinationStatusId: string | undefined;
  const destinationFixture = await createClassroomCopyFixture(
    t,
    "model-copy-destination-ambiguous",
    1,
    1,
    async () => {
      if (duplicateDestinationStatusId) {
        await prisma.spaceChecklistStatus.delete({ where: { id: duplicateDestinationStatusId } });
      }
      if (duplicateDestinationItemId) {
        await prisma.checklistItem.delete({ where: { id: duplicateDestinationItemId } });
      }
    },
    "model_classroom",
    true,
  );
  const destinationSource = destinationFixture.sourceStatuses[0];
  const destinationTarget = destinationFixture.destinationStatuses[0];
  const duplicateDestinationItem = await prisma.checklistItem.create({
    data: {
      module: "overall_classroom",
      category: destinationFixture.items[0].category,
      name: destinationFixture.items[0].name,
    },
  });
  duplicateDestinationItemId = duplicateDestinationItem.id;
  const duplicateDestinationStatus = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: destinationFixture.university.id,
      spaceId: destinationFixture.destinationSpaces[0].id,
      checklistItemId: duplicateDestinationItem.id,
    },
  });
  duplicateDestinationStatusId = duplicateDestinationStatus.id;
  const destinationAmbiguousResponse = await destinationFixture.request(
    `/universities/${destinationFixture.university.id}/status/bulk`,
    {
      updates: [{
        checklistItemId: destinationSource.checklistItemId,
        sourceStatusId: destinationSource.id,
        classroomIds: [destinationFixture.destinationClassrooms[0].id],
        spaceIds: [destinationFixture.destinationSpaces[0].id],
        targetStatusIds: [destinationTarget.id],
        remarks: destinationSource.remarks,
        sourceSpaceType: "model_classroom",
        skipBlankValues: true,
      }],
    },
  );
  assert.equal(destinationAmbiguousResponse.status, 422);
  assert.equal(
    (await destinationAmbiguousResponse.json() as { code: string }).code,
    "CHECKLIST_MODEL_TARGET_SEMANTIC_AMBIGUOUS",
  );
  assert.equal(
    (await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: destinationTarget.id },
      select: { remarks: true },
    })).remarks,
    null,
  );
});

test("model classroom marker rejects a non-model source and non-classroom destination", async (t) => {
  const ordinaryFixture = await createClassroomCopyFixture(t, "model-copy-source-type", 1, 1);
  const ordinaryUpdate = {
    ...buildClassroomCopyUpdates(ordinaryFixture)[0],
    sourceSpaceType: "model_classroom",
    skipBlankValues: true,
  };
  const sourceRejected = await ordinaryFixture.request(
    `/universities/${ordinaryFixture.university.id}/status/bulk`,
    { updates: [ordinaryUpdate] },
  );
  assert.equal(sourceRejected.status, 422);
  assert.equal(
    (await sourceRejected.json() as { code: string }).code,
    "CHECKLIST_SOURCE_SPACE_TYPE_MISMATCH",
  );

  const modelFixture = await createClassroomCopyFixture(
    t,
    "model-copy-destination-type",
    1,
    1,
    undefined,
    "model_classroom",
  );
  await prisma.space.update({
    where: { id: modelFixture.destinationSpaces[0].id },
    data: { spaceType: "model_classroom" },
  });
  const destinationRejected = await modelFixture.request(
    `/universities/${modelFixture.university.id}/status/bulk`,
    {
      updates: [{
        ...buildClassroomCopyUpdates(modelFixture)[0],
        sourceSpaceType: "model_classroom",
        skipBlankValues: true,
      }],
    },
  );
  assert.equal(destinationRejected.status, 422);
  assert.equal(
    (await destinationRejected.json() as { code: string }).code,
    "CHECKLIST_MODEL_DESTINATION_INVALID",
  );
});

test("persisted model sources cannot bypass field and blank protections by omitting markers", async (t) => {
  const fixture = await createClassroomCopyFixture(
    t,
    "model-copy-derived-semantics",
    1,
    1,
    undefined,
    "model_classroom",
  );
  const source = fixture.sourceStatuses[0];
  const target = fixture.destinationStatuses[0];
  await prisma.spaceChecklistStatus.update({
    where: { id: target.id },
    data: {
      currentStatus: "Done",
      isBlocker: false,
      remarks: "keep target remark",
      capacity: "old capacity",
      itemStartDate: "old start",
      itemEndDate: "old end",
      actualCompletionDate: "old completion",
      universityTimeline: "keep university timeline",
      targetTimeline: "keep target timeline",
    },
  });
  const beforeReadiness = await prisma.university.findUniqueOrThrow({
    where: { id: fixture.university.id },
    select: { overallReadiness: true },
  });
  const forbiddenFieldsAndBlank = {
    checklistItemId: fixture.items[0].id,
    sourceStatusId: source.id,
    classroomIds: [fixture.destinationClassrooms[0].id],
    spaceIds: [fixture.destinationSpaces[0].id],
    targetStatusIds: [target.id],
    // These are ordinary-copy fields. A persisted model source must ignore
    // them even when sourceSpaceType is omitted.
    currentStatus: "Blocker",
    isBlocker: true,
    capacity: "new capacity",
    itemStartDate: "new start",
    itemEndDate: "new end",
    actualCompletionDate: "new completion",
    // The selected model field is blank and must not clear the destination.
    remarks: "",
  };

  for (const update of [
    forbiddenFieldsAndBlank,
    { ...forbiddenFieldsAndBlank, skipBlankValues: false },
  ]) {
    const response = await fixture.request(
      `/universities/${fixture.university.id}/status/bulk`,
      { updates: [update] },
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      applied: number;
      skipped: number;
      results: Array<{ statusId: string; outcome: string }>;
    };
    assert.equal(body.applied, 0);
    assert.equal(body.skipped, 1);
    assert.deepEqual(
      body.results.map((result) => ({
        statusId: result.statusId,
        outcome: result.outcome,
      })),
      [{ statusId: target.id, outcome: "unchanged" }],
    );
  }

  assert.deepEqual(
    await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: target.id },
      select: {
        currentStatus: true,
        isBlocker: true,
        remarks: true,
        capacity: true,
        itemStartDate: true,
        itemEndDate: true,
        actualCompletionDate: true,
        universityTimeline: true,
        targetTimeline: true,
      },
    }),
    {
      currentStatus: "Done",
      isBlocker: false,
      remarks: "keep target remark",
      capacity: "old capacity",
      itemStartDate: "old start",
      itemEndDate: "old end",
      actualCompletionDate: "old completion",
      universityTimeline: "keep university timeline",
      targetTimeline: "keep target timeline",
    },
  );
  assert.equal(
    await prisma.checklistStatusHistory.count({
      where: { universityId: fixture.university.id },
    }),
    0,
  );
  assert.deepEqual(
    await prisma.university.findUniqueOrThrow({
      where: { id: fixture.university.id },
      select: { overallReadiness: true },
    }),
    beforeReadiness,
  );

  await prisma.space.update({
    where: { id: fixture.destinationSpaces[0].id },
    data: { spaceType: "model_classroom" },
  });
  const destinationRejected = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [{ ...forbiddenFieldsAndBlank, remarks: source.remarks }] },
  );
  assert.equal(destinationRejected.status, 422);
  assert.equal(
    (await destinationRejected.json() as { code: string }).code,
    "CHECKLIST_MODEL_DESTINATION_INVALID",
  );
});

test("skip-Done preserves completed targets while acknowledging applied and skipped rows exactly", async (t) => {
  const fixture = await createClassroomCopyFixture(t, "bulk-skip-done", 1, 3);
  const source = fixture.sourceStatuses[0];
  await prisma.spaceChecklistStatus.update({
    where: { id: source.id },
    data: { currentStatus: "Done", isBlocker: false },
  });
  const doneTarget = fixture.destinationStatuses[0];
  await prisma.spaceChecklistStatus.update({
    where: { id: doneTarget.id },
    data: {
      currentStatus: "Done",
      remarks: "keep completed target",
      photoUrl: "/objects/keep-done.jpg",
      photoContentType: "image/jpeg",
    },
  });
  const update = {
    ...buildClassroomCopyUpdates(fixture)[0],
    currentStatus: "Done",
    skipDone: true,
  };
  const targetIds = fixture.destinationStatuses.map((status) => status.id);
  const response = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [update] },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  assert.equal(body.applied, 2);
  assert.equal(body.skipped, 1);
  assert.deepEqual(
    body.results.map((result) => ({
      statusId: result.statusId,
      outcome: result.outcome,
    })),
    [
      { statusId: targetIds[0], outcome: "skipped" },
      { statusId: targetIds[1], outcome: "applied" },
      { statusId: targetIds[2], outcome: "applied" },
    ],
  );
  assert.deepEqual(
    await prisma.spaceChecklistStatus.findUniqueOrThrow({
      where: { id: doneTarget.id },
      select: { currentStatus: true, remarks: true, photoUrl: true },
    }),
    {
      currentStatus: "Done",
      remarks: "keep completed target",
      photoUrl: "/objects/keep-done.jpg",
    },
  );
  assert.equal(
    await prisma.checklistStatusHistory.count({ where: { statusId: doneTarget.id } }),
    0,
  );
  assert.equal(
    await prisma.photoHistory.count({ where: { statusId: doneTarget.id } }),
    0,
  );
  for (const target of fixture.destinationStatuses.slice(1)) {
    assert.equal(
      await prisma.checklistStatusHistory.count({ where: { statusId: target.id } }),
      2,
    );
    assert.equal(
      await prisma.photoHistory.count({ where: { statusId: target.id } }),
      1,
    );
  }

  const retryResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [update] },
  );
  assert.equal(retryResponse.status, 200);
  const retry = await retryResponse.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  assert.equal(retry.applied, 0);
  assert.equal(retry.skipped, 3);
  assert.deepEqual(
    retry.results.map((result) => ({
      statusId: result.statusId,
      outcome: result.outcome,
    })),
    [
      { statusId: targetIds[0], outcome: "skipped" },
      { statusId: targetIds[1], outcome: "skipped" },
      { statusId: targetIds[2], outcome: "skipped" },
    ],
  );
  assert.equal(
    await prisma.checklistStatusHistory.count({
      where: { universityId: fixture.university.id },
    }),
    4,
  );
});

test("a timed-out multi-item classroom copy rolls back every target and retries without duplicate history", async (t) => {
  let releaseUniversityLock: (() => void) | undefined;
  let lockTransaction: Promise<unknown> | undefined;
  const fixture = await createClassroomCopyFixture(
    t,
    "bulk-rollback",
    3,
    4,
    async () => {
      releaseUniversityLock?.();
      await lockTransaction?.catch(() => undefined);
    },
  );
  const updates = buildClassroomCopyUpdates(fixture);
  const expectedTargetIds = updates.flatMap((update) => update.targetStatusIds);
  const before = await prisma.spaceChecklistStatus.findMany({
    where: { id: { in: expectedTargetIds } },
    select: { id: true, currentStatus: true, remarks: true, photoUrl: true },
    orderBy: { id: "asc" },
  });
  const beforeReadiness = await prisma.university.findUniqueOrThrow({
    where: { id: fixture.university.id },
    select: { overallReadiness: true },
  });
  const blockedTargetId = expectedTargetIds[0];
  const releaseLock = new Promise<void>((resolve) => {
    releaseUniversityLock = resolve;
  });
  let lockAcquired!: () => void;
  const acquiredLock = new Promise<void>((resolve) => {
    lockAcquired = resolve;
  });
  lockTransaction = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM space_checklist_status
      WHERE id = ${blockedTargetId}
      FOR UPDATE
    `;
    lockAcquired();
    await releaseLock;
  }, { timeout: 15_000 });
  await acquiredLock;

  const startedAt = performance.now();
  const responsePromise = fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates },
  );
  // The lock intentionally spans the current five-second transaction budget.
  // This is a development-only fixture: it never uses an application row.
  const releaseTimer = setTimeout(() => releaseUniversityLock?.(), 5_250);
  const response = await responsePromise;
  const elapsedMs = performance.now() - startedAt;
  clearTimeout(releaseTimer);
  releaseUniversityLock?.();
  await lockTransaction;
  if (process.env.BULK_COPY_REPORT_TIMING === "1") {
    console.info(
      `[bulk-copy measurement] blocked rollback ${fixture.items.length} items x `
      + `${fixture.destinationSpaces.length} destinations: ${elapsedMs.toFixed(1)} ms `
      + `(HTTP ${response.status})`,
    );
  }

  assert.ok(response.status === 200 || response.status === 503);
  let firstOutcome: { applied: number; skipped: number };
  if (response.status === 503) {
    const failed = await response.json() as { code: string };
    assert.equal(failed.code, "CHECKLIST_SAVE_BUSY");
    assert.deepEqual(
      await prisma.spaceChecklistStatus.findMany({
        where: { id: { in: expectedTargetIds } },
        select: { id: true, currentStatus: true, remarks: true, photoUrl: true },
        orderBy: { id: "asc" },
      }),
      before,
      "a transaction deadline must not leave partially copied targets",
    );
    assert.equal(
      await prisma.checklistStatusHistory.count({
        where: { universityId: fixture.university.id },
      }),
      0,
    );
    assert.equal(
      await prisma.photoHistory.count({
        where: { status: { universityId: fixture.university.id } },
      }),
      0,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: { userId: fixture.user.id, entityId: fixture.university.id },
      }),
      0,
    );
    assert.deepEqual(
      await prisma.university.findUniqueOrThrow({
        where: { id: fixture.university.id },
        select: { overallReadiness: true },
      }),
      beforeReadiness,
    );
    firstOutcome = { applied: 0, skipped: 0 };
  } else {
    const committed = await response.json() as { applied: number; skipped: number };
    firstOutcome = committed;
  }

  const retryResponse = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates },
  );
  assert.equal(retryResponse.status, 200);
  const retry = await retryResponse.json() as {
    applied: number;
    skipped: number;
    results: Array<{ statusId: string; outcome: string }>;
  };
  const expectedApplied = expectedTargetIds.length;
  assert.equal(
    retry.applied,
    firstOutcome.applied === expectedApplied ? 0 : expectedApplied,
  );
  assert.equal(
    retry.skipped,
    firstOutcome.applied === expectedApplied ? expectedApplied : 0,
  );
  assert.deepEqual(
    retry.results.map((result) => ({
      statusId: result.statusId,
      outcome: result.outcome,
    })),
    expectedTargetIds.map((statusId) => ({
      statusId,
      outcome: firstOutcome.applied === expectedApplied ? "unchanged" : "applied",
    })),
  );
  assert.equal(
    await prisma.checklistStatusHistory.count({
      where: { universityId: fixture.university.id },
    }),
    expectedTargetIds.length * 2,
  );
  assert.equal(
    await prisma.photoHistory.count({
      where: { status: { universityId: fixture.university.id } },
    }),
    expectedTargetIds.length,
  );
});

test("overlapping single and classroom saves serialize without losing either committed history", async (t) => {
  let releaseUniversityLock: (() => void) | undefined;
  let lockTransaction: Promise<unknown> | undefined;
  const fixture = await createClassroomCopyFixture(
    t,
    "bulk-overlap",
    1,
    2,
    async () => {
      releaseUniversityLock?.();
      await lockTransaction?.catch(() => undefined);
    },
  );
  const update = buildClassroomCopyUpdates(fixture)[0];
  const target = fixture.destinationStatuses[0];
  const releaseLock = new Promise<void>((resolve) => {
    releaseUniversityLock = resolve;
  });
  let lockAcquired!: () => void;
  const acquiredLock = new Promise<void>((resolve) => {
    lockAcquired = resolve;
  });
  lockTransaction = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM universities WHERE id = ${fixture.university.id} FOR UPDATE`;
    lockAcquired();
    await releaseLock;
  });
  await acquiredLock;

  const singleRequest = fixture.request(
    `/universities/${fixture.university.id}/status/${target.id}`,
    { remarks: "single queued save" },
  );
  await delay(100);
  const bulkRequest = fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    { updates: [update] },
  );
  await delay(100);
  releaseUniversityLock?.();
  await lockTransaction;
  const [singleResponse, bulkResponse] = await Promise.all([singleRequest, bulkRequest]);
  assert.equal(singleResponse.status, 200);
  assert.equal(bulkResponse.status, 200);

  const saved = await prisma.spaceChecklistStatus.findUniqueOrThrow({
    where: { id: target.id },
    select: { remarks: true, currentStatus: true, photoUrl: true },
  });
  assert.ok(
    saved.remarks === "single queued save" || saved.remarks === update.remarks,
    "the serialized writer must leave a complete value, never a partial row",
  );
  assert.equal(saved.currentStatus, update.currentStatus);
  assert.equal(saved.photoUrl, update.photoUrl);
  assert.equal(
    await prisma.checklistStatusHistory.count({ where: { statusId: target.id } }),
    3,
    "initial state, single save, and bulk save should each be represented once",
  );
  assert.equal(
    await prisma.photoHistory.count({ where: { statusId: target.id } }),
    1,
  );
});

test("legacy A-to-B-to-A and A-to-B-to-C duplicate destinations fail atomically", async (t) => {
  const fixture = await createStatusFixture(t, "legacy-target-duplicate");
  const targetSpace = await prisma.space.create({
    data: {
      universityId: fixture.university.id,
      spaceType: "model_classroom",
      name: "Legacy duplicate destination",
    },
  });
  const targetStatus = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: fixture.university.id,
      spaceId: targetSpace.id,
      checklistItemId: fixture.item.id,
      remarks: "A",
    },
  });
  const beforeReadiness = await prisma.university.findUniqueOrThrow({
    where: { id: fixture.university.id },
    select: { overallReadiness: true },
  });
  const duplicateSequences = [
    ["A-to-B-to-A", "A"],
    ["A-to-B-to-C", "C"],
  ] as const;

  for (const [sequence, finalRemark] of duplicateSequences) {
    const response = await fixture.request(
      `/universities/${fixture.university.id}/status/bulk`,
      {
        updates: [
          {
            checklistItemId: fixture.item.id,
            spaceIds: [targetSpace.id],
            remarks: "B",
          },
          {
            checklistItemId: fixture.item.id,
            spaceIds: [targetSpace.id],
            remarks: finalRemark,
          },
        ],
      },
    );
    assert.equal(response.status, 422, sequence);
    assert.equal(
      (await response.json() as { code: string }).code,
      "CHECKLIST_BULK_TARGET_STATUS_DUPLICATE",
      sequence,
    );
    assert.deepEqual(
      await prisma.spaceChecklistStatus.findUniqueOrThrow({
        where: { id: targetStatus.id },
        select: { currentStatus: true, remarks: true, photoUrl: true },
      }),
      { currentStatus: "Yet to start", remarks: "A", photoUrl: null },
      `${sequence} must not apply either update`,
    );
    assert.equal(
      await prisma.checklistStatusHistory.count({ where: { statusId: targetStatus.id } }),
      0,
      `${sequence} must not create history`,
    );
    assert.equal(
      await prisma.photoHistory.count({ where: { statusId: targetStatus.id } }),
      0,
      `${sequence} must not create evidence history`,
    );
    assert.deepEqual(
      await prisma.university.findUniqueOrThrow({
        where: { id: fixture.university.id },
        select: { overallReadiness: true },
      }),
      beforeReadiness,
      `${sequence} must not recalculate readiness from a partial write`,
    );
  }
});

test("explicit classroom source-target overlap is rejected before any mutation", async (t) => {
  const fixture = await createClassroomCopyFixture(t, "source-target-overlap", 1, 1);
  const source = fixture.sourceStatuses[0];
  const untouchedTarget = fixture.destinationStatuses[0];
  const body = {
    updates: [{
      checklistItemId: fixture.items[0].id,
      sourceStatusId: source.id,
      classroomIds: [fixture.sourceClassroom.id],
      spaceIds: [fixture.sourceSpace.id],
      targetStatusIds: [source.id],
      currentStatus: source.currentStatus,
      remarks: source.remarks,
      photoUrl: source.photoUrl,
      photoContentType: source.photoContentType,
    }],
  };
  const response = await fixture.request(
    `/universities/${fixture.university.id}/status/bulk`,
    body,
  );
  assert.equal(response.status, 422);
  assert.equal(
    (await response.json() as { code: string }).code,
    "CHECKLIST_BULK_SOURCE_TARGET_OVERLAP",
  );
  assert.deepEqual(
    await prisma.spaceChecklistStatus.findMany({
      where: { id: { in: [source.id, untouchedTarget.id] } },
      select: { id: true, currentStatus: true, remarks: true, photoUrl: true },
      orderBy: { id: "asc" },
    }),
    [
      {
        id: source.id,
        currentStatus: "In-Progress",
        remarks: "source-target-overlap source remark 1",
        photoUrl: source.photoUrl,
      },
      {
        id: untouchedTarget.id,
        currentStatus: "Yet to start",
        remarks: null,
        photoUrl: null,
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.equal(
    await prisma.checklistStatusHistory.count({
      where: { universityId: fixture.university.id },
    }),
    0,
  );
  assert.equal(
    await prisma.photoHistory.count({
      where: { status: { universityId: fixture.university.id } },
    }),
    0,
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { userId: fixture.user.id, entityId: fixture.university.id },
    }),
    0,
  );
});
