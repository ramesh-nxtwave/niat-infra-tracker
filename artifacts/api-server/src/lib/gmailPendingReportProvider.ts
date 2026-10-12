import { ReplitConnectors } from "@replit/connectors-sdk";
import { PendingReportError } from "./pendingReportTypes";
import type { PendingReportMessage, PendingReportProvider } from "./pendingReport";

export const PENDING_REPORT_GMAIL_SENDER = "niat.infra@gmail.com";
const GMAIL_CONNECTOR = "google-mail";
const PROFILE_PATH = "/gmail/v1/users/me/profile";
const SEND_PATH = "/gmail/v1/users/me/messages/send";
const DEFAULT_TIMEOUT_MS = 10_000;

type GmailProviderErrorOptions = {
  outcome?: "known_failure" | "unknown";
};

/**
 * Errors from the Gmail preflight are known failures: no send request has
 * started and retrying the same confirmation is safe. Errors after the
 * messages.send request starts are explicitly marked unknown because Gmail
 * does not offer an idempotency key.
 */
export class GmailPendingReportError extends PendingReportError {
  readonly providerOutcome: "known_failure" | "unknown";

  constructor(status: number, message: string, options: GmailProviderErrorOptions = {}) {
    super(status, message);
    this.name = "GmailPendingReportError";
    this.providerOutcome = options.outcome || "known_failure";
  }
}

/**
 * `proxy` is intentionally retained for the profile preflight. Gmail's
 * messages.send request uses the public URL/header helpers directly because
 * the SDK's proxy convenience method retries HTTP 401, which is unsafe for a
 * non-idempotent send.
 */
export type GmailConnector = Pick<ReplitConnectors, "proxy" | "getProxyUrl" | "getProxyHeaders">;

type GmailPendingReportProviderConfig = {
  senderEmail: string;
  senderName: string;
};

function assertHeaderSafe(value: string, headerName: string): void {
  if (!value || /[\r\n\0]/.test(value)) {
    throw new GmailPendingReportError(400, `Gmail report ${headerName} contains invalid header characters.`);
  }
}

function assertEmailSafe(value: string, fieldName: string): void {
  assertHeaderSafe(value, fieldName);
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new GmailPendingReportError(400, `Gmail report ${fieldName} is invalid.`);
  }
}

function encodeMimeHeader(value: string): string {
  // All values are header-safe before this function is called. ASCII headers
  // remain readable; non-ASCII display names/subjects use RFC 2047.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64Lines(value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function safeAttachmentFilename(filename: string): string {
  assertHeaderSafe(filename, "attachment filename");
  if (!filename || filename.length > 255 || /[/\\";]/.test(filename)) {
    throw new GmailPendingReportError(400, "Gmail report attachment filename is invalid.");
  }
  return filename;
}

function makeBoundary(prefix: string, idempotencyKey: string): string {
  // A deterministic boundary is useful for diagnostics and never acts as an
  // idempotency mechanism. Gmail sends are intentionally never retried.
  const digest = Buffer.from(idempotencyKey, "utf8").toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  return `${prefix}_${digest || "report"}`;
}

export function buildGmailRfc822Message(
  message: PendingReportMessage,
  config: GmailPendingReportProviderConfig,
): string {
  assertEmailSafe(config.senderEmail, "sender");
  assertHeaderSafe(config.senderName, "sender name");
  assertHeaderSafe(message.subject, "subject");
  assertHeaderSafe(message.filename, "attachment filename");
  for (const recipient of message.recipients) assertEmailSafe(recipient, "recipient");
  const filename = safeAttachmentFilename(message.filename);
  const mixedBoundary = makeBoundary("niat-mixed", message.idempotencyKey);
  const alternativeBoundary = makeBoundary("niat-alternative", `${message.idempotencyKey}:alternative`);

  return [
    `From: ${encodeMimeHeader(config.senderName)} <${config.senderEmail}>`,
    `To: ${message.recipients.join(", ")}`,
    `Subject: ${encodeMimeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    `--${alternativeBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.text),
    `--${alternativeBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.html),
    `--${alternativeBoundary}--`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: text/csv; name="${encodeMimeHeader(filename)}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${encodeMimeHeader(filename)}"`,
    "",
    base64Lines(message.csv),
    `--${mixedBoundary}--`,
    "",
  ].join("\r\n");
}

function profileEmail(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const emailAddress = (value as { emailAddress?: unknown }).emailAddress;
  return typeof emailAddress === "string" ? emailAddress.trim().toLowerCase() : null;
}

function responseErrorBody(body: string): string {
  const trimmed = body.replace(/[\r\n]+/g, " ").trim();
  return trimmed.slice(0, 300);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Manual Gmail delivery. The profile read is a preflight account check; only
 * after it matches the frozen sender does this class call messages.send.
 */
export class GmailPendingReportProvider implements PendingReportProvider {
  readonly providerKind = "gmail" as const;

  constructor(
    private readonly config: GmailPendingReportProviderConfig,
    private readonly connector: GmailConnector = new ReplitConnectors(),
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: PendingReportMessage): Promise<{ id: string }> {
    if (this.config.senderEmail.trim().toLowerCase() !== PENDING_REPORT_GMAIL_SENDER) {
      throw new GmailPendingReportError(
        503,
        `Gmail pending reports are restricted to the approved sender ${PENDING_REPORT_GMAIL_SENDER}.`,
      );
    }

    try {
      // Render and validate all operator-reviewed headers before touching the
      // connector. A malformed snapshot must never trigger even a profile
      // request, much less a send request.
      const raw = base64Url(buildGmailRfc822Message(message, this.config));
      let profileResponse: Response;
      try {
        profileResponse = await withTimeout(
          this.connector.proxy(GMAIL_CONNECTOR, PROFILE_PATH, { method: "GET" }),
          this.timeoutMs,
          () => new GmailPendingReportError(503, "Could not verify the connected Gmail sender within 10 seconds. No email was sent."),
        );
      } catch {
        throw new GmailPendingReportError(503, "Could not verify the connected Gmail sender. No email was sent.");
      }
      if (!profileResponse.ok) {
        let body = "";
        try {
          body = responseErrorBody(await profileResponse.text());
        } catch {
          // The profile request already returned a response, so a response
          // body read failure still proves messages.send was not started.
        }
        throw new GmailPendingReportError(
          503,
          `Could not verify the connected Gmail sender (HTTP ${profileResponse.status})${body ? `: ${body}` : ""}. No email was sent.`,
        );
      }

      let profile: unknown;
      try {
        profile = await profileResponse.json();
      } catch {
        throw new GmailPendingReportError(503, "The connected Gmail profile response was invalid. No email was sent.");
      }
      if (profileEmail(profile) !== this.config.senderEmail.trim().toLowerCase()) {
        throw new GmailPendingReportError(
          409,
          `Connected Gmail account does not match the approved report sender ${this.config.senderEmail}. No email was sent.`,
        );
      }

      let sendResponse: Response;
      try {
        // Gmail messages.send has no idempotency support. Do not use
        // connector.proxy or createProxyFetch here: both convenience methods
        // retry HTTP 401. Public URL/header helpers provide the authenticated
        // proxy transport without exposing or manually handling OAuth tokens.
        const proxyUrl = `${this.connector.getProxyUrl().replace(/\/$/, "")}${SEND_PATH}`;
        let proxyHeaders: Record<string, string>;
        try {
          proxyHeaders = await this.connector.getProxyHeaders(GMAIL_CONNECTOR);
        } catch {
          throw new GmailPendingReportError(503, "Could not authenticate the connected Gmail sender. No email was sent.");
        }
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new GmailPendingReportError(
              504,
              "Gmail did not respond within 10 seconds. Do not resend this report; an operator must reconcile the connected Gmail account.",
              { outcome: "unknown" },
            ));
          }, this.timeoutMs);
        });
        try {
          sendResponse = await Promise.race([
            this.fetchImpl(proxyUrl, {
              method: "POST",
              headers: { ...proxyHeaders, "Content-Type": "application/json" },
              body: JSON.stringify({ raw }),
              signal: controller.signal,
            }),
            deadline,
          ]);
          // Keep the same deadline active while consuming the response body.
          // A successful HTTP response without a readable body is still an
          // unknown Gmail outcome, never permission to submit again.
          if (!sendResponse.ok) {
            let body = "";
            try {
              body = responseErrorBody(await Promise.race([sendResponse.text(), deadline]));
            } catch {
              // The HTTP status is known, but a body read timeout still means
              // the delivery outcome cannot be safely inferred.
              throw new GmailPendingReportError(
                504,
                "Gmail returned a response whose body could not be read. Do not resend this report; an operator must reconcile the connected Gmail account.",
                { outcome: "unknown" },
              );
            }
            // Authentication/routing failures are known not to have accepted
            // a message. Rate limits and server failures can race acceptance.
            const outcome = sendResponse.status === 400 || sendResponse.status === 401 ||
              sendResponse.status === 403 || sendResponse.status === 404
              ? "known_failure"
              : "unknown";
            throw new GmailPendingReportError(
              outcome === "unknown" ? 504 : 502,
              outcome === "unknown"
                ? `Gmail returned HTTP ${sendResponse.status} without a provable outcome. Do not resend this report; an operator must reconcile the connected Gmail account.`
                : `Gmail rejected the report request (HTTP ${sendResponse.status})${body ? `: ${body}` : ""}. No email was sent.`,
              { outcome },
            );
          }

          let result: unknown;
          try {
            result = await Promise.race([sendResponse.json(), deadline]);
          } catch {
            throw new GmailPendingReportError(
              504,
              "Gmail accepted a request but returned an invalid response. Do not resend this report; an operator must reconcile the connected Gmail account.",
              { outcome: "unknown" },
            );
          }
          const id = result && typeof result === "object" && typeof (result as { id?: unknown }).id === "string"
            ? (result as { id: string }).id.trim()
            : "";
          if (!id) {
            throw new GmailPendingReportError(
              504,
              "Gmail accepted an incomplete response without a message ID. Do not resend this report; an operator must reconcile the connected Gmail account.",
              { outcome: "unknown" },
            );
          }
          return { id };
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      } catch (error) {
        if (error instanceof GmailPendingReportError) throw error;
        const isAbort = (error as Error).name === "AbortError";
        throw new GmailPendingReportError(
          504,
          isAbort
            ? "Gmail did not respond within 10 seconds. Do not resend this report; an operator must reconcile the connected Gmail account."
            : "Gmail did not return a delivery outcome. Do not resend this report; an operator must reconcile the connected Gmail account.",
          { outcome: "unknown" },
        );
      }
    } catch (error) {
      if (error instanceof GmailPendingReportError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new GmailPendingReportError(
          504,
          "Gmail did not respond within 10 seconds. Do not resend this report; an operator must reconcile the connected Gmail account.",
          { outcome: "unknown" },
        );
      }
      throw new GmailPendingReportError(
        504,
        "Gmail delivery ended without a provable outcome. Do not resend this report; an operator must reconcile the connected Gmail account.",
        { outcome: "unknown" },
      );
    }
  }
}
