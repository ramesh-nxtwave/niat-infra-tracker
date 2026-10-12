import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { signToken } from "../lib/auth";
import prisma from "../lib/prisma";
import universitiesRouter from "./universities";

const completionStatuses = new Set(["Done", "N/A"]);

test("overlapping checklist updates leave persisted and live readiness consistent", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/api", universitiesRouter);

  const suffix = `${process.pid}-${Date.now()}`;
  const user = await prisma.user.create({
    data: {
      name: "Readiness concurrency test",
      email: `readiness-concurrency-${suffix}@example.test`,
      passwordHash: "not-used",
      role: "admin",
    },
  });
  const university = await prisma.university.create({
    data: {
      code: `RCT-${suffix}`,
      name: `Readiness concurrency test ${suffix}`,
    },
  });
  const singleItem = await prisma.checklistItem.create({
    data: {
      module: "model_classroom",
      category: "Concurrency test",
      name: `Single update ${suffix}`,
    },
  });
  const bulkItem = await prisma.checklistItem.create({
    data: {
      module: "model_classroom",
      category: "Concurrency test",
      name: `Bulk update ${suffix}`,
    },
  });
  const spaces = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      prisma.space.create({
        data: {
          universityId: university.id,
          spaceType: "model_classroom",
          name: `Concurrency room ${index + 1}`,
        },
      }),
    ),
  );
  const singleStatus = await prisma.spaceChecklistStatus.create({
    data: {
      universityId: university.id,
      spaceId: spaces[0].id,
      checklistItemId: singleItem.id,
    },
  });
  await prisma.spaceChecklistStatus.createMany({
    data: spaces.slice(1).map((space) => ({
      universityId: university.id,
      spaceId: space.id,
      checklistItemId: bulkItem.id,
    })),
  });

  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
    await prisma.university.delete({ where: { id: university.id } });
    await prisma.checklistItem.deleteMany({
      where: { id: { in: [singleItem.id, bulkItem.id] } },
    });
    await prisma.user.delete({ where: { id: user.id } });
  });

  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const authorization = `Bearer ${signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    zoneIds: [],
    universityIds: [],
  })}`;
  const request = (path: string, init?: RequestInit) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
  const reportDate = new Date().toISOString().slice(0, 10);
  const initialReportResponse = await request(
    `/universities/${university.id}/daily-report?date=${reportDate}`,
  );
  assert.equal(initialReportResponse.status, 200);
  const initialReport = await initialReportResponse.json() as {
    summary: { overallReadiness: number };
  };
  assert.equal(initialReport.summary.overallReadiness, 0);

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
  await acquiredLock;

  const singleRequest = request(
    `/universities/${university.id}/status/${singleStatus.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ currentStatus: "Done" }),
    },
  );
  const bulkRequest = request(`/universities/${university.id}/status/bulk`, {
    method: "POST",
    body: JSON.stringify({
      updates: [{
        checklistItemId: bulkItem.id,
        spaceIds: spaces.slice(1).map((space) => space.id),
        currentStatus: "Done",
      }],
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  releaseUniversityLock();
  await lockTransaction;

  const [singleResponse, bulkResponse] = await Promise.all([singleRequest, bulkRequest]);
  assert.equal(singleResponse.status, 200);
  assert.equal(bulkResponse.status, 200);

  const finalRows = await prisma.spaceChecklistStatus.findMany({
    where: {
      universityId: university.id,
      space: { isDeleted: false },
    },
    select: { currentStatus: true },
  });
  const expectedReadiness = Math.round(
    finalRows.filter((row) => completionStatuses.has(row.currentStatus)).length
      / finalRows.length
      * 100,
  );
  const persisted = await prisma.university.findUniqueOrThrow({
    where: { id: university.id },
    select: { overallReadiness: true },
  });
  const listResponse = await request(`/universities?search=${encodeURIComponent(university.name)}`);
  assert.equal(listResponse.status, 200);
  const listedUniversities = await listResponse.json() as Array<{
    id: string;
    overallReadiness: number;
  }>;
  const listed = listedUniversities.find((entry) => entry.id === university.id);

  assert.equal(finalRows.length, 4);
  assert.equal(expectedReadiness, 100);
  assert.equal(persisted.overallReadiness, expectedReadiness);
  assert.equal(listed?.overallReadiness, expectedReadiness);
  const refreshedReportResponse = await request(
    `/universities/${university.id}/daily-report?date=${reportDate}`,
  );
  assert.equal(refreshedReportResponse.status, 200);
  const refreshedReport = await refreshedReportResponse.json() as {
    summary: { overallReadiness: number };
  };
  assert.equal(refreshedReport.summary.overallReadiness, expectedReadiness);
});