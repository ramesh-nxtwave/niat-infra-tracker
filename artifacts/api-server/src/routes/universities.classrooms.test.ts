import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { signToken } from "../lib/auth";
import prisma from "../lib/prisma";
import universitiesRouter from "./universities";

async function fixture(t: test.TestContext) {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [admin, apm, zonal] = await Promise.all(["admin", "apm", "zonal"].map((role) =>
    prisma.user.create({
      data: { name: `${role} classroom test`, email: `${role}-${suffix}@example.test`, passwordHash: "unused", role },
    }),
  ));
  const university = await prisma.university.create({ data: { code: `CRT-${suffix}`, name: `Classroom test ${suffix}` } });
  const foreign = await prisma.university.create({ data: { code: `CRF-${suffix}`, name: `Foreign classroom ${suffix}` } });
  const item = await prisma.checklistItem.create({
    data: { module: "overall_classroom", category: `category-${suffix}`, name: `item-${suffix}` },
  });
  const app = express();
  app.use(express.json());
  app.use("/api", universitiesRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const token = (user: typeof admin) => `Bearer ${signToken({
    userId: user.id, email: user.email, role: user.role, name: user.name, zoneIds: [], universityIds: [],
  })}`;
  const request = (path: string, user: typeof admin, init: RequestInit = {}) => fetch(
    `http://127.0.0.1:${address.port}/api${path}`,
    { ...init, headers: { authorization: token(user), "content-type": "application/json", ...init.headers } },
  );
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.id, apm.id, zonal.id] } } });
    await prisma.university.deleteMany({ where: { id: { in: [university.id, foreign.id] } } });
    await prisma.checklistItem.delete({ where: { id: item.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, apm.id, zonal.id] } } });
  });
  return { admin, apm, zonal, university, foreign, item, request };
}

test("association resolution is admin-only and preserves checklist evidence", async (t) => {
  const f = await fixture(t);
  const classroom = await prisma.universityClassroom.create({ data: { universityId: f.university.id, roomId: "Room A" } });
  const space = await prisma.space.create({
    data: { universityId: f.university.id, spaceType: "overall_classroom", name: "Room A" },
  });
  const status = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: f.university.id, spaceId: space.id, checklistItemId: f.item.id,
      currentStatus: "Done", remarks: "kept", photoUrl: "/objects/kept.jpg", photoContentType: "image/jpeg",
    },
  });
  await prisma.photoHistory.create({ data: { statusId: status.id, photoUrl: "/objects/kept.jpg", contentType: "image/jpeg" } });
  await prisma.checklistStatusHistory.create({
    data: { statusId: status.id, universityId: f.university.id, currentStatus: "Done", remarks: "history" },
  });

  for (const user of [f.apm, f.zonal]) {
    const denied = await f.request(`/universities/${f.university.id}/classrooms/${classroom.id}/association`, user, {
      method: "PUT", body: JSON.stringify({ spaceId: space.id }),
    });
    assert.equal(denied.status, 403);
  }
  const response = await f.request(`/universities/${f.university.id}/classrooms/${classroom.id}/association`, f.admin, {
    method: "PUT", body: JSON.stringify({ spaceId: space.id }),
  });
  assert.equal(response.status, 200);
  const saved = await prisma.spaceChecklistStatus.findUniqueOrThrow({
    where: { id: status.id }, include: { photoHistory: true, history: true },
  });
  assert.equal(saved.currentStatus, "Done");
  assert.equal(saved.photoUrl, "/objects/kept.jpg");
  assert.equal(saved.photoHistory.length, 1);
  assert.equal(saved.history.length, 1);
});

test("resolution rejects foreign, wrong-type, deleted, and already-owned spaces", async (t) => {
  const f = await fixture(t);
  const classroom = await prisma.universityClassroom.create({ data: { universityId: f.university.id, roomId: "Room A" } });
  const other = await prisma.universityClassroom.create({ data: { universityId: f.university.id, roomId: "Room B" } });
  const foreign = await prisma.space.create({ data: { universityId: f.foreign.id, spaceType: "overall_classroom", name: "Foreign" } });
  const wrongType = await prisma.space.create({ data: { universityId: f.university.id, spaceType: "lab", name: "Lab" } });
  const deleted = await prisma.space.create({ data: { universityId: f.university.id, spaceType: "overall_classroom", name: "Deleted" } });
  await prisma.space.update({ where: { id: deleted.id }, data: { isDeleted: true } });
  const owned = await prisma.space.create({ data: { universityId: f.university.id, spaceType: "overall_classroom", name: "Owned" } });
  await prisma.universityClassroom.update({ where: { id: other.id }, data: { spaceId: owned.id } });
  for (const [spaceId, expectedStatus] of [
    [foreign.id, 404],
    [wrongType.id, 404],
    [deleted.id, 404],
    [owned.id, 409],
  ] as const) {
    const response = await f.request(`/universities/${f.university.id}/classrooms/${classroom.id}/association`, f.admin, {
      method: "PUT", body: JSON.stringify({ spaceId }),
    });
    assert.equal(response.status, expectedStatus);
  }
});

test("active canonical duplicates are rejected and delete/recreate gets fresh space history", async (t) => {
  const f = await fixture(t);
  const firstResponse = await f.request(`/universities/${f.university.id}/classrooms`, f.admin, {
    method: "POST", body: JSON.stringify({ roomId: " Room 101 " }),
  });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json() as { id: string; spaceId: string };
  const duplicate = await f.request(`/universities/${f.university.id}/classrooms`, f.admin, {
    method: "POST", body: JSON.stringify({ roomId: "room   101" }),
  });
  assert.equal(duplicate.status, 409);
  const unicodeDuplicate = await f.request(`/universities/${f.university.id}/classrooms`, f.admin, {
    method: "POST", body: JSON.stringify({ roomId: "Ｒｏｏｍ １０１" }),
  });
  assert.equal(unicodeDuplicate.status, 409);
  const itemStatus = await prisma.spaceChecklistStatus.findFirstOrThrow({ where: { spaceId: first.spaceId } });
  await prisma.spaceChecklistStatus.update({ where: { id: itemStatus.id }, data: { currentStatus: "Done", photoUrl: "/objects/old.jpg" } });
  const foreignClassroom = await prisma.universityClassroom.create({ data: { universityId: f.foreign.id, roomId: "Foreign" } });
  const forbiddenDelete = await f.request(`/universities/${f.university.id}/classrooms/${foreignClassroom.id}`, f.admin, { method: "DELETE" });
  assert.equal(forbiddenDelete.status, 404);
  const deleted = await f.request(`/universities/${f.university.id}/classrooms/${first.id}`, f.admin, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  const recreatedResponse = await f.request(`/universities/${f.university.id}/classrooms`, f.admin, {
    method: "POST", body: JSON.stringify({ roomId: "Room 101" }),
  });
  assert.equal(recreatedResponse.status, 201);
  const recreated = await recreatedResponse.json() as { id: string; spaceId: string };
  assert.notEqual(recreated.spaceId, first.spaceId);
  assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: first.spaceId } })).isDeleted, true);
  assert.equal((await prisma.spaceChecklistStatus.findUniqueOrThrow({ where: { id: itemStatus.id } })).photoUrl, "/objects/old.jpg");
});

test("legacy exact-one rooms rename and delete their existing checklist space atomically", async (t) => {
  const f = await fixture(t);
  const classroom = await prisma.universityClassroom.create({
    data: { universityId: f.university.id, roomId: "Legacy 201" },
  });
  const space = await prisma.space.create({
    data: { universityId: f.university.id, spaceType: "overall_classroom", name: " legacy   201 " },
  });
  const status = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: f.university.id,
      spaceId: space.id,
      checklistItemId: f.item.id,
      currentStatus: "Done",
      photoUrl: "/objects/legacy.jpg",
    },
  });
  const renamed = await f.request(
    `/universities/${f.university.id}/classrooms/${classroom.id}`,
    f.admin,
    { method: "PUT", body: JSON.stringify({ roomId: "Room 201", capacity: "42" }) },
  );
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json() as { capacity: number }).capacity, 42);
  assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: space.id } })).name, "Room 201");
  assert.equal((await prisma.universityClassroom.findUniqueOrThrow({ where: { id: classroom.id } })).spaceId, space.id);

  const deleted = await f.request(
    `/universities/${f.university.id}/classrooms/${classroom.id}`,
    f.admin,
    { method: "DELETE" },
  );
  assert.equal(deleted.status, 200);
  assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: space.id } })).isDeleted, true);
  assert.equal((await prisma.spaceChecklistStatus.findUniqueOrThrow({ where: { id: status.id } })).photoUrl, "/objects/legacy.jpg");
});

test("legacy ambiguous rooms fail closed on rename and delete", async (t) => {
  const f = await fixture(t);
  const classroom = await prisma.universityClassroom.create({
    data: { universityId: f.university.id, roomId: "Legacy 301" },
  });
  await prisma.space.createMany({
    data: ["Legacy 301", " legacy   301 "].map(name => ({
      universityId: f.university.id,
      spaceType: "overall_classroom",
      name,
    })),
  });
  const rename = await f.request(
    `/universities/${f.university.id}/classrooms/${classroom.id}`,
    f.admin,
    { method: "PUT", body: JSON.stringify({ roomId: "Room 301" }) },
  );
  assert.equal(rename.status, 409);
  const deletion = await f.request(
    `/universities/${f.university.id}/classrooms/${classroom.id}`,
    f.admin,
    { method: "DELETE" },
  );
  assert.equal(deletion.status, 409);
  assert.equal((await prisma.universityClassroom.findUniqueOrThrow({ where: { id: classroom.id } })).isDeleted, false);
});

test("concurrent repairs and deletion serialize without replacing a chosen association", async (t) => {
  const f = await fixture(t);
  const classroom = await prisma.universityClassroom.create({
    data: { universityId: f.university.id, roomId: "Concurrent 401" },
  });
  const [firstSpace, secondSpace] = await Promise.all([
    prisma.space.create({
      data: { universityId: f.university.id, spaceType: "overall_classroom", name: "Candidate A" },
    }),
    prisma.space.create({
      data: { universityId: f.university.id, spaceType: "overall_classroom", name: "Candidate B" },
    }),
  ]);
  const associationPath = `/universities/${f.university.id}/classrooms/${classroom.id}/association`;
  const repairs = await Promise.all([
    f.request(associationPath, f.admin, {
      method: "PUT",
      body: JSON.stringify({ spaceId: firstSpace.id }),
    }),
    f.request(associationPath, f.admin, {
      method: "PUT",
      body: JSON.stringify({ spaceId: secondSpace.id }),
    }),
  ]);
  assert.deepEqual(repairs.map(response => response.status).sort(), [200, 409]);
  const repaired = await prisma.universityClassroom.findUniqueOrThrow({ where: { id: classroom.id } });
  assert.ok(repaired.spaceId === firstSpace.id || repaired.spaceId === secondSpace.id);

  const deleteAndRepair = await Promise.all([
    f.request(`/universities/${f.university.id}/classrooms/${classroom.id}`, f.admin, {
      method: "DELETE",
    }),
    f.request(associationPath, f.admin, {
      method: "PUT",
      body: JSON.stringify({ spaceId: repaired.spaceId === firstSpace.id ? firstSpace.id : secondSpace.id }),
    }),
  ]);
  assert.ok(deleteAndRepair.some(response => response.status === 200));
  assert.ok(deleteAndRepair.every(response => [200, 404].includes(response.status)));
  const deletedClassroom = await prisma.universityClassroom.findUniqueOrThrow({ where: { id: classroom.id } });
  assert.equal(deletedClassroom.isDeleted, true);
  const associatedSpace = await prisma.space.findUniqueOrThrow({ where: { id: deletedClassroom.spaceId! } });
  assert.equal(associatedSpace.isDeleted, true);
});