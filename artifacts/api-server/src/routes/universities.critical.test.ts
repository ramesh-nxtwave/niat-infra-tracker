import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { signToken } from "../lib/auth";
import prisma from "../lib/prisma";
import universitiesRouter from "./universities";

test("only admins can persist a critical university designation, while assigned users receive it", async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const admin = await prisma.user.create({
    data: {
      name: "Critical university admin",
      email: `critical-admin-${suffix}@example.test`,
      passwordHash: "not-used",
      role: "admin",
    },
  });
  const visibleUniversity = await prisma.university.create({
    data: {
      code: `CRITICAL-VISIBLE-${suffix}`,
      name: `Critical visible ${suffix}`,
    },
  });
  const hiddenUniversity = await prisma.university.create({
    data: {
      code: `CRITICAL-HIDDEN-${suffix}`,
      name: `Critical hidden ${suffix}`,
      isCritical: true,
    },
  });
  const apm = await prisma.user.create({
    data: {
      name: "Critical university APM",
      email: `critical-apm-${suffix}@example.test`,
      passwordHash: "not-used",
      role: "apm",
      universityIds: [visibleUniversity.id],
    },
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
  const tokenFor = (user: typeof admin) => `Bearer ${signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    zoneIds: user.zoneIds,
    universityIds: user.universityIds,
  })}`;
  const request = (path: string, token: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      ...init,
      headers: {
        authorization: token,
        "content-type": "application/json",
        ...init.headers,
      },
    });

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.auditLog.deleteMany({ where: { userId: admin.id } });
    await prisma.university.deleteMany({
      where: { id: { in: [visibleUniversity.id, hiddenUniversity.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, apm.id] } } });
  });

  const adminToken = tokenFor(admin);
  const apmToken = tokenFor(apm);
  const markResponse = await request(`/universities/${visibleUniversity.id}/critical`, adminToken, {
    method: "PATCH",
    body: JSON.stringify({ isCritical: true }),
  });
  assert.equal(markResponse.status, 200);
  assert.equal((await markResponse.json() as { isCritical: boolean }).isCritical, true);
  assert.equal(
    (await prisma.university.findUniqueOrThrow({
      where: { id: visibleUniversity.id },
      select: { isCritical: true },
    })).isCritical,
    true,
  );
  const retryMarkResponse = await request(`/universities/${visibleUniversity.id}/critical`, adminToken, {
    method: "PATCH",
    body: JSON.stringify({ isCritical: true }),
  });
  assert.equal(retryMarkResponse.status, 200, "a retried no-op succeeds");
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: visibleUniversity.id, action: "MARK_CRITICAL" },
    }),
    1,
    "a no-op retry does not create a duplicate audit event",
  );

  const visibleListResponse = await request("/universities", apmToken);
  assert.equal(visibleListResponse.status, 200);
  const visibleList = await visibleListResponse.json() as Array<{ id: string; isCritical: boolean }>;
  assert.deepEqual(
    visibleList.map((university) => university.id),
    [visibleUniversity.id],
    "the list stays role-visible",
  );
  assert.equal(visibleList[0]?.isCritical, true, "the list includes the critical flag");

  const visibleDetailResponse = await request(`/universities/${visibleUniversity.id}`, apmToken);
  assert.equal(visibleDetailResponse.status, 200);
  assert.equal((await visibleDetailResponse.json() as { isCritical: boolean }).isCritical, true);

  const lowPriorityResponse = await request(`/universities/${visibleUniversity.id}/report-priority`, adminToken, {
    method: "PATCH",
    body: JSON.stringify({ priority: "LOW" }),
  });
  assert.equal(lowPriorityResponse.status, 200);
  const lowPriorityUniversity = await lowPriorityResponse.json() as { priority: string; isCritical: boolean };
  assert.equal(lowPriorityUniversity.priority, "LOW");
  assert.equal(lowPriorityUniversity.isCritical, false);

  const deniedResponse = await request(`/universities/${visibleUniversity.id}/critical`, apmToken, {
    method: "PATCH",
    body: JSON.stringify({ isCritical: false }),
  });
  assert.equal(deniedResponse.status, 403);

  const unmarkResponse = await request(`/universities/${visibleUniversity.id}/critical`, adminToken, {
    method: "PATCH",
    body: JSON.stringify({ isCritical: false }),
  });
  assert.equal(unmarkResponse.status, 200);
  assert.equal((await unmarkResponse.json() as { isCritical: boolean }).isCritical, false);
  assert.deepEqual(
    (await prisma.auditLog.findMany({
      where: { entityId: visibleUniversity.id },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    })).map((entry) => entry.action),
    ["MARK_CRITICAL", "UPDATE_REPORT_PRIORITY"],
  );
});

test("critical designation requires an explicit boolean", async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const admin = await prisma.user.create({
    data: {
      name: "Critical validation admin",
      email: `critical-validation-${suffix}@example.test`,
      passwordHash: "not-used",
      role: "admin",
    },
  });
  const university = await prisma.university.create({
    data: {
      code: `CRITICAL-VALIDATION-${suffix}`,
      name: `Critical validation ${suffix}`,
    },
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

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.university.delete({ where: { id: university.id } });
    await prisma.user.delete({ where: { id: admin.id } });
  });

  const authorization = `Bearer ${signToken({
    userId: admin.id,
    email: admin.email,
    role: admin.role,
    name: admin.name,
    zoneIds: [],
    universityIds: [],
  })}`;
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/universities/${university.id}/critical`,
    {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ isCritical: "true" }),
    },
  );
  assert.equal(response.status, 400);
  assert.equal(
    (await prisma.university.findUniqueOrThrow({
      where: { id: university.id },
      select: { isCritical: true },
    })).isCritical,
    false,
  );
  const missingResponse = await fetch(
    `http://127.0.0.1:${address.port}/api/universities/missing-critical-${suffix}/critical`,
    {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ isCritical: true }),
    },
  );
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "University not found" });
});

test("critical status rolls back when its audit entry cannot be written", async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const university = await prisma.university.create({
    data: {
      code: `CRITICAL-ROLLBACK-${suffix}`,
      name: `Critical rollback ${suffix}`,
    },
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

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.university.delete({ where: { id: university.id } });
  });

  // The signed token is otherwise valid and administrative, but references a
  // deleted user. The update can begin, while auditLog's FK makes the audit
  // write fail. The transaction must roll the flag back with it.
  const authorization = `Bearer ${signToken({
    userId: `missing-critical-auditor-${suffix}`,
    email: `missing-critical-auditor-${suffix}@example.test`,
    role: "admin",
    name: "Missing critical auditor",
    zoneIds: [],
    universityIds: [],
  })}`;
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/universities/${university.id}/critical`,
    {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ isCritical: true }),
    },
  );
  assert.equal(response.status, 500);
  assert.match(
    (await response.json() as { error: string }).error,
    /No changes were saved; please retry/,
  );
  assert.equal(
    (await prisma.university.findUniqueOrThrow({
      where: { id: university.id },
      select: { isCritical: true },
    })).isCritical,
    false,
    "the database flag rolls back when the audit write fails",
  );
  assert.equal(
    await prisma.auditLog.count({ where: { entityId: university.id } }),
    0,
  );
});