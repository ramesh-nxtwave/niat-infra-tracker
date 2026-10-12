import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";

test("the complete Express app initializes in the TypeScript test runner", async () => {
  const { default: app } = await import("./app");

  assert.equal(typeof app, "function");
  assert.equal(typeof app.listen, "function");
});

test("GET /api/health is public and returns only the service status", async (t) => {
  const { default: app } = await import("./app");
  const server = app.listen(0);
  t.after(() => server.close());

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
