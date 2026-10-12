import assert from "node:assert/strict";
import test from "node:test";
import {
  GmailPendingReportError,
  GmailPendingReportProvider,
  PENDING_REPORT_GMAIL_SENDER,
} from "./gmailPendingReportProvider";
import {
  buildPendingDataset,
  buildPendingHtml,
  buildPendingText,
  buildPendingCsv,
  PendingReportError,
  InMemoryPendingReportSnapshotStore,
  PendingReportService,
  type PendingReportDataSource,
  type PendingReportMessage,
  type PendingReportProvider,
} from "./pendingReport";

const message: PendingReportMessage = {
  recipients: ["recipient@example.com"],
  subject: "Reviewed pending report",
  html: "<p>Pending &amp; safe</p>",
  text: "Pending and safe",
  csv: "University,Pending\r\nNIAT,1",
  filename: "pending-work-report.csv",
  idempotencyKey: "frozen-gmail-preview-key",
};

test("reviewed grouped email and complete alternatives reach Gmail MIME unchanged without live delivery", async () => {
  const { connector } = connectorWithResponses([
    new Response(JSON.stringify({ emailAddress: PENDING_REPORT_GMAIL_SENDER }), { status: 200 }),
  ]);
  let raw = "";
  const provider = new GmailPendingReportProvider(
    { senderEmail: PENDING_REPORT_GMAIL_SENDER, senderName: "NIAT InfraTracker" },
    connector, 10_000,
    async (_input, init) => {
      raw = Buffer.from(JSON.parse(init!.body as string).raw, "base64url").toString("utf8");
      return new Response(JSON.stringify({ id: "synthetic-only" }), { status: 200 });
    },
  );
  const dataset = buildPendingDataset(["Alpha & <University>", "Beta University"].map((name, index) => ({
    id: `u-${index}`, name, targetDate: null,
    classrooms: [{ roomId: "C-101" }],
    spaces: ["overall_classroom", "model_classroom", "lab", "staff_room"].map((spaceType, room) => ({
      name: room === 0 ? "C-101" : `${spaceType} room`, spaceType,
      checklistStatuses: [{
        id: `${index}-${room}`, currentStatus: room === 0 ? "Blocker" : "In-Progress",
        remarks: `Vendor <approval> & parts ${"long remark ".repeat(40)}`,
        targetTimeline: "2026-05-01", universityTimeline: null, isBlocker: room === 0,
        checklistItem: { category: "Electrical", name: `Unique task ${index}-${room}` },
      }],
    })),
  })), new Date("2026-05-15T12:00:00Z"), { recipients: ["reviewer@example.test"] });
  const expected = {
    ...message, recipients: dataset.recipients,
    html: buildPendingHtml(dataset), text: buildPendingText(dataset), csv: buildPendingCsv(dataset),
  };
  await provider.send(expected);
  const decodePart = (type: string) => {
    const start = raw.indexOf(`Content-Type: ${type};`);
    assert.ok(start >= 0);
    const bodyStart = raw.indexOf("\r\n\r\n", start) + 4;
    const end = raw.indexOf("\r\n--", bodyStart);
    return Buffer.from(raw.slice(bodyStart, end).replace(/\r\n/g, ""), "base64").toString("utf8");
  };
  assert.equal(decodePart("text/html"), expected.html);
  assert.equal(decodePart("text/plain"), expected.text);
  assert.equal(decodePart("text/csv"), expected.csv);
  assert.match(raw, /To: reviewer@example.test\r\n/);
  const stripped = decodePart("text/html").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  for (const label of ["Classrooms", "Lab Room", "Staff Room", "Overdue"]) assert.ok(stripped.includes(label));
  assert.match(stripped, /Alpha &amp; &lt;University&gt;/);
  const cells = stripped.match(/<(?:td|th)\b[^>]*>/g) || [];
  assert.ok(cells.length > 0);
  assert.ok(cells.every(cell => /style="[^"]*border/.test(cell) && /style="[^"]*padding/.test(cell)));
  for (const university of dataset.universities) for (const item of university.pendingItems) {
    for (const part of [stripped, expected.text, expected.csv]) assert.ok(part.includes(item.item));
  }
});

function connectorWithResponses(responses: Response[]) {
  const calls: Array<{ connector: string; path: string; options?: Record<string, unknown> }> = [];
  return {
    calls,
    connector: {
      async proxy(connector: string, path: string, options?: Record<string, unknown>) {
        calls.push({ connector, path, options });
        const response = responses.shift();
        if (!response) throw new Error("unexpected connector call");
        return response;
      },
      getProxyUrl() {
        return "https://proxy.test/api/v2/proxy";
      },
      async getProxyHeaders(connector: string) {
        return { Authorization: "Bearer mocked", "Connector-Name": connector };
      },
    },
  };
}

test("Gmail provider verifies the profile and sends multipart MIME with a CSV attachment", async () => {
  const { calls, connector } = connectorWithResponses([
    new Response(JSON.stringify({ emailAddress: PENDING_REPORT_GMAIL_SENDER }), { status: 200 }),
  ]);
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const provider = new GmailPendingReportProvider(
    { senderEmail: PENDING_REPORT_GMAIL_SENDER, senderName: "NIAT InfraTracker" },
    connector,
    10_000,
    async (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return new Response(JSON.stringify({ id: "gmail-message-id" }), { status: 200 });
    },
  );

  const result = await provider.send(message);

  assert.equal(result.id, "gmail-message-id");
  assert.deepEqual(calls.map(call => [call.connector, call.path, call.options?.method]), [
    ["google-mail", "/gmail/v1/users/me/profile", "GET"],
  ]);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].input, "https://proxy.test/api/v2/proxy/gmail/v1/users/me/messages/send");
  const sendOptions = fetchCalls[0].init!;
  assert.equal(sendOptions.method, "POST");
  assert.deepEqual(sendOptions.headers, {
    Authorization: "Bearer mocked",
    "Connector-Name": "google-mail",
    "Content-Type": "application/json",
  });
  const body = JSON.parse(sendOptions.body as string) as { raw: string };
  assert.equal(Object.keys(body).join(","), "raw");
  assert.equal(body.raw.includes("+") || body.raw.includes("/") || body.raw.includes("="), false, "raw must be base64url");
  const raw = Buffer.from(body.raw, "base64url").toString("utf8");
  assert.match(raw, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(raw, /Content-Type: multipart\/alternative; boundary=/);
  assert.match(raw, /Content-Type: text\/html; charset=UTF-8/);
  assert.match(raw, /Content-Type: text\/csv; name="pending-work-report\.csv"/);
  assert.match(raw, /Content-Disposition: attachment; filename="pending-work-report\.csv"/);
  assert.match(raw, new RegExp(Buffer.from(message.csv).toString("base64").slice(0, 16)));
  assert.doesNotMatch(JSON.stringify(sendOptions), /Idempotency-Key/i);
});

test("Gmail messages.send HTTP 401 is one POST with no SDK retry", async () => {
  const { calls, connector } = connectorWithResponses([
    new Response(JSON.stringify({ emailAddress: PENDING_REPORT_GMAIL_SENDER }), { status: 200 }),
  ]);
  let postCalls = 0;
  const provider = new GmailPendingReportProvider(
    { senderEmail: PENDING_REPORT_GMAIL_SENDER, senderName: "NIAT InfraTracker" },
    connector,
    10_000,
    async () => {
      postCalls++;
      return new Response("unauthorized", { status: 401 });
    },
  );

  await assert.rejects(
    () => provider.send(message),
    (error: unknown) => error instanceof GmailPendingReportError &&
      error.status === 502 && error.providerOutcome === "known_failure",
  );
  assert.equal(postCalls, 1);
  assert.equal(calls.length, 1, "only the profile preflight used connector.proxy");
});

test("Gmail send deadline aborts one in-flight POST and does not create a late retry", async () => {
  const { connector } = connectorWithResponses([
    new Response(JSON.stringify({ emailAddress: PENDING_REPORT_GMAIL_SENDER }), { status: 200 }),
  ]);
  let postCalls = 0;
  const provider = new GmailPendingReportProvider(
    { senderEmail: PENDING_REPORT_GMAIL_SENDER, senderName: "NIAT InfraTracker" },
    connector,
    5,
    async (_input, init) => {
      postCalls++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    },
  );

  await assert.rejects(
    () => provider.send(message),
    (error: unknown) => error instanceof GmailPendingReportError &&
      error.status === 504 && error.providerOutcome === "unknown",
  );
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(postCalls, 1);
});

test("Gmail response-body timeout is unknown and service blocks a second confirmation", async () => {
  const { connector } = connectorWithResponses([
    new Response(JSON.stringify({ emailAddress: PENDING_REPORT_GMAIL_SENDER }), { status: 200 }),
  ]);
  let postCalls = 0;
  const provider = new GmailPendingReportProvider(
    { senderEmail: PENDING_REPORT_GMAIL_SENDER, senderName: "NIAT InfraTracker" },
    connector,
    5,
    async (_input, init) => {
      postCalls++;
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, "json", {
        value: () => new Promise<unknown>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      });
      return response;
    },
  );
  const service = new PendingReportService(
    emptyDataSource,
    { async recordAccepted() {} },
    () => gmailDelivery(provider),
    () => new Date("2026-05-15T12:00:00.000Z"),
    new InMemoryPendingReportSnapshotStore(),
  );
  const preview = await service.createPreview("admin-1", "admin@example.test");

  await assert.rejects(
    () => service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 504,
  );
  await assert.rejects(
    () => service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 409 &&
      /Gmail send has an unknown or in-flight outcome/.test(error.message),
  );
  assert.equal(postCalls, 1);
});

test("Gmail provider refuses an account mismatch before messages.send", async () => {
  const { calls, connector } = connectorWithResponses([
    new Response(JSON.stringify({ emailAddress: "another-account@gmail.com" }), { status: 200 }),
  ]);
  const provider = new GmailPendingReportProvider(
    { senderEmail: PENDING_REPORT_GMAIL_SENDER, senderName: "NIAT InfraTracker" },
    connector,
  );

  await assert.rejects(
    () => provider.send(message),
    (error: unknown) => error instanceof GmailPendingReportError &&
      error.status === 409 && /does not match/.test(error.message) &&
      error.providerOutcome === "known_failure",
  );
  assert.equal(calls.length, 1);
});

test("Gmail provider rejects header injection without contacting the connector", async () => {
  let calls = 0;
  const provider = new GmailPendingReportProvider(
    { senderEmail: PENDING_REPORT_GMAIL_SENDER, senderName: "NIAT InfraTracker" },
    {
      async proxy() { calls++; return new Response("{}"); },
      getProxyUrl() { return "https://proxy.test/api/v2/proxy"; },
      async getProxyHeaders() { return {}; },
    },
  );

  await assert.rejects(
    () => provider.send({ ...message, subject: "safe\r\nBcc: attacker@example.com" }),
    (error: unknown) => error instanceof GmailPendingReportError && error.status === 400,
  );
  assert.equal(calls, 0);
});

const emptyDataSource: PendingReportDataSource = {
  async activeUniversities() { return []; },
};

function gmailDelivery(provider: PendingReportProvider) {
  return {
    mode: "live" as const,
    message: `Live mode: confirmation submits the reviewed report to Gmail (${PENDING_REPORT_GMAIL_SENDER}).`,
    provider,
    providerKind: "gmail" as const,
    senderEmail: PENDING_REPORT_GMAIL_SENDER,
    senderName: "NIAT InfraTracker",
  };
}

test("Gmail unknown outcome is durable and never retried after its lease expires", async () => {
  const provider: PendingReportProvider = {
    providerKind: "gmail",
    async send() {
      throw new PendingReportError(504, "Gmail outcome is unknown");
    },
  };
  const delivery = () => gmailDelivery(provider);
  const store = new InMemoryPendingReportSnapshotStore();
  let current = new Date("2026-05-15T12:00:00.000Z");
  const service = new PendingReportService(
    emptyDataSource,
    { async recordAccepted() {} },
    delivery,
    () => current,
    store,
  );
  const preview = await service.createPreview("admin-1", "admin@example.test");

  await assert.rejects(
    () => service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 504,
  );
  current = new Date(current.getTime() + 31_000);
  await assert.rejects(
    () => service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 409 &&
      /Gmail send has an unknown or in-flight outcome/.test(error.message),
  );
});

test("accepted Gmail snapshots replay the receipt without contacting the provider", async () => {
  let calls = 0;
  const provider: PendingReportProvider = {
    providerKind: "gmail",
    async send() {
      calls++;
      return { id: "gmail-accepted-id" };
    },
  };
  const service = new PendingReportService(
    emptyDataSource,
    { async recordAccepted() {} },
    () => gmailDelivery(provider),
    () => new Date("2026-05-15T12:00:00.000Z"),
    new InMemoryPendingReportSnapshotStore(),
  );
  const preview = await service.createPreview("admin-1", "admin@example.test");
  const first = await service.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  });
  const replay = await service.confirm({
    previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test",
  });

  assert.equal(calls, 1);
  assert.equal(first.providerId, "gmail-accepted-id");
  assert.equal(replay.providerId, "gmail-accepted-id");
  assert.equal(replay.deliveryProvider, "gmail");
  assert.equal(replay.senderEmail, PENDING_REPORT_GMAIL_SENDER);
  assert.match(replay.message, /^Gmail accepted/);
});

test("a changed provider cannot send a frozen Gmail snapshot", async () => {
  let sendCalls = 0;
  let changed = false;
  const gmailProvider: PendingReportProvider = {
    providerKind: "gmail",
    async send() {
      sendCalls++;
      return { id: "should-not-send" };
    },
  };
  const resendProvider: PendingReportProvider = {
    providerKind: "resend",
    async send() {
      sendCalls++;
      return { id: "should-not-send" };
    },
  };
  const service = new PendingReportService(
    emptyDataSource,
    { async recordAccepted() {} },
    () => changed ? {
      mode: "live" as const, message: "Resend", provider: resendProvider,
      providerKind: "resend" as const, senderEmail: "reports@example.com", senderName: "NIAT",
    } : gmailDelivery(gmailProvider),
    () => new Date("2026-05-15T12:00:00.000Z"),
    new InMemoryPendingReportSnapshotStore(),
  );
  const preview = await service.createPreview("admin-1", "admin@example.test");
  changed = true;

  await assert.rejects(
    () => service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 409 &&
      /reviewed for gmail/.test(error.message),
  );
  assert.equal(sendCalls, 0);
});

test("a changed Gmail sender cannot send a frozen snapshot", async () => {
  let changed = false;
  let sendCalls = 0;
  const provider: PendingReportProvider = {
    providerKind: "gmail",
    async send() {
      sendCalls++;
      return { id: "should-not-send" };
    },
  };
  const service = new PendingReportService(
    emptyDataSource,
    { async recordAccepted() {} },
    () => changed
      ? {
        mode: "live" as const, message: "Gmail", provider,
        providerKind: "gmail" as const, senderEmail: "different@gmail.com", senderName: "NIAT InfraTracker",
      }
      : gmailDelivery(provider),
    () => new Date("2026-05-15T12:00:00.000Z"),
    new InMemoryPendingReportSnapshotStore(),
  );
  const preview = await service.createPreview("admin-1", "admin@example.test");
  changed = true;

  await assert.rejects(
    () => service.confirm({ previewId: preview.previewId, confirmed: true, userId: "admin-1", userEmail: "admin@example.test" }),
    (error: unknown) => error instanceof PendingReportError && error.status === 409 &&
      /sender changed/.test(error.message),
  );
  assert.equal(sendCalls, 0);
});
